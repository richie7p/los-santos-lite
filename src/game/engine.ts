import * as THREE from 'three';
import {
  AABB,
  circlesOverlap,
  clamp,
  dist2,
  lerp,
  lerpAngle,
  resolveCircleList,
  separateCircles,
  wrapAngle,
  yawForward,
  yawRight,
} from './collision';
import {
  CharacterId,
  MissionId,
  NpcDialogueProfile,
  RadarBlip,
  WeaponId,
} from './types';
import {
  getDistrictName,
  GRID,
  LANDMARKS,
  MISSION_ORDER,
  MISSIONS,
  NPC_DIALOGUES,
  PROTAGONISTS,
  WEAPON_WHEEL_ORDER,
  WEAPONS,
} from './data';
import {
  CharacterRig,
  createCharacterRig,
  createMissionBeaconMesh,
  createPoliceHelicopterMesh,
  createVehicleMesh,
  HelicopterRig,
  updateRigWeaponVisual,
  VehicleRig,
} from './meshes';
import { BarrelEntity, buildLosSantosCity, RoadNode } from './city';
import { loadWorldTextures, WorldTextures } from './textures';
import { useGameStore } from './store';
import { sound } from './audio';

const PLAYER_RADIUS = 0.44;
const WALK_SPEED = 5.6;
const RUN_SPEED = 9.2;
const WALK_ACCEL = 22;
const WALK_FRICTION = 16;
const JUMP_SPEED = 7.6;
const GRAVITY = 22;

const CAR_RADIUS = 1.58;
const CAR_ACCEL = 20;
const CAR_BRAKE = 34;
const CAR_DRAG = 1.6;
const CAR_MAX_SPEED = 36;
const CAR_REVERSE_MAX = 12;
const CAR_TURN_RATE = 1.95;
const CAR_HANDBRAKE = 26;
const CAR_GRIP = 9.2;
const CAR_HANDBRAKE_GRIP = 2.8;
const LANE_OFFSET = 2.15;

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
  staggerT: number;
  dead: boolean;
  deathTimer: number;
  walkT: number;
  waypoints?: { x: number; z: number }[];
  wpIdx: number;
  waitT: number;
  panicT: number;
  dialogueProfile?: NpcDialogueProfile;
}

interface VehicleEntity {
  id: string;
  name: string;
  kind: 'sport' | 'sedan' | 'suv' | 'police' | 'swat' | 'taxi' | 'cash_truck';
  rig: VehicleRig;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  lateral: number;
  roll: number;
  pitch: number;
  maxSpeed: number;
  hp: number;
  maxHp: number;
  exploded: boolean;
  aiTraffic: boolean;
  isPolice: boolean;
  isMissionTarget?: boolean;
  isCashTruck?: boolean;
  nextNode?: { i: number; j: number };
  destNode?: { i: number; j: number };
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
  private time = 0;
  private disposed = false;

  // World data
  private cityGroup: THREE.Object3D | null = null;
  private colliders: AABB[] = [];
  private treeColliders: { x: number; z: number; r: number }[] = [];
  private barrels: BarrelEntity[] = [];
  private shootableMeshes: THREE.Object3D[] = [];
  private nodes: RoadNode[] = [];
  private npcLoops: { x: number; z: number }[][] = [];

  // Protagonist Rigs & Physics
  private charRigs: Record<CharacterId, CharacterRig>;
  private charVel: Record<CharacterId, { vx: number; vy: number; vz: number; y: number; yaw: number }> = {
    michael: { vx: 0, vy: 0, vz: 0, y: 0, yaw: PROTAGONISTS.michael.spawnYaw },
    franklin: { vx: 0, vy: 0, vz: 0, y: 0, yaw: PROTAGONISTS.franklin.spawnYaw },
    trevor: { vx: 0, vy: 0, vz: 0, y: 0, yaw: PROTAGONISTS.trevor.spawnYaw },
  };

  // Camera & Input
  private camYaw = 0;
  private camPitch = 0.22;
  private lookYaw = 0;
  private lookIdle = 0;
  private camDistMul = 1.0;
  private camLook = new THREE.Vector3();
  private camSnap = true;
  private attractAngle = 0.5;
  private crashShake = 0;
  private reticleBloom = 0;

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

  // Mission Marker
  private missionBeacon: THREE.Group;

  // Wanted & Police Timers
  private lastCrimeTime = -99;
  private lastSeenTime = -99;
  private copSpawnTimer = 0;
  private hudSyncTimer = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.innerHTML = '';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6d7c88);
    this.scene.fog = new THREE.Fog(0x6d7c88, 52, 195);

    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.15, 360);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x6d7c88, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
    container.appendChild(this.renderer.domElement);

    // Warm Golden-Hour Los Santos Lighting
    const hemi = new THREE.HemisphereLight(0xd4c8b8, 0x323830, 0.98);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0x4a5460, 0.78);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffe8d0, 1.45);
    sun.position.set(45, 68, 32);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 165;
    const d = 62;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    // Build initial city (and immediately upgrade once photorealistic textures finish loading)
    this.initCity(null);
    loadWorldTextures().then((tex) => {
      if (!this.disposed && tex) {
        this.rebuildCityWithTextures(tex);
      }
    });

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
      y: 32,
      z: 0,
      yaw: 0,
      hp: 450,
      maxHp: 450,
      active: false,
      crashing: false,
      fireCooldown: 1.4,
    };

    // Create Mission Beacon
    this.missionBeacon = createMissionBeaconMesh(0xfacc15);
    this.scene.add(this.missionBeacon);

    // Spawn Initial Mission Step
    this.setupMissionStep('street_warmup', 0);

    // Bind Events
    this.bindEvents();
    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  private initCity(tex: WorldTextures | null) {
    const city = buildLosSantosCity(this.scene, tex);
    this.cityGroup = this.scene.children[this.scene.children.length - 1] ?? null;
    this.colliders = city.colliders;
    this.treeColliders = city.treeColliders;
    this.barrels = city.barrels;
    this.shootableMeshes = city.shootableMeshes;
    this.nodes = city.nodes;
    this.npcLoops = city.npcLoops;

    if (this.vehicles.length === 0) {
      this.spawnInitialVehicles(city.parkedSpots, city.policeSpawns);
      this.spawnInitialCivilians();
    }
  }

  private rebuildCityWithTextures(tex: WorldTextures) {
    if (this.cityGroup) {
      this.scene.remove(this.cityGroup);
    }
    const city = buildLosSantosCity(this.scene, tex);
    this.cityGroup = this.scene.children[this.scene.children.length - 1] ?? null;
    this.colliders = city.colliders;
    this.treeColliders = city.treeColliders;
    this.barrels = city.barrels;
    this.shootableMeshes = city.shootableMeshes;
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
    rig.root.rotation.y = p.spawnYaw;
    updateRigWeaponVisual(rig, p.defaultWeapon);
    this.scene.add(rig.root);
    return rig;
  }

  private node(i: number, j: number): RoadNode | undefined {
    return this.nodes.find((n) => n.i === i && n.j === j);
  }

  private pickNeighbor(n: RoadNode, avoid?: { i: number; j: number }): RoadNode | null {
    const dirs: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const candidates: RoadNode[] = [];
    for (const [di, dj] of dirs) {
      const ni = n.i + di;
      const nj = n.j + dj;
      if (ni < 0 || ni > GRID || nj < 0 || nj > GRID) continue;
      if (avoid && ni === avoid.i && nj === avoid.j) continue;
      const found = this.node(ni, nj);
      if (found) candidates.push(found);
    }
    if (candidates.length === 0 && avoid) {
      return this.node(avoid.i, avoid.j) ?? null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }

  private laneAt(a: RoadNode, b: RoadNode, start: boolean): { x: number; z: number } {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const rx = -dz / len;
    const rz = dx / len;
    const base = start ? a : b;
    return {
      x: base.x + rx * LANE_OFFSET,
      z: base.z + rz * LANE_OFFSET,
    };
  }

  private spawnInitialVehicles(
    parkedSpots: {
      name: string;
      x: number;
      z: number;
      yaw: number;
      color: number;
      kind: 'sport' | 'sedan' | 'suv' | 'taxi' | 'swat';
    }[],
    policeSpawns: { x: number; z: number; yaw: number }[]
  ) {
    // 1. Parked Vehicles
    parkedSpots.forEach((s, idx) => {
      this.addVehicle({
        id: `parked_${idx}`,
        name: s.name,
        kind: s.kind,
        color: s.color,
        x: s.x,
        z: s.z,
        yaw: s.yaw,
        aiTraffic: false,
        isPolice: false,
      });
    });

    // 2. Autonomous AI Traffic Cars + 1 Armored Cash Truck
    const trafficColors = [0xb8bec6, 0x3c6ea5, 0xc14b3c, 0xd8d2c6, 0x4c7c58, 0xf0c040, 0x2c3038];
    const trafficKinds: ('sedan' | 'taxi' | 'sport' | 'suv' | 'cash_truck')[] = [
      'sedan',
      'taxi',
      'sport',
      'suv',
      'cash_truck',
      'sedan',
      'taxi',
      'sport',
    ];
    const trafficNames: Record<string, string> = {
      sedan: '貝飛特 都會轎車 (Benefactor Schafter)',
      taxi: '洛聖都計程車 (Downtown Cab Co.)',
      sport: '佩嘉西 街頭跑車 (Pegassi Infernus)',
      suv: '絕緻 休旅車 (Declasse Granger)',
      cash_truck: '💰 グルッペ6 裝甲運鈔車 (擊毀掉落 $25,000！)',
    };

    for (let n = 0; n < 8; n++) {
      const a = this.nodes[(n * 3) % this.nodes.length]!;
      const b = this.pickNeighbor(a) ?? a;
      const lane = this.laneAt(a, b, true);
      const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
      const kind = trafficKinds[n]!;
      const v = this.addVehicle({
        id: `traffic_${n}`,
        name: trafficNames[kind]!,
        kind,
        color: trafficColors[n % trafficColors.length]!,
        x: lane.x,
        z: lane.z,
        yaw,
        aiTraffic: true,
        isPolice: false,
        isCashTruck: kind === 'cash_truck',
      });
      v.nextNode = { i: a.i, j: a.j };
      v.destNode = { i: b.i, j: b.j };
    }

    // 3. LSPD Police Cruisers
    policeSpawns.forEach((ps, idx) => {
      this.addVehicle({
        id: `police_${idx}`,
        name: 'LSPD 警用攔截巡邏車 (Police Interceptor)',
        kind: 'police',
        color: 0xe8eaee,
        x: ps.x,
        z: ps.z,
        yaw: ps.yaw,
        aiTraffic: false,
        isPolice: true,
      });
    });
  }

  private addVehicle(opts: {
    id: string;
    name: string;
    kind: 'sport' | 'sedan' | 'suv' | 'police' | 'swat' | 'taxi' | 'cash_truck';
    color: number;
    x: number;
    z: number;
    yaw: number;
    aiTraffic: boolean;
    isPolice: boolean;
    isMissionTarget?: boolean;
    isCashTruck?: boolean;
  }): VehicleEntity {
    const rig = createVehicleMesh({ color: opts.color, kind: opts.kind });
    rig.root.position.set(opts.x, 0, opts.z);
    rig.root.rotation.y = opts.yaw;
    this.scene.add(rig.root);

    const maxHp = opts.isCashTruck ? 360 : opts.kind === 'swat' ? 320 : 180;
    const maxSpeed = opts.kind === 'sport' ? CAR_MAX_SPEED + 8 : opts.kind === 'swat' ? CAR_MAX_SPEED - 4 : CAR_MAX_SPEED;

    const v: VehicleEntity = {
      id: opts.id,
      name: opts.name,
      kind: opts.kind,
      rig,
      x: opts.x,
      z: opts.z,
      yaw: opts.yaw,
      speed: 0,
      lateral: 0,
      roll: 0,
      pitch: 0,
      maxSpeed,
      hp: maxHp,
      maxHp,
      exploded: false,
      aiTraffic: opts.aiTraffic,
      isPolice: opts.isPolice,
      isMissionTarget: opts.isMissionTarget,
      isCashTruck: opts.isCashTruck,
    };
    this.vehicles.push(v);
    return v;
  }

  private spawnInitialCivilians() {
    const suitColors = [0x334155, 0x7c2d12, 0x14532d, 0x4c1d95, 0x831843, 0x1e3a8a, 0x3b6e5c];
    for (let i = 0; i < 18; i++) {
      const loop = this.npcLoops[i % this.npcLoops.length]!;
      const pt = loop[i % loop.length]!;
      const profile = NPC_DIALOGUES[i % NPC_DIALOGUES.length]!;
      this.spawnNPC({
        x: pt.x,
        z: pt.z,
        role: 'civilian',
        weapon: 'unarmed',
        suitColor: suitColors[i % suitColors.length],
        waypoints: loop,
        dialogueProfile: profile,
      });
    }
  }

  private spawnNPC(opts: {
    x: number;
    z: number;
    role: 'civilian' | 'cop' | 'swat' | 'mission_enemy';
    weapon: WeaponId;
    suitColor?: number;
    waypoints?: { x: number; z: number }[];
    dialogueProfile?: NpcDialogueProfile;
  }): NPCEntity {
    const isCop = opts.role === 'cop';
    const isSwat = opts.role === 'swat';
    const rig = createCharacterRig({
      suitColor: opts.suitColor ?? (opts.role === 'mission_enemy' ? 0x7f1d1d : 0x334155),
      shirtColor: opts.role === 'mission_enemy' ? 0xef4444 : 0x94a3b8,
      skinColor: 0xe0b898,
      hairColor: 0x18181b,
      isCop,
      isSwat,
      showHpBar: opts.role !== 'civilian',
    });
    rig.root.position.set(opts.x, 0, opts.z);
    updateRigWeaponVisual(rig, opts.weapon);
    this.scene.add(rig.root);

    const maxHp = isSwat ? 150 : opts.role === 'mission_enemy' ? 115 : isCop ? 95 : 60;
    const npc: NPCEntity = {
      id: `npc_${Date.now()}_${Math.random()}`,
      rig,
      x: opts.x,
      z: opts.z,
      yaw: Math.random() * Math.PI * 2,
      hp: maxHp,
      maxHp,
      role: opts.role,
      weapon: opts.weapon,
      fireCooldown: 0.55 + Math.random() * 0.75,
      staggerT: 0,
      dead: false,
      deathTimer: 0,
      walkT: Math.random() * 10,
      waypoints: opts.waypoints,
      wpIdx: 0,
      waitT: Math.random() * 2,
      panicT: 0,
      dialogueProfile: opts.dialogueProfile,
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
    const fromRig = this.charRigs[fromChar];
    const toRig = this.charRigs[target];

    this.skyCam = {
      active: true,
      fromChar,
      toChar: target,
      timer: 0,
      duration: 1.75,
      fromPos: fromRig.root.position.clone(),
      toPos: toRig.root.position.clone(),
    };

    sound.playSkyCamStep(false);
    state.updateHUD({
      skyCamSwitching: true,
      skyCamTarget: target,
      charWheelOpen: false,
      weaponWheelOpen: false,
      dialogue: null,
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
    if (!state.specialActive) {
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

    state.updateHUD({ reloading: true, reloadProgress: 0 });
  }

  public startMission(missionId: MissionId) {
    const state = useGameStore.getState();
    const def = MISSIONS[missionId];
    if (!def) return;

    this.npcs = this.npcs.filter((n) => {
      if (n.role === 'mission_enemy') {
        this.scene.remove(n.rig.root);
        return false;
      }
      return true;
    });

    const activeRig = this.charRigs[state.activeChar];
    const dx = activeRig.root.position.x - def.startPos[0];
    const dz = activeRig.root.position.z - def.startPos[1];
    if (Math.hypot(dx, dz) > 42) {
      if (this.currentVehicle) {
        this.currentVehicle.x = def.startPos[0];
        this.currentVehicle.z = def.startPos[1];
        this.currentVehicle.rig.root.position.set(def.startPos[0], 0, def.startPos[1]);
      } else {
        activeRig.root.position.set(def.startPos[0], 0, def.startPos[1]);
      }
      this.camSnap = true;
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
    }, 3000);
  }

  private setupMissionStep(missionId: MissionId, stepIdx: number) {
    const def = MISSIONS[missionId];
    const step = def.steps[stepIdx];
    if (!step) return;

    const [tx, tz] = step.targetPos;
    this.missionBeacon.position.set(tx, 0, tz);
    this.missionBeacon.visible = true;

    if (step.type === 'kill_targets') {
      const count =
        missionId === 'pacific_heist' ? 6 : missionId === 'pier_arms' ? 6 : 4;
      const weapon: WeaponId =
        missionId === 'pacific_heist'
          ? 'rifle'
          : missionId === 'pier_arms'
            ? 'shotgun'
            : 'smg';
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const rx = tx + Math.cos(ang) * 6.5;
        const rz = tz + Math.sin(ang) * 6.5;
        const hit = resolveCircleList(rx, rz, PLAYER_RADIUS, this.colliders);
        this.spawnNPC({
          x: hit.x,
          z: hit.z,
          role: 'mission_enemy',
          weapon,
        });
      }
    } else if (step.type === 'enter_car' && missionId === 'simeon_repo') {
      this.addVehicle({
        id: `mission_car_${Date.now()}`,
        name: '西門限量版 黃金女妖超跑 (Golden Banshee GT)',
        kind: 'sport',
        color: 0xfacc15,
        x: tx,
        z: tz,
        yaw: 0,
        aiTraffic: false,
        isPolice: false,
        isMissionTarget: true,
      });
    } else if (step.type === 'destroy_heli') {
      this.addWantedStars(5);
      this.triggerInstantAction('max_arsenal');
      this.selectWeapon('rpg');
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
      state.pushPopup('🔫 已補滿全 8 種武器彈藥！', '#34d399');
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
      state.pushPopup('🛡️ 生命值與重型防彈護甲已補滿！', '#38bdf8');
      state.updateHUD({ charStates: cs });
      sound.playCashPickup();
    } else if (item === 'heavy' && state.cash >= 3500) {
      const updated = { ...state.weapons };
      updated.rpg = { unlocked: true, inMag: 1, reserve: 15 };
      updated.minigun = { unlocked: true, inMag: 200, reserve: 800 };
      updated.sniper = { unlocked: true, inMag: 6, reserve: 48 };
      state.addCash(-3500);
      state.pushPopup('🚀 已裝備 RPG 火箭筒與火神六管機槍！', '#f97316');
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
      state.pushPopup('🔧 座駕板金與引擎已完全修復！', '#34d399');
      sound.playCashPickup();
    } else if (service === 'respray' && state.cash >= 500) {
      if (this.currentVehicle) {
        const neonPalette = [0x2ec4b6, 0xf43f5e, 0xa855f7, 0xfacc15, 0x22c55e, 0xf97316, 0x38bdf8];
        const randomCol = neonPalette[Math.floor(Math.random() * neonPalette.length)]!;
        this.currentVehicle.rig.bodyMat.color.setHex(randomCol);
      }
      state.addCash(-500);
      state.pushPopup('🎨 已換上全新賽博金屬烤漆！', '#c084fc');
      sound.playCashPickup();
    } else if (service === 'clear_wanted' && state.cash >= 1500) {
      this.clearWantedLevel();
      state.addCash(-1500);
      state.pushPopup('✨ 已更換偽造車牌，全數通緝星等解除！', '#facc15');
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
    useGameStore.getState().updateHUD({ wantedStars: 0, wantedSearching: false });
  }

  public triggerInstantAction(action: 'spawn_supercar' | 'max_arsenal' | 'trigger_5star') {
    const state = useGameStore.getState();
    const rig = this.charRigs[state.activeChar];
    const px = rig.root.position.x;
    const pz = rig.root.position.z;

    if (action === 'spawn_supercar') {
      const fwd = yawForward(this.camYaw);
      const sx = px + fwd.x * 5.2;
      const sz = pz + fwd.z * 5.2;
      const hit = resolveCircleList(sx, sz, CAR_RADIUS, this.colliders);
      this.addVehicle({
        id: `super_${Date.now()}`,
        name: '空投超跑 佩嘉西 奧西里斯 (Osiris GT)',
        kind: 'sport',
        color: 0x2ec4b6,
        x: hit.x,
        z: hit.z,
        yaw: this.camYaw,
        aiTraffic: false,
        isPolice: false,
      });
      state.pushPopup('🏎️ 已在前方空投雙門超跑 Osiris GT！按 [E] 駕駛', '#2ec4b6');
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
      state.pushPopup('🔥 全武器滿彈藥 + 100% 重型防彈衣已補給！', '#facc15');
      state.updateHUD({ weapons: updated, charStates: cs });
      sound.playCashPickup();
    } else if (action === 'trigger_5star') {
      this.addWantedStars(5);
      state.pushPopup('🚨 五星聯邦全面封鎖啟動！特警與武裝直升機出動！', '#ef4444');
    }
  }

  private addWantedStars(targetStars: number) {
    const state = useGameStore.getState();
    const nextStars = clamp(Math.max(state.wantedStars, targetStars), 0, 5);
    this.lastCrimeTime = this.time;
    this.lastSeenTime = this.time;

    if (nextStars >= 3 && !this.heli.active) {
      const rig = this.charRigs[state.activeChar];
      this.heli.active = true;
      this.heli.crashing = false;
      this.heli.hp = this.heli.maxHp;
      this.heli.x = rig.root.position.x + 28;
      this.heli.y = 32;
      this.heli.z = rig.root.position.z - 28;
      this.heli.rig.root.visible = true;
    }

    state.updateHUD({ wantedStars: nextStars, wantedSearching: false });
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
        !state.shopModalOpen &&
        !state.dialogue
      ) {
        this.renderer.domElement.requestPointerLock?.();
      }
    });
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
      } else if (state.dialogue) {
        state.closeDialogue();
      } else {
        state.setPaused(!state.paused);
      }
      return;
    }

    if (state.paused) return;

    if (code === 'Tab') {
      e.preventDefault();
      if (!state.weaponWheelOpen) {
        document.exitPointerLock?.();
        state.updateHUD({ weaponWheelOpen: true });
      }
      return;
    }

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

    if (code === 'Digit4') this.selectWeapon('pistol');
    if (code === 'Digit5') this.selectWeapon('smg');
    if (code === 'Digit6') this.selectWeapon('shotgun');
    if (code === 'Digit7') this.selectWeapon('rifle');
    if (code === 'Digit8') this.selectWeapon('sniper');
    if (code === 'Digit9') this.selectWeapon('rpg');
    if (code === 'Digit0') this.selectWeapon('minigun');

    if (code === 'KeyQ' || code === 'CapsLock') {
      e.preventDefault();
      this.toggleSpecialAbility();
    }

    if (code === 'KeyR') {
      this.triggerReload();
    }

    if ((code === 'ControlLeft' || code === 'KeyC') && !this.currentVehicle && this.rollTimer <= 0) {
      this.rollTimer = 0.4;
      const fwd = yawForward(this.camYaw);
      this.rollDir.set(fwd.x, fwd.z);
    }

    if (code === 'KeyE') {
      this.handleUseInteraction();
    }

    if (code === 'KeyF') {
      this.handleTalkInteraction();
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
  };

  private onMouseMove = (e: MouseEvent) => {
    const state = useGameStore.getState();
    if (!state.started || state.paused || state.weaponWheelOpen || state.charWheelOpen || state.shopModalOpen) {
      return;
    }
    if (document.pointerLockElement === this.renderer.domElement || this.mouseDownRight || this.mouseDownLeft) {
      const sens = state.aiming ? 0.0018 : 0.0026;
      if (this.currentVehicle) {
        this.lookYaw = wrapAngle(this.lookYaw - e.movementX * sens);
        this.lookIdle = 0;
      } else {
        this.camYaw = wrapAngle(this.camYaw - e.movementX * sens);
      }
      this.camPitch = clamp(this.camPitch - e.movementY * sens * 0.85, -0.18, 0.68);
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    const state = useGameStore.getState();
    if (!state.started || state.paused || state.weaponWheelOpen || state.charWheelOpen || state.shopModalOpen) {
      return;
    }
    if (state.dialogue) {
      state.closeDialogue();
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
    const curW = state.charStates[state.activeChar].weapon;
    const idx = WEAPON_WHEEL_ORDER.indexOf(curW);
    const dir = e.deltaY > 0 ? 1 : -1;
    const nextIdx = (idx + dir + WEAPON_WHEEL_ORDER.length) % WEAPON_WHEEL_ORDER.length;
    this.selectWeapon(WEAPON_WHEEL_ORDER[nextIdx]!);
  };

  // === Interactions ===
  private handleUseInteraction() {
    const state = useGameStore.getState();
    if (state.shopModalOpen) {
      state.setShopModalOpen(null);
      return;
    }
    if (state.dialogue) {
      state.closeDialogue();
      return;
    }

    const activeRig = this.charRigs[state.activeChar];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    // 1. Check Landmarks
    for (const lm of LANDMARKS) {
      if (Math.hypot(px - lm.x, pz - lm.z) < 7.5) {
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
        if (lm.type === 'police') {
          this.startMission('federal_lockdown');
          return;
        }
      }
    }

    // 2. Enter or Exit Vehicle
    if (this.currentVehicle) {
      this.exitVehicle();
      return;
    }

    let nearest: VehicleEntity | null = null;
    let bestDist = 4.6;
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

  private handleTalkInteraction() {
    const state = useGameStore.getState();
    if (state.dialogue) {
      state.closeDialogue();
      return;
    }
    if (this.currentVehicle) return;

    const activeRig = this.charRigs[state.activeChar];
    const px = activeRig.root.position.x;
    const pz = activeRig.root.position.z;

    for (const npc of this.npcs) {
      if (npc.dead || npc.role !== 'civilian' || !npc.dialogueProfile) continue;
      if (Math.hypot(npc.x - px, npc.z - pz) < 4.2) {
        const p = npc.dialogueProfile;
        const pool = state.wantedStars > 0 ? p.linesWanted : p.linesNormal;
        const line = pool[Math.floor(Math.random() * pool.length)]!;
        npc.yaw = Math.atan2(-(px - npc.x), -(pz - npc.z));
        npc.waitT = 4.0;
        state.updateHUD({
          dialogue: {
            name: p.name,
            job: p.job,
            personality: p.personality,
            line,
          },
        });
        return;
      }
    }
  }

  private enterVehicle(v: VehicleEntity) {
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    activeRig.root.visible = false;
    this.currentVehicle = v;
    v.aiTraffic = false;
    this.camYaw = v.yaw;
    this.lookYaw = 0;
    this.camSnap = true;

    const curW = state.charStates[state.activeChar].weapon;
    if (!WEAPONS[curW].driveBy) {
      this.selectWeapon('smg');
    }

    if (v.isPolice || v.kind === 'swat') {
      this.addWantedStars(2);
      state.pushPopup('🚓 劫持警用車輛！觸發兩星通緝！', '#38bdf8');
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
    const active = state.activeChar;
    const activeRig = this.charRigs[active];
    const v = this.currentVehicle;

    const right = yawRight(v.yaw);
    const hit = resolveCircleList(v.x + right.x * 2.3, v.z + right.z * 2.3, PLAYER_RADIUS, this.colliders);
    activeRig.root.position.set(hit.x, 0, hit.z);
    activeRig.root.rotation.y = v.yaw;
    activeRig.root.visible = true;
    this.charVel[active] = { vx: 0, vy: 0, vz: 0, y: 0, yaw: v.yaw };
    this.camYaw = v.yaw;
    this.lookYaw = 0;

    v.speed = 0;
    this.currentVehicle = null;
    state.updateHUD({
      inVehicle: false,
      vehicleName: '',
      vehicleSpeedKmh: 0,
    });
  }

  // === Shooting, Ballistics & Explosions ===
  private tryFireWeapon() {
    const state = useGameStore.getState();
    if (this.fireTimer > 0 || state.reloading || this.skyCam?.active) return;

    const active = state.activeChar;
    const wId = state.charStates[active].weapon;
    const spec = WEAPONS[wId];
    const ammo = state.weapons[wId];

    if (wId !== 'unarmed' && ammo.inMag <= 0) {
      this.triggerReload();
      return;
    }

    const isTrevorRampage = active === 'trevor' && state.specialActive;
    if (wId !== 'unarmed' && !isTrevorRampage) {
      const updated = { ...state.weapons };
      updated[wId] = { ...ammo, inMag: ammo.inMag - 1 };
      state.updateHUD({ weapons: updated });
      if (updated[wId].inMag <= 0 && updated[wId].reserve > 0) {
        setTimeout(() => this.triggerReload(), 140);
      }
    }

    this.fireTimer = 1 / spec.fireRate;
    sound.playGunshot(wId);

    // Camera recoil & reticle bloom
    const isMichaelBulletTime = active === 'michael' && state.specialActive;
    if (!isMichaelBulletTime) {
      this.camPitch = clamp(this.camPitch + spec.recoilKick, -0.18, 0.68);
      this.reticleBloom = Math.min(1, this.reticleBloom + 0.32);
    }

    // Nearby civilians panic when shots are fired
    const rig = this.charRigs[active];
    const px = this.currentVehicle ? this.currentVehicle.x : rig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : rig.root.position.z;
    for (const npc of this.npcs) {
      if (!npc.dead && npc.role === 'civilian' && Math.hypot(npc.x - px, npc.z - pz) < 34) {
        npc.panicT = 8.0;
      }
    }

    rig.muzzleFlash.visible = true;
    setTimeout(() => {
      rig.muzzleFlash.visible = false;
    }, 55);

    const origin = new THREE.Vector3();
    if (this.currentVehicle) {
      origin.set(this.currentVehicle.x, 1.35, this.currentVehicle.z);
    } else {
      rig.muzzleFlash.getWorldPosition(origin);
    }

    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    this.camera.getWorldPosition(camPos);
    this.camera.getWorldDirection(camDir);

    if (!this.currentVehicle) {
      const targetYaw = Math.atan2(-camDir.x, -camDir.z);
      this.charVel[active].yaw = targetYaw;
      rig.root.rotation.y = targetYaw;
    }

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

    const damageMult = isTrevorRampage ? 2.2 : 1.0;
    for (let p = 0; p < spec.pellets; p++) {
      const spreadFactor = isMichaelBulletTime ? 0 : state.aiming ? spec.spread * 0.4 : spec.spread;
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
    const raycaster = new THREE.Raycaster(rayOrigin, dir, 1.0, range);

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
        ? hits[0]!.point.clone()
        : rayOrigin.clone().add(dir.clone().multiplyScalar(range));

    this.spawnTracerBeam(muzzleOrigin, endPoint, isBulletTime ? 0x38bdf8 : 0xfef08a);

    if (hits.length === 0) return;

    const hitObj = hits[0]!.object;
    const hitPoint = hits[0]!.point;

    // 1. Explosive Barrel Hit
    for (const b of this.barrels) {
      if (!b.exploded && (b.mesh === hitObj || b.mesh.children.includes(hitObj))) {
        b.exploded = true;
        b.mesh.visible = false;
        this.triggerExplosion(b.x, 0.8, b.z, 13);
        return;
      }
    }

    // 2. NPC Hit (Headshot vs Bodyshot + Knockback Stagger)
    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const isHead = hitObj === npc.rig.head;
      const isTorso = hitObj === npc.rig.torso;
      if (isHead || isTorso) {
        const headshotMult = isHead ? (isBulletTime ? 2.8 : 2.2) : 1.0;
        npc.x += dir.x * (isHead ? 0.55 : 0.28);
        npc.z += dir.z * (isHead ? 0.55 : 0.28);
        npc.staggerT = 0.25;
        this.damageNPC(npc, damage * headshotMult, isHead);
        this.spawnImpactSparks(hitPoint, 0xef4444);
        return;
      }
    }

    // 3. Helicopter Hit
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

    // 4. Vehicle Hit
    for (const v of this.vehicles) {
      if (v.exploded || v === this.currentVehicle) continue;
      if (v.rig.root.children.includes(hitObj)) {
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
      npc.deathTimer = 5.5;
      npc.rig.root.rotation.x = -Math.PI * 0.48;
      npc.rig.root.position.y = 0.22;
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
      v.rig.root.position.y = 0.35;
      v.rig.root.rotation.z = 0.18;
      this.triggerExplosion(v.x, 1.2, v.z, 12);

      if (v.isCashTruck) {
        useGameStore.getState().addCash(25000);
        useGameStore.getState().pushPopup('💰 爆破グルッペ6 裝甲運鈔車！奪得 +$25,000！', '#22c55e');
        for (let i = 0; i < 5; i++) {
          this.spawnLootDrop(v.x + (Math.random() - 0.5) * 5, v.z + (Math.random() - 0.5) * 5);
        }
      }

      if (this.currentVehicle === v) {
        this.exitVehicle();
        this.damageActivePlayer(40);
      }
    }
  }

  private triggerExplosion(x: number, y: number, z: number, radius: number) {
    sound.playExplosion();
    this.crashShake = Math.min(1.4, this.crashShake + 0.95);

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

    for (const npc of this.npcs) {
      if (npc.dead) continue;
      const d = Math.hypot(npc.x - x, npc.z - z);
      if (d < radius) {
        this.damageNPC(npc, (1 - d / radius) * 290, false);
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
      new THREE.BoxGeometry(0.62, 0.32, 0.42),
      new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.set(x, 0.42, z);
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
        subtitle: '重傷送往中央醫院緊急搶救（醫療費 -$500）',
      },
    });

    setTimeout(() => {
      const s = useGameStore.getState();
      const active = s.activeChar;
      const rig = this.charRigs[active];
      const spawn = PROTAGONISTS[active].spawnPos;
      rig.root.position.set(spawn[0], 0, spawn[1]);
      const cs = { ...s.charStates };
      cs[active] = { ...cs[active], hp: 100, armor: 60, special: 100 };
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

    // Live Orbiting City Preview on Start Menu
    if (!state.started) {
      this.attractAngle += rawDt * 0.12;
      this.time += rawDt;
      this.updateTrafficAndPoliceCars(rawDt);
      this.updateNPCsAndPolice(rawDt, true);
      this.camera.position.set(
        Math.sin(this.attractAngle) * 76,
        36,
        Math.cos(this.attractAngle) * 76
      );
      this.camera.lookAt(0, 4, -10);
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
    this.time += dt;
    this.crashShake = Math.max(0, this.crashShake - rawDt * 3.5);
    this.reticleBloom = Math.max(0, this.reticleBloom - rawDt * 2.8);

    this.updateSkyCam(rawDt);
    this.updatePlayerMovement(rawDt);
    this.updateTrafficAndPoliceCars(dt);
    this.updateReloadAndSpecial(rawDt);
    this.updateRocketsAndEffects(dt);
    this.updateNPCsAndPolice(dt, false);
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
      const h = step * 38;
      this.camera.position.set(fromPos.x, h, fromPos.z + 10);
      this.camera.lookAt(fromPos.x, 0, fromPos.z);
    } else if (p < 0.7) {
      const panT = (p - 0.35) / 0.35;
      const smooth = panT * panT * (3 - 2 * panT);
      const cx = THREE.MathUtils.lerp(fromPos.x, toPos.x, smooth);
      const cz = THREE.MathUtils.lerp(fromPos.z, toPos.z, smooth);
      this.camera.position.set(cx, 118, cz + 12);
      this.camera.lookAt(cx, 0, cz);
    } else {
      const descT = (p - 0.7) / 0.3;
      const step = 3 - Math.floor(descT * 2.99);
      const h = step * 32;
      this.camera.position.set(toPos.x, h, toPos.z + 8);
      this.camera.lookAt(toPos.x, 1.5, toPos.z);
    }

    if (p >= 1) {
      sound.playSkyCamStep(true);
      this.skyCam.active = false;
      this.camSnap = true;
      useGameStore.getState().updateHUD({
        activeChar: toChar,
        skyCamSwitching: false,
        skyCamTarget: null,
      });
    }
  }

  private updatePlayerMovement(rawDt: number) {
    const state = useGameStore.getState();
    const active = state.activeChar;
    const rig = this.charRigs[active];
    const vel = this.charVel[active];

    if (this.fireTimer > 0) {
      this.fireTimer -= rawDt;
    }
    if (
      this.mouseDownLeft &&
      !state.weaponWheelOpen &&
      !state.charWheelOpen &&
      !state.shopModalOpen &&
      !state.dialogue
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
      const throttle =
        this.keys.has('KeyW') || this.keys.has('ArrowUp') ? (isFranklinFocus ? 1.65 : 1) : 0;
      const brake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
      const steer =
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) -
        (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0);
      const handbrake = this.keys.has('Space');

      this.integrateVehicle(v, rawDt, throttle, brake, steer * (isFranklinFocus ? 1.45 : 1), true, handbrake);
      rig.root.position.set(v.x, 0, v.z);
      return;
    }

    // === On-Foot Smooth Acceleration & Sliding Collision ===
    let moveX = 0;
    let moveY = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;

    const fwd = yawForward(this.camYaw);
    const right = yawRight(this.camYaw);

    let mx = right.x * moveX + fwd.x * moveY;
    let mz = right.z * moveX + fwd.z * moveY;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) {
      mx /= mag;
      mz /= mag;
    }

    const sprinting = this.keys.has('ShiftLeft') && !state.aiming;
    const maxSpd = this.rollTimer > 0 ? 14.5 : sprinting ? RUN_SPEED : state.aiming ? 4.4 : WALK_SPEED;

    if (this.rollTimer > 0) {
      this.rollTimer -= rawDt;
      mx = this.rollDir.x;
      mz = this.rollDir.y;
    }

    const targetVx = mx * maxSpd;
    const targetVz = mz * maxSpd;
    const rate = mag > 0.08 || this.rollTimer > 0 ? WALK_ACCEL : WALK_FRICTION;
    const k = 1 - Math.exp(-rate * rawDt);
    vel.vx = lerp(vel.vx, targetVx, k);
    vel.vz = lerp(vel.vz, targetVz, k);

    let nx = rig.root.position.x + vel.vx * rawDt;
    let nz = rig.root.position.z + vel.vz * rawDt;

    const col = resolveCircleList(nx, nz, PLAYER_RADIUS, this.colliders);
    nx = col.x;
    nz = col.z;
    if (col.hit) {
      vel.vx *= 0.3;
      vel.vz *= 0.3;
    }

    for (const t of this.treeColliders) {
      if (circlesOverlap(nx, nz, PLAYER_RADIUS, t.x, t.z, t.r)) {
        const sep = separateCircles(nx, nz, PLAYER_RADIUS, t.x, t.z, t.r, 1, 99);
        nx = sep.ax;
        nz = sep.az;
      }
    }

    rig.root.position.x = nx;
    rig.root.position.z = nz;

    if (state.aiming || this.mouseDownLeft) {
      vel.yaw = this.camYaw;
    } else if (mag > 0.08) {
      vel.yaw = lerpAngle(vel.yaw, Math.atan2(-mx, -mz), 1 - Math.exp(-14 * rawDt));
    }
    rig.root.rotation.y = vel.yaw;

    // Jump & Gravity
    if (this.keys.has('Space') && vel.y <= 0.01) {
      vel.vy = JUMP_SPEED;
    }
    vel.vy -= GRAVITY * rawDt;
    vel.y = Math.max(0, vel.y + vel.vy * rawDt);
    if (vel.y <= 0) vel.vy = 0;
    rig.root.position.y = vel.y;

    // Limb Swing & Gun Arm Pose
    const spd = Math.hypot(vel.vx, vel.vz);
    if (spd > 0.4) {
      const swing = Math.sin(this.time * (sprinting ? 11 : 8)) * 0.52;
      rig.leftLeg.rotation.x = swing;
      rig.rightLeg.rotation.x = -swing;
      rig.leftArm.rotation.x = -swing * 0.7;
    } else {
      rig.leftLeg.rotation.x *= 0.8;
      rig.rightLeg.rotation.x *= 0.8;
      rig.leftArm.rotation.x *= 0.8;
    }

    if (state.aiming || this.mouseDownLeft) {
      rig.rightArm.rotation.x = Math.PI * 0.46 - this.camPitch * 0.65;
    } else {
      rig.rightArm.rotation.x = 0.28;
    }
  }

  private integrateVehicle(
    car: VehicleEntity,
    dt: number,
    throttle: number,
    brake: number,
    steer: number,
    isPlayer: boolean,
    handbrake = false
  ) {
    if (throttle > 0) {
      car.speed += CAR_ACCEL * throttle * dt;
    } else if (brake > 0) {
      if (car.speed > 0.45) car.speed -= CAR_BRAKE * brake * dt;
      else car.speed -= CAR_ACCEL * 0.55 * brake * dt;
    } else {
      const sign = Math.sign(car.speed);
      car.speed -= sign * CAR_DRAG * 3.2 * dt;
      if (Math.abs(car.speed) < 0.18) car.speed = 0;
    }

    if (handbrake) {
      const s = Math.sign(car.speed);
      car.speed -= s * CAR_HANDBRAKE * dt;
      if (Math.abs(car.speed) < 0.35) car.speed = 0;
    }

    car.speed = clamp(car.speed, -CAR_REVERSE_MAX, car.maxSpeed);
    const speedFactor = clamp(Math.abs(car.speed) / 7, 0, 1);
    const reverse = car.speed >= 0 ? 1 : -1;
    const turnMul = handbrake ? 1.45 : 1;
    car.yaw += steer * CAR_TURN_RATE * speedFactor * reverse * turnMul * dt;

    const f = yawForward(car.yaw);
    const r = yawRight(car.yaw);
    const grip = handbrake ? CAR_HANDBRAKE_GRIP : CAR_GRIP;
    car.lateral *= Math.max(0, 1 - grip * dt);
    if (handbrake) {
      car.lateral += -steer * Math.abs(car.speed) * 0.38 * dt;
    }

    const px = car.x + (f.x * car.speed + r.x * car.lateral) * dt;
    const pz = car.z + (f.z * car.speed + r.z * car.lateral) * dt;
    const before = Math.abs(car.speed);
    const hit = resolveCircleList(px, pz, CAR_RADIUS, this.colliders);
    car.x = hit.x;
    car.z = hit.z;

    if (hit.hit) {
      car.speed *= 0.28;
      car.lateral += (hit.nx * r.x + hit.nz * r.z) * before * 0.15;
      if (before > 8) {
        const dmg = (before - 6) * (isPlayer ? 1.8 : 0.9);
        this.damageVehicle(car, dmg);
        if (isPlayer) {
          this.crashShake = Math.min(1.1, before / 18);
        }
      }
    }

    const wantRoll = -steer * clamp(Math.abs(car.speed) / 26, 0, 1) * 0.16;
    const wantPitch = throttle * 0.042 - (brake > 0 || handbrake ? 0.052 : 0);
    car.roll = lerp(car.roll, wantRoll, 1 - Math.exp(-8 * dt));
    car.pitch = lerp(car.pitch, wantPitch, 1 - Math.exp(-6 * dt));

    car.rig.root.position.set(car.x, car.exploded ? 0.35 : 0, car.z);
    car.rig.root.rotation.set(car.pitch, car.yaw, car.roll);

    const spin = car.speed * 0.35 * dt * 12;
    for (const wh of car.rig.wheels) {
      wh.rotation.x -= spin;
    }

    // Roadkill check when player drives fast
    if (isPlayer && Math.abs(car.speed) > 9) {
      for (const npc of this.npcs) {
        if (npc.dead) continue;
        if (Math.hypot(npc.x - car.x, npc.z - car.z) < 2.2) {
          this.damageNPC(npc, 140, false);
        }
      }
    }
  }

  private updateTrafficAndPoliceCars(dt: number) {
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    // 1. Autonomous AI Traffic
    for (const car of this.vehicles) {
      if (car.exploded || !car.aiTraffic || car.isPolice || car === this.currentVehicle) continue;
      const dest = car.destNode ? this.node(car.destNode.i, car.destNode.j) : null;
      const from = car.nextNode ? this.node(car.nextNode.i, car.nextNode.j) : null;
      if (!dest || !from) continue;

      const target = this.laneAt(from, dest, false);
      const dx = target.x - car.x;
      const dz = target.z - car.z;
      const d = Math.hypot(dx, dz);
      const desiredYaw = Math.atan2(-dx, -dz);
      const steer = clamp(wrapAngle(desiredYaw - car.yaw) * 2.4, -1, 1);

      let throttle = 0.52;
      if (this.isCarAhead(car, 9.5)) throttle = 0;

      this.integrateVehicle(car, dt, throttle, throttle === 0 ? 0.5 : 0, steer, false);
      car.speed = clamp(car.speed, 0, 14);

      if (d < 3.4) {
        const nxt = this.pickNeighbor(dest, from);
        car.nextNode = { i: dest.i, j: dest.j };
        car.destNode = nxt ? { i: nxt.i, j: nxt.j } : car.nextNode;
      }
    }

    // 2. LSPD Police Cruisers Pursuit
    const policeCars = this.vehicles.filter((v) => v.isPolice && !v.exploded && v !== this.currentVehicle);
    policeCars.forEach((car, idx) => {
      const shouldChase = state.started && state.wantedStars > 0 && idx < state.wantedStars + 1;
      if (!shouldChase) {
        if (Math.abs(car.speed) > 0.2) {
          this.integrateVehicle(car, dt, 0, 0.8, 0, false);
        }
        return;
      }

      const dx = px - car.x;
      const dz = pz - car.z;
      const d = Math.hypot(dx, dz);
      if (d < 56) {
        this.lastSeenTime = this.time;
      }
      const desiredYaw = Math.atan2(-dx, -dz);
      const steer = clamp(wrapAngle(desiredYaw - car.yaw) * 2.8, -1, 1);
      const throttle = d > 6 ? 0.92 : 0.25;
      this.integrateVehicle(car, dt, throttle, 0, steer, false);
      car.speed = clamp(car.speed, -6, 22 + state.wantedStars * 1.6);
    });

    // 3. Car-to-Car Collisions
    for (let i = 0; i < this.vehicles.length; i++) {
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const a = this.vehicles[i]!;
        const b = this.vehicles[j]!;
        const sep = separateCircles(a.x, a.z, CAR_RADIUS * 0.9, b.x, b.z, CAR_RADIUS * 0.9, 1, 1);
        if (!sep.hit) continue;
        a.x = sep.ax;
        a.z = sep.az;
        b.x = sep.bx;
        b.z = sep.bz;
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 8 && (a === this.currentVehicle || b === this.currentVehicle)) {
          this.crashShake = Math.min(0.9, rel / 18);
          if (a.isPolice || b.isPolice) {
            this.damageActivePlayer(5);
          }
        }
      }
    }

    // 4. Police Siren Flashing
    const flash = Math.sin(this.time * 15) > 0;
    for (const v of this.vehicles) {
      if (v.rig.copRed && v.rig.copBlue) {
        const on = state.wantedStars > 0;
        (v.rig.copRed.material as THREE.MeshStandardMaterial).emissiveIntensity =
          on && flash ? 1.8 : 0.2;
        (v.rig.copBlue.material as THREE.MeshStandardMaterial).emissiveIntensity =
          on && !flash ? 1.8 : 0.2;
      }
    }
  }

  private isCarAhead(car: VehicleEntity, dist: number): boolean {
    const f = yawForward(car.yaw);
    for (const o of this.vehicles) {
      if (o === car) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const along = dx * f.x + dz * f.z;
      if (along < 1.5 || along > dist) continue;
      const side = Math.abs(dx * -f.z + dz * f.x);
      if (side < 2.2) return true;
    }
    return false;
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

      const hitGround = r.pos.y <= 0.35;
      const hitBuilding = resolveCircleList(r.pos.x, r.pos.z, 0.4, this.colliders).hit;
      let hitEntity = false;

      for (const v of this.vehicles) {
        if (!v.exploded && Math.hypot(v.x - r.pos.x, v.z - r.pos.z) < 2.6 && r.pos.y < 2.6) {
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

  private updateNPCsAndPolice(dt: number, isMenu: boolean) {
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    // Wanted Level Decay & Armed Police / SWAT Foot Patrol Spawning
    if (!isMenu && state.wantedStars > 0) {
      const hiddenTime = this.time - this.lastSeenTime;
      if (hiddenTime > 12 && !state.wantedSearching) {
        state.updateHUD({ wantedSearching: true });
      }
      if (hiddenTime > 24) {
        const nextStars = state.wantedStars - 1;
        this.lastSeenTime = this.time - 12;
        if (nextStars <= 0) {
          this.clearWantedLevel();
          state.pushPopup('✨ 已成功甩開警方視線，解除通緝！', '#34d399');
        } else {
          state.updateHUD({ wantedStars: nextStars });
        }
      }

      this.copSpawnTimer -= dt;
      const activeCops = this.npcs.filter((n) => !n.dead && (n.role === 'cop' || n.role === 'swat')).length;
      const maxCops = state.wantedStars * 2 + 2;

      if (this.copSpawnTimer <= 0 && activeCops < maxCops) {
        this.copSpawnTimer = 3.2;
        const ang = Math.random() * Math.PI * 2;
        const sx = px + Math.cos(ang) * 32;
        const sz = pz + Math.sin(ang) * 32;
        const col = resolveCircleList(sx, sz, PLAYER_RADIUS, this.colliders);
        if (!col.hit) {
          const isSwat = state.wantedStars >= 3;
          this.spawnNPC({
            x: col.x,
            z: col.z,
            role: isSwat ? 'swat' : 'cop',
            weapon: isSwat ? 'rifle' : 'pistol',
          });
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

      if (npc.staggerT > 0) {
        npc.staggerT -= dt;
        npc.rig.root.position.set(npc.x, 0, npc.z);
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
        if (npc.panicT > 0) {
          npc.panicT -= dt;
          npc.yaw = Math.atan2(dx, dz); // Run away from player
          const spd = 4.6;
          const f = yawForward(npc.yaw);
          const col = resolveCircleList(npc.x + f.x * spd * dt, npc.z + f.z * spd * dt, PLAYER_RADIUS, this.colliders);
          npc.x = col.x;
          npc.z = col.z;
          npc.walkT += dt * 11;
        } else if (npc.waitT > 0) {
          npc.waitT -= dt;
        } else if (npc.waypoints && npc.waypoints.length > 0) {
          const dest = npc.waypoints[npc.wpIdx]!;
          const wx = dest.x - npc.x;
          const wz = dest.z - npc.z;
          const wd = Math.hypot(wx, wz);
          if (wd < 0.5) {
            npc.wpIdx = (npc.wpIdx + 1) % npc.waypoints.length;
            if (Math.random() < 0.25) npc.waitT = 1.5;
          } else {
            const sp = 1.45;
            npc.x += (wx / wd) * sp * dt;
            npc.z += (wz / wd) * sp * dt;
            npc.yaw = Math.atan2(-wx, -wz);
            npc.walkT += dt * 6;
          }
        }

        npc.rig.root.position.set(npc.x, 0, npc.z);
        npc.rig.root.rotation.y = npc.yaw;
        const sw = npc.waitT > 0 && npc.panicT <= 0 ? 0 : Math.sin(npc.walkT) * 0.45;
        npc.rig.leftLeg.rotation.x = sw;
        npc.rig.rightLeg.rotation.x = -sw;
        npc.rig.leftArm.rotation.x = -sw * 0.7;
        npc.rig.rightArm.rotation.x = sw * 0.7;
      } else {
        // Hostile Cops, SWAT & Mission Enemies
        if (dist < 48) {
          this.lastSeenTime = this.time;
        }
        npc.yaw = Math.atan2(-dx, -dz);
        npc.rig.root.rotation.y = npc.yaw;
        npc.rig.rightArm.rotation.x = Math.PI * 0.45;

        if (dist > 12 && dist < 80) {
          const spd = npc.role === 'swat' ? 4.8 : 4.2;
          const col = resolveCircleList(
            npc.x + (dx / dist) * spd * dt,
            npc.z + (dz / dist) * spd * dt,
            PLAYER_RADIUS,
            this.colliders
          );
          npc.x = col.x;
          npc.z = col.z;
          npc.walkT += dt * 8;
          const sw = Math.sin(npc.walkT) * 0.5;
          npc.rig.leftLeg.rotation.x = sw;
          npc.rig.rightLeg.rotation.x = -sw;
        }

        npc.rig.root.position.set(npc.x, 0, npc.z);

        if (!isMenu && dist < 42) {
          npc.fireCooldown -= dt;
          if (npc.fireCooldown <= 0) {
            npc.fireCooldown = npc.role === 'swat' ? 0.6 : 0.98;
            npc.rig.muzzleFlash.visible = true;
            setTimeout(() => {
              npc.rig.muzzleFlash.visible = false;
            }, 50);

            const start = new THREE.Vector3(npc.x, 1.45, npc.z);
            const end = new THREE.Vector3(
              px + (Math.random() - 0.5) * 1.4,
              1.1,
              pz + (Math.random() - 0.5) * 1.4
            );
            this.spawnTracerBeam(start, end, 0xf87171);

            if (Math.random() < 0.45) {
              this.damageActivePlayer(npc.role === 'swat' ? 7 : 4.5);
            }
          }
        }
      }

      return true;
    });
  }

  private updateHelicopter(dt: number) {
    if (!this.heli.active) return;

    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    this.heli.rig.mainRotor.rotation.y += dt * 22;
    this.heli.rig.tailRotor.rotation.x += dt * 28;

    if (this.heli.crashing) {
      this.heli.yaw += dt * 5.5;
      this.heli.y -= dt * 14;
      this.heli.rig.root.position.set(this.heli.x, this.heli.y, this.heli.z);
      this.heli.rig.root.rotation.set(0.35, this.heli.yaw, 0.28);
      if (this.heli.y <= 1.5) {
        this.heli.active = false;
        this.heli.rig.root.visible = false;
        this.heli.rig.root.rotation.set(0, 0, 0);
        this.triggerExplosion(this.heli.x, 2, this.heli.z, 16);
      }
      return;
    }

    const orbitAngle = this.time * 0.55;
    const targetX = px + Math.cos(orbitAngle) * 18;
    const targetZ = pz + Math.sin(orbitAngle) * 18;
    this.heli.x = lerp(this.heli.x, targetX, dt * 1.8);
    this.heli.z = lerp(this.heli.z, targetZ, dt * 1.8);
    this.heli.yaw = Math.atan2(-(px - this.heli.x), -(pz - this.heli.z));

    this.heli.rig.root.position.set(this.heli.x, this.heli.y, this.heli.z);
    this.heli.rig.root.rotation.y = this.heli.yaw;

    this.heli.fireCooldown -= dt;
    if (this.heli.fireCooldown <= 0) {
      this.heli.fireCooldown = 1.4;
      const start = new THREE.Vector3(this.heli.x, this.heli.y - 1.2, this.heli.z);
      const end = new THREE.Vector3(
        px + (Math.random() - 0.5) * 1.6,
        1.1,
        pz + (Math.random() - 0.5) * 1.6
      );
      this.spawnTracerBeam(start, end, 0x38bdf8);
      if (Math.random() < 0.4) {
        this.damageActivePlayer(6);
      }
    }
  }

  private updateMissionsAndLoots(dt: number) {
    const state = useGameStore.getState();
    const activeRig = this.charRigs[state.activeChar];
    const px = this.currentVehicle ? this.currentVehicle.x : activeRig.root.position.x;
    const pz = this.currentVehicle ? this.currentVehicle.z : activeRig.root.position.z;

    this.missionBeacon.rotation.y = this.time * 1.2;

    this.loots = this.loots.filter((l) => {
      l.mesh.rotation.y += dt * 2.8;
      if (Math.hypot(l.x - px, l.z - pz) < 2.5) {
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
    const distToTarget = Math.hypot(px - tx, pz - tz);
    const remainingEnemies = this.npcs.filter((n) => !n.dead && n.role === 'mission_enemy').length;

    let stepComplete = false;
    let progressLabel: string | null = null;

    if (step.type === 'goto') {
      progressLabel = `距離目標光圈：${Math.round(distToTarget)}m`;
      if (distToTarget < step.radius) stepComplete = true;
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
        progressLabel = this.currentVehicle ? '已登上載具！' : `距離跑車：${Math.round(distToTarget)}m`;
        if (this.currentVehicle) stepComplete = true;
      } else {
        progressLabel = this.currentVehicle?.isMissionTarget
          ? '已奪取黃金超跑！'
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
      progressLabel = this.heli.active && !this.heli.crashing
        ? `警用武裝直升機耐久：${Math.max(0, Math.round((this.heli.hp / this.heli.maxHp) * 100))}%`
        : '已擊落武裝直升機！';
      if (!this.heli.active || this.heli.crashing) {
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

        // Auto-chain to next chapter after celebration banner
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
    const rig = this.charRigs[active];
    const vel = this.charVel[active];
    const wId = state.charStates[active].weapon;
    const spec = WEAPONS[wId];

    const inCar = !!this.currentVehicle;
    const targetFov = state.aiming
      ? spec.scopeZoom ?? 40
      : inCar && Math.abs(this.currentVehicle!.speed) > 22
        ? 68
        : 60;
    this.camera.fov = lerp(this.camera.fov, targetFov, rawDt * 12);
    this.camera.updateProjectionMatrix();

    if (inCar && this.currentVehicle) {
      this.lookIdle += rawDt;
      if (this.lookIdle > 0.5 && !this.mouseDownLeft && !this.mouseDownRight) {
        this.lookYaw = lerpAngle(this.lookYaw, 0, 1 - Math.exp(-3.5 * rawDt));
      }
    }

    const lookBack = this.keys.has('KeyV') ? Math.PI : 0;
    const heading = inCar
      ? this.currentVehicle!.yaw + this.lookYaw + lookBack
      : this.camYaw + lookBack;

    const fwd = yawForward(heading);
    const right = yawRight(heading);

    const baseDist = inCar ? 7.4 : state.aiming ? 2.85 : 4.9;
    const dist = baseDist * this.camDistMul;
    const height = (inCar ? 2.85 : 1.78) + (inCar ? 0 : vel.y);
    const lookY = (inCar ? 1.12 : 1.38) + (inCar ? 0 : vel.y);
    const shoulder = inCar ? 0.55 : state.aiming ? 0.65 : 0.38;

    const px = inCar ? this.currentVehicle!.x : rig.root.position.x;
    const pz = inCar ? this.currentVehicle!.z : rig.root.position.z;

    let wantX = px - fwd.x * dist * Math.cos(this.camPitch * 0.4) + right.x * shoulder;
    let wantZ = pz - fwd.z * dist * Math.cos(this.camPitch * 0.4) + right.z * shoulder;
    let wantY = height + Math.sin(this.camPitch) * dist * 0.55;

    if (!inCar) {
      const spd = Math.hypot(vel.vx, vel.vz);
      wantY += Math.sin(this.time * 9) * Math.min(0.04, spd * 0.006);
    }

    // Pull camera in smoothly if obstructed by building AABB
    let pull = 1.0;
    for (let i = 0; i < 6; i++) {
      const tx = px + (wantX - px) * pull;
      const tz = pz + (wantZ - pz) * pull;
      const hit = resolveCircleList(tx, tz, 0.42, this.colliders);
      if (!hit.hit) break;
      pull *= 0.72;
    }
    wantX = px + (wantX - px) * pull;
    wantZ = pz + (wantZ - pz) * pull;
    if (pull < 0.45) wantY = Math.max(wantY, vel.y + 1.6);

    const k = this.camSnap ? 1 : 1 - Math.exp(-(inCar ? 10 : 14) * rawDt);
    this.camSnap = false;

    let camX = lerp(this.camera.position.x, wantX, k);
    let camY = lerp(this.camera.position.y, Math.max(0.85, wantY), k);
    const camZ = lerp(this.camera.position.z, wantZ, k);

    if (this.crashShake > 0) {
      camX += (Math.random() - 0.5) * this.crashShake * 0.35;
      camY += (Math.random() - 0.5) * this.crashShake * 0.22;
    }

    this.camera.position.set(camX, camY, camZ);

    const targetLookX = px + fwd.x * 16 + right.x * shoulder * 0.5;
    const targetLookY = lookY - Math.sin(this.camPitch) * 7.5;
    const targetLookZ = pz + fwd.z * 16 + right.z * shoulder * 0.5;

    this.camLook.lerp(new THREE.Vector3(targetLookX, targetLookY, targetLookZ), k);
    this.camera.lookAt(this.camLook);
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

    const cs = { ...state.charStates };
    (['michael', 'franklin', 'trevor'] as CharacterId[]).forEach((cid) => {
      const r = this.charRigs[cid];
      cs[cid] = {
        ...cs[cid],
        x: r.root.position.x,
        z: r.root.position.z,
      };
    });

    let interactPrompt: string | null = null;
    for (const lm of LANDMARKS) {
      if (lm.interactPrompt && Math.hypot(px - lm.x, pz - lm.z) < 7.5) {
        interactPrompt = lm.interactPrompt;
        break;
      }
    }
    if (!interactPrompt && !this.currentVehicle) {
      for (const v of this.vehicles) {
        if (!v.exploded && Math.hypot(v.x - px, v.z - pz) < 4.5) {
          interactPrompt = `按 [E] 駕駛【${v.name}】`;
          break;
        }
      }
    }

    let talkPrompt: string | null = null;
    if (!this.currentVehicle) {
      for (const npc of this.npcs) {
        if (!npc.dead && npc.role === 'civilian' && npc.dialogueProfile && Math.hypot(npc.x - px, npc.z - pz) < 4.0) {
          talkPrompt = `按 [F] 與市民【${npc.dialogueProfile.name} · ${npc.dialogueProfile.job}】交談`;
          break;
        }
      }
    }

    const blips: RadarBlip[] = [];
    (['michael', 'franklin', 'trevor'] as CharacterId[]).forEach((cid) => {
      if (cid !== active) {
        blips.push({
          id: `char_${cid}`,
          x: this.charRigs[cid].root.position.x,
          z: this.charRigs[cid].root.position.z,
          type: 'protagonist',
          color: PROTAGONISTS[cid].color,
          label: cid[0]!.toUpperCase(),
        });
      }
    });

    for (const lm of LANDMARKS) {
      if (lm.type === 'ammu' || lm.type === 'customs' || lm.type === 'bank') {
        blips.push({
          id: lm.id,
          x: lm.x,
          z: lm.z,
          type: lm.type,
          color: lm.color,
        });
      }
    }

    for (const v of this.vehicles) {
      if (v.exploded) continue;
      if (v.isCashTruck) {
        blips.push({
          id: v.id,
          x: v.x,
          z: v.z,
          type: 'cash_truck',
          color: '#22c55e',
          label: '$',
        });
      } else if (v.isPolice && state.wantedStars > 0) {
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
      district: getDistrictName(px, pz),
      interactPrompt,
      talkPrompt,
      blips,
      playerRotation: this.currentVehicle ? this.currentVehicle.yaw : this.camYaw,
      vehicleSpeedKmh: this.currentVehicle ? Math.round(Math.abs(this.currentVehicle.speed) * 3.6) : 0,
      vehicleHpPercent: this.currentVehicle
        ? Math.max(0, Math.round((this.currentVehicle.hp / this.currentVehicle.maxHp) * 100))
        : 100,
    });
  }
}
