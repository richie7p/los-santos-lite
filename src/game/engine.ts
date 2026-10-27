import * as THREE from 'three';
import {
  CharacterId,
  MissionId,
  NpcDialogueProfile,
  RadarBlip,
  WeaponId,
} from './types';
import {
  HALF,
  LANDMARKS,
  MISSION_ORDER,
  MISSIONS,
  NPC_DIALOGUES,
  PROTAGONISTS,
  STUNT_RAMPS,
  VEHICLE_SPECS,
  VehicleSpec,
  WEAPON_WHEEL_ORDER,
  WEAPONS,
  getDistrictName,
  getTerrainHeight,
} from './data';
import {
  CharacterRig,
  HelicopterRig,
  VehicleRig,
  createCharacterRig,
  createMissionBeaconMesh,
  createPoliceHelicopterMesh,
  createVehicleMesh,
  updateRigWeaponVisual,
} from './meshes';
import {
  AnimatedWorldProp,
  BarrelEntity,
  BoxCollider,
  RoadNode,
  buildLosSantosCity,
} from './city';
import {
  clamp,
  lerp,
  lerpAngle,
  resolveCircleList,
  separateCircles,
  wrapAngle,
  yawForward,
  yawRight,
} from './collision';
import { loadWorldTextures } from './textures';
import { useGameStore } from './store';
import { sound } from './audio';

interface NPCEntity {
  id: string;
  rig: CharacterRig;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  role: 'civilian' | 'cop' | 'swat' | 'mission_enemy';
  weapon: WeaponId;
  fireCooldown: number;
  staggerTimer: number;
  dead: boolean;
  deathTimer: number;
  walkPhase: number;
  panicTimer: number;
  dialogueProfile?: NpcDialogueProfile;
}

interface VehicleEntity {
  id: string;
  spec: VehicleSpec;
  rig: VehicleRig;
  x: number;
  y: number;
  z: number;
  vy: number;
  yaw: number;
  speed: number;
  lateralVel: number;
  roll: number;
  pitch: number;
  hp: number;
  maxHp: number;
  exploded: boolean;
  aiTraffic: boolean;
  targetNodeId?: string;
  isMissionTarget?: boolean;
  airborne: boolean;
  jumpStartX: number;
  jumpStartZ: number;
}

interface HeliEntity {
  rig: HelicopterRig;
  x: number;
  y: number;
  z: number;
  yaw: number;
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
  private resizeObserver: ResizeObserver | null = null;
  private animId = 0;
  private lastTime = 0;
  private clockElapsed = 0;
  private disposed = false;

  // World Data
  private colliders: BoxCollider[] = [];
  private barrels: BarrelEntity[] = [];
  private shootableMeshes: THREE.Object3D[] = [];
  private roadNodes = new Map<string, RoadNode>();
  private animatedProps: AnimatedWorldProp[] = [];

  // 3 Protagonists
  private protagonists: Record<
    CharacterId,
    {
      rig: CharacterRig;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      yaw: number;
      rollTimer: number;
      rollDir: THREE.Vector2;
    }
  >;

  // Camera & Input
  private camYaw = 0;
  private camPitch = 0.24;
  private camShake = 0;
  private reticleBloom = 0;
  private attractAngle = 0.4;
  private keys = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;
  private fireTimer = 0;

  // Sky-Cam Satellite Switch / Fast Travel State
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

  // Mission Marker
  private missionBeacon: THREE.Group;

  // Wanted & Police Spawn Timers
  private copSpawnTimer = 0;
  private wantedSightTimer = 0;
  private hudSyncTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = '';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfdba74);
    this.scene.fog = new THREE.FogExp2(0xfed7aa, 0.0022);

    const initW = Math.max(1, container.clientWidth || window.innerWidth);
    const initH = Math.max(1, container.clientHeight || window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(62, initW / initH, 0.2, 850);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(initW, initH);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Golden-Hour California Sunset Lighting
    const hemi = new THREE.HemisphereLight(0xfffbeb, 0x1e293b, 1.08);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffedd5, 2.15);
    sun.position.set(-140, 165, -75);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 520;
    const d = 195;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // Build Multi-Biome San Andreas Island Open World
    const city = buildLosSantosCity(this.scene);
    this.colliders = city.colliders;
    this.barrels = city.barrels;
    this.shootableMeshes = city.shootableMeshes;
    this.roadNodes = city.roadNodes;
    this.animatedProps = city.animatedProps;

    loadWorldTextures()
      .then((tex) => {
        if (!this.disposed && tex) {
          city.applyTextures(tex);
        }
      })
      .catch(() => {});

    // Create 3 Protagonists on the 3D Island Terrain
    this.protagonists = {
      michael: this.createProtagonistEntity('michael'),
      franklin: this.createProtagonistEntity('franklin'),
      trevor: this.createProtagonistEntity('trevor'),
    };

    // Create Police Maverick Helicopter
    const heliRig = createPoliceHelicopterMesh();
    heliRig.root.visible = false;
    this.scene.add(heliRig.root);
    this.heli = {
      rig: heliRig,
      x: 0,
      y: 42,
      z: 0,
      yaw: 0,
      hp: 650,
      maxHp: 650,
      active: false,
      crashing: false,
      fireCooldown: 1.5,
    };

    // Create Mission Beacon
    this.missionBeacon = createMissionBeaconMesh(0xfacc15);
    this.scene.add(this.missionBeacon);

    // Populate Open World: Helicopters, Off-Road Trucks, Supercars, Armored Cash Truck & Citizens
    this.spawnInitialTrafficAndParkedCars();
    this.spawnInitialCivilians();

    // Start Chapter 1
    this.setupMissionStep('street_warmup', 0);

    this.bindEvents();
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private createProtagonistEntity(id: CharacterId) {
    const profile = PROTAGONISTS[id];
    const rig = createCharacterRig({
      suitColor: profile.suitColor,
      shirtColor: profile.shirtColor,
      skinColor: profile.skinColor,
      hairColor: profile.hairColor,
    });
    const [sx, sz] = profile.spawnPos;
    const sy = getTerrainHeight(sx, sz);
    rig.root.position.set(sx, sy, sz);
    rig.root.rotation.y = profile.spawnYaw;
    updateRigWeaponVisual(rig, profile.defaultWeapon);
    this.scene.add(rig.root);

    return {
      rig,
      x: sx,
      y: sy,
      z: sz,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: profile.spawnYaw,
      rollTimer: 0,
      rollDir: new THREE.Vector2(),
    };
  }

  private spawnInitialTrafficAndParkedCars() {
    // 1. Flyable Attack Helicopters ("Buzzard") at Sandy Shores Airfield & LSIA Helipad!
    this.spawnVehicle('buzzard', 172, -55, 0, false);
    this.spawnVehicle('buzzard', -55, 145, Math.PI / 2, false);

    // 2. Parked Supercars & Off-Road Monster Trucks at Iconic Landmarks
    const parkedSpots: Array<[string, number, number, number]> = [
      ['zentorno', -112, 18, -Math.PI / 2], // Vespucci Beach & Del Perro Pier entrance (Ch.1 car!)
      ['comet', -152, 24, Math.PI / 2], // On Del Perro Pleasure Pier facing the Pier Stunt Jump!
      ['banshee', 12, -148, Math.PI], // At Vinewood Observatory facing the Summit Cliff Jump!
      ['zentorno', -12, -16, 0], // Near Michael in Downtown Maze Bank Plaza
      ['comet', -46, -18, Math.PI / 2], // Outside Pacific Standard Bank getaway car
      ['sandking', 160, -72, 0], // Lifted Desert Monster Truck at Sandy Shores Airfield
      ['sandking', 132, -18, 0], // Near Sandy Shores Desert Stunt Ramp
      ['zentorno', -10, 155, -Math.PI / 2], // At LSIA Airport Runway ready for Jet Stunt Jumps!
      ['police', 46, 78, 0], // Outside LSPD HQ
    ];

    for (const [specId, x, z, yaw] of parkedSpots) {
      this.spawnVehicle(specId, x, z, yaw, false);
    }

    // 3. Autonomous AI Traffic + 1 Golden Armored Cash Truck ("Gruppe Sechs")
    const nodeKeys = Array.from(this.roadNodes.keys());
    const trafficTypes = [
      'sedan',
      'suv',
      'comet',
      'sedan',
      'banshee',
      'suv',
      'zentorno',
      'sedan',
      'cash_truck',
    ];
    for (let i = 0; i < trafficTypes.length; i++) {
      const nodeKey = nodeKeys[(i * 2) % nodeKeys.length];
      const node = this.roadNodes.get(nodeKey);
      if (!node) continue;
      const nextId = node.neighbors[0];
      this.spawnVehicle(
        trafficTypes[i],
        node.x + (i % 2 === 0 ? 2.6 : -2.6),
        node.z + (i % 3 === 0 ? 4 : -4),
        0,
        true,
        nextId
      );
    }
  }

  private mapSpecToKind(
    spec: VehicleSpec
  ):
    | 'sport'
    | 'sedan'
    | 'suv'
    | 'police'
    | 'swat'
    | 'taxi'
    | 'cash_truck'
    | 'offroad'
    | 'buzzard' {
    if (spec.isAircraft) return 'buzzard';
    if (spec.isOffroad) return 'offroad';
    if (spec.isPolice) return 'police';
    if (spec.isCashTruck) return 'cash_truck';
    if (spec.isSport) return 'sport';
    if (spec.id === 'suv') return 'suv';
    return 'sedan';
  }

  private spawnVehicle(
    specId: string,
    x: number,
    z: number,
    yaw: number,
    aiTraffic: boolean,
    targetNodeId?: string,
    isMissionTarget?: boolean
  ): VehicleEntity {
    const spec = VEHICLE_SPECS[specId] || VEHICLE_SPECS.sedan;
    const rig = createVehicleMesh({
      color: spec.color,
      kind: this.mapSpecToKind(spec),
    });
    const y = getTerrainHeight(x, z);
    rig.root.position.set(x, y, z);
    rig.root.rotation.y = yaw;
    this.scene.add(rig.root);

    const v: VehicleEntity = {
      id: `veh_${Date.now()}_${Math.random()}`,
      spec,
      rig,
      x,
      y,
      z,
      vy: 0,
      yaw,
      speed: 0,
      lateralVel: 0,
      roll: 0,
      pitch: 0,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      exploded: false,
      aiTraffic,
      targetNodeId,
      isMissionTarget,
      airborne: false,
      jumpStartX: x,
      jumpStartZ: z,
    };
    this.vehicles.push(v);
    return v;
  }

  private spawnInitialCivilians() {
    const suitPalette = [0x334155, 0x7c2d12, 0x14532d, 0x4c1d95, 0x831843, 0x1e3a8a, 0x0f766e];
    const spawnCoords: Array<[number, number]> = [
      // Vespucci Beach & Del Perro Pier tourists
      [-115, 12],
      [-145, 18],
      [-165, 22],
      [-110, -15],
      [-110, 55],
      // Vinewood Observatory visitors
      [-16, -152],
      [6, -155],
      [-28, -148],
      // Downtown Los Santos pedestrians
      [-22, -10],
      [18, -10],
      [-42, 15],
      [42, 15],
      [-22, 48],
      [28, 48],
      [-65, -20],
      [65, -20],
      // Sandy Shores & LSIA crew
      [162, -50],
      [178, -68],
      [-20, 142],
      [20, 142],
    ];

    spawnCoords.forEach(([x, z], i) => {
      const profile = NPC_DIALOGUES[i % NPC_DIALOGUES.length];
      this.spawnNPC(
        x,
        z,
        'civilian',
        'unarmed',
        suitPalette[i % suitPalette.length],
        profile
      );
    });
  }

  private spawnNPC(
    x: number,
    z: number,
    role: 'civilian' | 'cop' | 'swat' | 'mission_enemy',
    weapon: WeaponId,
    customSuit?: number,
    dialogueProfile?: NpcDialogueProfile
  ): NPCEntity {
    const isCop = role === 'cop';
    const isSwat = role === 'swat';
    const rig = createCharacterRig({
      suitColor: customSuit ?? (role === 'mission_enemy' ? 0x7f1d1d : 0x334155),
      shirtColor: role === 'mission_enemy' ? 0xef4444 : 0x94a3b8,
      skinColor: 0xe0ac69,
      hairColor: 0x18181b,
      isCop,
      isSwat,
      showHpBar: role !== 'civilian',
    });
    const y = getTerrainHeight(x, z);
    rig.root.position.set(x, y, z);
    updateRigWeaponVisual(rig, weapon);
    this.scene.add(rig.root);

    const maxHp = isSwat ? 160 : role === 'mission_enemy' ? 120 : isCop ? 100 : 65;
    const npc: NPCEntity = {
      id: `npc_${Date.now()}_${Math.random()}`,
      rig,
      x,
      z,
      yaw: Math.random() * Math.PI * 2,
      hp: maxHp,
      maxHp,
      role,
      weapon,
      fireCooldown: 0.6 + Math.random() * 0.8,
      staggerTimer: 0,
      dead: false,
      deathTimer: 0,
      walkPhase: Math.random() * 10,
      panicTimer: 0,
      dialogueProfile,
    };
    this.npcs.push(npc);
    return npc;
  }

  // === Public Actions callable from HUD ===
  public switchCharacter(target: CharacterId) {
    const state = useGameStore.getState();
    if (state.activeChar === target || this.skyCam?.active) return;

    if (this.currentVehicle) {
      this.exitVehicle();
    }

    const fromChar = state.activeChar;
    const fromP = this.protagonists[fromChar];
    const toP = this.protagonists[target];

    this.skyCam = {
      active: true,
      fromChar,
      toChar: target,
      timer: 0,
      duration: 1.75,
      fromPos: new THREE.Vector3(fromP.x, fromP.y, fromP.z),
      toPos: new THREE.Vector3(toP.x, toP.y, toP.z),
    };

    sound.playSkyCamStep(false);
    state.updateHUD({
      skyCamSwitching: true,
      skyCamTarget: target,
      charWheelOpen: false,
      weaponWheelOpen: false,
      worldMapOpen: false,
      dialogue: null,
    });
  }

  /**
   * Fast-Travel to any landmark or point on the San Andreas Island via Satellite Sky-Cam!
   */
  public teleportTo(targetX: number, targetZ: number, label?: string) {
    const state = useGameStore.getState();
    if (this.skyCam?.active) return;

    if (this.currentVehicle) {
      this.exitVehicle();
    }

    const active = state.activeChar;
    const p = this.protagonists[active];
    const fromPos = new THREE.Vector3(p.x, p.y, p.z);
    const targetY = getTerrainHeight(targetX, targetZ);
    const toPos = new THREE.Vector3(targetX, targetY, targetZ);

    p.x = targetX;
    p.y = targetY;
    p.z = targetZ;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.rig.root.position.set(targetX, targetY, targetZ);

    this.skyCam = {
      active: true,
      fromChar: active,
      toChar: active,
      timer: 0,
      duration: 1.5,
      fromPos,
      toPos,
    };

    sound.playSkyCamStep(false);
    state.updateHUD({
      skyCamSwitching: true,
      skyCamTarget: active,
      worldMapOpen: false,
      dialogue: null,
    });
    if (label) {
      state.pushPopup(`🛰️ 衛星空降傳送至：【${label}】`, '#38bdf8');
    }
  }

  public selectWeapon(weapon: WeaponId) {
    const state = useGameStore.getState();
    const active = state.activeChar;
    const charStates = { ...state.charStates };
    charStates[active] = { ...charStates[active], weapon };
    updateRigWeaponVisual(this.protagonists[active].rig, weapon);
    state.updateHUD({ charStates, reloading: false });
  }

  public toggleSpecialAbility() {
    const state = useGameStore.getState();
    const cur = state.charStates[state.activeChar];
    if (!state.specialActive && cur.special < 15) return;
    const next = !state.specialActive;
    state.updateHUD({ specialActive: next });
    if (next) {
      state.pushPopup(`⚡ 啟動特殊能力：${PROTAGONISTS[state.activeChar].specialName}`, '#facc15');
    }
  }

  public triggerReload() {
    const state = useGameStore.getState();
    if (state.reloading) return;
    const wId = state.charStates[state.activeChar].weapon;
    const spec = WEAPONS[wId];
    const ammo = state.weapons[wId];
    if (wId === 'unarmed' || ammo.inMag >= spec.magSize || ammo.reserve <= 0) return;

    sound.playReload();
    state.updateHUD({ reloading: true, reloadProgress: 0 });
  }

  public buyAmmuNationItem(item: 'ammo' | 'armor' | 'heavy') {
    const state = useGameStore.getState();
    if (item === 'ammo' && state.cash >= 1200) {
      state.addCash(-1200);
      const updated = { ...state.weapons };
      for (const wId of WEAPON_WHEEL_ORDER) {
        if (wId !== 'unarmed') {
          updated[wId] = {
            unlocked: true,
            inMag: WEAPONS[wId].magSize,
            reserve: WEAPONS[wId].maxReserve,
          };
        }
      }
      sound.playCashPickup();
      state.updateHUD({ weapons: updated });
      state.pushPopup('🔫 已補滿全 8 格武器彈匣與備彈！', '#34d399');
    } else if (item === 'armor' && state.cash >= 800) {
      state.addCash(-800);
      const cs = { ...state.charStates };
      cs[state.activeChar] = {
        ...cs[state.activeChar],
        hp: 100,
        armor: 100,
      };
      sound.playCashPickup();
      state.updateHUD({ charStates: cs });
      state.pushPopup('🛡️ 已穿戴重型複合防彈衣並恢復滿生命值！', '#38bdf8');
    } else if (item === 'heavy' && state.cash >= 3500) {
      state.addCash(-3500);
      const updated = { ...state.weapons };
      updated.rpg = { unlocked: true, inMag: 2, reserve: 20 };
      updated.minigun = { unlocked: true, inMag: 200, reserve: 1000 };
      sound.playCashPickup();
      state.updateHUD({ weapons: updated });
      this.selectWeapon('rpg');
      state.pushPopup('🚀 已購入重裝毀滅軍火套組 (RPG + 火神機槍)！', '#facc15');
    }
  }

  public useLSCustoms(service: 'repair' | 'respray' | 'clear_wanted') {
    const state = useGameStore.getState();
    if (service === 'clear_wanted' && state.cash >= 1500) {
      state.addCash(-1500);
      this.clearWantedLevel();
      sound.playCashPickup();
      state.pushPopup('✨ 已更換偽造車牌，全面消除警方通緝！', '#a855f7');
    } else if (service === 'repair' && state.cash >= 600) {
      state.addCash(-600);
      if (this.currentVehicle) {
        this.currentVehicle.hp = this.currentVehicle.maxHp;
        this.currentVehicle.rig.smokeGroup.visible = false;
      }
      sound.playCashPickup();
      state.pushPopup('🔧 座駕引擎與防彈裝甲已 100% 修復！', '#34d399');
    } else if (service === 'respray' && state.cash >= 500) {
      state.addCash(-500);
      if (this.currentVehicle) {
        const neonColors = [0xec4899, 0x06b6d4, 0x8b5cf6, 0x10b981, 0xf59e0b, 0xef4444];
        const nextC = neonColors[Math.floor(Math.random() * neonColors.length)];
        this.currentVehicle.rig.bodyMat.color.setHex(nextC);
      }
      sound.playCashPickup();
      state.pushPopup('🎨 已換上賽博金屬烤漆！', '#ec4899');
    }
  }

  public startMission(missionId: MissionId) {
    const def = MISSIONS[missionId];
    const state = useGameStore.getState();

    this.npcs = this.npcs.filter((n) => {
      if (n.role === 'mission_enemy') {
        this.scene.remove(n.rig.root);
        return false;
      }
      return true;
    });

    this.setupMissionStep(missionId, 0);

    state.updateHUD({
      activeMissionId: missionId,
      missionStepIdx: 0,
      missionObjectiveText: def.steps[0].instruction,
      missionProgressText: null,
      banner: {
        type: 'heist_start',
        title: def.title,
        subtitle: `委託人：${def.giver} · 分紅賞金 $${def.reward.toLocaleString()}`,
      },
    });

    setTimeout(() => {
      const s = useGameStore.getState();
      if (s.banner.type === 'heist_start') {
        s.updateHUD({ banner: { type: null, title: '', subtitle: '' } });
      }
    }, 3200);
  }

  private setupMissionStep(missionId: MissionId, stepIdx: number) {
    const def = MISSIONS[missionId];
    const step = def.steps[stepIdx];
    if (!step) return;

    const [tx, tz] = step.targetPos;
    const ty = getTerrainHeight(tx, tz);
    this.missionBeacon.position.set(tx, ty, tz);
    this.missionBeacon.visible = true;

    if (missionId === 'simeon_repo' && step.id === 'kill_bodyguards') {
      const guardCoords: Array<[number, number]> = [
        [-16, -155],
        [-4, -155],
        [-16, -162],
        [6, -158],
      ];
      for (const [gx, gz] of guardCoords) {
        this.spawnNPC(gx, gz, 'mission_enemy', 'smg', 0x1e1b4b);
      }
      this.spawnVehicle('banshee', 10, -152, Math.PI, false, undefined, true);
    } else if (missionId === 'pier_arms' && step.id === 'clear_cartel') {
      const cartelCoords: Array<[number, number]> = [
        [164, -68],
        [178, -68],
        [164, -82],
        [178, -82],
        [172, -92],
        [182, -75],
      ];
      for (const [cx, cz] of cartelCoords) {
        this.spawnNPC(cx, cz, 'mission_enemy', 'rifle', 0x451a03);
      }
    } else if (missionId === 'pier_arms' && step.id === 'survive_backup') {
      const backupCoords: Array<[number, number]> = [
        [160, -52],
        [182, -52],
        [165, -62],
        [178, -62],
      ];
      for (const [bx, bz] of backupCoords) {
        this.spawnNPC(bx, bz, 'mission_enemy', 'shotgun', 0x7f1d1d);
      }
    } else if (missionId === 'pacific_heist' && step.id === 'kill_guards') {
      const bankGuards: Array<[number, number]> = [
        [-60, -22],
        [-52, -21],
        [-44, -22],
        [-56, -26],
        [-48, -26],
      ];
      for (const [bx, bz] of bankGuards) {
        this.spawnNPC(bx, bz, 'mission_enemy', 'rifle', 0x0f172a);
      }
    } else if (missionId === 'federal_lockdown' && step.id === 'defeat_swat_and_heli') {
      this.triggerInstantAction('max_arsenal');
      this.selectWeapon('rpg');
      this.addWantedStars(5);
      const swatCoords: Array<[number, number]> = [
        [45, 148],
        [55, 148],
        [65, 148],
        [45, 162],
        [55, 162],
        [65, 162],
        [72, 155],
        [38, 155],
      ];
      for (const [sx, sz] of swatCoords) {
        this.spawnNPC(sx, sz, 'mission_enemy', 'rifle', 0x09090b);
      }
    }

    useGameStore.getState().updateHUD({
      activeMissionId: missionId,
      missionStepIdx: stepIdx,
      missionObjectiveText: step.instruction,
    });
  }

  public triggerInstantAction(
    action: 'spawn_supercar' | 'spawn_helicopter' | 'max_arsenal' | 'trigger_5star'
  ) {
    const state = useGameStore.getState();
    const p = this.protagonists[state.activeChar];
    if (action === 'spawn_supercar') {
      const carX = p.x - Math.sin(p.yaw) * 4.5;
      const carZ = p.z - Math.cos(p.yaw) * 4.5;
      const v = this.spawnVehicle('zentorno', carX, carZ, p.yaw, false);
      this.enterVehicle(v);
      sound.playCashPickup();
      state.pushPopup('🏎️ 已空投【佩嘉西·桑托勞超跑】並自動入座！', '#38bdf8');
    } else if (action === 'spawn_helicopter') {
      const heliX = p.x - Math.sin(p.yaw) * 6.0;
      const heliZ = p.z - Math.cos(p.yaw) * 6.0;
      const v = this.spawnVehicle('buzzard', heliX, heliZ, p.yaw, false);
      this.enterVehicle(v);
      sound.playCashPickup();
      state.pushPopup('🚁 已空投【長崎·禿鷹武裝直升機】！按 [Space] 升空、左鍵發射機砲與火箭！', '#facc15');
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
      cs[state.activeChar] = { ...cs[state.activeChar], hp: 100, armor: 100, special: 100 };
      state.updateHUD({ weapons: updated, charStates: cs });
      sound.playCashPickup();
      state.pushPopup('🔥 全 8 格重裝軍火、生命與防彈衣已 100% 補滿！', '#facc15');
    } else if (action === 'trigger_5star') {
      this.addWantedStars(5);
      state.pushPopup('⭐⭐⭐⭐⭐ 已觸發五星聯邦最高通緝！武裝直升機出動！', '#ef4444');
    }
  }

  public clearWantedLevel() {
    this.heli.active = false;
    this.heli.crashing = false;
    this.heli.rig.root.visible = false;
    this.wantedSightTimer = 0;

    this.npcs = this.npcs.filter((n) => {
      if (n.role === 'cop' || n.role === 'swat') {
        this.scene.remove(n.rig.root);
        return false;
      }
      return true;
    });

    useGameStore.getState().updateHUD({ wantedStars: 0, wantedSearching: false });
  }

  private addWantedStars(minStars: number) {
    const state = useGameStore.getState();
    const next = Math.min(5, Math.max(state.wantedStars, minStars));
    this.wantedSightTimer = 0;
    if (next !== state.wantedStars) {
      sound.playPoliceSirenBlip();
      state.updateHUD({ wantedStars: next, wantedSearching: false });
    } else if (state.wantedSearching) {
      state.updateHUD({ wantedSearching: false });
    }
    if (next >= 3 && !this.heli.active) {
      const p = this.protagonists[state.activeChar];
      this.heli.active = true;
      this.heli.crashing = false;
      this.heli.hp = this.heli.maxHp;
      this.heli.x = p.x + 35;
      this.heli.y = p.y + 38;
      this.heli.z = p.z - 35;
      this.heli.rig.root.visible = true;
    }
  }

  // === Input & Event Listeners ===
  private bindEvents() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', this.onContextMenu);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.container);
    }
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.renderer.dispose();
  }

  private onResize = () => {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private onContextMenu = (e: MouseEvent) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    const state = useGameStore.getState();
    if (!state.started) return;

    this.keys.add(e.code);

    if (e.code === 'Digit1') this.switchCharacter('michael');
    if (e.code === 'Digit2') this.switchCharacter('franklin');
    if (e.code === 'Digit3') this.switchCharacter('trevor');

    if (e.code === 'KeyM') {
      e.preventDefault();
      state.setWorldMapOpen(!state.worldMapOpen);
    }

    if (e.code === 'Tab') {
      e.preventDefault();
      state.updateHUD({ weaponWheelOpen: true });
    }
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
      e.preventDefault();
      state.updateHUD({ charWheelOpen: true });
    }
    if (e.code === 'KeyQ' || e.code === 'CapsLock') {
      e.preventDefault();
      this.toggleSpecialAbility();
    }
    if (e.code === 'KeyR') {
      this.triggerReload();
    }
    if (e.code === 'KeyE') {
      this.handleInteract();
    }
    if (e.code === 'KeyF') {
      this.handleTalkToCitizen();
    }
    if (e.code === 'KeyC' || e.code === 'ControlLeft') {
      const p = this.protagonists[state.activeChar];
      if (!this.currentVehicle && p.rollTimer <= 0) {
        p.rollTimer = 0.42;
        const fwd = new THREE.Vector2(-Math.sin(this.camYaw), -Math.cos(this.camYaw));
        p.rollDir.copy(fwd);
      }
    }
    if (e.code === 'Escape') {
      if (state.worldMapOpen) {
        state.setWorldMapOpen(false);
      } else if (state.shopModalOpen) {
        state.setShopModalOpen(null);
      } else if (state.dialogue) {
        state.closeDialogue();
      } else {
        state.setPaused(!state.paused);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    const state = useGameStore.getState();
    if (e.code === 'Tab') {
      state.updateHUD({ weaponWheelOpen: false });
    }
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
      state.updateHUD({ charWheelOpen: false });
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    const state = useGameStore.getState();
    if (
      !state.started ||
      state.paused ||
      state.weaponWheelOpen ||
      state.charWheelOpen ||
      state.worldMapOpen ||
      state.shopModalOpen
    ) {
      return;
    }

    if (document.pointerLockElement === this.renderer.domElement || this.mouseDownLeft || this.mouseDownRight) {
      const sens = state.aiming ? 0.0018 : 0.0028;
      this.camYaw -= e.movementX * sens;
      this.camPitch = clamp(this.camPitch + e.movementY * sens, -0.55, 0.88);
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    const state = useGameStore.getState();
    if (
      !state.started ||
      state.paused ||
      state.weaponWheelOpen ||
      state.charWheelOpen ||
      state.worldMapOpen ||
      state.shopModalOpen
    ) {
      return;
    }

    if (state.dialogue) {
      state.closeDialogue();
      return;
    }

    if (
      document.pointerLockElement !== this.renderer.domElement &&
      e.target === this.renderer.domElement
    ) {
      this.renderer.domElement.requestPointerLock?.();
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
    if (!state.started || state.paused || state.worldMapOpen) return;
    const curW = state.charStates[state.activeChar].weapon;
    const idx = WEAPON_WHEEL_ORDER.indexOf(curW);
    const dir = e.deltaY > 0 ? 1 : -1;
    const nextIdx = (idx + dir + WEAPON_WHEEL_ORDER.length) % WEAPON_WHEEL_ORDER.length;
    this.selectWeapon(WEAPON_WHEEL_ORDER[nextIdx]);
  };

  private handleInteract() {
    const state = useGameStore.getState();
    if (state.shopModalOpen) {
      state.setShopModalOpen(null);
      return;
    }

    const p = this.protagonists[state.activeChar];

    for (const lm of LANDMARKS) {
      const dist = Math.hypot(p.x - lm.x, p.z - lm.z);
      if (dist < 10.5) {
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
        if (lm.type === 'bank' && state.activeMissionId !== 'pacific_heist') {
          this.startMission('pacific_heist');
          return;
        }
      }
    }

    if (this.currentVehicle) {
      this.exitVehicle();
      return;
    }

    let closest: VehicleEntity | null = null;
    let bestDist = 6.5;
    for (const v of this.vehicles) {
      if (v.exploded) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestDist) {
        bestDist = d;
        closest = v;
      }
    }

    if (closest) {
      this.enterVehicle(closest);
    }
  }

  private handleTalkToCitizen() {
    const state = useGameStore.getState();
    if (this.currentVehicle) return;
    const p = this.protagonists[state.activeChar];

    let nearest: NPCEntity | null = null;
    let bestD = 5.0;
    for (const n of this.npcs) {
      if (n.dead || n.role !== 'civilian' || !n.dialogueProfile) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bestD) {
        bestD = d;
        nearest = n;
      }
    }

    if (!nearest || !nearest.dialogueProfile) return;
    const prof = nearest.dialogueProfile;
    nearest.yaw = Math.atan2(-(p.x - nearest.x), -(p.z - nearest.z));
    nearest.rig.root.rotation.y = nearest.yaw;

    const pool = state.wantedStars > 0 ? prof.linesWanted : prof.linesNormal;
    const line = pool[Math.floor(Math.random() * pool.length)];
    state.updateHUD({
      dialogue: {
        name: prof.name,
        job: prof.job,
        personality: prof.personality,
        line,
      },
    });
  }

  private enterVehicle(v: VehicleEntity) {
    const state = useGameStore.getState();
    const p = this.protagonists[state.activeChar];
    this.currentVehicle = v;
    v.aiTraffic = false;
    p.rig.root.visible = false;

    if (v.spec.isPolice) {
      this.addWantedStars(2);
    }

    const curW = state.charStates[state.activeChar].weapon;
    if (!WEAPONS[curW].driveBy && !v.spec.isAircraft) {
      this.selectWeapon('smg');
    }

    state.updateHUD({
      inVehicle: true,
      isFlyingVehicle: !!v.spec.isAircraft,
      vehicleAltitude: Math.round(v.y),
      vehicleName: v.spec.name,
      vehicleHpPercent: Math.round((v.hp / v.maxHp) * 100),
      dialogue: null,
    });
  }

  private exitVehicle() {
    if (!this.currentVehicle) return;
    const state = useGameStore.getState();
    const p = this.protagonists[state.activeChar];
    const v = this.currentVehicle;

    p.x = v.x + Math.cos(v.yaw) * 2.8;
    p.z = v.z - Math.sin(v.yaw) * 2.8;
    p.y = getTerrainHeight(p.x, p.z);
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.rig.root.position.set(p.x, p.y, p.z);
    p.rig.root.visible = true;

    this.currentVehicle = null;
    state.updateHUD({
      inVehicle: false,
      isFlyingVehicle: false,
      vehicleSpeedKmh: 0,
    });
  }

  // === Combat, Recoil & Ballistics ===
  private tryFireWeapon() {
    const state = useGameStore.getState();
    if (state.reloading || this.fireTimer > 0) return;

    const active = state.activeChar;
    const p = this.protagonists[active];

    // If piloting the Buzzard Attack Helicopter: fire twin helicopter rockets & autocannon!
    if (this.currentVehicle && this.currentVehicle.spec.isAircraft) {
      this.fireTimer = 0.28;
      sound.playGunshot('rpg');
      this.camShake = Math.min(0.45, this.camShake + 0.2);

      const v = this.currentVehicle;
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      const startPos = new THREE.Vector3(v.x, v.y + 1.1, v.z).addScaledVector(forward, 3.5);
      this.spawnRocket(startPos, forward);
      return;
    }

    let wId = state.charStates[active].weapon;
    if (this.currentVehicle && !WEAPONS[wId].driveBy) {
      wId = 'smg';
    }

    const spec = WEAPONS[wId];
    const ammo = state.weapons[wId];

    if (wId !== 'unarmed') {
      if (ammo.inMag <= 0) {
        this.triggerReload();
        return;
      }
      const isTrevorRage = active === 'trevor' && state.specialActive;
      if (!isTrevorRage) {
        const updated = { ...state.weapons };
        updated[wId] = { ...ammo, inMag: ammo.inMag - 1 };
        state.updateHUD({ weapons: updated });
      }
    }

    this.fireTimer = 1 / spec.fireRate;
    sound.playGunshot(wId);

    const isMichaelFocus = active === 'michael' && state.specialActive;
    const recoilMult = isMichaelFocus ? 0.15 : state.aiming ? 0.55 : 1.0;
    this.camPitch = clamp(this.camPitch - spec.recoilKick * recoilMult, -0.55, 0.88);
    this.camYaw += (Math.random() - 0.5) * spec.recoilKick * 0.45 * recoilMult;
    this.camShake = Math.min(0.6, this.camShake + spec.recoilKick * 3.2);
    this.reticleBloom = Math.min(1, this.reticleBloom + spec.recoilKick * 9 + 0.14);

    p.rig.muzzleFlash.visible = true;
    setTimeout(() => {
      p.rig.muzzleFlash.visible = false;
    }, 55);

    for (const n of this.npcs) {
      if (!n.dead && n.role === 'civilian' && Math.hypot(n.x - p.x, n.z - p.z) < 35) {
        n.panicTimer = 9.0;
      }
    }

    const dmgMult = active === 'trevor' && state.specialActive ? 2.2 : 1.0;
    const origin = new THREE.Vector3(
      this.currentVehicle ? this.currentVehicle.x : p.x,
      (this.currentVehicle ? this.currentVehicle.y : p.y) + 1.45,
      this.currentVehicle ? this.currentVehicle.z : p.z
    );

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);

    if (spec.explosive) {
      this.spawnRocket(origin.clone().addScaledVector(forward, 1.5), forward);
      return;
    }

    const spreadMult = isMichaelFocus ? 0.1 : state.aiming ? 0.42 : 1.0;
    for (let i = 0; i < spec.pellets; i++) {
      const dir = forward.clone();
      const s = spec.spread * spreadMult * (1 + this.reticleBloom * 0.5);
      dir.x += (Math.random() - 0.5) * s;
      dir.y += (Math.random() - 0.5) * s;
      dir.z += (Math.random() - 0.5) * s;
      dir.normalize();

      this.castBulletRay(origin, dir, spec.range, spec.damage * dmgMult, isMichaelFocus);
    }
  }

  private spawnRocket(pos: THREE.Vector3, dir: THREE.Vector3) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.85, 8),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    body.rotation.x = Math.PI / 2;
    group.add(body);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xf97316 })
    );
    group.add(glow);
    group.position.copy(pos);
    this.scene.add(group);

    this.rockets.push({
      mesh: group,
      pos: pos.clone(),
      vel: dir.clone().multiplyScalar(82),
      life: 3.4,
    });
  }

  private castBulletRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxRange: number,
    damage: number,
    isBulletTime: boolean
  ) {
    const raycaster = new THREE.Raycaster(this.camera.position.clone(), dir, 0.5, maxRange);

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
        : this.camera.position.clone().addScaledVector(dir, maxRange);

    this.spawnTracerBeam(origin, endPoint, isBulletTime ? 0x38bdf8 : 0xfef08a);

    if (hits.length === 0) return;
    const hitObj = hits[0].object;
    const hitPoint = hits[0].point;

    for (const b of this.barrels) {
      if (!b.exploded && (b.mesh === hitObj || b.mesh.children.includes(hitObj))) {
        b.exploded = true;
        b.mesh.visible = false;
        this.triggerExplosion(b.x, getTerrainHeight(b.x, b.z) + 0.8, b.z, 13);
        return;
      }
    }

    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const isHead = hitObj === npc.rig.head || npc.rig.head.children.includes(hitObj);
      const isTorso = hitObj === npc.rig.torso || npc.rig.torso.children.includes(hitObj);
      if (isHead || isTorso) {
        const headshotMult = isHead ? (isBulletTime ? 2.8 : 2.2) : 1.0;
        const knock = isHead ? 0.55 : 0.28;
        npc.x += dir.x * knock;
        npc.z += dir.z * knock;
        npc.staggerTimer = 0.25;
        this.damageNPC(npc, damage * headshotMult, isHead);
        this.spawnImpactSparks(hitPoint, 0xef4444);
        return;
      }
    }

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
        useGameStore.getState().pushPopup('🚁 擊落警用武裝直升機！賞金 +$5,000', '#facc15');
      }
      return;
    }

    for (const v of this.vehicles) {
      if (v.exploded || v === this.currentVehicle) continue;
      if (v.rig.root.children.some((c) => c === hitObj || c.children.includes(hitObj))) {
        this.damageVehicle(v, damage);
        this.spawnImpactSparks(hitPoint, 0xfbbf24);
        sound.playHitmarker(false);
        return;
      }
    }

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
      npc.deathTimer = 5.0;
      npc.rig.root.rotation.x = -Math.PI / 2;
      npc.rig.root.position.y = getTerrainHeight(npc.x, npc.z) + 0.25;
      if (npc.rig.hpBarBg) npc.rig.hpBarBg.visible = false;
      if (npc.rig.hpBarFill) npc.rig.hpBarFill.visible = false;

      if (isHeadshot) {
        state.addCash(250);
        state.pushPopup('🎯 精準爆頭擊殺！ +$250', '#f87171');
      }

      this.spawnLootDrop(npc.x, npc.z);

      if (npc.role === 'civilian') {
        this.addWantedStars(Math.max(1, state.wantedStars));
      } else if (npc.role === 'cop' || npc.role === 'swat') {
        this.addWantedStars(Math.min(5, Math.max(2, state.wantedStars + (Math.random() > 0.5 ? 1 : 0))));
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
      v.speed = 0;
      v.rig.bodyMat.color.setHex(0x18181b);
      this.triggerExplosion(v.x, v.y + 1.2, v.z, 12);

      if (v.spec.isCashTruck) {
        useGameStore.getState().addCash(25000);
        useGameStore
          .getState()
          .pushPopup('💰 成功攔截爆破黃金裝甲運鈔車！奪取 +$25,000！', '#22c55e');
        for (let i = 0; i < 5; i++) {
          this.spawnLootDrop(v.x + (Math.random() - 0.5) * 5, v.z + (Math.random() - 0.5) * 5);
        }
      }

      if (this.currentVehicle === v) {
        this.exitVehicle();
        this.damageActivePlayer(35);
      }
    }
  }

  private triggerExplosion(x: number, y: number, z: number, radius: number) {
    sound.playExplosion();
    this.camShake = Math.min(1.2, this.camShake + 0.9);

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
    ring.position.set(x, getTerrainHeight(x, z) + 0.2, z);
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

    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const d = Math.hypot(npc.x - x, npc.z - z);
      if (d < radius) {
        this.damageNPC(npc, (1 - d / radius) * 280, false);
      }
    }

    for (const v of this.vehicles) {
      if (v.exploded) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius) {
        this.damageVehicle(v, (1 - d / radius) * 260);
      }
    }

    if (this.heli.active && !this.heli.crashing) {
      const dh = Math.hypot(this.heli.x - x, this.heli.y - y, this.heli.z - z);
      if (dh < radius * 1.45) {
        this.heli.hp -= 380;
        if (this.heli.hp <= 0) {
          this.heli.crashing = true;
          useGameStore.getState().addCash(5000);
          useGameStore.getState().pushPopup('🚁 火箭彈擊落警用武裝直升機！ +$5,000', '#facc15');
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
      opacity: 0.9,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({
      mesh: line,
      life: 0,
      maxLife: 0.08,
      onUpdate: (p) => {
        mat.opacity = 0.9 * (1 - p);
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
      roll < 0.58 ? 'cash' : roll < 0.8 ? 'health' : 'armor';
    const color = type === 'cash' ? 0x22c55e : type === 'health' ? 0x10b981 : 0x38bdf8;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.35, 0.45),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.set(x, getTerrainHeight(x, z) + 0.45, z);
    this.scene.add(mesh);
    this.loots.push({
      id: `loot_${Date.now()}_${Math.random()}`,
      mesh,
      x,
      z,
      type,
      amount: type === 'cash' ? 500 + Math.floor(Math.random() * 900) : 35,
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
        subtitle: '重傷送往圓柱山醫療中心緊急搶救（醫療費 -$500）',
      },
    });

    setTimeout(() => {
      const s = useGameStore.getState();
      const active = s.activeChar;
      const p = this.protagonists[active];
      p.x = 52;
      p.z = -24;
      p.y = getTerrainHeight(p.x, p.z);
      p.rig.root.position.set(p.x, p.y, p.z);

      const cs = { ...s.charStates };
      cs[active] = { ...cs[active], hp: 100, armor: 50, special: 100 };
      s.addCash(-500);
      s.updateHUD({
        charStates: cs,
        banner: { type: null, title: '', subtitle: '' },
      });
    }, 2800);
  }

  // === Main Game Loop ===
  private loop = (now: number) => {
    if (this.disposed) return;
    this.animId = requestAnimationFrame(this.loop);
    const rawDt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const state = useGameStore.getState();

    // Animate Open-World Landmarks (Ferris Wheel, Wind Turbines, Ocean Waves)
    this.clockElapsed += rawDt;
    for (const prop of this.animatedProps) {
      if (prop.kind === 'ferris_wheel' || prop.kind === 'wind_turbine') {
        prop.object.rotation.z += rawDt * prop.speed;
      } else if (prop.kind === 'ocean' && prop.baseY !== undefined) {
        prop.object.position.y = prop.baseY + Math.sin(this.clockElapsed * prop.speed) * 0.14;
      }
    }

    // Live Orbiting San Andreas Island Preview on Start Menu
    if (!state.started) {
      this.attractAngle += rawDt * 0.12;
      this.updateVehicles(rawDt);
      this.camera.position.set(
        Math.sin(this.attractAngle) * 145 - 25,
        52,
        Math.cos(this.attractAngle) * 145 - 15
      );
      this.camera.lookAt(-20, 8, -35);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (state.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    let timeScale = 1.0;
    if (state.weaponWheelOpen || state.charWheelOpen) {
      timeScale = 0.22;
    } else if (state.specialActive) {
      if (state.activeChar === 'michael') timeScale = 0.35;
      if (state.activeChar === 'franklin' && this.currentVehicle) timeScale = 0.45;
    }

    const dt = rawDt * timeScale;
    this.camShake = Math.max(0, this.camShake - rawDt * 3.5);
    this.reticleBloom = Math.max(0, this.reticleBloom - rawDt * 2.8);

    this.updateSkyCam(rawDt);
    this.updateActiveProtagonist(rawDt);
    this.updateReloadAndSpecial(rawDt);
    this.updateRocketsAndEffects(dt);
    this.updateVehicles(dt);
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
      const step = Math.floor((p / 0.35) * 3) + 1;
      const h = fromPos.y + step * 42;
      this.camera.position.set(fromPos.x, h, fromPos.z + 10);
      this.camera.lookAt(fromPos.x, fromPos.y, fromPos.z);
    } else if (p < 0.7) {
      const panT = (p - 0.35) / 0.35;
      const smooth = panT * panT * (3 - 2 * panT);
      const cx = THREE.MathUtils.lerp(fromPos.x, toPos.x, smooth);
      const cz = THREE.MathUtils.lerp(fromPos.z, toPos.z, smooth);
      this.camera.position.set(cx, 155, cz + 14);
      this.camera.lookAt(cx, 0, cz);
    } else {
      const descT = (p - 0.7) / 0.3;
      const step = 3 - Math.floor(descT * 2.99);
      const h = toPos.y + step * 36;
      this.camera.position.set(toPos.x, h, toPos.z + 8);
      this.camera.lookAt(toPos.x, toPos.y + 1.5, toPos.z);
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

  private updateActiveProtagonist(rawDt: number) {
    const state = useGameStore.getState();
    const active = state.activeChar;
    const p = this.protagonists[active];

    if (this.fireTimer > 0) {
      this.fireTimer -= rawDt;
    }
    if (
      this.mouseDownLeft &&
      !state.weaponWheelOpen &&
      !state.charWheelOpen &&
      !state.worldMapOpen &&
      !state.shopModalOpen &&
      !state.dialogue
    ) {
      const curW = state.charStates[active].weapon;
      if (WEAPONS[curW].automatic || this.currentVehicle?.spec.isAircraft) {
        this.tryFireWeapon();
      }
    }

    if (this.skyCam?.active) return;

    // === Driving or Flying Mode ===
    if (this.currentVehicle) {
      const v = this.currentVehicle;

      // 1) Flyable Attack Helicopter ("Buzzard") Controls!
      if (v.spec.isAircraft) {
        const climb =
          (this.keys.has('Space') ? 1 : 0) -
          (this.keys.has('ShiftLeft') || this.keys.has('KeyC') ? 1 : 0);
        const fwdInput =
          (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
          (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
        const turnInput =
          (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) -
          (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0);

        v.yaw += turnInput * 2.1 * rawDt;
        const targetSpeed = fwdInput * v.spec.maxSpeed;
        v.speed = lerp(v.speed, targetSpeed, 1 - Math.exp(-3.5 * rawDt));
        v.vy = lerp(v.vy, climb * 20, 1 - Math.exp(-5.0 * rawDt));

        const f = yawForward(v.yaw);
        v.x = clamp(v.x + f.x * v.speed * rawDt, -HALF, HALF);
        v.z = clamp(v.z + f.z * v.speed * rawDt, -HALF, HALF);
        const groundY = getTerrainHeight(v.x, v.z);
        v.y = clamp(v.y + v.vy * rawDt, groundY, 145);

        v.pitch = lerp(v.pitch, -fwdInput * 0.24, 1 - Math.exp(-6 * rawDt));
        v.roll = lerp(v.roll, -turnInput * 0.28, 1 - Math.exp(-6 * rawDt));

        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.set(v.pitch, v.yaw, v.roll);

        // Spin Main & Tail Rotors
        if (v.rig.wheels[0]) v.rig.wheels[0].rotation.y += rawDt * 26;
        if (v.rig.wheels[1]) v.rig.wheels[1].rotation.x += rawDt * 32;

        p.x = v.x;
        p.y = v.y;
        p.z = v.z;
        p.yaw = v.yaw;
        p.rig.root.position.set(v.x, v.y, v.z);
        return;
      }

      // 2) Ground Vehicle with 3D Terrain Elevation & Stunt Jump Parabolic Flight
      const isFranklinFocus = active === 'franklin' && state.specialActive;
      const accelBoost = isFranklinFocus ? 1.55 : 1.0;
      const handlingBoost = isFranklinFocus ? 1.65 : 1.0;

      const forwardInput =
        (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const turnInput =
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) -
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0);
      const handbrake = this.keys.has('Space');

      if (forwardInput > 0) {
        v.speed += v.spec.accel * accelBoost * rawDt;
      } else if (forwardInput < 0) {
        v.speed -= v.spec.accel * 1.15 * rawDt;
      } else {
        v.speed *= Math.max(0, 1 - 2.4 * rawDt);
      }

      if (handbrake) {
        v.speed *= Math.max(0, 1 - 4.2 * rawDt);
      }

      v.speed = clamp(v.speed, -v.spec.maxSpeed * 0.4, v.spec.maxSpeed);

      if (Math.abs(v.speed) > 0.6) {
        const dirSign = v.speed >= 0 ? 1 : -1;
        const speedFactor = clamp(Math.abs(v.speed) / 9, 0.25, 1.0);
        const driftTurn = handbrake ? 1.45 : 1.0;
        v.yaw +=
          turnInput * v.spec.handling * handlingBoost * speedFactor * driftTurn * dirSign * rawDt;
      }

      const grip = handbrake ? 2.5 : isFranklinFocus ? 14.0 : 8.5;
      v.lateralVel *= Math.max(0, 1 - grip * rawDt);
      if (handbrake && Math.abs(v.speed) > 6) {
        v.lateralVel += -turnInput * Math.abs(v.speed) * 0.35 * rawDt;
      }

      const prevGroundY = getTerrainHeight(v.x, v.z);
      const f = yawForward(v.yaw);
      const r = yawRight(v.yaw);
      const nx = clamp(v.x + (f.x * v.speed + r.x * v.lateralVel) * rawDt, -HALF, HALF);
      const nz = clamp(v.z + (f.z * v.speed + r.z * v.lateralVel) * rawDt, -HALF, HALF);

      const col = resolveCircleList(nx, nz, 1.45, this.colliders);
      if (col.hit && v.y < 12) {
        if (Math.abs(v.speed) > 12) {
          this.damageVehicle(v, Math.abs(v.speed) * 1.1);
          this.camShake = Math.min(0.8, Math.abs(v.speed) / 28);
        }
        v.speed *= 0.28;
      }
      v.x = col.x;
      v.z = col.z;

      const newGroundY = getTerrainHeight(v.x, v.z);
      const slopeVy = (newGroundY - prevGroundY) / Math.max(0.005, rawDt);

      if (!v.airborne) {
        // Check if launching off a stunt ramp or cliff drop!
        if (v.y > newGroundY + 0.7 && Math.abs(v.speed) > 14) {
          v.airborne = true;
          v.vy = Math.max(4.5, v.vy);
          v.jumpStartX = v.x;
          v.jumpStartZ = v.z;
        } else {
          v.y = newGroundY;
          v.vy = clamp(slopeVy, -15, 22);
        }
      } else {
        // Parabolic airborne flight!
        v.vy -= 25.0 * rawDt;
        v.y += v.vy * rawDt;
        if (v.y <= newGroundY) {
          v.y = newGroundY;
          v.airborne = false;
          const jumpDist = Math.hypot(v.x - v.jumpStartX, v.z - v.jumpStartZ);
          if (jumpDist >= 16) {
            const bonus = Math.round(jumpDist * 180);
            state.addCash(bonus);
            sound.playCashPickup();
            state.pushPopup(
              `🚀 極限飛車特技成功！飛躍 ${Math.round(jumpDist)} 公尺 · 賞金 +$${bonus.toLocaleString()}`,
              '#facc15'
            );
          }
          v.vy = 0;
        }
      }

      const targetRoll = -turnInput * clamp(Math.abs(v.speed) / 30, 0, 1) * 0.14;
      const targetPitch = v.airborne
        ? clamp(v.vy * 0.025, -0.35, 0.35)
        : forwardInput * 0.035 - (handbrake ? 0.045 : 0);
      v.roll = lerp(v.roll, targetRoll, 1 - Math.exp(-8 * rawDt));
      v.pitch = lerp(v.pitch, targetPitch, 1 - Math.exp(-6 * rawDt));

      v.rig.root.position.set(v.x, v.y, v.z);
      v.rig.root.rotation.set(v.pitch, v.yaw, v.roll);

      const spin = v.speed * rawDt * 3.8;
      for (const wh of v.rig.wheels) {
        wh.rotation.x -= spin;
      }

      p.x = v.x;
      p.y = v.y;
      p.z = v.z;
      p.yaw = v.yaw;
      p.rig.root.position.set(p.x, p.y, p.z);

      if (Math.abs(v.speed) > 10 && !v.airborne) {
        for (const npc of this.npcs) {
          if (npc.dead) continue;
          if (Math.hypot(npc.x - v.x, npc.z - v.z) < 2.2) {
            this.damageNPC(npc, 130, false);
          }
        }
      }
      return;
    }

    // === On-Foot Smooth Acceleration & 3D Terrain Movement ===
    const forward = yawForward(this.camYaw);
    const right = yawRight(this.camYaw);

    let inputX = 0;
    let inputZ = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) inputZ += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) inputZ -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) inputX += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) inputX -= 1;

    let moveX = right.x * inputX + forward.x * inputZ;
    let moveZ = right.z * inputX + forward.z * inputZ;
    const mag = Math.hypot(moveX, moveZ);
    if (mag > 1) {
      moveX /= mag;
      moveZ /= mag;
    }

    const sprinting = this.keys.has('ShiftLeft') && !state.aiming;
    const maxSpeed =
      p.rollTimer > 0 ? 15.5 : sprinting ? 11.2 : state.aiming ? 5.2 : 7.4;

    if (p.rollTimer > 0) {
      p.rollTimer -= rawDt;
      moveX = p.rollDir.x;
      moveZ = p.rollDir.y;
    }

    const accelRate = mag > 0.05 || p.rollTimer > 0 ? 22 : 16;
    const k = 1 - Math.exp(-accelRate * rawDt);
    p.vx = lerp(p.vx, moveX * maxSpeed, k);
    p.vz = lerp(p.vz, moveZ * maxSpeed, k);

    const nx = clamp(p.x + p.vx * rawDt, -HALF, HALF);
    const nz = clamp(p.z + p.vz * rawDt, -HALF, HALF);

    const col = resolveCircleList(nx, nz, 0.52, this.colliders);
    p.x = col.x;
    p.z = col.z;
    if (col.hit) {
      p.vx *= 0.3;
      p.vz *= 0.3;
    }

    if (state.aiming || this.mouseDownLeft) {
      p.yaw = this.camYaw;
    } else if (mag > 0.08) {
      const targetYaw = Math.atan2(-moveX, -moveZ);
      p.yaw = lerpAngle(p.yaw, targetYaw, 1 - Math.exp(-14 * rawDt));
    }

    const groundY = getTerrainHeight(p.x, p.z);
    if (this.keys.has('Space') && p.y <= groundY + 0.05) {
      p.vy = 7.8;
    }
    p.vy -= 22 * rawDt;
    p.y = Math.max(groundY, p.y + p.vy * rawDt);
    if (p.y <= groundY) p.vy = 0;

    p.rig.root.position.set(p.x, p.y, p.z);
    p.rig.root.rotation.y = p.yaw;

    const curSpeed = Math.hypot(p.vx, p.vz);
    if (curSpeed > 0.4) {
      const swing = Math.sin(this.clockElapsed * (sprinting ? 14 : 9)) * 0.55;
      p.rig.leftLeg.rotation.x = swing;
      p.rig.rightLeg.rotation.x = -swing;
      p.rig.leftArm.rotation.x = -swing * 0.65;
    } else {
      p.rig.leftLeg.rotation.x *= 0.8;
      p.rig.rightLeg.rotation.x *= 0.8;
      p.rig.leftArm.rotation.x *= 0.8;
    }

    if (state.aiming || this.mouseDownLeft) {
      p.rig.rightArm.rotation.x = Math.PI / 2 - this.camPitch * 0.7;
    } else {
      p.rig.rightArm.rotation.x = 0.25;
    }
  }

  private updateReloadAndSpecial(rawDt: number) {
    const state = useGameStore.getState();
    const active = state.activeChar;

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

    const cs = { ...state.charStates };
    const cur = { ...cs[active] };
    if (state.specialActive) {
      cur.special = Math.max(0, cur.special - rawDt * 11);
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
    this.rockets = this.rockets.filter((r) => {
      r.life -= dt;
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);

      const groundY = getTerrainHeight(r.pos.x, r.pos.z);
      const hitGround = r.pos.y <= groundY + 0.35;
      const hitBuilding = resolveCircleList(r.pos.x, r.pos.z, 0.4, this.colliders).hit && r.pos.y < 28;
      let hitEntity = false;

      for (const v of this.vehicles) {
        if (
          !v.exploded &&
          v !== this.currentVehicle &&
          Math.hypot(v.x - r.pos.x, v.z - r.pos.z) < 2.8 &&
          Math.abs(v.y - r.pos.y) < 3.0
        ) {
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
        this.triggerExplosion(r.pos.x, Math.max(groundY + 0.8, r.pos.y), r.pos.z, 14);
        return false;
      }
      return true;
    });

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

  private updateVehicles(dt: number) {
    const state = useGameStore.getState();
    const p = this.protagonists[state.activeChar];
    const flash = Math.sin(this.clockElapsed * 15) > 0;

    for (const v of this.vehicles) {
      if (v.rig.copRed && v.rig.copBlue) {
        const on = state.wantedStars > 0;
        (v.rig.copRed.material as THREE.MeshStandardMaterial).emissiveIntensity =
          on && flash ? 1.8 : 0.2;
        (v.rig.copBlue.material as THREE.MeshStandardMaterial).emissiveIntensity =
          on && !flash ? 1.8 : 0.2;
      }

      // Spin idle rotors on parked helicopters slowly
      if (v.spec.isAircraft && v !== this.currentVehicle) {
        if (v.rig.wheels[0]) v.rig.wheels[0].rotation.y += dt * 4;
        if (v.rig.wheels[1]) v.rig.wheels[1].rotation.x += dt * 6;
        continue;
      }

      if (v === this.currentVehicle || v.exploded) continue;

      if (v.spec.isPolice && state.started && state.wantedStars > 0) {
        const dx = p.x - v.x;
        const dz = p.z - v.z;
        const d = Math.hypot(dx, dz);
        if (d < 65) {
          this.wantedSightTimer = 0;
        }
        const desiredYaw = Math.atan2(-dx, -dz);
        v.yaw = lerpAngle(v.yaw, desiredYaw, 3.0 * dt);
        v.speed = d > 7 ? 20 + state.wantedStars * 2 : 5;
        const f = yawForward(v.yaw);
        const col = resolveCircleList(v.x + f.x * v.speed * dt, v.z + f.z * v.speed * dt, 1.4, this.colliders);
        v.x = col.x;
        v.z = col.z;
        v.y = getTerrainHeight(v.x, v.z);
        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.y = v.yaw;
        continue;
      }

      if (!v.aiTraffic || !v.targetNodeId) continue;
      const targetNode = this.roadNodes.get(v.targetNodeId);
      if (!targetNode) continue;

      const dx = targetNode.x - v.x;
      const dz = targetNode.z - v.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 4.5) {
        const neighbors = targetNode.neighbors;
        v.targetNodeId = neighbors[Math.floor(Math.random() * neighbors.length)];
      } else {
        const targetYaw = Math.atan2(-dx, -dz);
        v.yaw = lerpAngle(v.yaw, targetYaw, 4.5 * dt);
        v.speed = v.spec.isCashTruck ? 12 : 14;
        const f = yawForward(v.yaw);
        v.x += f.x * v.speed * dt;
        v.z += f.z * v.speed * dt;
        v.y = getTerrainHeight(v.x, v.z);
        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.y = v.yaw;
        for (const wh of v.rig.wheels) {
          wh.rotation.x -= v.speed * dt * 3;
        }
      }
    }

    // Car-to-Car Separation
    for (let i = 0; i < this.vehicles.length; i++) {
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const a = this.vehicles[i];
        const b = this.vehicles[j];
        if (Math.abs(a.y - b.y) > 2.5) continue;
        const sep = separateCircles(a.x, a.z, 1.45, b.x, b.z, 1.45, 1, 1);
        if (!sep.hit) continue;
        a.x = sep.ax;
        a.z = sep.az;
        b.x = sep.bx;
        b.z = sep.bz;
      }
    }
  }

  private updateNPCsAndPolice(dt: number) {
    const state = useGameStore.getState();
    const p = this.protagonists[state.activeChar];

    if (state.wantedStars > 0) {
      this.wantedSightTimer += dt;
      if (this.wantedSightTimer > 8 && !state.wantedSearching) {
        state.updateHUD({ wantedSearching: true });
      }
      if (this.wantedSightTimer > 18) {
        this.wantedSightTimer = 8;
        const nextStars = state.wantedStars - 1;
        if (nextStars <= 0) {
          this.clearWantedLevel();
          state.pushPopup('✨ 已成功脫離警方搜索網，消除所有通緝星等！', '#34d399');
        } else {
          state.updateHUD({ wantedStars: nextStars });
        }
      }

      this.copSpawnTimer -= dt;
      const activeCops = this.npcs.filter(
        (n) => !n.dead && (n.role === 'cop' || n.role === 'swat')
      ).length;
      const maxCops = state.wantedStars * 2 + 2;

      if (this.copSpawnTimer <= 0 && activeCops < maxCops) {
        this.copSpawnTimer = 3.2;
        const angle = Math.random() * Math.PI * 2;
        const sx = clamp(p.x + Math.cos(angle) * 32, -HALF, HALF);
        const sz = clamp(p.z + Math.sin(angle) * 32, -HALF, HALF);
        const col = resolveCircleList(sx, sz, 0.55, this.colliders);
        if (!col.hit) {
          const isSwat = state.wantedStars >= 3;
          this.spawnNPC(col.x, col.z, isSwat ? 'swat' : 'cop', isSwat ? 'rifle' : 'pistol');
        }
      }
    }

    this.npcs = this.npcs.filter((npc) => {
      if (npc.dead) {
        npc.deathTimer -= dt;
        if (npc.deathTimer <= 0) {
          this.scene.remove(npc.rig.root);
          return false;
        }
        return true;
      }

      const ny = getTerrainHeight(npc.x, npc.z);
      if (npc.staggerTimer > 0) {
        npc.staggerTimer -= dt;
        npc.rig.root.position.set(npc.x, ny, npc.z);
        return true;
      }

      const dx = p.x - npc.x;
      const dz = p.z - npc.z;
      const dist = Math.hypot(dx, dz);

      if (npc.rig.hpBarBg && npc.rig.hpBarFill) {
        npc.rig.hpBarBg.lookAt(this.camera.position);
        npc.rig.hpBarFill.lookAt(this.camera.position);
      }

      if (npc.role === 'civilian') {
        const speed = npc.panicTimer > 0 ? 5.8 : 1.7;
        if (npc.panicTimer > 0) {
          npc.panicTimer -= dt;
          npc.yaw = Math.atan2(dx, dz);
        } else if (Math.random() < 0.012) {
          npc.yaw += (Math.random() - 0.5) * 1.2;
        }

        const f = yawForward(npc.yaw);
        const col = resolveCircleList(
          clamp(npc.x + f.x * speed * dt, -HALF, HALF),
          clamp(npc.z + f.z * speed * dt, -HALF, HALF),
          0.48,
          this.colliders
        );
        if (col.hit) {
          npc.yaw += Math.PI * 0.65;
        }
        npc.x = col.x;
        npc.z = col.z;
      } else {
        if (dist < 48) {
          this.wantedSightTimer = 0;
        }
        npc.yaw = Math.atan2(-dx, -dz);
        npc.rig.rightArm.rotation.x = Math.PI / 2;

        if (dist > 13 && dist < 85) {
          const moveSpeed = npc.role === 'swat' ? 5.2 : 4.4;
          const col = resolveCircleList(
            npc.x + (dx / dist) * moveSpeed * dt,
            npc.z + (dz / dist) * moveSpeed * dt,
            0.48,
            this.colliders
          );
          npc.x = col.x;
          npc.z = col.z;
        }

        if (dist < 42) {
          npc.fireCooldown -= dt;
          if (npc.fireCooldown <= 0) {
            npc.fireCooldown = npc.role === 'swat' ? 0.55 : 0.95;
            npc.rig.muzzleFlash.visible = true;
            setTimeout(() => {
              npc.rig.muzzleFlash.visible = false;
            }, 50);

            const start = new THREE.Vector3(npc.x, ny + 1.4, npc.z);
            const end = new THREE.Vector3(
              p.x + (Math.random() - 0.5) * 1.4,
              p.y + 1.1,
              p.z + (Math.random() - 0.5) * 1.4
            );
            this.spawnTracerBeam(start, end, 0xf87171);

            if (Math.random() < 0.45) {
              this.damageActivePlayer(npc.role === 'swat' ? 7 : 4.5);
            }
          }
        }
      }

      const groundY = getTerrainHeight(npc.x, npc.z);
      npc.rig.root.position.set(npc.x, groundY, npc.z);
      npc.rig.root.rotation.y = npc.yaw;
      npc.walkPhase += dt * (npc.panicTimer > 0 ? 12 : 6);
      const swing = Math.sin(npc.walkPhase) * 0.4;
      npc.rig.leftLeg.rotation.x = swing;
      npc.rig.rightLeg.rotation.x = -swing;

      return true;
    });
  }

  private updateHelicopter(dt: number) {
    if (!this.heli.active) return;

    const state = useGameStore.getState();
    const p = this.protagonists[state.activeChar];

    this.heli.rig.mainRotor.rotation.y += dt * 22;
    this.heli.rig.tailRotor.rotation.x += dt * 28;

    if (this.heli.crashing) {
      this.heli.yaw += dt * 5.5;
      this.heli.y -= dt * 15;
      this.heli.rig.root.position.set(this.heli.x, this.heli.y, this.heli.z);
      this.heli.rig.root.rotation.z += dt * 1.5;
      const groundY = getTerrainHeight(this.heli.x, this.heli.z);
      if (this.heli.y <= groundY + 1.5) {
        this.heli.active = false;
        this.heli.rig.root.visible = false;
        this.heli.rig.root.rotation.set(0, 0, 0);
        this.triggerExplosion(this.heli.x, groundY + 2, this.heli.z, 16);
      }
      return;
    }

    this.wantedSightTimer = 0;
    const orbitAngle = this.clockElapsed * 0.55;
    const targetX = p.x + Math.cos(orbitAngle) * 20;
    const targetZ = p.z + Math.sin(orbitAngle) * 20;
    const targetY = Math.max(p.y + 28, getTerrainHeight(targetX, targetZ) + 28);

    this.heli.x = THREE.MathUtils.lerp(this.heli.x, targetX, dt * 1.8);
    this.heli.y = THREE.MathUtils.lerp(this.heli.y, targetY, dt * 2.0);
    this.heli.z = THREE.MathUtils.lerp(this.heli.z, targetZ, dt * 1.8);
    this.heli.yaw = Math.atan2(-(p.x - this.heli.x), -(p.z - this.heli.z));

    this.heli.rig.root.position.set(this.heli.x, this.heli.y, this.heli.z);
    this.heli.rig.root.rotation.y = this.heli.yaw;

    this.heli.fireCooldown -= dt;
    if (this.heli.fireCooldown <= 0) {
      this.heli.fireCooldown = 1.4;
      const start = new THREE.Vector3(this.heli.x, this.heli.y - 1.2, this.heli.z);
      const end = new THREE.Vector3(
        p.x + (Math.random() - 0.5) * 1.6,
        p.y + 1.1,
        p.z + (Math.random() - 0.5) * 1.6
      );
      this.spawnTracerBeam(start, end, 0x38bdf8);
      if (Math.random() < 0.4) {
        this.damageActivePlayer(6);
      }
    }
  }

  private updateMissionsAndLoots(dt: number) {
    const state = useGameStore.getState();
    const p = this.protagonists[state.activeChar];

    this.missionBeacon.rotation.y = this.clockElapsed * 1.2;

    this.loots = this.loots.filter((l) => {
      l.mesh.rotation.y += dt * 2.8;
      if (Math.hypot(l.x - p.x, l.z - p.z) < 2.8) {
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

    if (!state.activeMissionId) {
      this.missionBeacon.visible = false;
      return;
    }

    const def = MISSIONS[state.activeMissionId];
    const step = def.steps[state.missionStepIdx];
    if (!step) return;

    const [tx, tz] = step.targetPos;
    const distToTarget = Math.hypot(p.x - tx, p.z - tz);
    const remainingEnemies = this.npcs.filter(
      (n) => !n.dead && n.role === 'mission_enemy'
    ).length;

    let stepComplete = false;
    let progressLabel: string | null = null;

    if (step.type === 'goto') {
      progressLabel = `距離目標光圈：${Math.round(distToTarget)}m`;
      if (distToTarget < step.radius) {
        stepComplete = true;
        if (state.activeMissionId === 'street_warmup' && step.id === 'drive_to_ammu') {
          this.triggerInstantAction('max_arsenal');
        }
      }
    } else if (step.type === 'kill_targets') {
      progressLabel = `剩餘目標武裝敵軍：${remainingEnemies} 人`;
      if (remainingEnemies === 0) stepComplete = true;
    } else if (step.type === 'pickup') {
      progressLabel = `距離戰利品光圈：${Math.round(distToTarget)}m`;
      if (distToTarget < step.radius) {
        stepComplete = true;
        sound.playCashPickup();
        if (state.activeMissionId === 'pacific_heist') {
          this.addWantedStars(4);
          state.pushPopup('🚨 金庫警報觸發！四星 NOOSE 特警與武裝直升機全面出動！', '#ef4444');
        } else if (state.activeMissionId === 'pier_arms') {
          this.triggerInstantAction('max_arsenal');
          this.selectWeapon('rpg');
        }
      }
    } else if (step.type === 'enter_car') {
      if (state.activeMissionId === 'street_warmup') {
        progressLabel = this.currentVehicle ? '已登上跑車！' : `距離海濱跑車：${Math.round(distToTarget)}m`;
        if (this.currentVehicle) stepComplete = true;
      } else {
        progressLabel = this.currentVehicle?.isMissionTarget
          ? '已奪取黃金女妖超跑！'
          : `距離目標超跑：${Math.round(distToTarget)}m`;
        if (this.currentVehicle?.isMissionTarget) {
          stepComplete = true;
          this.addWantedStars(2);
        }
      }
    } else if (step.type === 'escape_wanted') {
      progressLabel =
        state.wantedStars === 0
          ? '已消除通緝！'
          : `前往洛聖都改車王 (${Math.round(distToTarget)}m) 或脫離警方視線`;
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
    } else if (step.type === 'destroy_heli') {
      progressLabel =
        this.heli.active && !this.heli.crashing
          ? `警用武裝直升機耐久：${Math.max(0, Math.round((this.heli.hp / this.heli.maxHp) * 100))}% (剩餘特警 ${remainingEnemies} 人)`
          : `剩餘聯邦特警：${remainingEnemies} 人`;
      if ((!this.heli.active || this.heli.crashing) && remainingEnemies === 0) {
        stepComplete = true;
      }
    }

    state.updateHUD({ missionProgressText: progressLabel });

    if (stepComplete) {
      const nextIdx = state.missionStepIdx + 1;
      if (nextIdx < def.steps.length) {
        this.setupMissionStep(state.activeMissionId, nextIdx);
      } else {
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
            subtitle: `${def.title} — 賞金 +$${def.reward.toLocaleString()} · RESPECT +`,
            reward: def.reward,
          },
        });

        const curOrderIdx = MISSION_ORDER.indexOf(def.id);
        const nextMissionId = MISSION_ORDER[curOrderIdx + 1];

        setTimeout(() => {
          const s = useGameStore.getState();
          if (s.banner.type === 'mission_passed') {
            s.updateHUD({ banner: { type: null, title: '', subtitle: '' } });
            if (nextMissionId && !s.activeMissionId) {
              this.startMission(nextMissionId);
            }
          }
        }, 3600);
      }
    }
  }

  private updateCamera(rawDt: number) {
    if (this.skyCam?.active) return;

    const state = useGameStore.getState();
    const active = state.activeChar;
    const p = this.protagonists[active];
    const wId = state.charStates[active].weapon;
    const spec = WEAPONS[wId];

    const isFlying = !!this.currentVehicle?.spec.isAircraft;
    const targetFov = state.aiming
      ? spec.scopeZoom ?? 40
      : isFlying
        ? 68
        : this.currentVehicle && Math.abs(this.currentVehicle.speed) > 25
          ? 70
          : 60;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, rawDt * 12);
    this.camera.updateProjectionMatrix();

    const targetX = this.currentVehicle ? this.currentVehicle.x : p.x;
    const targetY = (this.currentVehicle ? this.currentVehicle.y : p.y) + 1.55;
    const targetZ = this.currentVehicle ? this.currentVehicle.z : p.z;

    if (this.currentVehicle && !this.mouseDownLeft && !this.mouseDownRight) {
      this.camYaw = lerpAngle(this.camYaw, this.currentVehicle.yaw, rawDt * 3.2);
    }

    const dist = isFlying ? 11.5 : this.currentVehicle ? 8.2 : state.aiming ? 2.85 : 5.0;
    const rightOffset = this.currentVehicle ? 0 : state.aiming ? 0.68 : 0.42;

    const sinY = Math.sin(this.camYaw);
    const cosY = Math.cos(this.camYaw);
    const sinP = Math.sin(this.camPitch);
    const cosP = Math.cos(this.camPitch);

    const shakeX = (Math.random() - 0.5) * this.camShake * 0.25;
    const shakeY = (Math.random() - 0.5) * this.camShake * 0.25;

    const camX = targetX + sinY * cosP * dist + cosY * rightOffset + shakeX;
    const camGround = getTerrainHeight(camX, targetZ + cosY * cosP * dist);
    const camY = Math.max(camGround + 0.85, targetY + sinP * dist + 0.5 + shakeY);
    const camZ = targetZ + cosY * cosP * dist - sinY * rightOffset;

    this.camera.position.set(camX, camY, camZ);

    const lookAhead = 28;
    const lookX = targetX - sinY * cosP * lookAhead + cosY * rightOffset * 0.5;
    const lookY = targetY - sinP * lookAhead;
    const lookZ = targetZ - cosY * cosP * lookAhead - sinY * rightOffset * 0.5;

    this.camera.lookAt(lookX, lookY, lookZ);
  }

  private syncHUD(rawDt: number) {
    this.hudSyncTimer += rawDt;
    if (this.hudSyncTimer < 0.08) return;
    this.hudSyncTimer = 0;

    const state = useGameStore.getState();
    const active = state.activeChar;
    const p = this.protagonists[active];

    const cs = { ...state.charStates };
    (['michael', 'franklin', 'trevor'] as CharacterId[]).forEach((cid) => {
      cs[cid] = {
        ...cs[cid],
        x: this.protagonists[cid].x,
        z: this.protagonists[cid].z,
      };
    });

    let interactPrompt: string | null = null;
    for (const lm of LANDMARKS) {
      if (lm.interactPrompt && Math.hypot(p.x - lm.x, p.z - lm.z) < 10.5) {
        interactPrompt = lm.interactPrompt;
        break;
      }
    }
    if (!interactPrompt && !this.currentVehicle) {
      for (const v of this.vehicles) {
        if (!v.exploded && Math.hypot(v.x - p.x, v.z - p.z) < 6.2) {
          interactPrompt = v.spec.isAircraft
            ? `按 [E] 登機駕駛【${v.spec.name}】(空白鍵升空)`
            : `按 [E] 駕駛【${v.spec.name}】`;
          break;
        }
      }
    }

    let talkPrompt: string | null = null;
    if (!this.currentVehicle) {
      for (const npc of this.npcs) {
        if (
          !npc.dead &&
          npc.role === 'civilian' &&
          npc.dialogueProfile &&
          Math.hypot(npc.x - p.x, npc.z - p.z) < 4.5
        ) {
          talkPrompt = `按 [F] 與【${npc.dialogueProfile.name} · ${npc.dialogueProfile.job}】交談`;
          break;
        }
      }
    }

    const blips: RadarBlip[] = [];
    (['michael', 'franklin', 'trevor'] as CharacterId[]).forEach((cid) => {
      if (cid !== active) {
        blips.push({
          id: `char_${cid}`,
          x: this.protagonists[cid].x,
          z: this.protagonists[cid].z,
          type: 'protagonist',
          color: PROTAGONISTS[cid].color,
          label: cid[0].toUpperCase(),
        });
      }
    });

    for (const lm of LANDMARKS) {
      blips.push({
        id: lm.id,
        x: lm.x,
        z: lm.z,
        type: lm.type === 'ammu' ? 'ammu' : lm.type === 'customs' ? 'customs' : 'bank',
        color: lm.color,
        label: lm.icon,
      });
    }

    for (const ramp of STUNT_RAMPS) {
      blips.push({
        id: ramp.id,
        x: ramp.x,
        z: ramp.z,
        type: 'stunt',
        color: '#f472b6',
        label: '▲',
      });
    }

    for (const v of this.vehicles) {
      if (v.exploded) continue;
      if (v.spec.isCashTruck) {
        blips.push({
          id: v.id,
          x: v.x,
          z: v.z,
          type: 'cash_truck',
          color: '#22c55e',
          label: '$',
        });
      } else if (v.spec.isAircraft && v !== this.currentVehicle) {
        blips.push({
          id: v.id,
          x: v.x,
          z: v.z,
          type: 'helipad',
          color: '#facc15',
          label: 'H',
        });
      } else if (v.spec.isPolice && state.wantedStars > 0) {
        blips.push({
          id: v.id,
          x: v.x,
          z: v.z,
          type: 'cop',
          color: '#38bdf8',
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
      reticleBloom: this.reticleBloom,
      district: getDistrictName(p.x, p.z),
      interactPrompt,
      talkPrompt,
      blips,
      playerRotation: this.currentVehicle ? this.currentVehicle.yaw : this.camYaw,
      isFlyingVehicle: !!this.currentVehicle?.spec.isAircraft,
      vehicleAltitude: this.currentVehicle ? Math.round(this.currentVehicle.y) : Math.round(p.y),
      vehicleSpeedKmh: this.currentVehicle
        ? Math.round(Math.abs(this.currentVehicle.speed) * 3.6)
        : 0,
      vehicleHpPercent: this.currentVehicle
        ? Math.max(0, Math.round((this.currentVehicle.hp / this.currentVehicle.maxHp) * 100))
        : 100,
    });
  }
}
