import * as THREE from 'three';
import {
  CharacterId,
  MissionId,
  RadarBlip,
  WeaponId,
} from './types';
import {
  getDistrictName,
  LANDMARKS,
  MISSIONS,
  PROTAGONISTS,
  WEAPON_WHEEL_ORDER,
  WEAPONS,
} from './data';
import {
  CharacterRig,
  createCharacterRig,
  createPoliceHelicopterMesh,
  createVehicleMesh,
  HelicopterRig,
  updateRigWeaponVisual,
  VehicleRig,
} from './meshes';
import { BarrelEntity, BoxCollider, buildLosSantosCity } from './city';
import { useGameStore } from './store';
import { sound } from './audio';

interface NPCEntity {
  id: string;
  rig: CharacterRig;
  x: number;
  z: number;
  rotY: number;
  hp: number;
  maxHp: number;
  role: 'civilian' | 'cop' | 'swat' | 'mission_enemy';
  weapon: WeaponId;
  fireCooldown: number;
  dead: boolean;
  deathTimer: number;
  walkPhase: number;
}

interface VehicleEntity {
  id: string;
  name: string;
  kind: 'sport' | 'sedan' | 'suv' | 'police' | 'swat';
  rig: VehicleRig;
  x: number;
  z: number;
  rotY: number;
  speed: number;
  maxSpeed: number;
  hp: number;
  maxHp: number;
  exploded: boolean;
  isMissionTarget?: boolean;
  aiCop?: boolean;
}

interface HeliEntity {
  rig: HelicopterRig;
  x: number;
  y: number;
  z: number;
  rotY: number;
  hp: number;
  maxHp: number;
  active: boolean;
  crashing: boolean;
  fireCooldown: number;
}

interface RocketProjectile {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

interface VisualEffect {
  mesh: THREE.Object3D;
  life: number;
  maxLife: number;
  onUpdate?: (progress: number, dt: number) => void;
}

interface LootDrop {
  id: string;
  mesh: THREE.Mesh;
  x: number;
  z: number;
  type: 'cash' | 'health' | 'armor';
  amount: number;
}

export class LosSantosEngine {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private animId = 0;
  private lastTime = 0;

  // World data
  private colliders: BoxCollider[] = [];
  private barrels: BarrelEntity[] = [];
  private shootableMeshes: THREE.Object3D[] = [];

  // Protagonist Rigs
  private charRigs: Record<CharacterId, CharacterRig>;
  private charVelY: Record<CharacterId, number> = {
    michael: 0,
    franklin: 0,
    trevor: 0,
  };
  private charPosY: Record<CharacterId, number> = {
    michael: 0,
    franklin: 0,
    trevor: 0,
  };

  // Camera & Input
  private camYaw = Math.PI;
  private camPitch = 0.18;
  private camDist = 6.5;
  private resizeObserver: ResizeObserver | null = null;
  private keys = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;
  private fireTimer = 0;
  private rollTimer = 0;
  private rollDir = new THREE.Vector2();

  // Sky-Cam Character Transition State
  private skyCam: {
    active: boolean;
    fromChar: CharacterId;
    toChar: CharacterId;
    timer: number;
    duration: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
  } | null = null;

  // Entities
  private npcs: NPCEntity[] = [];
  private vehicles: VehicleEntity[] = [];
  private currentVehicle: VehicleEntity | null = null;
  private heli: HeliEntity;
  private rockets: RocketProjectile[] = [];
  private effects: VisualEffect[] = [];
  private loots: LootDrop[] = [];

  // Mission Marker 3D cylinder
  private missionBeacon: THREE.Mesh;

  // Wanted & Police Timers
  private wantedDecayTimer = 0;
  private copSpawnTimer = 0;
  private hudSyncTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    // Clear any residual canvas from React StrictMode double-mount
    this.container.innerHTML = '';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6d7c88);
    this.scene.fog = new THREE.Fog(0x6d7c88, 65, 290);

    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(62, w / h, 0.2, 480);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
    container.appendChild(this.renderer.domElement);

    // Golden-hour Los Santos Sunset Lighting
    const ambient = new THREE.AmbientLight(0x64748b, 0.9);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xffe4c4, 0x3a4438, 1.05);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe8d0, 1.55);
    sun.position.set(-70, 115, 65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 340;
    const d = 140;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // Build City
    const city = buildLosSantosCity(this.scene);
    this.colliders = city.colliders;
    this.barrels = city.barrels;
    this.shootableMeshes = city.shootableMeshes;

    // Create 3 Protagonist 3D Rigs
    this.charRigs = {
      michael: this.createProtagonistRig('michael'),
      franklin: this.createProtagonistRig('franklin'),
      trevor: this.createProtagonistRig('trevor'),
    };

    // Create Police Helicopter
    const heliRig = createPoliceHelicopterMesh();
    heliRig.root.visible = false;
    this.scene.add(heliRig.root);
    this.heli = {
      rig: heliRig,
      x: 0,
      y: 34,
      z: 0,
      rotY: 0,
      hp: 450,
      maxHp: 450,
      active: false,
      crashing: false,
      fireCooldown: 1.5,
    };

    // Create Mission Beacon Cylinder
    const beaconGeo = new THREE.CylinderGeometry(2.4, 2.4, 18, 20, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.missionBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.missionBeacon.position.set(0, 9, 0);
    this.missionBeacon.visible = false;
    this.scene.add(this.missionBeacon);

    // Spawn Initial Vehicles & Civilians
    this.spawnInitialVehicles();
    this.spawnInitialCivilians();

    // Bind Events
    this.bindEvents();
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private createProtagonistRig(id: CharacterId): CharacterRig {
    const p = PROTAGONISTS[id];
    const rig = createCharacterRig({
      suitColor: p.suitColor,
      shirtColor: p.shirtColor,
      skinColor: p.skinColor,
      hairColor: p.hairColor,
    });
    rig.root.position.set(p.spawnPos[0], 0, p.spawnPos[1]);
    updateRigWeaponVisual(rig, p.defaultWeapon);
    this.scene.add(rig.root);
    return rig;
  }

  private spawnInitialVehicles() {
    const specs: {
      name: string;
      kind: 'sport' | 'sedan' | 'suv' | 'police' | 'swat';
      color: number;
      x: number;
      z: number;
      rotY: number;
      maxSpeed: number;
    }[] = [
      // Near Michael (Downtown / Pacific Bank)
      { name: '奧北 密探 (Obey Tailgater)', kind: 'sedan', color: 0x1e293b, x: -52, z: -76, rotY: 0, maxSpeed: 34 },
      { name: '佩嘉西 桑托勞 (Pegassi Zentorno)', kind: 'sport', color: 0xef4444, x: -12, z: -72, rotY: Math.PI * 0.5, maxSpeed: 44 },
      // Near Franklin (LS Customs)
      { name: '布拉瓦多 女妖 GT (Banshee GT)', kind: 'sport', color: 0x22c55e, x: 85, z: 22, rotY: -Math.PI * 0.5, maxSpeed: 45 },
      { name: '威皮 霸王 (Vapid Dominator)', kind: 'sport', color: 0x3b82f6, x: 64, z: -8, rotY: 0, maxSpeed: 39 },
      // Near Trevor (West Pier)
      { name: '卡ニス 菩提越野皮卡 (Canis Bodhi)', kind: 'suv', color: 0xd97706, x: -122, z: 112, rotY: Math.PI * 0.25, maxSpeed: 35 },
      // Around City
      { name: '貝飛特 莎夫特 (Benefactor Schafter)', kind: 'sedan', color: 0xa855f7, x: -12, z: 18, rotY: Math.PI * 0.5, maxSpeed: 36 },
      { name: 'LSPD 警用攔截者 (Police Interceptor)', kind: 'police', color: 0x0f172a, x: 84, z: -26, rotY: 0, maxSpeed: 41 },
      { name: 'NOOSE 防暴裝甲車 (Riot Armored)', kind: 'swat', color: 0x18181b, x: -38, z: -80, rotY: Math.PI * 0.5, maxSpeed: 31 },
    ];

    specs.forEach((s, idx) => {
      const rig = createVehicleMesh({ color: s.color, kind: s.kind });
      rig.root.position.set(s.x, 0, s.z);
      rig.root.rotation.y = s.rotY;
      this.scene.add(rig.root);
      this.vehicles.push({
        id: `veh_${idx}`,
        name: s.name,
        kind: s.kind,
        rig,
        x: s.x,
        z: s.z,
        rotY: s.rotY,
        speed: 0,
        maxSpeed: s.maxSpeed,
        hp: s.kind === 'swat' ? 420 : 220,
        maxHp: s.kind === 'swat' ? 420 : 220,
        exploded: false,
      });
    });
  }

  private spawnInitialCivilians() {
    const suitPalette = [0x334155, 0x7c2d12, 0x14532d, 0x4c1d95, 0x831843, 0x1e3a8a];
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const dist = 25 + (i % 4) * 28;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      this.spawnNPC({
        x,
        z,
        role: 'civilian',
        weapon: 'unarmed',
        suitColor: suitPalette[i % suitPalette.length],
      });
    }
  }

  private spawnNPC(opts: {
    x: number;
    z: number;
    role: 'civilian' | 'cop' | 'swat' | 'mission_enemy';
    weapon: WeaponId;
    suitColor?: number;
  }): NPCEntity {
    const isCop = opts.role === 'cop';
    const isSwat = opts.role === 'swat';
    const rig = createCharacterRig({
      suitColor: opts.suitColor ?? (opts.role === 'mission_enemy' ? 0x7f1d1d : 0x334155),
      shirtColor: opts.role === 'mission_enemy' ? 0xef4444 : 0x94a3b8,
      skinColor: 0xe0ac69,
      hairColor: 0x18181b,
      isCop,
      isSwat,
      showHpBar: opts.role !== 'civilian',
    });
    rig.root.position.set(opts.x, 0, opts.z);
    updateRigWeaponVisual(rig, opts.weapon);
    this.scene.add(rig.root);

    const maxHp = isSwat ? 160 : opts.role === 'mission_enemy' ? 120 : isCop ? 100 : 65;
    const npc: NPCEntity = {
      id: `npc_${Date.now()}_${Math.random()}`,
      rig,
      x: opts.x,
      z: opts.z,
      rotY: Math.random() * Math.PI * 2,
      hp: maxHp,
      maxHp,
      role: opts.role,
      weapon: opts.weapon,
      fireCooldown: 0.6 + Math.random() * 0.8,
      dead: false,
      deathTimer: 0,
      walkPhase: Math.random() * 10,
    };
    this.npcs.push(npc);
    return npc;
  }

  // === Public Actions callable from HUD ===
  public switchCharacter(target: CharacterId) {
    const state = useGameStore.getState();
    if (state.activeChar === target || this.skyCam?.active) return;

    // Exit vehicle if driving before switching
    if (this.currentVehicle) {
      this.exitVehicle();
    }

    const fromChar = state.activeChar;
    const fromRig = this.charRigs[fromChar];
    const toRig = this.charRigs[target];

    this.skyCam = {
      active: true,
      fromChar,
      toChar: target,
      timer: 0,
      duration: 1.85,
      fromPos: fromRig.root.position.clone(),
      toPos: toRig.root.position.clone(),
    };

    sound.playSkyCamStep(false);
    state.updateHUD({
      skyCamSwitching: true,
      skyCamTarget: target,
      charWheelOpen: false,
      weaponWheelOpen: false,
    });
  }

  public selectWeapon(weapon: WeaponId) {
    const state = useGameStore.getState();
    const active = state.activeChar;
    const charStates = { ...state.charStates };
    charStates[active] = { ...charStates[active], weapon };
    updateRigWeaponVisual(this.charRigs[active], weapon);
    state.updateHUD({ charStates, reloading: false });
  }

  public toggleSpecialAbility() {
    const state = useGameStore.getState();
    const cur = state.charStates[state.activeChar];
    if (!state.specialActive && cur.special < 15) return;
    state.updateHUD({ specialActive: !state.specialActive });
  }

  public triggerReload() {
    const state = useGameStore.getState();
    if (state.reloading) return;
    const wId = state.charStates[state.activeChar].weapon;
    const spec = WEAPONS[wId];
    const ammo = state.weapons[wId];
    if (wId === 'unarmed' || ammo.inMag >= spec.magSize || ammo.reserve <= 0) return;

    state.updateHUD({ reloading: true, reloadProgress: 0 });
  }

  public startMission(missionId: MissionId) {
    const state = useGameStore.getState();
    const def = MISSIONS[missionId];
    if (!def) return;

    // Clean up old mission enemies
    this.npcs = this.npcs.filter((n) => {
      if (n.role === 'mission_enemy') {
        this.scene.remove(n.rig.root);
        return false;
      }
      return true;
    });

    // Teleport active character near mission start if far away
    const activeRig = this.charRigs[state.activeChar];
    const dx = activeRig.root.position.x - def.startPos[0];
    const dz = activeRig.root.position.z - def.startPos[1];
    if (Math.hypot(dx, dz) > 45) {
      if (this.currentVehicle) {
        this.currentVehicle.x = def.startPos[0];
        this.currentVehicle.z = def.startPos[1];
        this.currentVehicle.rig.root.position.set(def.startPos[0], 0, def.startPos[1]);
      } else {
        activeRig.root.position.set(def.startPos[0], 0, def.startPos[1]);
      }
    }

    this.setupMissionStep(missionId, 0);

    state.updateHUD({
      activeMissionId: missionId,
      missionStepIdx: 0,
      banner: {
        type: 'heist_start',
        title: def.title,
        subtitle: `委託人：${def.giver} — 目標賞金 $${def.reward.toLocaleString()}`,
      },
    });

    setTimeout(() => {
      if (useGameStore.getState().banner.type === 'heist_start') {
        useGameStore.getState().updateHUD({
          banner: { type: null, title: '', subtitle: '' },
        });
      }
    }, 3200);
  }

  private setupMissionStep(missionId: MissionId, stepIdx: number) {
    const def = MISSIONS[missionId];
    const step = def.steps[stepIdx];
    if (!step) return;

    const [tx, tz] = step.targetPos;
    this.missionBeacon.position.set(tx, 9, tz);
    this.missionBeacon.visible = true;

    if (step.type === 'kill_targets') {
      const count = missionId === 'pacific_heist' ? 5 : missionId === 'pier_arms' ? 6 : 3;
      const weapon: WeaponId =
        missionId === 'pacific_heist'
          ? 'rifle'
          : missionId === 'pier_arms'
            ? 'shotgun'
            : 'smg';
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        this.spawnNPC({
          x: tx + Math.cos(ang) * 7.5,
          z: tz + Math.sin(ang) * 7.5,
          role: 'mission_enemy',
          weapon,
        });
      }
    } else if (step.type === 'enter_car') {
      // Spawn Simeon's Golden Banshee supercar
      const rig = createVehicleMesh({ color: 0xfacc15, kind: 'sport' });
      rig.root.position.set(tx, 0, tz);
      this.scene.add(rig.root);
      this.vehicles.push({
        id: `mission_car_${Date.now()}`,
        name: '西門限量版 黃金女妖超跑 (Golden Banshee)',
        kind: 'sport',
        rig,
        x: tx,
        z: tz,
        rotY: 0,
        speed: 0,
        maxSpeed: 48,
        hp: 320,
        maxHp: 320,
        exploded: false,
        isMissionTarget: true,
      });
    }

    useGameStore.getState().updateHUD({
      missionStepIdx: stepIdx,
      missionObjectiveText: step.instruction,
    });
  }

  public buyAmmuNationItem(item: 'ammo' | 'armor' | 'heavy') {
    const state = useGameStore.getState();
    if (item === 'ammo' && state.cash >= 1200) {
      const updated = { ...state.weapons };
      for (const wId of WEAPON_WHEEL_ORDER) {
        updated[wId] = {
          unlocked: true,
          inMag: WEAPONS[wId].magSize,
          reserve: WEAPONS[wId].maxReserve,
        };
      }
      state.addCash(-1200);
      state.updateHUD({ weapons: updated });
      sound.playCashPickup();
    } else if (item === 'armor' && state.cash >= 800) {
      const cs = { ...state.charStates };
      cs[state.activeChar] = {
        ...cs[state.activeChar],
        hp: 100,
        armor: 100,
      };
      state.addCash(-800);
      state.updateHUD({ charStates: cs });
      sound.playCashPickup();
    } else if (item === 'heavy' && state.cash >= 3500) {
      const updated = { ...state.weapons };
      updated.rpg = { unlocked: true, inMag: 1, reserve: 15 };
      updated.minigun = { unlocked: true, inMag: 200, reserve: 800 };
      updated.sniper = { unlocked: true, inMag: 6, reserve: 48 };
      state.addCash(-3500);
      state.updateHUD({ weapons: updated });
      this.selectWeapon('rpg');
      sound.playCashPickup();
    }
  }

  public useLSCustoms(service: 'repair' | 'respray' | 'clear_wanted') {
    const state = useGameStore.getState();
    if (service === 'repair' && state.cash >= 600) {
      if (this.currentVehicle) {
        this.currentVehicle.hp = this.currentVehicle.maxHp;
        this.currentVehicle.rig.smokeGroup.visible = false;
      }
      state.addCash(-600);
      sound.playCashPickup();
    } else if (service === 'respray' && state.cash >= 500) {
      if (this.currentVehicle) {
        const neonPalette = [0x22d3ee, 0xf43f5e, 0xa855f7, 0xfacc15, 0x10b981, 0xf97316];
        const randomCol = neonPalette[Math.floor(Math.random() * neonPalette.length)];
        this.currentVehicle.rig.bodyMat.color.setHex(randomCol);
      }
      state.addCash(-500);
      sound.playCashPickup();
    } else if (service === 'clear_wanted' && state.cash >= 1500) {
      this.clearWantedLevel();
      state.addCash(-1500);
      sound.playCashPickup();
    }
  }

  public clearWantedLevel() {
    this.heli.active = false;
    this.heli.rig.root.visible = false;
    this.npcs = this.npcs.filter((n) => {
      if (n.role === 'cop' || n.role === 'swat') {
        this.scene.remove(n.rig.root);
        return false;
      }
      return true;
    });
    useGameStore.getState().updateHUD({ wantedStars: 0, wantedCooldown: 0 });
  }

  public triggerInstantAction(action: 'spawn_supercar' | 'max_arsenal' | 'trigger_5star') {
    const state = useGameStore.getState();
    const rig = this.charRigs[state.activeChar];
    const px = rig.root.position.x;
    const pz = rig.root.position.z;

    if (action === 'spawn_supercar') {
      const vRig = createVehicleMesh({ color: 0x38bdf8, kind: 'sport' });
      const sx = px + Math.sin(this.camYaw) * 5.5;
      const sz = pz + Math.cos(this.camYaw) * 5.5;
      vRig.root.position.set(sx, 0, sz);
      this.scene.add(vRig.root);
      this.vehicles.push({
        id: `super_${Date.now()}`,
        name: '空投超跑 佩嘉西 奧西里斯 (Osiris GT)',
        kind: 'sport',
        rig: vRig,
        x: sx,
        z: sz,
        rotY: this.camYaw,
        speed: 0,
        maxSpeed: 48,
        hp: 300,
        maxHp: 300,
        exploded: false,
      });
      sound.playCashPickup();
    } else if (action === 'max_arsenal') {
      const updated = { ...state.weapons };
      for (const wId of WEAPON_WHEEL_ORDER) {
        updated[wId] = {
          unlocked: true,
          inMag: WEAPONS[wId].magSize,
          reserve: WEAPONS[wId].maxReserve,
        };
      }
      const cs = { ...state.charStates };
      cs[state.activeChar] = {
        ...cs[state.activeChar],
        hp: 100,
        armor: 100,
        special: 100,
      };
      state.updateHUD({ weapons: updated, charStates: cs });
      sound.playCashPickup();
    } else if (action === 'trigger_5star') {
      this.addWantedStars(5);
    }
  }

  private addWantedStars(targetStars: number) {
    const state = useGameStore.getState();
    const nextStars = Math.min(5, Math.max(state.wantedStars, targetStars));
    this.wantedDecayTimer = 0;

    if (nextStars >= 3 && !this.heli.active) {
      const rig = this.charRigs[state.activeChar];
      this.heli.active = true;
      this.heli.crashing = false;
      this.heli.hp = this.heli.maxHp;
      this.heli.x = rig.root.position.x + 35;
      this.heli.y = 34;
      this.heli.z = rig.root.position.z - 35;
      this.heli.rig.root.visible = true;
    }

    state.updateHUD({ wantedStars: nextStars, wantedCooldown: 1 });
  }

  // === Event Binding ===
  private bindEvents() {
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    this.renderer.domElement.addEventListener('click', () => {
      const state = useGameStore.getState();
      if (
        state.started &&
        !state.paused &&
        !state.weaponWheelOpen &&
        !state.charWheelOpen &&
        !state.shopModalOpen
      ) {
        this.renderer.domElement.requestPointerLock?.();
      }
    });
  }

  public dispose() {
    cancelAnimationFrame(this.animId);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  private onResize = () => {
    if (!this.container) return;
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const state = useGameStore.getState();
    if (!state.started) return;

    const code = e.code;
    this.keys.add(code);

    if (code === 'Escape') {
      if (state.shopModalOpen) {
        state.setShopModalOpen(null);
      } else {
        state.setPaused(!state.paused);
      }
      return;
    }

    if (state.paused) return;

    // Weapon Wheel (Tab)
    if (code === 'Tab') {
      e.preventDefault();
      if (!state.weaponWheelOpen) {
        document.exitPointerLock?.();
        state.updateHUD({ weaponWheelOpen: true });
      }
      return;
    }

    // Character Switch Wheel (AltLeft / AltRight)
    if (code === 'AltLeft' || code === 'AltRight') {
      e.preventDefault();
      if (!state.charWheelOpen) {
        document.exitPointerLock?.();
        state.updateHUD({ charWheelOpen: true });
      }
      return;
    }

    // Direct Character Hotkeys: F1 / F2 / F3 or Digit1 / Digit2 / Digit3
    if (code === 'Digit1') {
      this.switchCharacter('michael');
      return;
    }
    if (code === 'Digit2') {
      this.switchCharacter('franklin');
      return;
    }
    if (code === 'Digit3') {
      this.switchCharacter('trevor');
      return;
    }

    // Number keys 4..9 for quick weapons
    if (code === 'Digit4') this.selectWeapon('pistol');
    if (code === 'Digit5') this.selectWeapon('smg');
    if (code === 'Digit6') this.selectWeapon('shotgun');
    if (code === 'Digit7') this.selectWeapon('rifle');
    if (code === 'Digit8') this.selectWeapon('sniper');
    if (code === 'Digit9') this.selectWeapon('rpg');
    if (code === 'Digit0') this.selectWeapon('minigun');

    // Special Ability (Q or CapsLock)
    if (code === 'KeyQ' || code === 'CapsLock') {
      e.preventDefault();
      this.toggleSpecialAbility();
    }

    // Reload (R)
    if (code === 'KeyR') {
      this.triggerReload();
    }

    // Combat Roll (ControlLeft / KeyC)
    if ((code === 'ControlLeft' || code === 'KeyC') && !this.currentVehicle && this.rollTimer <= 0) {
      this.rollTimer = 0.42;
      const forward = new THREE.Vector2(Math.sin(this.camYaw), Math.cos(this.camYaw));
      this.rollDir.copy(forward);
    }

    // Interact: Enter/Exit Car or Landmark / Mission (E or F)
    if (code === 'KeyE' || code === 'KeyF') {
      this.handleInteraction();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const code = e.code;
    this.keys.delete(code);
    const state = useGameStore.getState();

    if (code === 'Tab' && state.weaponWheelOpen) {
      state.updateHUD({ weaponWheelOpen: false });
      this.renderer.domElement.requestPointerLock?.();
    }
    if ((code === 'AltLeft' || code === 'AltRight') && state.charWheelOpen) {
      state.updateHUD({ charWheelOpen: false });
      this.renderer.domElement.requestPointerLock?.();
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    const state = useGameStore.getState();
    if (!state.started || state.paused || state.weaponWheelOpen || state.charWheelOpen || state.shopModalOpen) {
      return;
    }
    if (document.pointerLockElement === this.renderer.domElement || this.mouseDownRight || this.mouseDownLeft) {
      const sens = state.aiming ? 0.0018 : 0.0028;
      this.camYaw -= e.movementX * sens;
      this.camPitch = Math.max(-0.16, Math.min(0.62, this.camPitch + e.movementY * sens));
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    const state = useGameStore.getState();
    if (!state.started || state.paused || state.weaponWheelOpen || state.charWheelOpen || state.shopModalOpen) {
      return;
    }
    if (e.button === 0) {
      this.mouseDownLeft = true;
      this.tryFireWeapon();
    } else if (e.button === 2) {
      this.mouseDownRight = true;
      state.updateHUD({ aiming: true });
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseDownLeft = false;
    } else if (e.button === 2) {
      this.mouseDownRight = false;
      useGameStore.getState().updateHUD({ aiming: false });
    }
  };

  private onWheel = (e: WheelEvent) => {
    const state = useGameStore.getState();
    if (!state.started || state.paused) return;
    // Cycle weapons with scroll wheel
    const curW = state.charStates[state.activeChar].weapon;
    const idx = WEAPON_WHEEL_ORDER.indexOf(curW);
    const dir = e.deltaY > 0 ? 1 : -1;
    const nextIdx = (idx + dir + WEAPON_WHEEL_ORDER.length) % WEAPON_WHEEL_ORDER.length;
    this.selectWeapon(WEAPON_WHEEL_ORDER[nextIdx]);
  };

  // === Interactions (Vehicles, Shops, Missions) ===
  private handleInteraction() {
    const state = useGameStore.getState();
    if (state.shopModalOpen) {
      state.setShopModalOpen(null);
      return;
    }

    const activeRig = this.charRigs[state.activeChar];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    // Check Landmarks first
    for (const lm of LANDMARKS) {
      const dist = Math.hypot(px - lm.x, pz - (lm.z + 8));
      if (dist < 9.5) {
        if (lm.type === 'ammu') {
          document.exitPointerLock?.();
          state.setShopModalOpen('ammu');
          return;
        }
        if (lm.type === 'customs') {
          document.exitPointerLock?.();
          state.setShopModalOpen('customs');
          return;
        }
        if (lm.type === 'hospital') {
          if (state.cash >= 300) {
            const cs = { ...state.charStates };
            cs[state.activeChar] = { ...cs[state.activeChar], hp: 100 };
            state.addCash(-300);
            state.updateHUD({ charStates: cs });
            sound.playCashPickup();
          }
          return;
        }
        if (lm.type === 'bank') {
          this.startMission('pacific_heist');
          return;
        }
        if (lm.type === 'pier') {
          this.startMission('pier_arms');
          return;
        }
        if (lm.type === 'villa') {
          this.startMission('simeon_repo');
          return;
        }
      }
    }

    // Enter or Exit Vehicle
    if (this.currentVehicle) {
      this.exitVehicle();
      return;
    }

    let nearest: VehicleEntity | null = null;
    let bestDist = 5.5;
    for (const v of this.vehicles) {
      if (v.exploded) continue;
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d < bestDist) {
        bestDist = d;
        nearest = v;
      }
    }

    if (nearest) {
      this.enterVehicle(nearest);
    }
  }

  private enterVehicle(v: VehicleEntity) {
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    activeRig.root.visible = false;
    this.currentVehicle = v;
    v.aiCop = false;

    // Auto-select drive-by weapon if current weapon is not drive-by compatible
    const curW = state.charStates[state.activeChar].weapon;
    if (!WEAPONS[curW].driveBy) {
      this.selectWeapon('smg');
    }

    if (v.kind === 'police' || v.kind === 'swat') {
      this.addWantedStars(2);
    }

    state.updateHUD({
      inVehicle: true,
      vehicleName: v.name,
      vehicleHpPercent: Math.round((v.hp / v.maxHp) * 100),
    });
  }

  private exitVehicle() {
    if (!this.currentVehicle) return;
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const v = this.currentVehicle;

    const exitX = v.x - Math.cos(v.rotY) * 2.4;
    const exitZ = v.z + Math.sin(v.rotY) * 2.4;
    activeRig.root.position.set(exitX, 0, exitZ);
    activeRig.root.visible = true;

    this.currentVehicle = null;
    state.updateHUD({
      inVehicle: false,
      vehicleName: '',
      vehicleSpeedKmh: 0,
    });
  }

  // === Shooting, Raycasting & Explosions ===
  private tryFireWeapon() {
    const state = useGameStore.getState();
    if (this.fireTimer > 0 || state.reloading || this.skyCam?.active) return;

    const active = state.activeChar;
    const wId = state.charStates[active].weapon;
    const spec = WEAPONS[wId];
    const ammo = state.weapons[wId];

    // Check ammo
    if (wId !== 'unarmed' && ammo.inMag <= 0) {
      this.triggerReload();
      return;
    }

    // Consume ammo unless Trevor's Red Mist is active
    const isTrevorRampage = active === 'trevor' && state.specialActive;
    if (wId !== 'unarmed' && !isTrevorRampage) {
      const updated = { ...state.weapons };
      updated[wId] = { ...ammo, inMag: ammo.inMag - 1 };
      state.updateHUD({ weapons: updated });
      if (updated[wId].inMag <= 0 && updated[wId].reserve > 0) {
        setTimeout(() => this.triggerReload(), 160);
      }
    }

    this.fireTimer = 1 / spec.fireRate;
    sound.playGunshot(wId);

    // Muzzle flash on active character
    const rig = this.charRigs[active];
    rig.muzzleFlash.visible = true;
    setTimeout(() => {
      rig.muzzleFlash.visible = false;
    }, 55);

    const origin = new THREE.Vector3();
    if (this.currentVehicle) {
      origin.set(this.currentVehicle.x, 1.5, this.currentVehicle.z);
    } else {
      rig.muzzleFlash.getWorldPosition(origin);
    }

    // Aim direction from camera through screen center
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    this.camera.getWorldDirection(camDir);

    // Rotate character toward aim direction when firing on foot
    if (!this.currentVehicle) {
      rig.root.rotation.y = Math.atan2(camDir.x, camDir.z);
    }

    // RPG Rocket Projectile
    if (spec.explosive) {
      const rocketGroup = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xf97316 })
      );
      rocketGroup.add(body);
      rocketGroup.position.copy(origin);
      this.scene.add(rocketGroup);
      this.rockets.push({
        mesh: rocketGroup,
        pos: origin.clone(),
        vel: camDir.clone().multiplyScalar(68),
        life: 3.5,
      });
      return;
    }

    // Bullet Raycasting (supports multi-pellet shotgun)
    const isMichaelBulletTime = active === 'michael' && state.specialActive;
    const damageMult = isTrevorRampage ? 2.2 : 1.0;

    for (let p = 0; p < spec.pellets; p++) {
      const spreadFactor = isMichaelBulletTime ? 0 : state.aiming ? spec.spread * 0.45 : spec.spread;
      const dir = camDir.clone();
      dir.x += (Math.random() - 0.5) * spreadFactor;
      dir.y += (Math.random() - 0.5) * spreadFactor;
      dir.z += (Math.random() - 0.5) * spreadFactor;
      dir.normalize();

      this.castBulletRay(origin, camPos, dir, spec.range, spec.damage * damageMult, isMichaelBulletTime);
    }
  }

  private castBulletRay(
    muzzleOrigin: THREE.Vector3,
    rayOrigin: THREE.Vector3,
    dir: THREE.Vector3,
    range: number,
    damage: number,
    isBulletTime: boolean
  ) {
    const raycaster = new THREE.Raycaster(rayOrigin, dir, 1.2, range);

    // Collect candidate meshes
    const targets: THREE.Object3D[] = [...this.shootableMeshes];
    for (const npc of this.npcs) {
      if (!npc.dead) {
        targets.push(npc.rig.head, npc.rig.torso);
      }
    }
    for (const v of this.vehicles) {
      if (!v.exploded && v !== this.currentVehicle) {
        targets.push(...v.rig.root.children);
      }
    }
    if (this.heli.active && !this.heli.crashing) {
      targets.push(...this.heli.rig.root.children);
    }

    const hits = raycaster.intersectObjects(targets, true);
    const endPoint =
      hits.length > 0
        ? hits[0].point.clone()
        : rayOrigin.clone().add(dir.clone().multiplyScalar(range));

    this.spawnTracerBeam(muzzleOrigin, endPoint, isBulletTime ? 0xfacc15 : 0xfef08a);

    if (hits.length === 0) return;

    const hitObj = hits[0].object;
    const hitPoint = hits[0].point;

    // 1. Check Explosive Barrel hit
    for (const b of this.barrels) {
      if (!b.exploded && (b.mesh === hitObj || b.mesh.children.includes(hitObj))) {
        b.exploded = true;
        b.mesh.visible = false;
        this.triggerExplosion(b.x, 0.8, b.z, 13);
        return;
      }
    }

    // 2. Check NPC hit (with Headshot detection)
    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const isHead = hitObj === npc.rig.head;
      const isTorso = hitObj === npc.rig.torso;
      if (isHead || isTorso) {
        const headshotMult = isHead ? (isBulletTime ? 2.8 : 2.1) : 1.0;
        this.damageNPC(npc, damage * headshotMult, isHead);
        this.spawnImpactSparks(hitPoint, 0xef4444);
        return;
      }
    }

    // 3. Check Helicopter hit
    if (
      this.heli.active &&
      !this.heli.crashing &&
      this.heli.rig.root.children.some((c) => c === hitObj || c.children.includes(hitObj))
    ) {
      this.heli.hp -= damage;
      this.spawnImpactSparks(hitPoint, 0xfacc15);
      sound.playHitmarker(false);
      if (this.heli.hp <= 0) {
        this.heli.crashing = true;
        useGameStore.getState().addCash(5000);
      }
      return;
    }

    // 4. Check Vehicle hit
    for (const v of this.vehicles) {
      if (v.exploded || v === this.currentVehicle) continue;
      if (v.rig.root.children.includes(hitObj)) {
        this.damageVehicle(v, damage);
        this.spawnImpactSparks(hitPoint, 0xfbbf24);
        sound.playHitmarker(false);
        return;
      }
    }

    // Environment spark
    this.spawnImpactSparks(hitPoint, 0xe2e8f0);
  }

  private damageNPC(npc: NPCEntity, amount: number, isHeadshot: boolean) {
    npc.hp -= amount;
    sound.playHitmarker(isHeadshot);

    const state = useGameStore.getState();
    state.updateHUD({
      hitmarker: { active: true, headshot: isHeadshot, ts: performance.now() },
    });

    if (npc.rig.hpBarFill) {
      const ratio = Math.max(0, npc.hp / npc.maxHp);
      npc.rig.hpBarFill.scale.x = ratio;
    }

    if (npc.hp <= 0 && !npc.dead) {
      npc.dead = true;
      npc.deathTimer = 6.0;
      npc.rig.root.rotation.x = -Math.PI * 0.48;
      npc.rig.root.position.y = 0.25;
      if (npc.rig.hpBarBg) npc.rig.hpBarBg.visible = false;
      if (npc.rig.hpBarFill) npc.rig.hpBarFill.visible = false;

      // Spawn loot drop (Cash or Medkit/Armor)
      this.spawnLootDrop(npc.x, npc.z);

      // Wanted level logic
      if (npc.role === 'civilian') {
        this.addWantedStars(Math.max(1, state.wantedStars));
      } else if (npc.role === 'cop' || npc.role === 'swat') {
        this.addWantedStars(Math.min(5, Math.max(2, state.wantedStars + (Math.random() > 0.55 ? 1 : 0))));
      }

      state.updateHUD({ kills: state.kills + 1 });
    }
  }

  private damageVehicle(v: VehicleEntity, amount: number) {
    if (v.exploded) return;
    v.hp -= amount;
    if (v.hp < v.maxHp * 0.45) {
      v.rig.smokeGroup.visible = true;
    }
    if (v.hp <= 0) {
      v.exploded = true;
      v.rig.bodyMat.color.setHex(0x18181b);
      v.rig.root.position.y = 0.35;
      v.rig.root.rotation.z = 0.18;
      this.triggerExplosion(v.x, 1.2, v.z, 12);
      if (this.currentVehicle === v) {
        this.exitVehicle();
        this.damageActivePlayer(45);
      }
    }
  }

  private triggerExplosion(x: number, y: number, z: number, radius: number) {
    sound.playExplosion();

    // Fireball sphere + Shockwave ring
    const fireball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.92,
      })
    );
    fireball.position.set(x, y, z);
    this.scene.add(fireball);

    const ringGeo = new THREE.RingGeometry(0.8, 1.4, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    ring.position.set(x, 0.15, z);
    this.scene.add(ring);

    this.effects.push({
      mesh: fireball,
      life: 0,
      maxLife: 0.55,
      onUpdate: (p) => {
        const s = 1 + p * radius * 0.72;
        fireball.scale.set(s, s, s);
        (fireball.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.92 * (1 - p));
      },
    });

    this.effects.push({
      mesh: ring,
      life: 0,
      maxLife: 0.48,
      onUpdate: (p) => {
        const s = 1 + p * radius * 1.1;
        ring.scale.set(s, s, 1);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - p));
      },
    });

    // Damage nearby NPCs
    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const d = Math.hypot(npc.x - x, npc.z - z);
      if (d < radius) {
        const dmg = (1 - d / radius) * 280;
        this.damageNPC(npc, dmg, false);
      }
    }

    // Chain-explode nearby vehicles
    for (const v of this.vehicles) {
      if (v.exploded) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius) {
        this.damageVehicle(v, (1 - d / radius) * 260);
      }
    }

    // Damage helicopter if low or hit directly
    if (this.heli.active && !this.heli.crashing) {
      const dh = Math.hypot(this.heli.x - x, this.heli.y - y, this.heli.z - z);
      if (dh < radius * 1.35) {
        this.heli.hp -= 350;
        if (this.heli.hp <= 0) {
          this.heli.crashing = true;
          useGameStore.getState().addCash(5000);
        }
      }
    }

    this.addWantedStars(Math.max(2, useGameStore.getState().wantedStars));
  }

  private spawnTracerBeam(start: THREE.Vector3, end: THREE.Vector3, colorHex: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.88,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({
      mesh: line,
      life: 0,
      maxLife: 0.085,
      onUpdate: (p) => {
        mat.opacity = 0.88 * (1 - p);
      },
    });
  }

  private spawnImpactSparks(pos: THREE.Vector3, colorHex: number) {
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 6, 6),
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.9,
      })
    );
    spark.position.copy(pos);
    this.scene.add(spark);
    this.effects.push({
      mesh: spark,
      life: 0,
      maxLife: 0.16,
      onUpdate: (p) => {
        spark.scale.setScalar(1 + p * 2.2);
        (spark.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p);
      },
    });
  }

  private spawnLootDrop(x: number, z: number) {
    const roll = Math.random();
    const type: 'cash' | 'health' | 'armor' =
      roll < 0.55 ? 'cash' : roll < 0.8 ? 'health' : 'armor';
    const color = type === 'cash' ? 0x22c55e : type === 'health' ? 0x10b981 : 0x38bdf8;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.35, 0.45),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.set(x, 0.45, z);
    this.scene.add(mesh);
    this.loots.push({
      id: `loot_${Date.now()}_${Math.random()}`,
      mesh,
      x,
      z,
      type,
      amount: type === 'cash' ? 450 + Math.floor(Math.random() * 850) : 35,
    });
  }

  private damageActivePlayer(dmg: number) {
    const state = useGameStore.getState();
    const active = state.activeChar;
    if (active === 'trevor' && state.specialActive) {
      dmg *= 0.15;
    }

    const cs = { ...state.charStates };
    const cur = { ...cs[active] };

    if (cur.armor > 0) {
      const absorb = Math.min(cur.armor, dmg * 0.75);
      cur.armor = Math.max(0, cur.armor - absorb);
      cur.hp = Math.max(0, cur.hp - (dmg - absorb));
    } else {
      cur.hp = Math.max(0, cur.hp - dmg);
    }

    cs[active] = cur;
    state.updateHUD({ charStates: cs });

    if (cur.hp <= 0 && state.banner.type !== 'wasted') {
      this.handlePlayerWasted();
    }
  }

  private handlePlayerWasted() {
    const state = useGameStore.getState();
    sound.playWasted();
    if (this.currentVehicle) {
      this.exitVehicle();
    }
    this.clearWantedLevel();

    state.updateHUD({
      specialActive: false,
      banner: {
        type: 'wasted',
        title: 'WASTED',
        subtitle: '重傷送往藥盒山醫療中心緊急搶救（醫療費 -$500）',
      },
    });

    setTimeout(() => {
      const s = useGameStore.getState();
      const active = s.activeChar;
      const rig = this.charRigs[active];
      rig.root.position.set(35, 0, -25); // Pillbox Medical Center
      const cs = { ...s.charStates };
      cs[active] = { ...cs[active], hp: 100, armor: 50, special: 100 };
      s.addCash(-500);
      s.updateHUD({
        charStates: cs,
        banner: { type: null, title: '', subtitle: '' },
      });
    }, 3000);
  }

  // === Main Game Loop ===
  private loop = (now: number) => {
    this.animId = requestAnimationFrame(this.loop);
    const rawDt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const state = useGameStore.getState();
    if (!state.started || state.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Time Scale (Weapon Wheel slow-mo or Michael/Franklin Special Ability)
    let timeScale = 1.0;
    if (state.weaponWheelOpen || state.charWheelOpen) {
      timeScale = 0.22;
    } else if (state.specialActive) {
      if (state.activeChar === 'michael') timeScale = 0.35;
      if (state.activeChar === 'franklin' && this.currentVehicle) timeScale = 0.45;
    }

    const dt = rawDt * timeScale;

    this.updateSkyCam(rawDt);
    this.updatePlayerAndVehicles(rawDt, dt);
    this.updateReloadAndSpecial(rawDt);
    this.updateRocketsAndEffects(dt);
    this.updateNPCsAndPolice(dt);
    this.updateHelicopter(dt);
    this.updateMissionsAndLoots(dt);
    this.updateCamera(rawDt);
    this.syncHUD(rawDt);

    this.renderer.render(this.scene, this.camera);
  };

  private updateSkyCam(rawDt: number) {
    if (!this.skyCam?.active) return;
    this.skyCam.timer += rawDt;
    const p = Math.min(1, this.skyCam.timer / this.skyCam.duration);

    const { fromPos, toPos, toChar } = this.skyCam;
    if (p < 0.35) {
      // Step 1: 3-stage GTA V vertical zoom up
      const step = Math.floor((p / 0.35) * 3) + 1;
      const h = step * 42;
      this.camera.position.set(fromPos.x, h, fromPos.z + 12);
      this.camera.lookAt(fromPos.x, 0, fromPos.z);
    } else if (p < 0.7) {
      // Step 2: High-altitude satellite pan across Los Santos
      const panT = (p - 0.35) / 0.35;
      const smooth = panT * panT * (3 - 2 * panT);
      const cx = THREE.MathUtils.lerp(fromPos.x, toPos.x, smooth);
      const cz = THREE.MathUtils.lerp(fromPos.z, toPos.z, smooth);
      this.camera.position.set(cx, 132, cz + 14);
      this.camera.lookAt(cx, 0, cz);
    } else {
      // Step 3: 3-stage vertical dive down to target protagonist
      const descT = (p - 0.7) / 0.3;
      const step = 3 - Math.floor(descT * 2.99);
      const h = step * 36;
      this.camera.position.set(toPos.x, h, toPos.z + 10);
      this.camera.lookAt(toPos.x, 1.5, toPos.z);
    }

    if (p >= 1) {
      sound.playSkyCamStep(true);
      this.skyCam.active = false;
      useGameStore.getState().updateHUD({
        activeChar: toChar,
        skyCamSwitching: false,
        skyCamTarget: null,
      });
    }
  }

  private updatePlayerAndVehicles(rawDt: number, dt: number) {
    const state = useGameStore.getState();
    const active = state.activeChar;
    const rig = this.charRigs[active];

    // Automatic firing when holding left mouse button
    if (this.fireTimer > 0) {
      this.fireTimer -= rawDt;
    }
    if (
      this.mouseDownLeft &&
      !state.weaponWheelOpen &&
      !state.charWheelOpen &&
      !state.shopModalOpen
    ) {
      const curW = state.charStates[active].weapon;
      if (WEAPONS[curW].automatic) {
        this.tryFireWeapon();
      }
    }

    if (this.skyCam?.active) return;

    // === Driving Mode ===
    if (this.currentVehicle) {
      const v = this.currentVehicle;
      const isFranklinFocus = active === 'franklin' && state.specialActive;
      const accelMult = isFranklinFocus ? 1.85 : 1.0;
      const turnMult = isFranklinFocus ? 1.65 : 1.0;

      const throttle = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const steer = (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) -
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0);
      const handbrake = this.keys.has('Space');

      if (throttle !== 0) {
        v.speed += throttle * 28 * accelMult * rawDt;
      } else {
        v.speed *= Math.pow(0.25, rawDt);
      }
      if (handbrake) {
        v.speed *= Math.pow(0.04, rawDt);
      }

      v.speed = Math.max(-v.maxSpeed * 0.45, Math.min(v.maxSpeed, v.speed));

      if (Math.abs(v.speed) > 0.6) {
        const dirSign = v.speed >= 0 ? 1 : -1;
        v.rotY += steer * 2.4 * turnMult * dirSign * rawDt;
      }

      const nextX = v.x + Math.sin(v.rotY) * v.speed * rawDt;
      const nextZ = v.z + Math.cos(v.rotY) * v.speed * rawDt;

      if (!this.checkWorldCollision(nextX, nextZ, 1.8)) {
        v.x = nextX;
        v.z = nextZ;
      } else {
        v.speed *= -0.35;
      }

      v.rig.root.position.set(v.x, 0, v.z);
      v.rig.root.rotation.y = v.rotY;

      // Keep active character synced with vehicle position
      rig.root.position.set(v.x, 0, v.z);

      // Roadkill / ramming check on NPCs
      if (Math.abs(v.speed) > 10) {
        for (const npc of this.npcs) {
          if (npc.dead) continue;
          if (Math.hypot(npc.x - v.x, npc.z - v.z) < 2.35) {
            this.damageNPC(npc, 140, false);
          }
        }
      }
      return;
    }

    // === On-Foot Shooter Movement ===
    let moveX = 0;
    let moveZ = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveZ += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveZ -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX += 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX -= 1;

    const forwardX = Math.sin(this.camYaw);
    const forwardZ = Math.cos(this.camYaw);
    const rightX = Math.cos(this.camYaw);
    const rightZ = -Math.sin(this.camYaw);

    let worldDX = forwardX * moveZ + rightX * moveX;
    let worldDZ = forwardZ * moveZ + rightZ * moveX;
    const len = Math.hypot(worldDX, worldDZ);

    const sprinting = this.keys.has('ShiftLeft') && !state.aiming;
    const baseSpeed = this.rollTimer > 0 ? 15.5 : sprinting ? 10.8 : state.aiming ? 5.6 : 7.8;

    if (this.rollTimer > 0) {
      this.rollTimer -= rawDt;
      worldDX = this.rollDir.x;
      worldDZ = this.rollDir.y;
    } else if (len > 0.001) {
      worldDX /= len;
      worldDZ /= len;
    }

    if (len > 0.001 || this.rollTimer > 0) {
      const nx = rig.root.position.x + worldDX * baseSpeed * rawDt;
      const nz = rig.root.position.z + worldDZ * baseSpeed * rawDt;
      if (!this.checkWorldCollision(nx, rig.root.position.z, 0.65)) {
        rig.root.position.x = nx;
      }
      if (!this.checkWorldCollision(rig.root.position.x, nz, 0.65)) {
        rig.root.position.z = nz;
      }

      if (!state.aiming && !this.mouseDownLeft) {
        rig.root.rotation.y = Math.atan2(worldDX, worldDZ);
      }

      // Walk animation
      const t = performance.now() * (sprinting ? 0.015 : 0.01);
      rig.leftLeg.rotation.x = Math.sin(t) * 0.65;
      rig.rightLeg.rotation.x = -Math.sin(t) * 0.65;
      rig.leftArm.rotation.x = -Math.sin(t) * 0.45;
    } else {
      rig.leftLeg.rotation.x *= 0.8;
      rig.rightLeg.rotation.x *= 0.8;
      rig.leftArm.rotation.x *= 0.8;
    }

    // Jump & Gravity
    if (this.keys.has('Space') && this.charPosY[active] <= 0.01) {
      this.charVelY[active] = 7.8;
    }
    this.charVelY[active] -= 21 * rawDt;
    this.charPosY[active] = Math.max(0, this.charPosY[active] + this.charVelY[active] * rawDt);
    rig.root.position.y = this.charPosY[active];

    // Raise right gun arm when aiming or firing
    if (state.aiming || this.mouseDownLeft) {
      rig.root.rotation.y = this.camYaw;
      rig.rightArm.rotation.x = -Math.PI * 0.46 + this.camPitch * 0.6;
    } else {
      rig.rightArm.rotation.x = -0.35;
    }
  }

  private checkWorldCollision(x: number, z: number, radius: number): boolean {
    if (x < -195 || x > 195 || z < -195 || z > 195) return true;
    for (const c of this.colliders) {
      if (
        x + radius > c.minX &&
        x - radius < c.maxX &&
        z + radius > c.minZ &&
        z - radius < c.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  private updateReloadAndSpecial(rawDt: number) {
    const state = useGameStore.getState();
    const active = state.activeChar;

    // Reload progress
    if (state.reloading) {
      const wId = state.charStates[active].weapon;
      const spec = WEAPONS[wId];
      const nextProg = state.reloadProgress + rawDt / spec.reloadTime;
      if (nextProg >= 1) {
        const curAmmo = state.weapons[wId];
        const needed = spec.magSize - curAmmo.inMag;
        const transfer = Math.min(needed, curAmmo.reserve);
        const updated = { ...state.weapons };
        updated[wId] = {
          ...curAmmo,
          inMag: curAmmo.inMag + transfer,
          reserve: curAmmo.reserve - transfer,
        };
        state.updateHUD({ weapons: updated, reloading: false, reloadProgress: 0 });
      } else {
        state.updateHUD({ reloadProgress: nextProg });
      }
    }

    // Special Ability meter drain / recharge
    const cs = { ...state.charStates };
    const cur = { ...cs[active] };
    if (state.specialActive) {
      cur.special = Math.max(0, cur.special - rawDt * 12);
      if (cur.special <= 0) {
        state.updateHUD({ specialActive: false });
      }
    } else {
      cur.special = Math.min(100, cur.special + rawDt * 4.5);
    }
    cs[active] = cur;
    state.updateHUD({ charStates: cs });
  }

  private updateRocketsAndEffects(dt: number) {
    // Update RPG Rockets
    this.rockets = this.rockets.filter((r) => {
      r.life -= dt;
      const nextPos = r.pos.clone().addScaledVector(r.vel, dt);
      r.pos.copy(nextPos);
      r.mesh.position.copy(r.pos);

      const hitGround = r.pos.y <= 0.35;
      const hitBuilding = this.checkWorldCollision(r.pos.x, r.pos.z, 0.45);
      let hitEntity = false;

      for (const v of this.vehicles) {
        if (!v.exploded && Math.hypot(v.x - r.pos.x, v.z - r.pos.z) < 2.6 && r.pos.y < 2.8) {
          hitEntity = true;
          break;
        }
      }
      if (
        this.heli.active &&
        !this.heli.crashing &&
        Math.hypot(this.heli.x - r.pos.x, this.heli.y - r.pos.y, this.heli.z - r.pos.z) < 4.5
      ) {
        hitEntity = true;
      }

      if (hitGround || hitBuilding || hitEntity || r.life <= 0) {
        this.scene.remove(r.mesh);
        this.triggerExplosion(r.pos.x, Math.max(0.8, r.pos.y), r.pos.z, 14);
        return false;
      }
      return true;
    });

    // Update Visual Effects
    this.effects = this.effects.filter((fx) => {
      fx.life += dt;
      const p = Math.min(1, fx.life / fx.maxLife);
      fx.onUpdate?.(p, dt);
      if (p >= 1) {
        this.scene.remove(fx.mesh);
        return false;
      }
      return true;
    });
  }

  private updateNPCsAndPolice(dt: number) {
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const px = activeRig.root.position.x;
    const pz = activeRig.root.position.z;

    // Wanted level Police Spawning
    if (state.wantedStars > 0) {
      this.wantedDecayTimer += dt;
      if (this.wantedDecayTimer > 28) {
        this.clearWantedLevel();
      }

      this.copSpawnTimer -= dt;
      const activeCops = this.npcs.filter((n) => !n.dead && (n.role === 'cop' || n.role === 'swat')).length;
      const maxCops = state.wantedStars * 2 + 2;

      if (this.copSpawnTimer <= 0 && activeCops < maxCops) {
        this.copSpawnTimer = 3.5;
        const ang = Math.random() * Math.PI * 2;
        const sx = px + Math.cos(ang) * 34;
        const sz = pz + Math.sin(ang) * 34;
        if (!this.checkWorldCollision(sx, sz, 1)) {
          const isSwat = state.wantedStars >= 3;
          this.spawnNPC({
            x: sx,
            z: sz,
            role: isSwat ? 'swat' : 'cop',
            weapon: isSwat ? 'rifle' : 'pistol',
          });
        }
      }
    }

    // Update all NPCs
    this.npcs = this.npcs.filter((npc) => {
      if (npc.dead) {
        npc.deathTimer -= dt;
        if (npc.deathTimer <= 0) {
          this.scene.remove(npc.rig.root);
          return false;
        }
        return true;
      }

      const dx = px - npc.x;
      const dz = pz - npc.z;
      const dist = Math.hypot(dx, dz);

      if (npc.rig.hpBarBg && npc.rig.hpBarFill) {
        npc.rig.hpBarBg.lookAt(this.camera.position);
        npc.rig.hpBarFill.lookAt(this.camera.position);
      }

      if (npc.role === 'civilian') {
        // Civilians stroll around or flee if gunfire is nearby
        npc.walkPhase += dt * 2.2;
        const speed = state.wantedStars > 0 && dist < 35 ? 5.2 : 2.1;
        if (state.wantedStars > 0 && dist < 35) {
          npc.rotY = Math.atan2(-dx, -dz);
        }
        const nx = npc.x + Math.sin(npc.rotY) * speed * dt;
        const nz = npc.z + Math.cos(npc.rotY) * speed * dt;
        if (!this.checkWorldCollision(nx, nz, 0.6)) {
          npc.x = nx;
          npc.z = nz;
        } else {
          npc.rotY += Math.PI * 0.65;
        }
        npc.rig.root.position.set(npc.x, 0, npc.z);
        npc.rig.root.rotation.y = npc.rotY;
        npc.rig.leftLeg.rotation.x = Math.sin(npc.walkPhase * 3) * 0.45;
        npc.rig.rightLeg.rotation.x = -Math.sin(npc.walkPhase * 3) * 0.45;
      } else {
        // Hostile Cops, SWAT & Mission Enemies engage player
        npc.rotY = Math.atan2(dx, dz);
        npc.rig.root.rotation.y = npc.rotY;
        npc.rig.rightArm.rotation.x = -Math.PI * 0.45;

        if (dist > 14 && dist < 85) {
          const speed = npc.role === 'swat' ? 4.8 : 4.2;
          const nx = npc.x + (dx / dist) * speed * dt;
          const nz = npc.z + (dz / dist) * speed * dt;
          if (!this.checkWorldCollision(nx, nz, 0.6)) {
            npc.x = nx;
            npc.z = nz;
          }
          npc.walkPhase += dt * 8;
          npc.rig.leftLeg.rotation.x = Math.sin(npc.walkPhase) * 0.55;
          npc.rig.rightLeg.rotation.x = -Math.sin(npc.walkPhase) * 0.55;
        }

        npc.rig.root.position.set(npc.x, 0, npc.z);

        // Shoot at player
        if (dist < 44) {
          npc.fireCooldown -= dt;
          if (npc.fireCooldown <= 0) {
            npc.fireCooldown = npc.role === 'swat' ? 0.55 : 0.95;
            npc.rig.muzzleFlash.visible = true;
            setTimeout(() => {
              npc.rig.muzzleFlash.visible = false;
            }, 50);

            const start = new THREE.Vector3(npc.x, 1.5, npc.z);
            const end = new THREE.Vector3(
              px + (Math.random() - 0.5) * 1.4,
              1.2,
              pz + (Math.random() - 0.5) * 1.4
            );
            this.spawnTracerBeam(start, end, 0xf87171);

            if (Math.random() < 0.48) {
              this.damageActivePlayer(npc.role === 'swat' ? 8 : 5);
            }
          }
        }
      }

      return true;
    });

    // Update vehicle siren lights
    const flash = Math.floor(performance.now() / 180) % 2 === 0;
    for (const v of this.vehicles) {
      if (v.rig.sirenLeft && v.rig.sirenRight) {
        (v.rig.sirenLeft.material as THREE.MeshBasicMaterial).color.setHex(
          flash ? 0xef4444 : 0x1e3a8a
        );
        (v.rig.sirenRight.material as THREE.MeshBasicMaterial).color.setHex(
          flash ? 0x3b82f6 : 0x7f1d1d
        );
      }
    }
  }

  private updateHelicopter(dt: number) {
    if (!this.heli.active) return;

    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const px = activeRig.root.position.x;
    const pz = activeRig.root.position.z;

    this.heli.rig.mainRotor.rotation.y += dt * 22;
    this.heli.rig.tailRotor.rotation.x += dt * 28;

    if (this.heli.crashing) {
      this.heli.rotY += dt * 5.5;
      this.heli.y -= dt * 14;
      this.heli.rig.root.position.set(this.heli.x, this.heli.y, this.heli.z);
      this.heli.rig.root.rotation.set(0.35, this.heli.rotY, 0.28);
      if (this.heli.y <= 1.5) {
        this.heli.active = false;
        this.heli.rig.root.visible = false;
        this.heli.rig.root.rotation.set(0, 0, 0);
        this.triggerExplosion(this.heli.x, 2, this.heli.z, 16);
      }
      return;
    }

    // Orbit overhead around player
    const orbitAngle = performance.now() * 0.00055;
    const targetX = px + Math.cos(orbitAngle) * 20;
    const targetZ = pz + Math.sin(orbitAngle) * 20;
    this.heli.x = THREE.MathUtils.lerp(this.heli.x, targetX, dt * 1.8);
    this.heli.z = THREE.MathUtils.lerp(this.heli.z, targetZ, dt * 1.8);
    this.heli.rotY = Math.atan2(px - this.heli.x, pz - this.heli.z);

    this.heli.rig.root.position.set(this.heli.x, this.heli.y, this.heli.z);
    this.heli.rig.root.rotation.y = this.heli.rotY;

    // Helicopter sniper fire
    this.heli.fireCooldown -= dt;
    if (this.heli.fireCooldown <= 0) {
      this.heli.fireCooldown = 1.35;
      const start = new THREE.Vector3(this.heli.x, this.heli.y - 1.2, this.heli.z);
      const end = new THREE.Vector3(px + (Math.random() - 0.5) * 1.6, 1.1, pz + (Math.random() - 0.5) * 1.6);
      this.spawnTracerBeam(start, end, 0x38bdf8);
      if (Math.random() < 0.42) {
        this.damageActivePlayer(7);
      }
    }
  }

  private updateMissionsAndLoots(dt: number) {
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    // Rotate & collect loot drops
    this.loots = this.loots.filter((l) => {
      l.mesh.rotation.y += dt * 2.8;
      if (Math.hypot(l.x - px, l.z - pz) < 2.6) {
        this.scene.remove(l.mesh);
        sound.playCashPickup();
        if (l.type === 'cash') {
          state.addCash(l.amount);
        } else {
          const cs = { ...state.charStates };
          const cur = { ...cs[state.activeChar] };
          if (l.type === 'health') cur.hp = Math.min(100, cur.hp + l.amount);
          if (l.type === 'armor') cur.armor = Math.min(100, cur.armor + l.amount);
          cs[state.activeChar] = cur;
          state.updateHUD({ charStates: cs });
        }
        return false;
      }
      return true;
    });

    // Update Active Mission Progression
    if (!state.activeMissionId) {
      this.missionBeacon.visible = false;
      return;
    }

    const def = MISSIONS[state.activeMissionId];
    const step = def.steps[state.missionStepIdx];
    if (!step) return;

    const [tx, tz] = step.targetPos;
    const distToTarget = Math.hypot(px - tx, pz - tz);
    const remainingEnemies = this.npcs.filter((n) => !n.dead && n.role === 'mission_enemy').length;

    let stepComplete = false;
    let progressLabel: string | null = null;

    if (step.type === 'kill_targets') {
      progressLabel = `剩餘目標敵軍：${remainingEnemies} 人`;
      if (remainingEnemies === 0) stepComplete = true;
    } else if (step.type === 'pickup') {
      progressLabel = `距離目標點：${Math.round(distToTarget)}m`;
      if (distToTarget < step.radius) {
        stepComplete = true;
        sound.playCashPickup();
        if (state.activeMissionId === 'pacific_heist') {
          this.addWantedStars(3);
        } else if (state.activeMissionId === 'pier_arms') {
          this.triggerInstantAction('max_arsenal');
          this.selectWeapon('rpg');
        }
      }
    } else if (step.type === 'enter_car') {
      progressLabel = this.currentVehicle?.isMissionTarget
        ? '已奪取目標超跑！'
        : `距離目標超跑：${Math.round(distToTarget)}m`;
      if (this.currentVehicle?.isMissionTarget) {
        stepComplete = true;
        this.addWantedStars(2);
      }
    } else if (step.type === 'escape_wanted') {
      progressLabel =
        state.wantedStars === 0
          ? '已甩開通緝！'
          : `抵達改車王 (${Math.round(distToTarget)}m) 或消除通緝星等`;
      if (state.wantedStars === 0 || distToTarget < step.radius) {
        this.clearWantedLevel();
        stepComplete = true;
      }
    } else if (step.type === 'deliver_car') {
      progressLabel = `距離洛聖都改車王：${Math.round(distToTarget)}m`;
      if (distToTarget < step.radius && this.currentVehicle) {
        this.clearWantedLevel();
        stepComplete = true;
      }
    }

    state.updateHUD({ missionProgressText: progressLabel });

    if (stepComplete) {
      const nextIdx = state.missionStepIdx + 1;
      if (nextIdx < def.steps.length) {
        this.setupMissionStep(state.activeMissionId, nextIdx);
      } else {
        // Mission Passed!
        this.missionBeacon.visible = false;
        sound.playCashPickup();
        state.addCash(def.reward);
        const completed = state.completedMissions.includes(def.id)
          ? state.completedMissions
          : [...state.completedMissions, def.id];

        state.updateHUD({
          activeMissionId: null,
          missionObjectiveText: null,
          missionProgressText: null,
          completedMissions: completed,
          banner: {
            type: 'mission_passed',
            title: 'MISSION PASSED',
            subtitle: `${def.title} — 劫案分紅 +$${def.reward.toLocaleString()} · RESPECT +`,
            reward: def.reward,
          },
        });

        setTimeout(() => {
          if (useGameStore.getState().banner.type === 'mission_passed') {
            useGameStore.getState().updateHUD({
              banner: { type: null, title: '', subtitle: '' },
            });
          }
        }, 4200);
      }
    }
  }

  private updateCamera(rawDt: number) {
    if (this.skyCam?.active) return;

    const state = useGameStore.getState();
    const active = state.activeChar;
    const rig = this.charRigs[active];
    const wId = state.charStates[active].weapon;
    const spec = WEAPONS[wId];

    // Smooth FOV zoom for ADS & Sniper Scope
    const targetFov = state.aiming
      ? spec.scopeZoom ?? 42
      : this.currentVehicle && Math.abs(this.currentVehicle.speed) > 25
        ? 72
        : 62;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, rawDt * 12);
    this.camera.updateProjectionMatrix();

    if (this.currentVehicle) {
      const v = this.currentVehicle;
      const dist = 8.8;
      const camX = v.x - Math.sin(this.camYaw) * dist;
      const camZ = v.z - Math.cos(this.camYaw) * dist;
      const camY = 3.4 + this.camPitch * 3.2;
      this.camera.position.lerp(new THREE.Vector3(camX, Math.max(1.2, camY), camZ), rawDt * 14);
      this.camera.lookAt(v.x + Math.sin(this.camYaw) * 6, 1.3, v.z + Math.cos(this.camYaw) * 6);
      return;
    }

    // Over-the-shoulder Third-Person Shooter Camera
    const targetDist = state.aiming ? 3.2 : this.camDist;
    const shoulderOffset = state.aiming ? 0.78 : 0.48;

    const px = rig.root.position.x;
    const py = rig.root.position.y + 1.85;
    const pz = rig.root.position.z;

    const rightX = -Math.cos(this.camYaw) * shoulderOffset;
    const rightZ = Math.sin(this.camYaw) * shoulderOffset;

    let actualDist = targetDist;
    for (let step = 1; step <= 6; step++) {
      const testD = (targetDist * step) / 6;
      const tx = px + rightX - Math.sin(this.camYaw) * Math.cos(this.camPitch) * testD;
      const tz = pz + rightZ - Math.cos(this.camYaw) * Math.cos(this.camPitch) * testD;
      if (this.checkWorldCollision(tx, tz, 0.35)) {
        actualDist = Math.max(1.4, ((step - 1) / 6) * targetDist);
        break;
      }
    }

    const camX = px + rightX - Math.sin(this.camYaw) * Math.cos(this.camPitch) * actualDist;
    const camY = py + Math.sin(this.camPitch) * actualDist;
    const camZ = pz + rightZ - Math.cos(this.camYaw) * Math.cos(this.camPitch) * actualDist;

    this.camera.position.set(camX, Math.max(1.1, camY), camZ);

    const lookX = px + rightX + Math.sin(this.camYaw) * Math.cos(this.camPitch) * 30;
    const lookY = py - Math.sin(this.camPitch) * 30;
    const lookZ = pz + rightZ + Math.cos(this.camYaw) * Math.cos(this.camPitch) * 30;
    this.camera.lookAt(lookX, lookY, lookZ);
  }

  private syncHUD(rawDt: number) {
    this.hudSyncTimer += rawDt;
    if (this.hudSyncTimer < 0.08) return;
    this.hudSyncTimer = 0;

    const state = useGameStore.getState();
    const active = state.activeChar;
    const activeRig = this.charRigs[active];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    // Update character coordinates
    const cs = { ...state.charStates };
    (['michael', 'franklin', 'trevor'] as CharacterId[]).forEach((cid) => {
      const r = this.charRigs[cid];
      cs[cid] = {
        ...cs[cid],
        x: r.root.position.x,
        z: r.root.position.z,
      };
    });

    // Nearby interaction prompt
    let prompt: string | null = null;
    for (const lm of LANDMARKS) {
      if (lm.interactPrompt && Math.hypot(px - lm.x, pz - (lm.z + 8)) < 9.5) {
        prompt = lm.interactPrompt;
        break;
      }
    }
    if (!prompt && !this.currentVehicle) {
      for (const v of this.vehicles) {
        if (!v.exploded && Math.hypot(v.x - px, v.z - pz) < 5.2) {
          prompt = `按 [E] 駕駛【${v.name}】`;
          break;
        }
      }
    }

    // Build Minimap Radar Blips
    const blips: RadarBlip[] = [];
    (['michael', 'franklin', 'trevor'] as CharacterId[]).forEach((cid) => {
      if (cid !== active) {
        blips.push({
          id: `char_${cid}`,
          x: this.charRigs[cid].root.position.x,
          z: this.charRigs[cid].root.position.z,
          type: 'protagonist',
          color: PROTAGONISTS[cid].color,
          label: cid[0].toUpperCase(),
        });
      }
    });

    for (const lm of LANDMARKS) {
      if (lm.type === 'ammu' || lm.type === 'customs' || lm.type === 'bank') {
        blips.push({
          id: lm.id,
          x: lm.x,
          z: lm.z + 8,
          type: lm.type,
          color: lm.color,
        });
      }
    }

    for (const npc of this.npcs) {
      if (npc.dead) continue;
      if (npc.role === 'cop' || npc.role === 'swat') {
        blips.push({
          id: npc.id,
          x: npc.x,
          z: npc.z,
          type: 'cop',
          color: '#38bdf8',
        });
      } else if (npc.role === 'mission_enemy') {
        blips.push({
          id: npc.id,
          x: npc.x,
          z: npc.z,
          type: 'enemy',
          color: '#ef4444',
        });
      }
    }

    if (this.heli.active && !this.heli.crashing) {
      blips.push({
        id: 'heli',
        x: this.heli.x,
        z: this.heli.z,
        type: 'heli',
        color: '#facc15',
      });
    }

    if (state.activeMissionId) {
      const def = MISSIONS[state.activeMissionId];
      const step = def.steps[state.missionStepIdx];
      if (step) {
        blips.push({
          id: 'mission_target',
          x: step.targetPos[0],
          z: step.targetPos[1],
          type: 'mission',
          color: '#facc15',
        });
      }
    }

    state.updateHUD({
      charStates: cs,
      district: getDistrictName(px, pz),
      interactPrompt: prompt,
      blips,
      playerRotation: this.camYaw,
      vehicleSpeedKmh: this.currentVehicle ? Math.round(Math.abs(this.currentVehicle.speed) * 3.4) : 0,
      vehicleHpPercent: this.currentVehicle
        ? Math.max(0, Math.round((this.currentVehicle.hp / this.currentVehicle.maxHp) * 100))
        : 100,
    });
  }
}
