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
import { Grass } from './render/grass';
import { HeadlightBeams } from './render/headlights';
import { interiorSettings } from './render/interiors';
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
  grass!: Grass;
  beams!: HeadlightBeams;
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
  difficultyDamage = 0.8;

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
  private skipRender = false;
  private lastShotT = -1e9;
  private respawnAt: 'hospital' | 'police' = 'hospital';
  private autosaveT = 120;
  private wetness = 0;

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
    this.input.onLockChange = (locked, selfReleased) => {
      // an unlock we asked for (shop/menu) can arrive after the game already resumed: don't pause for it
      if (!locked && !selfReleased && this.phase === 'playing') this.setPhase('paused');
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
        // hard crash on a motorbike throws the rider off
        if (v.isPlayer && v.spec.bike && sp > 11 && this.player.vehicle === v) {
          const dx = v.vx;
          const dz = v.vz;
          this.exitVehicle(true);
          const p = this.player;
          p.vx = dx * 0.6;
          p.vz = dz * 0.6;
          p.vy = 5;
          p.onGround = false;
          this.combat.damageActor(p, Math.min(60, sp * 2.5), null, null, false, 'fall');
          this.toast('摔車了！', 'bad');
        }
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
    this.env.onThunder = (delay) => setTimeout(() => !this.disposed && this.audio.thunder(), delay * 1000);
    this.world3d = buildWorld(this.scene, this.world, this.renderer.capabilities.getMaxAnisotropy());
    this.fx = new FX(this.scene);
    this.grass = new Grass(this.scene, this.world);
    this.beams = new HeadlightBeams(this.scene);
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
    this.post.noAO.push(this.env.sky, this.env.clouds, this.env.flare, this.world3d.water);
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
    this.npcs.populate();
    for (let i = 0; i < 4; i++) this.npcs.update(0.016);
    for (let i = 0; i < 8; i++) this.traffic.update(0.3);

    // compile every shader behind the loading screen so the first frames don't hitch
    this.phase = 'loading';
    useHud.getState().set({ hasSave: this.hasSave(), phase: 'loading', loadingText: '正在準備畫面效果…' });
    this.camera.position.set(240, 95, 0);
    this.env.hour = 17.1; // the title sequence plays at golden hour
    this.camera.lookAt(0, 20, 0);
    const done = () => {
      if (this.disposed || this.phase !== 'loading') return;
      this.phase = 'title';
      useHud.getState().set({ phase: 'title' });
    };
    const compile = (this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown> }).compileAsync;
    if (compile) {
      compile
        .call(this.renderer, this.scene, this.camera)
        .catch(() => undefined)
        .finally(done);
      setTimeout(done, 15000); // never get stuck on slow drivers
    } else done();
    this.lastT = performance.now();
    this.animId = requestAnimationFrame(this.loop);
  }

  // ================================================================ adaptive resolution
  /** Render-scale steps the auto quality can fall back to (multiplies the preset's pixel ratio). */
  private static readonly SCALES = [1, 0.85, 0.72, 0.6];
  private scaleLevel = 0;
  private lowFpsStreak = 0;
  private baseRatio = 1;
  private perfAcc = 0;
  private perfFrames = 0;
  private perfCool = 0;
  private lastWall = performance.now();

  /** Watches frame time while playing; lowers render scale (and AO) when the game struggles, raises it again when there is headroom. */
  private adaptQuality(rawDt: number) {
    const s = useHud.getState().settings;
    if (!s.autoQuality || this.phase !== 'playing') return;
    if (document.hidden) {
      // background tab: frame timing is meaningless
      this.perfAcc = 0;
      this.perfFrames = 0;
      return;
    }
    rawDt = Math.min(rawDt, 1);
    this.perfCool -= rawDt;
    this.perfAcc += rawDt;
    this.perfFrames++;
    if (this.perfAcc < 2.5) return;
    const fps = this.perfFrames / this.perfAcc;
    this.perfAcc = 0;
    this.perfFrames = 0;
    if (this.perfCool > 0) return;
    if (fps < 42 && this.scaleLevel < Game.SCALES.length - 1) {
      this.scaleLevel++;
      this.applyScale();
      this.perfCool = 3;
    } else if (fps < 26 && this.scaleLevel === Game.SCALES.length - 1) {
      // still struggling at the lowest render scale: drop to the next lighter preset
      if (++this.lowFpsStreak >= 2 && s.quality !== 'low') {
        const next: Quality = s.quality === 'high' ? 'medium' : 'low';
        this.updateSettings({ quality: next });
        this.toast(`畫面較卡，已自動調整為${next === 'medium' ? '中' : '低'}畫質`, 'info');
        this.perfCool = 4;
      }
    } else if (fps > 58 && this.scaleLevel > 0) {
      this.scaleLevel--;
      this.applyScale();
      this.perfCool = 8;
    }
  }

  private applyScale() {
    const q = useHud.getState().settings.quality;
    this.renderer.setPixelRatio(this.baseRatio * Game.SCALES[this.scaleLevel]);
    // ambient occlusion is the first thing to go on the high preset
    this.post.gtao.enabled = q === 'high' && this.scaleLevel === 0;
    this.onResize();
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
      const tips: [number, string][] = this.input.touch
        ? [
            [7000, '提示：點 [上車] 上車或下車，開車時按住 [手煞車] 甩尾'],
            [13000, '提示：點上方 [地圖] 開啟地圖，點擊地圖即可設定 GPS 導航點'],
            [19000, '提示：點 [武器] 切換武器，點 [專注] 進入子彈時間'],
          ]
        : [
            [7000, '提示：按 [F] 上車或下車，按住空白鍵甩尾'],
            [13000, '提示：按 [M] 開啟地圖，點擊即可設定 GPS 導航點'],
            [19000, '提示：按住 [Tab] 開啟武器輪盤，按 [Q] 進入子彈時間'],
          ];
      for (const [ms, text] of tips) setTimeout(() => !this.disposed && this.toast(text, 'info'), ms);
    }
    // the streets are already busy when the camera fades in
    this.focus.set(this.player.x, this.player.y, this.player.z);
    this.npcs.populate();
    this.traffic.populate();
    this.setPhase('playing');
    this.input.requestLock();
    this.camYaw = this.player.yaw;
    if (this.input.touch) {
      // phones: go fullscreen landscape when the browser allows it
      const de = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
      de.requestFullscreen?.()
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
        .catch(() => {});
    }
  }

  /**
   * Key hint for prompts and objectives: "按 [F]" with a keyboard, "點 [上車]" on touch screens
   * (the label of the on-screen button that does the same thing).
   */
  hint(key: 'F' | 'E' | 'M' | 'B' | 'Q' | 'Tab' | 'Shift' | 'Space' | 'R', touchLabel?: string) {
    if (!this.input.touch) return `按 [${key === 'Space' ? '空白鍵' : key}]`;
    const labels: Record<string, string> = { F: this.player?.vehicle ? '下車' : '上車', E: '互動', M: '地圖', B: '電台', Q: '專注', Tab: '武器', Shift: '下降', Space: this.player?.vehicle ? '手煞車' : '跳躍', R: '換彈' };
    return `點 [${touchLabel ?? labels[key]}]`;
  }

  setPhase(p: HudState['phase']) {
    this.phase = p;
    // keep the mouse captured through death/arrest so respawning needs no extra click
    const lockNeeded = p === 'playing' || p === 'dead';
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
    const touch = this.input.touch;
    // phones have small CSS viewports but dense screens: render closer to native so the image stays crisp
    const ratio = touch
      ? q === 'low'
        ? Math.min(dpr, 1.25)
        : q === 'medium'
          ? Math.min(dpr, 1.5)
          : Math.min(dpr, 2)
      : q === 'low'
        ? Math.min(dpr, 1) * 0.75
        : q === 'medium'
          ? Math.min(dpr, 1.25)
          : Math.min(dpr, 1.75);
    this.baseRatio = ratio;
    this.scaleLevel = 0;
    this.lowFpsStreak = 0;
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.env.setShadowQuality(q === 'high' ? 4096 : touch ? 1024 : 2048, q !== 'low', q === 'high' ? 130 : touch ? 70 : 95);
    this.post.enabled = q !== 'low';
    this.post.gtao.enabled = q === 'high';
    this.grass.enabled = q !== 'low';
    this.grass.density = touch ? 0.5 : 1;
    interiorSettings.enabled = q !== 'low'; // materials recompile below (needsUpdate)
    this.env.flareEnabled = q !== 'low';
    if (this.post.smaa) this.post.smaa.enabled = q === 'high';
    this.traffic.maxCars = touch ? (q === 'low' ? 12 : q === 'medium' ? 16 : 20) : q === 'low' ? 16 : q === 'medium' ? 22 : 28;
    // far people and cars are single-mesh LODs, so the streets can be busier
    this.npcs.maxPeds = touch ? (q === 'low' ? 28 : q === 'medium' ? 36 : 44) : q === 'low' ? 36 : q === 'medium' ? 52 : 64;
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
    if (patch.autoQuality === false && this.scaleLevel !== 0) {
      this.scaleLevel = 0;
      this.applyScale();
    }
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
  /** Spawn an AI car on a lane in a distance band around (cx, cz) – the camera focus by default. */
  spawnTrafficVehicle(type: VehicleType, minD: number, maxD: number, cx?: number, cz?: number) {
    return this.traffic.spawnOnLane(type, minD, maxD, cx, cz);
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

  cycleWeapon(dir: number) {
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
  private letterboxTimer = 0;
  /** Letterbox bars for a few seconds (mission intros). */
  cinematic(seconds: number) {
    this.hud({ letterbox: true });
    window.clearTimeout(this.letterboxTimer);
    this.letterboxTimer = window.setTimeout(() => !this.disposed && this.hud({ letterbox: false }), seconds * 1000);
  }

  big(title: string, sub?: string, color?: string, rows?: [string, string][]) {
    const id = this.bigId++;
    this.hud({ big: { title, sub, color, id, rows } });
    setTimeout(
      () => {
        if (!this.disposed && useHud.getState().big?.id === id) this.hud({ big: null });
      },
      rows ? 6000 : 3800,
    );
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
    const blame = v.isPlayer ? null : v.lastHitBy;
    this.combat.explode(v.x, v.y + 1, v.z, 9, 260, blame);
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
    if (v.ai.kind === 'police' && blame === this.player) this.police.addHeat(Math.max(2, this.police.heat), '炸毀警車');
  }

  /** Is the player visibly armed and dangerous (stops the police from trying to arrest)? */
  playerThreat() {
    const p = this.player;
    if (p.weapon !== 'fist' && (this.aiming || performance.now() - this.lastShotT < 6000)) return true;
    return false;
  }

  /** Arrested by the police at low heat. */
  onBusted() {
    if (this.phase === 'dead') return;
    this.respawnAt = 'police';
    this.deadT = 0;
    this.focusActive = false;
    this.player.pose = 'handsUp';
    this.setPhase('dead');
    this.hud({ deathReason: '被警方逮捕', deathTitle: '被捕' });
    this.audio.jingle('fail');
    if (this.missions.run) this.missions.fail('你被捕了');
  }

  private onPlayerDeath(reason: string) {
    if (this.phase === 'dead') return;
    this.stats.deaths++;
    this.deadT = 0;
    this.focusActive = false;
    if (this.player.vehicle) this.exitVehicle(true);
    this.respawnAt = 'hospital';
    this.setPhase('dead');
    this.hud({ deathReason: reason, deathTitle: '重傷倒地' });
    this.audio.jingle('fail');
    if (this.missions.run) this.missions.fail('你倒下了');
  }

  private respawn() {
    // nearest hospital (or police station after an arrest)
    const busted = this.respawnAt === 'police';
    const hs = POIS.filter((o) => o.kind === (busted ? 'police' : 'hospital'));
    const h = hs.reduce((a, b) => (Math.hypot(b.x - this.player.x, b.z - this.player.z) < Math.hypot(a.x - this.player.x, a.z - this.player.z) ? b : a));
    const p = this.player;
    p.dead = false;
    p.rig.revive();
    p.hp = p.maxHp;
    p.armor = 0;
    p.setPos(h.x, h.z);
    p.yaw = 0;
    this.camYaw = 0;
    const fee = busted ? Math.min(3000, Math.round(this.cash * 0.15)) : Math.min(2000, Math.round(this.cash * 0.1));
    if (fee > 0) this.addCash(-fee, busted ? '罰款與保釋金' : '醫療費');
    if (busted) {
      // the police confiscate half of your ammunition
      for (const w of WEAPON_ORDER) this.inv[w].reserve = Math.floor(this.inv[w].reserve / 2);
      this.toast('警方沒收了一半的彈藥', 'bad');
    }
    p.pose = 'idle';
    this.police.clear(true);
    // clear hostile mission leftovers near the player
    for (const a of [...this.actors]) if (a.team === 'police' || (a.team === 'enemy' && !a.tag)) this.removeActor(a);
    this.setPhase('playing');
    this.input.requestLock();
    this.env.hour = (this.env.hour + 4) % 24;
    this.focus.set(p.x, p.y, p.z);
    this.npcs.populate();
    this.traffic.populate();
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
    if (v.spec.flying) this.toast(this.input.touch ? '直升機：上升／下降按鈕控制高度，搖桿前後傾斜與轉向' : '直升機：空白鍵上升、Shift 下降、W/S 前進後退、A/D 轉向', 'info');
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
      this.input.vehicleMode = !!this.player?.vehicle;
      this.input.pollGamepad();
      // Menu button resumes from the pause screen
      if (this.phase === 'paused' && this.input.gamepadActive && this.input.rawPressed('Escape')) this.resume();
      // measure with the wall clock: the frame delta above is capped for the simulation
      const wall = performance.now();
      const realDt = (wall - this.lastWall) / 1000;
      this.lastWall = wall;
      this.adaptQuality(realDt);
      this.frame(rawDt);
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
  };

  // ================================================================ title cinematics
  /** Camera shots for the title screen: [from, to, look-from, look-to] (y above ground), duration. */
  private static readonly SHOTS: { from: number[]; to: number[]; look: number[]; lookTo: number[]; dur: number; orbit?: boolean }[] = [
    { from: [0, 95, 240], to: [0, 95, 240], look: [0, 20, 0], lookTo: [0, 20, 0], dur: 12, orbit: true },
    { from: [-175, 6, 3.5], to: [-95, 8, 3.5], look: [60, 12, -2], lookTo: [80, 14, -2], dur: 10 },
    { from: [-8, 9, 432], to: [-30, 12, 448], look: [60, 20, 560], lookTo: [62, 23, 560], dur: 10 },
    { from: [500, 30, -250], to: [522, 40, -60], look: [590, 18, -40], lookTo: [600, 18, 40], dur: 10 },
    { from: [-260, 60, -470], to: [-170, 70, -455], look: [0, 30, 0], lookTo: [20, 30, 10], dur: 11 },
  ];
  private titleIdx = -1;
  private titleT = 0;
  private titleAngle = 0;
  private readonly tmpLook = new THREE.Vector3();

  private titleDirector(dt: number) {
    const shots = Game.SHOTS;
    this.titleT += dt;
    if (this.titleIdx < 0 || this.titleT > shots[this.titleIdx].dur) {
      this.titleIdx = (this.titleIdx + 1) % shots.length;
      this.titleT = 0;
      // keep the title at golden hour / early evening
      if (this.titleIdx === 0 && (this.env.hour > 19.6 || this.env.hour < 16)) this.env.hour = 17.1;
      const sh = shots[this.titleIdx];
      this.focus.set((sh.from[0] + sh.look[0]) / 2, 0, (sh.from[2] + sh.look[2]) / 2);
      // a few at a time: building characters and cars during the fade must not hitch
      this.npcs.populate(14);
      this.traffic.populate(10);
    }
    const sh = shots[this.titleIdx];
    const u = this.titleT / sh.dur;
    const e = u * u * (3 - 2 * u) * 0.6 + u * 0.4; // gentle ease, never fully stops
    if (sh.orbit) {
      this.titleAngle += dt * 0.05;
      const r = Math.hypot(sh.from[0], sh.from[2]);
      this.camera.position.set(Math.sin(this.titleAngle) * r, sh.from[1], Math.cos(this.titleAngle) * r);
      this.tmpLook.set(sh.look[0], sh.look[1], sh.look[2]);
    } else {
      const x = lerp(sh.from[0], sh.to[0], e);
      const z = lerp(sh.from[2], sh.to[2], e);
      this.camera.position.set(x, groundHeight(x, z) + lerp(sh.from[1], sh.to[1], e), z);
      this.tmpLook.set(lerp(sh.look[0], sh.lookTo[0], e), lerp(sh.look[1], sh.lookTo[1], e), lerp(sh.look[2], sh.lookTo[2], e));
    }
    this.camera.lookAt(this.tmpLook);
    // fade through black between shots (post-processing presets)
    this.post.grade.uniforms.uFade.value = Math.min(1, this.titleT / 0.9, (sh.dur - this.titleT) / 0.7);
  }

  private frame(rawDt: number) {
    const ph = this.phase;
    if (ph === 'loading') return;
    if (ph === 'title') {
      this.titleDirector(rawDt);
      this.env.update(rawDt * 0.5, this.focus);
      this.world3d.update(rawDt, performance.now() / 1000);
      this.world3d.setNight(this.env.night);
      this.traffic.update(rawDt);
      for (const v of this.vehicles) v.update(rawDt, this.world, this.vehicleEvents);
      this.vehicleCollisions(rawDt);
      this.npcs.update(rawDt);
      this.fx.update(rawDt);
      this.post.render(rawDt, this.scene, this.camera);
      return;
    }
    this.post.grade.uniforms.uFade.value = 1;
    const frozen = ph === 'paused' || ph === 'shop' || ph === 'map';
    if (frozen) {
      this.map.draw(rawDt);
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
      if (this.respawnAt === 'police') {
        this.player.pose = 'handsUp';
        this.player.move(dt, this.world, 0, 0, 20, false);
      }
      this.player.animate(dt);
      if (this.deadT > 4.5) this.respawn();
    }

    this.updatePlayer(dt);
    // vehicles
    this.traffic.update(dt);
    const cam = this.camera.position;
    const lodD2 = (this.input.touch ? 70 : 95) ** 2;
    for (const v of this.vehicles) {
      if (v.isPlayer || v.ai.kind !== 'parked' || v.speed > 0.05 || v.airborne) v.update(dt, this.world, this.vehicleEvents);
      if (v.isPlayer) v.headlightsOn = this.env.night > 0.35;
      v.setLod(!v.isPlayer && !v.destroyed && (v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 > lodD2);
    }
    this.vehicleCollisions(dt);
    this.npcs.update(dt);
    this.police.update(dt);
    this.combat.update(dt);
    this.missions.update(dt);
    // periodic autosave while free-roaming
    this.autosaveT -= rawDt;
    if (this.autosaveT <= 0) {
      this.autosaveT = 120;
      if (ph === 'playing' && !this.missions.run && this.police.heat === 0 && !this.player.dead) {
        this.save();
        this.toast('已自動存檔', 'info');
      }
    }
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
    // roads get wet quickly and dry slowly
    const rain = this.env.rain;
    this.wetness += (rain - this.wetness) * Math.min(1, dt * (rain > this.wetness ? 0.12 : 0.02));
    this.world3d.setWet(this.wetness);
    for (const v of this.vehicles) v.gripMul = 1 - this.wetness * 0.18;
    // ambient emitters (smokestacks, campfires) near the camera
    for (const e of this.world3d.emitters) {
      const d = Math.abs(e.x - this.camera.position.x) + Math.abs(e.z - this.camera.position.z);
      if (d > 420) continue;
      if (e.kind === 'smoke' && Math.random() < dt * 5) this.fx.smokePuff(e.x, e.y, e.z, 0.25, 2.2);
      else if (e.kind === 'fire') {
        if (Math.random() < dt * 25) this.fx.fire(e.x, e.y, e.z, 0.7);
        if (Math.random() < dt * 3) this.fx.smokePuff(e.x, e.y + 1.2, e.z, 0.5, 0.6);
      }
    }
    this.fx.update(dt);
    this.grass.update(this.camera.position, performance.now() / 1000);
    this.updateHeadlight();
    this.beams.update(this.vehicles, this.camera.position, this.env.night, this.wetness);
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
    this.post.bloom.strength = lerp(0.28, 0.6, this.env.night);
    if (!this.skipRender) this.post.render(rawDt, this.scene, this.camera);
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
    if (inp.wasPressed('Escape') || inp.wasPressed('KeyP')) {
      this.setPhase('paused');
      return;
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
    if (p.dead || this.phase === 'dead') return;
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
    const impact = p.move(dt, this.world, wx * speed * swim, wz * speed * swim, this.aiming ? 40 : 30, !this.aiming) ?? 0;
    if (impact > 13 && !p.inWater) this.combat.damageActor(p, (impact - 13) * 9, null, null, false, 'fall');
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
        if (d < min && d > 1e-4 && a.y < v.y + v.spec.height && a.y + 1.8 > v.y) {
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
    this.lastShotT = performance.now();
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
    if (v.spec.flying) {
      const up = playing && inp.isDown('Space') ? 1 : 0;
      const down = playing && (inp.isDown('ShiftLeft') || inp.isDown('ControlLeft') || inp.isDown('KeyC')) ? 1 : 0;
      v.input = { throttle: thr, steer, handbrake: false, lift: up - down };
    } else v.input = { throttle: thr, steer, handbrake: playing && inp.isDown('Space') };
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
                    other.lastHitBy = this.player;
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
        if (a.y > v.y + v.spec.height + 0.3 || a.y + 1.8 < v.y) continue;
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
    if (!v || this.env.night < 0.35 || v.destroyed || v.spec.flying) {
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
      const fly = v.spec.flying ? 1.25 : 1;
      const dist = [4.2 + len * 0.95, 3 + len * 0.7, 6 + len * 1.3][this.camDistMode] * fly;
      const pivot = tmpV.set(v.x, v.y + v.spec.height + (v.spec.flying ? 1.5 : 0.55), v.z);
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
    const speed = v ? (v.spec.flying ? v.rotor * v.spec.maxSpeed * 0.6 : Math.abs(v.forwardSpeed)) : 0;
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
      rain: this.env.rain,
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
        if (nv) prompt = nv.crewCount > 0 ? `${this.hint('F')} 劫持【${nv.spec.name}】` : `${this.hint('F')} 駕駛【${nv.spec.name}】`;
      }
      if (!prompt && v && v.speed < 1) prompt = this.input.touch ? `${this.hint('F')} 下車` : '按 [F] 下車　[B] 切換電台';
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
      speedKmh: v ? kmh(v.spec.flying ? v.speed : v.forwardSpeed) : 0,
      altitude: v?.spec.flying ? Math.max(0, Math.round(v.y - groundHeight(v.x, v.z))) : null,
      vehicleName: v?.spec.name ?? '',
      vehicleHp: v ? clamp(v.hp / v.spec.hp, 0, 1) : 1,
      prompt,
      hit: this.hitT,
      kill: this.killT,
      spread: this.currentSpread(),
      aiming: this.aiming,
      scoped,
      clock: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${this.env.rain > 0.6 ? '　暴雨' : this.env.rain > 0.15 ? '　小雨' : ''}`,
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
        this.focus.set(x, this.player.y, z);
        this.npcs.populate();
        this.traffic.populate();
      },
      key: (code: string, on: boolean) => this.input.debugSet(code, on),
      setHour: (h: number) => (this.env.hour = h),
      setWeather: (r: number) => {
        this.env.setWeather(r, true);
        this.wetness = r;
      },
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
      /** Advance the simulation without rendering (for automated tests). */
      simulate: (seconds: number, step = 1 / 30) => {
        this.skipRender = true;
        try {
          for (let t = 0; t < seconds; t += step) {
            this.frame(step);
            this.input.endFrame();
          }
        } finally {
          this.skipRender = false;
        }
      },
      game: this,
    };
  }
}

