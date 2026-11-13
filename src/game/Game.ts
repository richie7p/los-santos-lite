/** Port Solara – main game orchestrator. */
import * as THREE from 'three';
import { StaticWorld } from './core/collision';
import { Input } from './core/input';
import { angleDiff, clamp, damp, lerp, lerpAngle, pick, rand } from './core/math';
import { POIS, RACES, TAPES, poi } from './content';
import { WEAPONS, WEAPON_ORDER, kmh, type VehicleType, type WeaponId } from './data';
import { Actor, type Team } from './entities/actor';
import { type Outfit, playerOutfit, policeOutfit, randomOutfit, gangOutfit } from './entities/character';
import { Vehicle, type VehicleEvents } from './entities/vehicle';
import { Environment } from './render/environment';
import { FX } from './render/fx';
import { PostFX } from './render/post';
import { AudioEngine } from './systems/audio';
import { Combat } from './systems/combat';
import { MapRenderer } from './systems/minimap';
import { Missions } from './systems/missions';
import { NPCs } from './systems/npcs';
import { Police } from './systems/police';
import { Traffic } from './systems/traffic';
import { type HudState, type Quality, type ShopItem, type Toast, saveSettings, useHud } from './state';
import { buildWorld, type WorldBuild } from './world/builder';
import { DISTRICT_NAMES, RAMPS, districtAt, groundHeight } from './world/layout';

interface InvSlot {
  owned: boolean;
  mag: number;
  reserve: number;
}

interface SaveData {
  v: 1;
  cash: number;
  inv: Record<WeaponId, InvSlot>;
  progress: number;
  tapes: number[];
  stunts: number[];
  raceBest: Record<string, number>;
  hour: number;
  stats: Game['stats'];
  armor: number;
}

const SAVE_KEY = 'solara.save.v1';
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const samplesA: { x: number; z: number; r: number; o: number }[] = [];
const samplesB: { x: number; z: number; r: number; o: number }[] = [];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world = new StaticWorld();
  world3d!: WorldBuild;
  env!: Environment;
  post!: PostFX;
  fx!: FX;
  readonly audio = new AudioEngine();
  readonly input: Input;
  actors: Actor[] = [];
  vehicles: Vehicle[] = [];
  player!: Actor;
  combat!: Combat;
  traffic!: Traffic;
  npcs!: NPCs;
  police!: Police;
  missions!: Missions;
  map!: MapRenderer;

  phase: HudState['phase'] = 'loading';
  camYaw = Math.PI;
  camPitch = -0.12;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camFollow = new THREE.Vector3();
  private camDistMode = 0;
  private recoilKick = 0;
  private camShake = 0;
  private lastMouseT = 0;
  private aimBlend = 0;
  private fovCur = 70;
  readonly focus = new THREE.Vector3();
  stuntCam = false;
  private stuntCamT = 0;

  inv = Object.fromEntries(WEAPON_ORDER.map((w) => [w, { owned: w === 'fist', mag: 0, reserve: 0 }])) as Record<WeaponId, InvSlot>;
  cash = 500;
  stats = { kills: 0, missions: 0, deaths: 0, distance: 0 };
  godMode = false;
  difficultyDamage = 1;

  aiming = false;
  private fireCd = 0;
  private reloadT = 0;
  private bloom = 0;
  private hipFireT = 0;
  focusMeter = 100;
  focusActive = false;
  private stamina = 1;
  private regenT = 0;
  private deadT = 0;
  private wheelOpen = false;
  private wheelVec = { x: 0, y: 0 };
  private wheelSel: WeaponId | null = null;
  private damageFlash = 0;
  private hitT = 0;
  private killT = 0;
  private hudT = 0;
  private toastId = 1;
  private toasts: Toast[] = [];
  private bigId = 1;
  private subtitleT = 0;
  private subtitle: string | null = null;
  private objective: string | null = null;
  private stuntText: string | null = null;
  private cashDelta = 0;
  private cashDeltaT = 0;
  private animId = 0;
  private lastT = 0;
  private disposed = false;
  private attract = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private fps = 0;
  private headlight: THREE.SpotLight;
  private radioOn = false;
  private exitT = 0;
  private witnessT = 0;
  private lastDistrict = '';
  private districtT = 0;
  private resizeObs: ResizeObserver | null = null;

  vehicleEvents: VehicleEvents;

  constructor(private container: HTMLElement) {
    const s = useHud.getState().settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.camera = new THREE.PerspectiveCamera(s.fov, 1, 0.1, 4000);
    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (locked) => {
      if (!locked && this.phase === 'playing') this.setPhase('paused');
    };
    this.headlight = new THREE.SpotLight(0xfff1d6, 0, 70, 0.55, 0.45, 1.2);
    this.scene.add(this.headlight, this.headlight.target);

    this.vehicleEvents = {
      onImpact: (v, sp, x, y, z) => {
        const d = this.distToListener(tmpV.set(x, y, z));
        if (d < 80) {
          this.fx.sparks(tmpV, Math.min(20, Math.round(sp)));
          this.audio.crash(sp * clamp(1 - d / 80, 0, 1));
        }
        if (v.isPlayer) this.shake(Math.min(0.8, sp / 25));
      },
      onLand: (v, air, impact) => {
        if (v.isPlayer) {
          this.shake(Math.min(0.6, impact / 25));
          if (impact > 6) this.audio.crash(impact * 0.6);
          this.missions.onLand(v, air);
        }
      },
      onDestroyed: (v) => this.onVehicleDestroyed(v),
      skid: (x, y, z, yaw) => this.fx.skid(x, y, z, yaw),
      smoke: (x, y, z, dark, size) => this.fx.smokePuff(x, y, z, dark, size),
      fire: (x, y, z, size) => this.fx.fire(x, y, z, size),
      tireSmoke: (x, y, z) => this.fx.tireSmoke(x, y, z),
    };
  }

  /** Build the world (call after the loading screen has painted). */
  init() {
    const s = useHud.getState().settings;
    this.env = new Environment(this.scene, this.renderer);
    this.world3d = buildWorld(this.scene, this.world, this.renderer.capabilities.getMaxAnisotropy());
    this.fx = new FX(this.scene);
    this.combat = new Combat(this);
    this.traffic = new Traffic(this);
    this.npcs = new NPCs(this);
    this.police = new Police(this);

    // player
    this.player = new Actor('player', playerOutfit());
    this.player.hp = this.player.maxHp = 100;
    this.scene.add(this.player.rig.root);
    this.actors.push(this.player);
    const safe = poi('safehouse');
    this.player.setPos(safe.x + 2, safe.z - 1.5);
    this.player.yaw = Math.PI;
    this.giveWeapon('pistol', 60);
    this.selectWeapon('fist');

    this.missions = new Missions(this);
    this.map = new MapRenderer(this);

    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.post = new PostFX(this.renderer, this.scene, this.camera, w, h, s.quality === 'high');
    this.applyQuality(s.quality);
    this.onResize();
    window.addEventListener('resize', this.onResize);
    if ('ResizeObserver' in window) {
      this.resizeObs = new ResizeObserver(() => this.onResize());
      this.resizeObs.observe(this.container);
    }
    this.focus.set(this.player.x, this.player.y, this.player.z);
    this.camFollow.copy(this.focus);
    // pre-populate ambient life around the start
    for (let i = 0; i < 40; i++) this.npcs.update(0.016);
    for (let i = 0; i < 8; i++) this.traffic.update(0.3);

    useHud.getState().set({ hasSave: this.hasSave(), phase: 'title' });
    this.phase = 'title';
    this.lastT = performance.now();
    this.animId = requestAnimationFrame(this.loop);
  }

  // ================================================================ lifecycle
  start(continueGame: boolean) {
    this.audio.init();
    this.audio.setVolume(useHud.getState().settings.volume);
    if (continueGame) this.load();
    else {
      this.clearSave();
      this.env.hour = 9.5;
      this.missions.startStory();
    }
    this.setPhase('playing');
    this.input.requestLock();
    this.camYaw = this.player.yaw;
  }

  setPhase(p: HudState['phase']) {
    this.phase = p;
    const lockNeeded = p === 'playing';
    this.input.enabled = p === 'playing' || p === 'dead';
    if (!lockNeeded) this.input.releaseLock();
    if (p !== 'playing') {
      this.wheelOpen = false;
      this.audio.setRadio(false);
    }
    useHud.getState().set({ phase: p, wheelOpen: false });
  }

  resume() {
    if (this.phase === 'dead') return;
    this.setPhase('playing');
    this.input.requestLock();
    this.audio.init();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    window.removeEventListener('resize', this.onResize);
    this.resizeObs?.disconnect();
    this.input.dispose();
    this.audio.dispose();
    this.fx?.dispose();
    this.post?.dispose();
    this.env?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const disp = (mm: THREE.Material) => {
        for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose();
        mm.dispose();
      };
      if (Array.isArray(mat)) mat.forEach(disp);
      else if (mat) disp(mat);
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private onResize = () => {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
    this.fx?.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  };

  applyQuality(q: Quality) {
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'low' ? Math.min(dpr, 1) * 0.75 : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 1.75);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.env.setShadowQuality(q === 'high' ? 2048 : 1024, q !== 'low');
    this.post.enabled = q !== 'low';
    if (this.post.smaa) this.post.smaa.enabled = q === 'high';
    this.traffic.maxCars = q === 'low' ? 14 : q === 'medium' ? 18 : 24;
    this.npcs.maxPeds = q === 'low' ? 20 : q === 'medium' ? 28 : 36;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => (mm.needsUpdate = true));
      }
    });
    this.onResize();
  }

  updateSettings(patch: Partial<HudState['settings']>) {
    const s = { ...useHud.getState().settings, ...patch };
    useHud.getState().set({ settings: s });
    saveSettings(s);
    if (patch.quality) this.applyQuality(patch.quality);
    if (patch.volume !== undefined) this.audio.setVolume(patch.volume);
  }

  // ================================================================ spawning
  spawnActor(team: Team, outfit: Outfit, x: number, z: number) {
    const a = new Actor(team, outfit);
    a.setPos(x, z);
    a.yaw = Math.random() * Math.PI * 2;
    this.scene.add(a.rig.root);
    this.actors.push(a);
    return a;
  }

  removeActor(a: Actor) {
    if (a === this.player) return;
    const i = this.actors.indexOf(a);
    if (i >= 0) this.actors.splice(i, 1);
    if (a.vehicle && a.vehicle.driver === a) a.vehicle.driver = null;
    a.dispose(this.scene);
  }

  spawnVehicle(type: VehicleType, x: number, z: number, yaw: number, color?: number) {
    const v = new Vehicle(type, color);
    v.place(x, z, yaw);
    this.scene.add(v.rig.root);
    this.vehicles.push(v);
    return v;
  }

  removeVehicle(v: Vehicle) {
    if (v.isPlayer) return;
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    v.dispose();
  }

  /** Spawn a driving AI vehicle on a lane at a given distance band from the player. */
  spawnTrafficVehicle(type: VehicleType, minD: number, maxD: number) {
    return this.traffic.spawnOnLane(type, minD, maxD);
  }

  // ================================================================ inventory
  giveWeapon(w: WeaponId, ammo: number) {
    const slot = this.inv[w];
    const spec = WEAPONS[w];
    const wasOwned = slot.owned;
    slot.owned = true;
    if (w === 'fist') return;
    slot.reserve = Math.min(spec.maxAmmo, slot.reserve + ammo);
    if (!wasOwned || slot.mag === 0) {
      const take = Math.min(spec.mag, slot.reserve);
      slot.mag += take;
      slot.reserve -= take;
    }
  }

  selectWeapon(w: WeaponId) {
    if (!this.inv[w].owned) return;
    if (this.player.weapon !== w) {
      this.reloadT = 0;
      this.fireCd = 0.25;
      this.audio.ui('select');
    }
    this.player.setWeapon(w);
  }

  private cycleWeapon(dir: number) {
    const owned = WEAPON_ORDER.filter((w) => this.inv[w].owned);
    const i = owned.indexOf(this.player.weapon);
    this.selectWeapon(owned[(i + dir + owned.length) % owned.length]);
  }

  addCash(n: number, reason?: string) {
    this.cash = Math.max(0, this.cash + n);
    this.cashDelta += n;
    this.cashDeltaT = 2.5;
    if (n > 0) this.audio.cash();
    if (reason) this.toast(`${reason}　${n >= 0 ? '+' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`, n >= 0 ? 'money' : 'bad');
  }

  // ================================================================ HUD helpers
  hud(p: Partial<HudState>) {
    useHud.getState().set(p);
  }
  hudObjective(text: string | null) {
    if (text !== this.objective) {
      this.objective = text;
      this.hud({ objective: text });
    }
  }
  toast(text: string, kind: Toast['kind'] = 'info') {
    const t = { id: this.toastId++, text, kind };
    this.toasts = [...this.toasts.slice(-4), t];
    this.hud({ toasts: this.toasts });
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      if (!this.disposed) this.hud({ toasts: this.toasts });
    }, 4200);
  }
  big(title: string, sub?: string, color?: string) {
    const id = this.bigId++;
    this.hud({ big: { title, sub, color, id } });
    setTimeout(() => {
      if (!this.disposed && useHud.getState().big?.id === id) this.hud({ big: null });
    }, 3800);
  }
  setSubtitle(text: string | null, seconds = 3) {
    this.subtitle = text;
    this.subtitleT = seconds;
    this.hud({ subtitle: text });
  }
  setStuntText(t: string | null) {
    if (t !== this.stuntText) {
      this.stuntText = t;
      this.hud({ stuntText: t });
    }
  }

  // ================================================================ events from systems
  distToListener(p: THREE.Vector3) {
    return this.camera.position.distanceTo(p);
  }
  shake(a: number) {
    this.camShake = Math.max(this.camShake, a);
  }

  alertGunfire(shooter: Actor | null, x: number, z: number, radius = 45) {
    const byPlayer = shooter === this.player;
    for (const a of this.actors) {
      if (a.dead || a === this.player || a.vehicle) continue;
      const d = Math.hypot(a.x - x, a.z - z);
      if (d > radius) continue;
      if (a.team === 'civilian' && a.tag !== 'clerk') {
        if (a.ai.mode !== 'flee' && a.ai.mode !== 'cower') {
          a.ai.mode = Math.random() < 0.25 ? 'cower' : 'flee';
          a.ai.timer = rand(6, 12);
        }
        a.ai.tx = x;
        a.ai.tz = z;
      } else if ((a.team === 'gang' || a.team === 'enemy') && byPlayer && d < 35) a.ai.aggro = true;
      else if (a.team === 'police' && byPlayer && d < 60) {
        this.police.addHeat(this.police.heat > 0 ? this.police.heat : 1, '警察聽到槍聲');
      }
    }
    if (byPlayer) {
      for (const v of this.vehicles) {
        if (v.ai.kind === 'traffic' && Math.hypot(v.x - x, v.z - z) < radius) v.ai.cruise = 19;
        if (v.ai.kind === 'traffic' && v.crew === 'police' && Math.hypot(v.x - x, v.z - z) < 70) {
          v.ai.kind = 'police';
          this.police.addHeat(1, '巡邏警車聽到槍聲');
        }
      }
    }
  }

  onPlayerDamaged(dmg: number, by: Actor | null) {
    this.damageFlash = Math.min(1, this.damageFlash + dmg / 30);
    this.regenT = 5;
    this.shake(Math.min(0.35, dmg / 40));
    void by;
  }

  onActorHurt(a: Actor, by: Actor | null) {
    if (by !== this.player) return;
    if (a.team === 'police') this.police.addHeat(Math.max(2, this.police.heat), '襲警');
    if (a.team === 'gang') {
      for (const o of this.actors) if (o.team === 'gang' && Math.hypot(o.x - a.x, o.z - a.z) < 40) o.ai.aggro = true;
    }
    if (a.team === 'civilian' && !a.dead) {
      a.ai.mode = 'flee';
      a.ai.tx = this.player.x;
      a.ai.tz = this.player.z;
      a.ai.timer = 12;
    }
  }

  onPlayerHit(a: Actor | null, head: boolean) {
    this.hitT = performance.now();
    this.audio.hitmarker(false);
    if (head) this.focusMeter = Math.min(100, this.focusMeter + 2);
    void a;
  }

  onActorKilled(a: Actor, by: Actor | null, head: boolean) {
    if (a === this.player) {
      this.onPlayerDeath(by ? (by.team === 'police' ? '被警察擊倒' : '被敵人擊倒') : '傷勢過重');
      return;
    }
    if (by !== this.player) return;
    this.stats.kills++;
    this.killT = performance.now();
    this.audio.hitmarker(true);
    this.focusMeter = Math.min(100, this.focusMeter + (head ? 18 : 10));
    if (a.team === 'police') this.police.addHeat(Math.min(5, Math.max(2, this.police.heat + (Math.random() < 0.5 ? 1 : 0))), '擊斃警察');
    else if (a.team === 'civilian') {
      // witnesses call the police
      const copNear = this.actors.some((o) => o.team === 'police' && !o.dead && Math.hypot(o.x - a.x, o.z - a.z) < 60);
      if (copNear || this.police.heat > 0) this.police.addHeat(Math.max(1, this.police.heat), '殺害平民');
      else this.witnessT = 4;
    }
    if (a.bounty > 0) this.missions.dropCash(a.x, a.z, a.bounty);
    else if ((a.team === 'gang' || a.team === 'enemy' || a.team === 'police') && Math.random() < 0.7) this.missions.dropCash(a.x, a.z, Math.round(rand(20, 90)));
    else if (a.team === 'civilian' && Math.random() < 0.4) this.missions.dropCash(a.x, a.z, Math.round(rand(5, 40)));
    // ammo from fallen armed enemies
    if (a.weapon !== 'fist' && a.team !== 'civilian') {
      const w = this.inv[a.weapon].owned ? a.weapon : this.player.weapon;
      if (w !== 'fist' && this.inv[w].owned) {
        const amt = Math.ceil(WEAPONS[w].mag * 0.5);
        this.inv[w].reserve = Math.min(WEAPONS[w].maxAmmo, this.inv[w].reserve + amt);
      }
    }
  }

  onVehicleHurt(v: Vehicle, by: Actor | null) {
    if (by !== this.player) return;
    if (v.crew === 'police' || v.ai.kind === 'police') this.police.addHeat(Math.max(1, this.police.heat), '攻擊警車');
    if (v.crewCount > 0 && v.ai.kind === 'traffic' && v.hp < v.spec.hp * 0.6 && v.crew === 'civilian') this.ejectCrew(v, true);
  }

  private onVehicleDestroyed(v: Vehicle) {
    this.combat.explode(v.x, v.y + 1, v.z, 9, 260, v.isPlayer ? null : this.player);
    v.vy = 7;
    v.airborne = true;
    v.airTime = 0;
    v.yawRate += rand(-1.5, 1.5);
    if (v.crewCount > 0) {
      // occupants die
      v.crewCount = 0;
    }
    if (v.isPlayer) {
      this.combat.damageActor(this.player, 999, null, null, false, 'explosion');
    }
    if (v.ai.kind === 'police') this.police.addHeat(Math.max(2, this.police.heat), '炸毀警車');
  }

  private onPlayerDeath(reason: string) {
    if (this.phase === 'dead') return;
    this.stats.deaths++;
    this.deadT = 0;
    this.focusActive = false;
    if (this.player.vehicle) this.exitVehicle(true);
    this.setPhase('dead');
    this.hud({ deathReason: reason });
    this.audio.jingle('fail');
    if (this.missions.run) this.missions.fail('你倒下了');
  }

  private respawn() {
    const h = poi('hospital');
    const p = this.player;
    p.dead = false;
    p.rig.revive();
    p.hp = p.maxHp;
    p.armor = 0;
    p.setPos(h.x, h.z);
    p.yaw = 0;
    this.camYaw = 0;
    const fee = Math.min(2000, Math.round(this.cash * 0.1));
    if (fee > 0) this.addCash(-fee, '醫療費');
    this.police.clear(true);
    // clear hostile mission leftovers near the player
    for (const a of [...this.actors]) if (a.team === 'police' || (a.team === 'enemy' && !a.tag)) this.removeActor(a);
    this.setPhase('playing');
    this.input.requestLock();
    this.env.hour = (this.env.hour + 4) % 24;
  }

  // ================================================================ vehicles
  private nearestEnterable(): Vehicle | null {
    const p = this.player;
    let best: Vehicle | null = null;
    let bd = 3.2;
    for (const v of this.vehicles) {
      if (v.destroyed || v.sinking || v.isPlayer) continue;
      // distance to the car's oriented box
      const dx = p.x - v.x;
      const dz = p.z - v.z;
      const lz = dx * v.fx + dz * v.fz;
      const lx = dx * -v.fz + dz * v.fx;
      const ex = Math.max(0, Math.abs(lx) - v.spec.width / 2);
      const ez = Math.max(0, Math.abs(lz) - v.spec.length / 2);
      const d = Math.hypot(ex, ez);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  private ejectCrew(v: Vehicle, flee: boolean) {
    const n = v.crewCount;
    const crew = v.crew;
    v.crewCount = 0;
    for (let i = 0; i < n; i++) {
      const ep = v.exitPoint(i === 0 ? 1 : -1);
      const outfit = crew === 'police' ? policeOutfit() : crew === 'gang' || crew === 'enemy' ? gangOutfit() : randomOutfit();
      const team: Team = crew === 'police' ? 'police' : crew === 'gang' ? 'gang' : crew === 'enemy' ? 'enemy' : 'civilian';
      const a = this.spawnActor(team, outfit, ep.x, ep.z);
      if (team === 'civilian') {
        a.ai.mode = flee ? 'flee' : 'cower';
        a.ai.timer = 10;
        a.ai.tx = this.player.x;
        a.ai.tz = this.player.z;
        a.hp = a.maxHp = 60;
      } else {
        a.setWeapon(team === 'police' ? 'pistol' : 'smg');
        a.ai.aggro = true;
      }
    }
    if (v.ai.kind === 'traffic') v.ai.kind = 'parked';
  }

  private enterVehicle(v: Vehicle) {
    const p = this.player;
    if (v.crewCount > 0) {
      const wasPolice = v.crew === 'police';
      this.ejectCrew(v, true);
      if (wasPolice) this.police.addHeat(2, '搶奪警車');
      else {
        const copSees = this.actors.some((o) => o.team === 'police' && !o.dead && Math.hypot(o.x - p.x, o.z - p.z) < 45);
        if (copSees) this.police.addHeat(1, '當街劫車');
      }
      this.toast('劫車！', 'heat');
    } else if (v.type === 'police' && v.ai.kind !== 'police') {
      this.police.addHeat(1, '偷竊警車');
    }
    v.ai.kind = 'none';
    v.parkedSlot = -1;
    v.isPlayer = true;
    v.driver = p;
    p.vehicle = v;
    p.rig.root.visible = false;
    this.exitT = 0.4;
    this.audio.ui('open');
    this.hud({ vehicleName: v.spec.name });
    this.radioOn = true;
    this.audio.setRadio(this.audio.stationName !== '關閉電台');
    this.hud({ radio: this.audio.stationName });
  }

  private exitVehicle(force = false) {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    if (!force && v.speed > 12) {
      // bail out of a fast car
      this.combat.damageActor(p, 15, null, null, false, 'fall');
    }
    let ep = v.exitPoint(1);
    const res = this.world.resolveCircle(ep.x, ep.z, 0.4, v.y + 0.3, 1.5);
    if (res.hit) ep = v.exitPoint(-1);
    p.vehicle = null;
    v.isPlayer = false;
    v.driver = null;
    v.input = { throttle: 0, steer: 0, handbrake: true };
    if (v.siren && v.type === 'police') v.siren = false;
    p.setPos(ep.x, ep.z);
    p.vx = v.vx * 0.5;
    p.vz = v.vz * 0.5;
    p.yaw = v.yaw;
    p.rig.root.visible = true;
    this.exitT = 0.4;
    this.audio.setRadio(false);
    this.headlight.intensity = 0;
  }

  // ================================================================ main loop
  private loop = (now: number) => {
    if (this.disposed) return;
    this.animId = requestAnimationFrame(this.loop);
    const rawDt = Math.min(0.05, Math.max(0.0001, (now - this.lastT) / 1000));
    this.lastT = now;
    this.fpsAcc += rawDt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    try {
      this.frame(rawDt);
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
  };

  private frame(rawDt: number) {
    const ph = this.phase;
    if (ph === 'title' || ph === 'loading') {
      this.attract += rawDt * 0.05;
      this.env.update(rawDt * 0.5, this.focus);
      this.world3d.update(rawDt, performance.now() / 1000);
      this.world3d.setNight(this.env.night);
      const r = 240;
      this.camera.position.set(Math.sin(this.attract) * r, 95, Math.cos(this.attract) * r);
      this.camera.lookAt(0, 20, 0);
      this.focus.set(this.camera.position.x * 0.3, 0, this.camera.position.z * 0.3);
      this.traffic.update(rawDt);
      for (const v of this.vehicles) v.update(rawDt, this.world, this.vehicleEvents);
      this.post.render(rawDt, this.scene, this.camera);
      return;
    }
    const frozen = ph === 'paused' || ph === 'shop' || ph === 'map';
    if (frozen) {
      if (ph === 'map') this.map.draw(rawDt);
      this.post.render(rawDt, this.scene, this.camera);
      this.syncHud(rawDt, true);
      return;
    }

    // time scale
    let ts = 1;
    if (this.wheelOpen) ts = 0.2;
    else if (ph === 'dead') ts = 0.3;
    else if (this.focusActive) ts = 0.4;
    else if (this.stuntCam) ts = 0.45;
    const dt = rawDt * ts;

    if (ph === 'playing') this.handleInput(rawDt, dt);
    if (ph === 'dead') {
      this.deadT += rawDt;
      this.player.animate(dt);
      if (this.deadT > 4.5) this.respawn();
    }

    this.updatePlayer(dt);
    // vehicles
    this.traffic.update(dt);
    for (const v of this.vehicles) {
      if (v.isPlayer || v.ai.kind !== 'parked' || v.speed > 0.05 || v.airborne) v.update(dt, this.world, this.vehicleEvents);
      if (v.isPlayer) v.headlightsOn = this.env.night > 0.35;
    }
    this.vehicleCollisions(dt);
    this.npcs.update(dt);
    this.police.update(dt);
    this.combat.update(dt);
    this.missions.update(dt);
    if (this.witnessT > 0) {
      this.witnessT -= dt;
      if (this.witnessT <= 0 && Math.random() < 0.6) this.police.addHeat(1, '目擊者報警');
    }

    // focus point & world
    const pv = this.player.vehicle;
    this.focus.set(pv ? pv.x : this.player.x, pv ? pv.y : this.player.y, pv ? pv.z : this.player.z);
    this.env.update(dt, this.focus);
    this.world3d.update(dt, performance.now() / 1000);
    this.world3d.setNight(this.env.night);
    this.fx.update(dt);
    this.updateHeadlight();
    this.updateCamera(rawDt);
    this.updateAudio();
    this.map.draw(rawDt);
    this.syncHud(rawDt, false);

    const gu = this.post.grade.uniforms;
    this.damageFlash = Math.max(0, this.damageFlash - rawDt * 1.2);
    const lowHp = this.player.hp < 30 && !this.player.dead ? 0.35 + Math.sin(performance.now() / 300) * 0.1 : 0;
    gu.uDamage.value = Math.max(this.damageFlash, lowHp, ph === 'dead' ? 0.7 : 0);
    gu.uSlowmo.value = lerp(gu.uSlowmo.value, this.focusActive || this.wheelOpen || this.stuntCam ? 1 : 0, damp(6, rawDt));
    gu.uWarm.value = 1 - this.env.night;
    this.post.bloom.strength = lerp(0.28, 0.85, this.env.night);
    this.post.render(rawDt, this.scene, this.camera);
  }

  // ================================================================ input
  private handleInput(rawDt: number, dt: number) {
    const inp = this.input;
    const s = useHud.getState().settings;
    const p = this.player;
    // mouse look
    const sens = 0.0022 * s.sensitivity * (this.aiming ? 1 / Math.max(1, this.currentZoom() * 0.7) : 1);
    if (!this.wheelOpen) {
      this.camYaw -= inp.mouseDX * sens;
      this.camPitch -= inp.mouseDY * sens * (s.invertY ? -1 : 1);
      this.camPitch = clamp(this.camPitch, -1.25, 0.95);
    }
    if (inp.mouseDX !== 0 || inp.mouseDY !== 0) this.lastMouseT = performance.now();

    // weapon wheel
    if (inp.wasPressed('Tab')) {
      this.wheelOpen = true;
      this.wheelVec = { x: 0, y: 0 };
      this.wheelSel = null;
      this.hud({ wheelOpen: true, wheelSel: null });
      this.audio.ui('open');
    }
    if (this.wheelOpen) {
      this.wheelVec.x = clamp(this.wheelVec.x + inp.mouseDX, -120, 120);
      this.wheelVec.y = clamp(this.wheelVec.y + inp.mouseDY, -120, 120);
      if (Math.hypot(this.wheelVec.x, this.wheelVec.y) > 30) {
        const a = Math.atan2(this.wheelVec.x, -this.wheelVec.y);
        const idx = ((Math.round(a / ((Math.PI * 2) / 8)) % 8) + 8) % 8;
        const w = WEAPON_ORDER[idx];
        if (w !== this.wheelSel) {
          this.wheelSel = w;
          this.hud({ wheelSel: w });
          this.audio.ui('select');
        }
      }
      if (!inp.isDown('Tab')) {
        this.wheelOpen = false;
        if (this.wheelSel) this.selectWeapon(this.wheelSel);
        this.hud({ wheelOpen: false });
      }
    }
    for (let i = 0; i < 8; i++) if (inp.wasPressed(`Digit${i + 1}`)) this.selectWeapon(WEAPON_ORDER[i]);
    if (inp.wheel !== 0 && !this.aiming) this.cycleWeapon(inp.wheel > 0 ? 1 : -1);

    if (inp.wasPressed('KeyQ')) {
      if (this.focusActive) this.focusActive = false;
      else if (this.focusMeter > 15) {
        this.focusActive = true;
        this.audio.ui('open');
      }
    }
    if (inp.wasPressed('KeyV')) this.camDistMode = (this.camDistMode + 1) % 3;
    if (inp.wasPressed('KeyM')) {
      this.setPhase('map');
      return;
    }
    if (inp.wasPressed('KeyE')) {
      if (!this.missions.interact() && p.vehicle && (p.vehicle.type === 'police' || p.vehicle.type === 'taxi')) {
        /* nothing */
      }
    }
    this.exitT -= rawDt;
    if (inp.wasPressed('KeyF') && this.exitT <= 0) {
      if (p.vehicle) this.exitVehicle();
      else {
        const v = this.nearestEnterable();
        if (v) this.enterVehicle(v);
      }
    }
    if (p.vehicle) {
      if (inp.wasPressed('KeyH')) {
        if (p.vehicle.type === 'police') p.vehicle.siren = !p.vehicle.siren;
        else this.audio.horn();
      }
      if (inp.wasPressed('KeyB')) {
        const st = this.audio.cycleStation();
        this.audio.setRadio(false);
        this.audio.setRadio(st !== '關閉電台');
        this.hud({ radio: st });
        this.toast(`電台：${st}`, 'info');
      }
    }
    if (inp.wasPressed('KeyR')) this.startReload();

    // focus drain
    if (this.focusActive) {
      this.focusMeter -= rawDt * 12;
      if (this.focusMeter <= 0) {
        this.focusMeter = 0;
        this.focusActive = false;
      }
    } else this.focusMeter = Math.min(100, this.focusMeter + rawDt * 1.2);
    void dt;
  }

  private currentZoom() {
    return WEAPONS[this.player.weapon].zoom;
  }

  private startReload() {
    const w = this.player.weapon;
    const spec = WEAPONS[w];
    const slot = this.inv[w];
    if (w === 'fist' || this.reloadT > 0 || slot.mag >= spec.mag || slot.reserve <= 0) return;
    this.reloadT = spec.reload;
    this.audio.reload();
  }

  // ================================================================ player update
  private updatePlayer(dt: number) {
    const p = this.player;
    const inp = this.input;
    const playing = this.phase === 'playing';
    if (p.dead) return;
    // regen to 50%
    this.regenT -= dt;
    if (this.regenT <= 0 && p.hp < 50) p.hp = Math.min(50, p.hp + dt * 4);

    // reloading
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const spec = WEAPONS[p.weapon];
        const slot = this.inv[p.weapon];
        const take = Math.min(spec.mag - slot.mag, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
    this.fireCd -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 6);
    this.hipFireT -= dt;

    if (p.vehicle) {
      this.updateDriving(dt);
      return;
    }
    // on foot
    const fwdX = Math.sin(this.camYaw);
    const fwdZ = Math.cos(this.camYaw);
    const rgtX = -fwdZ;
    const rgtZ = fwdX;
    const mz = playing && !this.wheelOpen ? inp.axis('KeyS', 'KeyW') : 0;
    const mx = playing && !this.wheelOpen ? inp.axis('KeyA', 'KeyD') : 0;
    let wx = fwdX * mz + rgtX * mx;
    let wz = fwdZ * mz + rgtZ * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    this.aiming = playing && (inp.rmb || this.hipFireT > 0) && p.weapon !== 'fist' && !this.wheelOpen;
    if (inp.rmb && p.weapon === 'fist') this.aiming = false;
    const wantSprint = playing && inp.isDown('ShiftLeft') && wl > 0.1 && !inp.rmb;
    if (wantSprint && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - dt * 0.12);
    } else this.stamina = Math.min(1, this.stamina + dt * 0.25);
    p.sprinting = wantSprint && this.stamina > 0;
    const speed = this.aiming ? 2.8 : p.sprinting ? 8.2 : 5.0;
    const swim = p.inWater ? 0.45 : 1;
    p.move(dt, this.world, wx * speed * swim, wz * speed * swim, this.aiming ? 40 : 30, !this.aiming);
    if (this.aiming) p.yaw = lerpAngle(p.yaw, this.camYaw, damp(25, dt));
    if (playing && inp.wasPressed('Space') && !this.aiming) p.jump();
    p.aimPitch = this.camPitch + 0.08;
    p.pose = this.aiming ? 'aim' : wl > 0.1 ? 'move' : 'idle';
    this.pushOutOfVehicles(p);
    if (p.inWater && Math.random() < dt * 2) this.fx.splash(p.x, p.y + 1.1, p.z);
    p.animate(dt);

    // shooting
    if (playing && !this.wheelOpen) this.handleFire(p);
  }

  private pushOutOfVehicles(a: Actor) {
    for (const v of this.vehicles) {
      if (Math.abs(v.x - a.x) > 6 || Math.abs(v.z - a.z) > 6) continue;
      v.samples(samplesA);
      for (const s of samplesA) {
        const dx = a.x - s.x;
        const dz = a.z - s.z;
        const d = Math.hypot(dx, dz);
        const min = s.r + a.radius;
        if (d < min && d > 1e-4 && a.y < v.y + v.spec.height) {
          a.x = s.x + (dx / d) * min;
          a.z = s.z + (dz / d) * min;
        }
      }
    }
  }

  private handleFire(p: Actor) {
    const inp = this.input;
    const w = p.weapon;
    const spec = WEAPONS[w];
    const slot = this.inv[w];
    const trigger = spec.auto ? inp.lmb : inp.lmbPressed;
    if (!trigger || this.fireCd > 0) return;
    if (w === 'fist') {
      this.fireCd = 1 / spec.rate;
      p.rig.punch();
      setTimeout(() => !this.disposed && this.combat.melee(p), 120);
      return;
    }
    if (this.reloadT > 0) return;
    if (slot.mag <= 0) {
      this.audio.empty();
      this.fireCd = 0.25;
      this.startReload();
      return;
    }
    this.fireCd = 1 / spec.rate;
    this.hipFireT = 0.6;
    if (!(this.focusActive && false)) slot.mag--;
    p.rig.kick();
    // aim ray from camera
    const cam = this.camera;
    const dir = tmpDir;
    cam.getWorldDirection(dir);
    const chest = tmpV.set(p.x, p.y + 1.4, p.z);
    const t0 = Math.max(0, tmpV2.copy(chest).sub(cam.position).dot(dir));
    const from = tmpV2.copy(cam.position).addScaledVector(dir, t0);
    const muzzle = p.rig.muzzleWorld(new THREE.Vector3());
    const spread = this.currentSpread();
    if (w === 'rpg' || w === 'grenade') {
      // projectile from muzzle towards the crosshair target
      const hit = this.combat.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, 300, p, null);
      const d = new THREE.Vector3(hit.x - muzzle.x, hit.y - muzzle.y, hit.z - muzzle.z).normalize();
      this.combat.fire(p, w, muzzle, d, muzzle, 0);
    } else {
      this.combat.fire(p, w, from, dir, muzzle, spread, this.focusActive ? 1.6 : 1);
    }
    this.bloom = Math.min(8, this.bloom + spec.bloom);
    const kick = THREE.MathUtils.degToRad(spec.recoil) * (this.focusActive ? 0.4 : 1);
    this.camPitch += kick * 0.35;
    this.recoilKick += kick * 0.65;
    this.camYaw += (Math.random() - 0.5) * kick * 0.35;
    this.shake(spec.recoil * 0.03);
    if (slot.mag === 0) setTimeout(() => !this.disposed && this.startReload(), 250);
  }

  currentSpread() {
    const p = this.player;
    const spec = WEAPONS[p.weapon];
    let s = spec.spread + this.bloom;
    const sp = p.vehicle ? 0 : p.speed;
    s += (sp / 5) * (spec.spread * 0.8 + 0.6);
    if (!this.input.rmb) s *= 1.6;
    if (!p.onGround) s *= 2;
    if (this.focusActive) s *= 0.5;
    if (p.vehicle) s += 1.5;
    return s;
  }

  private updateDriving(dt: number) {
    const p = this.player;
    const v = p.vehicle!;
    const inp = this.input;
    const playing = this.phase === 'playing' && !this.wheelOpen;
    const thr = playing ? inp.axis('KeyS', 'KeyW') : 0;
    const steer = playing ? inp.axis('KeyA', 'KeyD') : 0;
    v.input = { throttle: thr, steer, handbrake: playing && inp.isDown('Space') };
    p.x = v.x;
    p.y = v.y;
    p.z = v.z;
    p.yaw = v.yaw;
    p.speed = 0;
    if (v.sinking && v.hp < -50) {
      this.exitVehicle(true);
      return;
    }
    // drive-by
    const canDriveBy = p.weapon === 'pistol' || p.weapon === 'smg' || p.weapon === 'grenade';
    this.aiming = playing && inp.rmb && canDriveBy;
    if (this.aiming && (WEAPONS[p.weapon].auto ? inp.lmb : inp.lmbPressed) && this.fireCd <= 0 && this.reloadT <= 0) {
      const slot = this.inv[p.weapon];
      if (slot.mag <= 0) this.startReload();
      else {
        const spec = WEAPONS[p.weapon];
        this.fireCd = 1 / spec.rate;
        slot.mag--;
        const dir = tmpDir;
        this.camera.getWorldDirection(dir);
        const side = Math.sign((dir.x * -v.fz + dir.z * v.fx) || 1);
        const muzzle = new THREE.Vector3(v.x + -v.fz * side * (v.spec.width / 2 + 0.3), v.y + v.spec.hood + 0.35, v.z + v.fx * side * (v.spec.width / 2 + 0.3));
        const from = tmpV2.copy(this.camera.position).addScaledVector(dir, this.camera.position.distanceTo(muzzle));
        this.combat.fire(p, p.weapon, p.weapon === 'grenade' ? muzzle : from, dir, muzzle, this.currentSpread());
        this.bloom = Math.min(8, this.bloom + spec.bloom);
        const kick = THREE.MathUtils.degToRad(spec.recoil);
        this.recoilKick += kick * 0.6;
        this.camPitch += kick * 0.25;
        this.lastMouseT = performance.now();
      }
    }
  }

  private vehicleCollisions(dt: number) {
    const vs = this.vehicles;
    // vehicle vs vehicle
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        const reach = (a.spec.length + b.spec.length) / 2 + 0.5;
        if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) continue;
        if (Math.abs(a.y - b.y) > 2.5) continue;
        a.samples(samplesA);
        b.samples(samplesB);
        for (const sa of samplesA) {
          for (const sb of samplesB) {
            const dx = sb.x - sa.x;
            const dz = sb.z - sa.z;
            const d = Math.hypot(dx, dz);
            const min = sa.r + sb.r;
            if (d >= min || d < 1e-5) continue;
            const nx = dx / d;
            const nz = dz / d;
            const pen = min - d;
            const ma = a.spec.mass;
            const mb = b.spec.mass;
            const ta = mb / (ma + mb);
            const tb = ma / (ma + mb);
            a.x -= nx * pen * ta;
            a.z -= nz * pen * ta;
            b.x += nx * pen * tb;
            b.z += nz * pen * tb;
            const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
            if (rv < 0) {
              const e = 0.3;
              const jImp = (-(1 + e) * rv) / (1 / ma + 1 / mb);
              a.vx -= (jImp / ma) * nx;
              a.vz -= (jImp / ma) * nz;
              b.vx += (jImp / mb) * nx;
              b.vz += (jImp / mb) * nz;
              a.yawRate += (Math.random() - 0.5) * -rv * 0.05;
              b.yawRate += (Math.random() - 0.5) * -rv * 0.05;
              const sp = -rv;
              if (sp > 3) {
                const cx = (sa.x + sb.x) / 2;
                const cz = (sa.z + sb.z) / 2;
                this.vehicleEvents.onImpact(a.isPlayer ? a : b, sp, cx, a.y + 0.7, cz);
                if (sp > 5) {
                  const dmg = (sp - 4) * (sp - 4) * 3;
                  a.damage(dmg * (mb / 1500), this.vehicleEvents);
                  b.damage(dmg * (ma / 1500), this.vehicleEvents);
                  if (a.isPlayer || b.isPlayer) {
                    const other = a.isPlayer ? b : a;
                    if (other.ai.kind === 'police' || other.crew === 'police') this.police.addHeat(Math.max(1, this.police.heat), '撞擊警車');
                    if (other.ai.kind === 'traffic' && other.crewCount > 0) other.ai.cruise = 18;
                  }
                }
              }
            }
          }
        }
      }
    }
    // vehicle vs actors
    for (const v of vs) {
      const sp = v.speed;
      for (const a of this.actors) {
        if (a.vehicle || (a.dead && sp < 3)) continue;
        if (Math.abs(a.x - v.x) > 5 || Math.abs(a.z - v.z) > 5) continue;
        if (a.y > v.y + v.spec.height + 0.3) continue;
        v.samples(samplesA);
        for (const s of samplesA) {
          const dx = a.x - s.x;
          const dz = a.z - s.z;
          const d = Math.hypot(dx, dz);
          const min = s.r + a.radius;
          if (d >= min) continue;
          const nx = d > 1e-4 ? dx / d : 1;
          const nz = d > 1e-4 ? dz / d : 0;
          const closing = -(v.vx * -nx + v.vz * -nz);
          if (sp > 5 && closing < -3 && !a.dead && a.invuln <= 0) {
            const dmg = sp * sp * 0.55;
            const by = v.isPlayer ? this.player : null;
            a.vy = Math.min(8, sp * 0.3);
            a.onGround = false;
            this.combat.damageActor(a, dmg, by, tmpV.set(v.vx, 0, v.vz).normalize(), false, 'vehicle');
            a.knock.x += v.vx * 0.8;
            a.knock.z += v.vz * 0.8;
            v.vx *= 0.93;
            v.vz *= 0.93;
            if (v.isPlayer) this.shake(0.15);
            this.audio.impact('flesh', this.distToListener(tmpV.set(a.x, a.y, a.z)));
            if (by && a.team === 'civilian') this.alertGunfire(null, a.x, a.z, 25);
          }
          a.x = s.x + nx * min;
          a.z = s.z + nz * min;
        }
      }
    }
    void dt;
  }

  private updateHeadlight() {
    const v = this.player.vehicle;
    if (!v || this.env.night < 0.35 || v.destroyed) {
      this.headlight.intensity = 0;
      return;
    }
    this.headlight.intensity = 260 * this.env.night;
    this.headlight.position.set(v.x + v.fx * (v.spec.length / 2), v.y + v.spec.hood, v.z + v.fz * (v.spec.length / 2));
    this.headlight.target.position.set(v.x + v.fx * 25, v.y - 1, v.z + v.fz * 25);
  }

  // ================================================================ camera
  private updateCamera(rawDt: number) {
    const s = useHud.getState().settings;
    const p = this.player;
    const v = p.vehicle;
    const cam = this.camera;
    this.recoilKick = lerp(this.recoilKick, 0, damp(10, rawDt));
    let fovTarget = s.fov;
    const pitch = this.camPitch + this.recoilKick;

    if (v) {
      const idle = performance.now() - this.lastMouseT > 1400;
      if (idle && !this.aiming && v.speed > 3) {
        const target = v.forwardSpeed < -2 ? v.yaw + Math.PI : v.yaw;
        this.camYaw = lerpAngle(this.camYaw, target, damp(2.6, rawDt));
        this.camPitch = lerp(this.camPitch, -0.16, damp(1.5, rawDt));
      }
      const len = v.spec.length;
      const dist = [4.2 + len * 0.95, 3 + len * 0.7, 6 + len * 1.3][this.camDistMode];
      const pivot = tmpV.set(v.x, v.y + v.spec.height + 0.55, v.z);
      this.camFollow.lerp(pivot, damp(14, rawDt));
      const cp = Math.cos(pitch);
      const dx = Math.sin(this.camYaw) * cp;
      const dy = Math.sin(pitch);
      const dz = Math.cos(this.camYaw) * cp;
      let want = tmpV2.set(this.camFollow.x - dx * dist, this.camFollow.y - dy * dist + 0.4, this.camFollow.z - dz * dist);
      want = this.cameraCollide(this.camFollow, want);
      if (this.stuntCam) {
        this.stuntCamT += rawDt;
        const side = Math.sin(this.stuntCamT * 0.6) * 0.5 + 1;
        want.set(v.x + -v.fz * 10 * side + v.fx * 6, v.y + 3, v.z + v.fx * 10 * side + v.fz * 6);
      } else this.stuntCamT = 0;
      this.camPos.copy(want);
      this.camLook.set(this.camFollow.x + dx * 10, this.camFollow.y + dy * 10, this.camFollow.z + dz * 10);
      if (this.stuntCam) this.camLook.set(v.x, v.y + 1, v.z);
      fovTarget = s.fov + Math.min(20, v.speed * 0.32) + (this.focusActive ? -5 : 0);
      if (this.aiming) fovTarget = s.fov * 0.85;
    } else {
      const aimK = this.aiming ? 1 : 0;
      this.aimBlend = lerp(this.aimBlend, aimK, damp(14, rawDt));
      const zoom = this.aiming && this.input.rmb ? this.currentZoom() : 1;
      const scoped = this.aiming && this.input.rmb && p.weapon === 'sniper';
      const baseDist = [3.6, 2.6, 5.4][this.camDistMode];
      const dist = scoped ? 0.2 : lerp(baseDist, 1.75, this.aimBlend);
      const shoulder = lerp(0.55, 0.62, this.aimBlend);
      const pivot = tmpV.set(p.x, p.y + lerp(1.55, 1.62, this.aimBlend), p.z);
      this.camFollow.lerp(pivot, damp(p.onGround ? 22 : 12, rawDt));
      const cp = Math.cos(pitch);
      const dx = Math.sin(this.camYaw) * cp;
      const dy = Math.sin(pitch);
      const dz = Math.cos(this.camYaw) * cp;
      const rx = -Math.cos(this.camYaw);
      const rz = Math.sin(this.camYaw);
      const base = tmpV2.set(this.camFollow.x + rx * shoulder * 0.6, this.camFollow.y, this.camFollow.z + rz * shoulder * 0.6);
      const want = new THREE.Vector3(this.camFollow.x + rx * shoulder - dx * dist, this.camFollow.y - dy * dist, this.camFollow.z + rz * shoulder - dz * dist);
      const res = this.cameraCollide(base, want);
      this.camPos.copy(res);
      this.camLook.set(this.camPos.x + dx * 20, this.camPos.y + dy * 20, this.camPos.z + dz * 20);
      fovTarget = s.fov / zoom;
      if (p.sprinting) fovTarget += 6;
      if (this.focusActive) fovTarget -= 4;
      p.rig.root.visible = !scoped && this.camPos.distanceTo(pivot) > 0.6;
    }
    // shake
    this.camShake = Math.max(0, this.camShake - rawDt * 2.5);
    const sh = this.camShake * this.camShake * 0.35;
    cam.position.set(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y + (Math.random() - 0.5) * sh, this.camPos.z + (Math.random() - 0.5) * sh);
    cam.lookAt(this.camLook);
    this.fovCur = lerp(this.fovCur, fovTarget, damp(12, rawDt));
    if (Math.abs(cam.fov - this.fovCur) > 0.01) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
      this.fx.setViewport(this.renderer.domElement.height, cam.fov);
    }
  }

  private cameraCollide(from: THREE.Vector3, to: THREE.Vector3) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return to;
    const h = this.world.raycast(from.x, from.y, from.z, dx / d, dy / d, dz / d, d + 0.3);
    const out = to.clone();
    if (h) {
      const t = Math.max(0.2, h.t - 0.3);
      out.set(from.x + (dx / d) * t, from.y + (dy / d) * t, from.z + (dz / d) * t);
    }
    const gh = groundHeight(out.x, out.z) + 0.35;
    if (out.y < gh) out.y = gh;
    return out;
  }

  // ================================================================ audio
  private updateAudio() {
    const v = this.player.vehicle;
    let siren = 0;
    for (const o of this.vehicles) {
      if (!o.siren) continue;
      const d = Math.hypot(o.x - this.focus.x, o.z - this.focus.z);
      siren = Math.max(siren, 1 - d / 140);
    }
    const speed = v ? Math.abs(v.forwardSpeed) : 0;
    const gearPos = v ? (speed / v.spec.maxSpeed) * 4 : 0;
    const rpm = v ? (gearPos % 1) * 0.6 + Math.min(1, gearPos / 4) * 0.4 : 0;
    const slip = v && !v.airborne ? Math.max(Math.abs(v.lateralSlip) / 10, v.input.handbrake && speed > 6 ? 0.7 : 0) : 0;
    this.audio.update({
      engine: rpm,
      load: v ? Math.max(0, v.input.throttle) : 0,
      inCar: !!v,
      skid: slip,
      siren,
      wind: v ? speed / 50 : this.player.y > 20 ? 0.4 : 0,
      city: Math.abs(this.focus.x) < 370 && Math.abs(this.focus.z) < 370 ? 1 : 0.2,
    });
  }

  // ================================================================ HUD sync
  private syncHud(rawDt: number, frozen: boolean) {
    this.hudT -= rawDt;
    this.subtitleT -= frozen ? 0 : rawDt;
    if (this.subtitle && this.subtitleT <= 0) this.setSubtitle(null);
    this.cashDeltaT -= rawDt;
    if (this.cashDeltaT <= 0 && this.cashDelta !== 0) this.cashDelta = 0;
    if (this.hudT > 0) return;
    this.hudT = 1 / 15;
    const p = this.player;
    const w = p.weapon;
    const slot = this.inv[w];
    const v = p.vehicle;
    const h = Math.floor(this.env.hour);
    const m = Math.floor((this.env.hour % 1) * 60);
    let prompt: string | null = null;
    if (this.phase === 'playing' && !p.dead) {
      prompt = this.missions.interactPrompt();
      if (!prompt && !v) {
        const nv = this.nearestEnterable();
        if (nv) prompt = nv.crewCount > 0 ? `按 [F] 劫持【${nv.spec.name}】` : `按 [F] 駕駛【${nv.spec.name}】`;
      }
      if (!prompt && v && v.speed < 1) prompt = '按 [F] 下車　[B] 切換電台';
    }
    // district banner
    const dKey = districtAt(this.focus.x, this.focus.z);
    if (dKey !== this.lastDistrict) {
      this.districtT += rawDt + 1 / 15;
      if (this.districtT > 1.5) {
        this.lastDistrict = dKey;
        this.districtT = 0;
      }
    } else this.districtT = 0;
    const scoped = this.aiming && this.input.rmb && w === 'sniper' && !v;
    this.hud({
      hp: p.hp,
      armor: p.armor,
      cash: this.cash,
      cashDelta: this.cashDelta,
      heat: this.police.heat,
      heatSearching: this.police.searching,
      weapon: w,
      mag: slot.mag,
      reserve: slot.reserve,
      reloading: this.reloadT > 0,
      owned: WEAPON_ORDER.filter((x) => this.inv[x].owned),
      focus: this.focusMeter,
      focusActive: this.focusActive,
      inVehicle: !!v,
      speedKmh: v ? kmh(v.forwardSpeed) : 0,
      vehicleName: v?.spec.name ?? '',
      vehicleHp: v ? clamp(v.hp / v.spec.hp, 0, 1) : 1,
      prompt,
      hit: this.hitT,
      kill: this.killT,
      spread: this.currentSpread(),
      aiming: this.aiming,
      scoped,
      clock: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      district: DISTRICT_NAMES[this.lastDistrict] ?? '',
      damage: this.damageFlash,
      fps: this.fps,
      stats: this.statSummary(),
    });
  }

  statSummary() {
    const total = this.missions.story.length;
    const comp =
      (this.missions.progress / total) * 50 +
      (this.missions.tapes.size / TAPES.length) * 20 +
      (this.missions.stunts.size / RAMPS.length) * 15 +
      (Object.keys(this.missions.raceBest).length / RACES.length) * 15;
    return {
      missions: this.missions.progress,
      totalMissions: total,
      tapes: this.missions.tapes.size,
      totalTapes: TAPES.length,
      stunts: this.missions.stunts.size,
      totalStunts: RAMPS.length,
      races: Object.keys(this.missions.raceBest).length,
      totalRaces: RACES.length,
      kills: this.stats.kills,
      completion: Math.round(comp),
    };
  }

  // ================================================================ shops
  openShop(kind: 'ammu' | 'garage' | 'safehouse', title: string) {
    this.setPhase('shop');
    this.hud({ shop: { kind, title, items: this.shopItems(kind) } });
    this.audio.ui('open');
  }

  closeShop() {
    this.hud({ shop: null });
    this.resume();
  }

  private shopItems(kind: 'ammu' | 'garage' | 'safehouse'): ShopItem[] {
    const items: ShopItem[] = [];
    if (kind === 'ammu') {
      for (const w of WEAPON_ORDER) {
        if (w === 'fist') continue;
        const spec = WEAPONS[w];
        const slot = this.inv[w];
        if (!slot.owned) items.push({ id: `buy:${w}`, name: spec.name, desc: `購買武器（附 ${spec.mag * 2} 發）`, price: spec.price || 300 });
        else items.push({ id: `ammo:${w}`, name: `${spec.short}彈藥 ×${spec.ammoPack}`, desc: `目前 ${slot.mag + slot.reserve} / ${spec.maxAmmo + spec.mag}`, price: spec.ammoPrice, disabled: slot.reserve >= spec.maxAmmo });
      }
      items.push({ id: 'armor', name: '防彈背心', desc: `護甲回滿（目前 ${Math.round(this.player.armor)}）`, price: 600, disabled: this.player.armor >= 100 });
      items.push({ id: 'health', name: '急救包', desc: '生命值回滿', price: 250, disabled: this.player.hp >= this.player.maxHp });
    } else if (kind === 'garage') {
      const v = this.player.vehicle;
      if (v) {
        items.push({ id: 'repair', name: '全車維修', desc: `車況 ${Math.round((Math.max(0, v.hp) / v.spec.hp) * 100)}%`, price: 300, disabled: v.hp >= v.spec.hp });
        const heatOk = this.police.heat <= 3;
        const colors: [string, number][] = [
          ['午夜黑', 0x111111],
          ['珍珠白', 0xf2f3f4],
          ['烈焰紅', 0xc0392b],
          ['海軍藍', 0x1a3e72],
          ['賽車黃', 0xf4c20d],
          ['森林綠', 0x1e6b46],
          ['電光紫', 0x7d3cff],
          ['霧面灰', 0x5d6d7e],
        ];
        for (const [n, c] of colors)
          items.push({ id: `paint:${c}`, name: `重新烤漆：${n}`, desc: this.police.heat > 0 ? (heatOk ? '同時清除通緝等級' : '通緝等級過高，警方盯太緊') : '換個新造型', price: 500, disabled: this.police.heat > 0 && !heatOk });
      }
    } else {
      items.push({ id: 'save', name: '存檔', desc: '儲存目前進度', price: 0 });
      items.push({ id: 'sleep_morning', name: '休息到早上 08:00', desc: '回滿生命並存檔', price: 0 });
      items.push({ id: 'sleep_night', name: '休息到晚上 20:00', desc: '回滿生命並存檔', price: 0 });
    }
    return items;
  }

  buy(id: string) {
    const st = useHud.getState().shop;
    if (!st) return;
    const item = st.items.find((i) => i.id === id);
    if (!item || item.disabled) return;
    if (item.price > this.cash) {
      this.audio.ui('error');
      this.toast('現金不足', 'bad');
      return;
    }
    const [kind, arg] = id.split(':');
    if (item.price > 0) this.addCash(-item.price);
    this.audio.cash();
    switch (kind) {
      case 'buy': {
        const w = arg as WeaponId;
        this.giveWeapon(w, WEAPONS[w].mag * 2);
        this.selectWeapon(w);
        this.toast(`購買 ${WEAPONS[w].name}`, 'good');
        break;
      }
      case 'ammo': {
        const w = arg as WeaponId;
        this.giveWeapon(w, WEAPONS[w].ammoPack);
        break;
      }
      case 'armor':
        this.player.armor = 100;
        break;
      case 'health':
        this.player.hp = this.player.maxHp;
        break;
      case 'repair':
        this.player.vehicle?.repair();
        this.toast('車輛已修復', 'good');
        break;
      case 'paint': {
        const v = this.player.vehicle;
        if (v) {
          v.repaint(Number(arg));
          v.repair();
          if (this.police.heat > 0 && this.police.heat <= 3) {
            this.police.clear(true);
            this.toast('烤漆完成，警方失去了你的蹤跡', 'good');
          } else this.toast('烤漆完成', 'good');
        }
        break;
      }
      case 'save':
        this.save();
        this.toast('進度已儲存', 'good');
        break;
      case 'sleep_morning':
      case 'sleep_night':
        this.env.hour = kind === 'sleep_morning' ? 8 : 20;
        this.player.hp = this.player.maxHp;
        this.save();
        this.toast('休息完畢，進度已儲存', 'good');
        break;
    }
    this.hud({ shop: { ...st, items: this.shopItems(st.kind) } });
  }

  // ================================================================ map
  setWaypoint(cx: number, cy: number) {
    const w = this.map.bigToWorld(cx, cy);
    const cur = this.missions.waypoint;
    if (cur && Math.hypot(cur.x - w.x, cur.z - w.z) < 25) this.missions.waypoint = null;
    else this.missions.waypoint = w;
    this.audio.ui('click');
  }

  setMapCanvases(mini: HTMLCanvasElement | null, big: HTMLCanvasElement | null) {
    if (!this.map) return;
    if (mini !== undefined) this.map.mini = mini;
    if (big !== undefined) this.map.big = big;
  }

  // ================================================================ save / load
  hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  save() {
    const data: SaveData = {
      v: 1,
      cash: this.cash,
      inv: this.inv,
      progress: this.missions.progress,
      tapes: [...this.missions.tapes],
      stunts: [...this.missions.stunts],
      raceBest: this.missions.raceBest,
      hour: this.env.hour,
      stats: this.stats,
      armor: this.player.armor,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.hud({ hasSave: true });
    } catch {
      /* storage might be unavailable */
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as SaveData;
      this.cash = d.cash ?? 500;
      for (const w of WEAPON_ORDER) if (d.inv?.[w]) this.inv[w] = { ...this.inv[w], ...d.inv[w] };
      this.missions.progress = d.progress ?? 0;
      this.missions.tapes = new Set(d.tapes ?? []);
      this.missions.stunts = new Set(d.stunts ?? []);
      this.missions.raceBest = d.raceBest ?? {};
      this.env.hour = d.hour ?? 10;
      this.stats = { ...this.stats, ...(d.stats ?? {}) };
      this.player.armor = d.armor ?? 0;
      this.missions.syncTapes();
      const safe = poi('safehouse');
      this.player.setPos(safe.x + 2, safe.z - 1.5);
      this.toast('已讀取存檔', 'good');
    } catch {
      this.toast('存檔讀取失敗', 'bad');
    }
  }

  // ================================================================ test hooks
  debug() {
    return {
      teleport: (x: number, z: number) => {
        if (this.player.vehicle) this.player.vehicle.place(x, z, this.player.vehicle.yaw);
        else this.player.setPos(x, z);
      },
      key: (code: string, on: boolean) => this.input.debugSet(code, on),
      setHour: (h: number) => (this.env.hour = h),
      give: (w: WeaponId) => this.giveWeapon(w, 200),
      heat: (n: number) => this.police.addHeat(n, 'debug'),
      god: (on: boolean) => (this.godMode = on),
      spawnCar: (t: VehicleType) => {
        const p = this.player;
        return this.spawnVehicle(t, p.x + Math.sin(p.yaw) * 5, p.z + Math.cos(p.yaw) * 5, p.yaw);
      },
      enterNearest: () => {
        const v = this.nearestEnterable();
        if (v) this.enterVehicle(v);
        return !!v;
      },
      look: (yaw: number, pitch: number) => {
        this.camYaw = yaw;
        this.camPitch = pitch;
      },
      fire: () => {
        this.input.lmbPressed = true;
        this.input.lmb = true;
        setTimeout(() => (this.input.lmb = false), 50);
      },
      aim: (on: boolean) => (this.input.rmb = on),
      state: () => ({
        x: this.player.x,
        z: this.player.z,
        y: this.player.y,
        hp: this.player.hp,
        inCar: !!this.player.vehicle,
        speed: this.player.vehicle?.speed ?? this.player.speed,
        actors: this.actors.length,
        vehicles: this.vehicles.length,
        heat: this.police.heat,
        mission: this.missions.run?.def.id ?? null,
        step: this.missions.run?.idx ?? null,
        phase: this.phase,
        calls: this.renderer.info.render.calls,
        tris: this.renderer.info.render.triangles,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        fps: this.fps,
      }),
      phase: (p: HudState['phase']) => this.setPhase(p),
      game: this,
    };
  }
}

