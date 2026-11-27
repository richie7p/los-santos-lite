/** Story missions, side activities, pickups, shops and map markers. */
import * as THREE from 'three';
import { clamp, pick, rand, randInt } from '../core/math';
import { POIS, RACES, TAPES, WEAPON_PICKUPS, poi, type RaceDef } from '../content';
import { WEAPONS, type WeaponId } from '../data';
import type { Actor } from '../entities/actor';
import { gangOutfit, policeOutfit } from '../entities/character';
import type { Vehicle } from '../entities/vehicle';
import { BLOCKS, RAMPS, groundHeight, randomSidewalkPoint } from '../world/layout';
import { signTexture } from '../world/textures';
import type { Game } from '../Game';

// ------------------------------------------------------------------ markers
export interface Blip {
  x: number;
  z: number;
  icon: string;
  color: string;
  label?: string;
  route?: boolean;
  big?: boolean;
}

class Marker {
  group = new THREE.Group();
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  private arrow: THREE.Mesh;
  x = 0;
  z = 0;
  r = 3;
  active = false;
  constructor(scene: THREE.Scene, color: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.2, 40, 1, true), mat);
    this.ring.position.y = 0.6;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 60, 8, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.beam.position.y = 30;
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color }));
    this.arrow.position.y = 4;
    this.group.add(this.ring, this.beam, this.arrow);
    this.group.visible = false;
    scene.add(this.group);
  }
  set(x: number, z: number, r: number, y?: number) {
    this.x = x;
    this.z = z;
    this.r = r;
    this.active = true;
    this.group.position.set(x, y ?? groundHeight(x, z), z);
    this.ring.scale.set(r, 1, r);
    this.group.visible = true;
  }
  hide() {
    this.active = false;
    this.group.visible = false;
  }
  update(t: number) {
    if (!this.active) return;
    this.arrow.position.y = 3.5 + Math.sin(t * 3) * 0.4;
    this.arrow.rotation.y = t * 2;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(t * 4) * 0.08;
  }
}

// ------------------------------------------------------------------ pickups
interface Pickup {
  id: string;
  kind: 'weapon' | 'health' | 'armor' | 'cash' | 'tape';
  weapon?: WeaponId;
  amount: number;
  x: number;
  y: number;
  z: number;
  mesh: THREE.Object3D;
  respawn: number;
  timer: number;
  taken: boolean;
  temp: boolean;
}

const pickupMats = {
  weapon: new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.3 }),
  health: new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.8 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x2563eb, emissiveIntensity: 0.8 }),
  cash: new THREE.MeshStandardMaterial({ color: 0x7a5a2a, roughness: 0.9 }),
  tape: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xf59e0b, emissiveIntensity: 0.5 }),
};
const pickupGeo = {
  weapon: new THREE.OctahedronGeometry(0.35),
  health: new THREE.BoxGeometry(0.5, 0.5, 0.5),
  armor: new THREE.CylinderGeometry(0.35, 0.3, 0.5, 6),
  cash: new THREE.SphereGeometry(0.35, 10, 8).scale(1, 1.2, 0.9),
  tape: new THREE.BoxGeometry(0.45, 0.28, 0.08),
};

// ------------------------------------------------------------------ missions
type StepResult = void | 'next' | { fail: string };
interface Step {
  obj: string;
  enter?: (m: MissionRun) => void;
  update: (m: MissionRun, dt: number) => StepResult;
}
interface MissionDef {
  id: string;
  title: string;
  brief: string;
  reward: number;
  start: () => { x: number; z: number };
  steps: (m: MissionRun) => Step[];
  /** for activities (not story) */
  activity?: boolean;
}

export interface MissionRun {
  def: MissionDef;
  steps: Step[];
  idx: number;
  t: number;
  stepT: number;
  actors: Actor[];
  vehicles: Vehicle[];
  data: Record<string, unknown>;
  timer: number | null;
}

export class Missions {
  marker: Marker;
  private startMarkers = new Map<string, Marker>();
  pickups: Pickup[] = [];
  run: MissionRun | null = null;
  progress = 0; // story mission index
  tapes = new Set<number>();
  stunts = new Set<number>();
  raceBest: Record<string, number> = {};
  storeCooldown: Record<string, number> = {};
  private clerks = new Map<string, Actor>();
  private han: Actor | null = null;
  private robT = 0;
  private stuntWatch: { ramp: number; t: number } | null = null;
  private armoredT = 90;
  private armored: Vehicle | null = null;
  private time = 0;
  waypoint: { x: number; z: number } | null = null;
  readonly story: MissionDef[];

  constructor(private g: Game) {
    this.marker = new Marker(g.scene, 0xfacc15);
    this.story = buildStory(g, this);
    this.buildProps();
  }

  // ---------------------------------------------------------- world setup
  private buildProps() {
    const g = this.g;
    // POI signs on poles
    for (const p of POIS) {
      if (p.kind === 'hospital' || p.kind === 'police') continue;
      const colors: Record<string, [string, string]> = {
        safehouse: ['#14532d', '#ecfccb'],
        garage: ['#7c2d12', '#fed7aa'],
        ammu: ['#1e293b', '#fbbf24'],
        courier: ['#1e3a8a', '#e0f2fe'],
        store: ['#065f46', '#fef9c3'],
      };
      const [bg, fg] = colors[p.kind] ?? ['#222', '#fff'];
      const t = signTexture(p.name, bg, fg, 768, 160);
      const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25, side: THREE.DoubleSide });
      g.world3d.nightMaterials.push({ mat: m, max: 0.9 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1), m);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      const y = groundHeight(p.x, p.z);
      const grp = new THREE.Group();
      pole.position.y = 1.6;
      sign.position.y = 3.5;
      grp.add(pole, sign);
      grp.position.set(p.x, y, p.z);
      // face the nearest road (away from block centre)
      const b = BLOCKS.reduce((best, bl) => (Math.hypot(bl.cx - p.x, bl.cz - p.z) < Math.hypot(best.cx - p.x, best.cz - p.z) ? bl : best));
      const outside = Math.abs(p.x) > 372 || Math.abs(p.z) > 372;
      grp.rotation.y = outside && p.yaw !== undefined ? p.yaw : Math.atan2(p.x - b.cx, p.z - b.cz);
      g.scene.add(grp);
      if (p.kind === 'store') {
        // kiosk counter + clerk
        const fx = Math.sin(grp.rotation.y);
        const fz = Math.cos(grp.rotation.y);
        const kiosk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 0.8), new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 }));
        kiosk.position.set(p.x - fx * 2.2, y + 0.55, p.z - fz * 2.2);
        kiosk.rotation.y = grp.rotation.y;
        kiosk.castShadow = true;
        const awning = new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 2), new THREE.MeshStandardMaterial({ color: 0x059669 }));
        awning.position.set(p.x - fx * 2.8, y + 2.7, p.z - fz * 2.8);
        awning.rotation.y = grp.rotation.y;
        g.scene.add(kiosk, awning);
        g.world.addBox(kiosk.position.x, kiosk.position.z, 1.8, 1.8, 0, y + 1.1, 'wood');
        const c = g.spawnActor('civilian', { skin: 0xe0ac69, shirt: 0x059669, pants: 0x1b2631, shoes: 0x111111, hair: 0x1b1b1b, hairStyle: 'short' }, p.x - fx * 3.2, p.z - fz * 3.2);
        c.yaw = grp.rotation.y;
        c.ai.mode = 'guard';
        c.tag = 'clerk';
        c.hp = c.maxHp = 50;
        this.clerks.set(p.id, c);
      }
    }
    // Han at the garage
    this.spawnHan();
    // pickups
    WEAPON_PICKUPS.forEach((w, i) => this.addPickup(`w${i}`, w.kind, w.x, w.z, w.kind === 'weapon' ? WEAPONS[w.weapon!].mag * 3 || 3 : w.kind === 'health' ? 50 : 50, w.weapon, 90, false));
    TAPES.forEach((t, i) => this.addPickup(`t${i}`, 'tape', t[0], t[1], 250, undefined, 0, false));
  }

  private spawnHan() {
    const g = this.g;
    const gp = poi('garage');
    const han = g.spawnActor('ally', { skin: 0xc68642, shirt: 0x5d4037, pants: 0x1f2a36, shoes: 0x3e2723, hair: 0x8c8c8c, hairStyle: 'cap', capColor: 0x7c2d12, jacket: 0x37474f }, gp.x - 3, gp.z + 2);
    han.ai.mode = 'guard';
    han.tag = 'han';
    han.invuln = 1e9;
    han.yaw = -Math.PI / 2;
    this.han = han;
  }

  addPickup(id: string, kind: Pickup['kind'], x: number, z: number, amount: number, weapon?: WeaponId, respawn = 0, temp = true) {
    const g = this.g;
    // nudge out of buildings
    const r = g.world.resolveCircle(x, z, 0.8, groundHeight(x, z), 1.5);
    x = r.x;
    z = r.z;
    let y = groundHeight(x, z);
    const sup = g.world.supportHeight(x, z, y + 3);
    if (sup > y) y = sup;
    const mesh = new THREE.Group();
    const core = new THREE.Mesh(pickupGeo[kind], pickupMats[kind]);
    core.castShadow = true;
    mesh.add(core);
    if (kind === 'health') {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const cross2 = cross.clone();
      cross2.rotation.z = Math.PI / 2;
      mesh.add(cross, cross2);
    }
    mesh.position.set(x, y + 0.8, z);
    g.scene.add(mesh);
    const p: Pickup = { id, kind, weapon, amount, x, y, z, mesh, respawn, timer: 0, taken: false, temp };
    this.pickups.push(p);
    return p;
  }

  // ---------------------------------------------------------- per frame
  update(dt: number) {
    const g = this.g;
    this.time += dt;
    this.marker.update(this.time);
    const p = g.player;
    const px = p.vehicle?.x ?? p.x;
    const pz = p.vehicle?.z ?? p.z;

    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.taken) {
        if (k.respawn > 0) {
          k.timer -= dt;
          if (k.timer <= 0) {
            k.taken = false;
            k.mesh.visible = true;
          }
        }
        continue;
      }
      k.mesh.rotation.y += dt * 2;
      k.mesh.position.y = k.y + 0.8 + Math.sin(this.time * 2.5 + i) * 0.15;
      if (Math.random() < dt * 4 && Math.abs(k.x - px) < 60 && Math.abs(k.z - pz) < 60)
        g.fx.pickupSparkle(k.x, k.y + 0.6, k.z, k.kind === 'tape' ? 0xf59e0b : k.kind === 'health' ? 0x22c55e : 0x60a5fa);
      const d = Math.hypot(k.x - px, k.z - pz);
      if (d < (p.vehicle ? 2.6 : 1.4) && Math.abs(k.y - (p.vehicle?.y ?? p.y)) < 3) this.collect(k);
    }

    // stores: robbery by aiming at the clerk
    this.updateRobbery(dt);

    // stunt jumps
    this.updateStunts(dt);

    // random armored truck event
    this.updateArmoredEvent(dt);

    // story / activity runner
    if (this.run) this.updateRun(dt);
    else this.updateStartMarkers();

    // Han hangs around the garage
    if (this.han && this.han.dead) {
      this.han.dead = false;
      this.han.hp = 100;
      this.han.rig.revive();
    }
  }

  private collect(k: Pickup) {
    const g = this.g;
    const p = g.player;
    switch (k.kind) {
      case 'weapon': {
        const w = k.weapon!;
        const had = g.inv[w].owned;
        g.giveWeapon(w, Math.max(k.amount, WEAPONS[w].mag * 2));
        g.toast(had ? `${WEAPONS[w].name} 彈藥 +${k.amount}` : `獲得武器：${WEAPONS[w].name}`, 'good');
        break;
      }
      case 'health':
        if (p.hp >= p.maxHp) return;
        p.hp = Math.min(p.maxHp, p.hp + k.amount);
        g.toast('生命值回復', 'good');
        break;
      case 'armor':
        if (p.armor >= 100) return;
        p.armor = Math.min(100, p.armor + k.amount);
        g.toast('防彈衣 +50', 'good');
        break;
      case 'cash':
        g.addCash(k.amount, '撿到現金');
        break;
      case 'tape': {
        const idx = Number(k.id.slice(1));
        this.tapes.add(idx);
        g.addCash(k.amount);
        g.toast(`找到隱藏錄音帶 ${this.tapes.size} / ${TAPES.length}`, 'good');
        if (this.tapes.size === TAPES.length) {
          g.big('全部錄音帶收集完成！', '獎勵 $25,000', '#f59e0b');
          g.addCash(25000);
        }
        g.save();
        break;
      }
    }
    g.audio.pickup();
    k.taken = true;
    k.mesh.visible = false;
    k.timer = k.respawn;
    if (k.temp || (k.respawn === 0 && k.kind !== 'tape')) this.removePickup(k);
    else if (k.kind === 'tape') this.removePickup(k);
  }

  removePickup(k: Pickup) {
    this.g.scene.remove(k.mesh);
    const i = this.pickups.indexOf(k);
    if (i >= 0) this.pickups.splice(i, 1);
  }

  /** Drop collected tapes after loading a save. */
  syncTapes() {
    for (const k of [...this.pickups]) if (k.kind === 'tape' && this.tapes.has(Number(k.id.slice(1)))) this.removePickup(k);
  }

  dropCash(x: number, z: number, amount: number) {
    this.addPickup(`c${Math.random()}`, 'cash', x + rand(-0.5, 0.5), z + rand(-0.5, 0.5), amount, undefined, 0, true);
  }

  // ---------------------------------------------------------- interactions
  /** Prompt text for the E key, or null. */
  interactPrompt(): string | null {
    const g = this.g;
    const p = g.player;
    const px = p.vehicle?.x ?? p.x;
    const pz = p.vehicle?.z ?? p.z;
    for (const o of POIS) {
      const tx = o.dx ?? o.x;
      const tz = o.dz ?? o.z;
      const d = Math.hypot(tx - px, tz - pz);
      if (o.kind === 'ammu' && d < 3 && !p.vehicle) return `${g.hint('E')} 進入 ${o.name}`;
      if (o.kind === 'garage' && d < 5 && p.vehicle) return `${g.hint('E')} 使用 ${o.name}（維修／烤漆）`;
      if (o.kind === 'safehouse' && d < 3 && !p.vehicle) return `${g.hint('E')} 存檔並休息`;
      if (o.kind === 'courier' && Math.hypot(o.x - px, o.z - pz) < 4 && !this.run && !p.vehicle) return `${g.hint('E')} 開始快鴿速遞外送工作`;
    }
    if (!this.run) {
      for (const r of RACES) {
        if (Math.hypot(r.start[0] - px, r.start[1] - pz) < 6 && p.vehicle) return `${g.hint('E')} 開始 ${r.name}${this.raceBest[r.id] ? `（最佳 ${this.raceBest[r.id].toFixed(1)} 秒）` : ''}`;
      }
    }
    return null;
  }

  interact(): boolean {
    const g = this.g;
    const p = g.player;
    const px = p.vehicle?.x ?? p.x;
    const pz = p.vehicle?.z ?? p.z;
    for (const o of POIS) {
      const tx = o.dx ?? o.x;
      const tz = o.dz ?? o.z;
      const d = Math.hypot(tx - px, tz - pz);
      if (o.kind === 'ammu' && d < 3 && !p.vehicle) {
        g.openShop('ammu', o.name);
        return true;
      }
      if (o.kind === 'garage' && d < 5 && p.vehicle) {
        g.openShop('garage', o.name);
        return true;
      }
      if (o.kind === 'safehouse' && d < 3 && !p.vehicle) {
        g.openShop('safehouse', o.name);
        return true;
      }
      if (o.kind === 'courier' && Math.hypot(o.x - px, o.z - pz) < 4 && !this.run && !p.vehicle) {
        this.startActivity(courierJob(g, this));
        return true;
      }
    }
    if (!this.run && p.vehicle) {
      for (const r of RACES) {
        if (Math.hypot(r.start[0] - px, r.start[1] - pz) < 6) {
          this.startActivity(raceActivity(g, this, r));
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------- robbery
  private updateRobbery(dt: number) {
    const g = this.g;
    const p = g.player;
    for (const k of Object.keys(this.storeCooldown)) this.storeCooldown[k] -= dt;
    let target: [string, Actor] | null = null;
    if (g.aiming && !p.vehicle && p.weapon !== 'fist') {
      for (const [id, c] of this.clerks) {
        if (c.dead) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d > 10) continue;
        // within the aim cone
        const ax = Math.sin(g.camYaw);
        const az = Math.cos(g.camYaw);
        const dot = ((c.x - p.x) * ax + (c.z - p.z) * az) / d;
        if (dot > 0.93) target = [id, c];
      }
    }
    if (target) {
      const [id, c] = target;
      if ((this.storeCooldown[id] ?? 0) > 0) {
        g.setSubtitle('店員：「收銀機已經空了……拜託別開槍！」', 2);
        c.ai.mode = 'handsUp';
        c.ai.timer = 3;
        return;
      }
      c.ai.mode = 'handsUp';
      c.ai.timer = 4;
      this.robT += dt;
      g.setSubtitle(`店員：「別、別開槍！我把錢給你！」（${Math.min(100, Math.round((this.robT / 3) * 100))}%）`, 0.3);
      if (this.robT >= 3) {
        this.robT = 0;
        this.storeCooldown[id] = 300;
        const amount = randInt(6, 15) * 100;
        this.dropCash(c.x + Math.sin(c.yaw) * 1.5, c.z + Math.cos(c.yaw) * 1.5, amount);
        g.police.addHeat(2, '搶劫便利店');
        g.toast('店員把錢丟了出來，快撿起來！', 'money');
      }
    } else this.robT = Math.max(0, this.robT - dt);
  }

  // ---------------------------------------------------------- stunts
  private updateStunts(dt: number) {
    const g = this.g;
    const v = g.player.vehicle;
    if (!v) {
      this.stuntWatch = null;
      return;
    }
    for (let i = 0; i < RAMPS.length; i++) {
      const r = RAMPS[i];
      if (Math.hypot(v.x - r.x, v.z - r.z) < r.len * 0.6 && v.speed > 12) this.stuntWatch = { ramp: i, t: 1.2 };
    }
    if (this.stuntWatch) {
      this.stuntWatch.t -= dt;
      if (v.airborne && v.airTime > 0.8) g.stuntCam = true;
      if (!v.airborne && this.stuntWatch.t < 0) {
        this.stuntWatch = null;
        g.stuntCam = false;
      }
    }
  }

  onLand(v: Vehicle, airTime: number) {
    const g = this.g;
    g.stuntCam = false;
    if (!this.stuntWatch || v !== g.player.vehicle) return;
    const idx = this.stuntWatch.ramp;
    this.stuntWatch = null;
    if (airTime < 0.6) return;
    const first = !this.stunts.has(idx);
    this.stunts.add(idx);
    const bonus = first ? 1500 : 250;
    g.audio.jingle('stunt');
    g.big(first ? '特技跳躍完成！' : '漂亮的飛躍！', `滯空 ${airTime.toFixed(1)} 秒 · +$${bonus}${first ? `　(${this.stunts.size}/${RAMPS.length})` : ''}`, '#38bdf8');
    g.addCash(bonus);
    if (first) g.save();
  }

  // ---------------------------------------------------------- armored truck event
  private updateArmoredEvent(dt: number) {
    const g = this.g;
    if (this.armored) {
      const v = this.armored;
      if (!g.vehicles.includes(v)) {
        this.armored = null;
        return;
      }
      v.blip = 'target';
      if ((v.hp < v.spec.hp * 0.35 || v.destroyed) && !v.tag.includes('looted')) {
        v.tag = 'armored-looted';
        v.ai.kind = 'parked';
        v.crewCount = 0;
        // guards bail out
        for (let i = 0; i < 2; i++) {
          const ep = v.exitPoint(i === 0 ? 1 : -1);
          const a = g.spawnActor('enemy', policeOutfit(true), ep.x, ep.z);
          a.setWeapon('smg');
          a.ai.accuracy = 0.3;
          a.ai.aggro = true;
        }
        const bx = v.x - Math.sin(v.yaw) * (v.spec.length / 2 + 1);
        const bz = v.z - Math.cos(v.yaw) * (v.spec.length / 2 + 1);
        for (let i = 0; i < 3; i++) this.dropCash(bx, bz, randInt(20, 40) * 100);
        g.police.addHeat(3, '搶劫運鈔車');
        g.toast('後門被炸開了！搶走現金！', 'money');
        v.blip = null;
      }
      if (Math.hypot(v.x - g.focus.x, v.z - g.focus.z) > 330) {
        g.removeVehicle(v);
        this.armored = null;
      }
      return;
    }
    if (this.run) return;
    this.armoredT -= dt;
    if (this.armoredT > 0) return;
    this.armoredT = rand(150, 240);
    // spawn on a road near-ish the player
    const v = g.spawnTrafficVehicle('armored', 120, 200);
    if (v) {
      v.ai.cruise = 11;
      v.tag = 'armored';
      v.damageScale = 0.8;
      this.armored = v;
      g.toast('附近有運鈔車經過（雷達 $ 標記）', 'money');
    }
  }

  // ---------------------------------------------------------- start markers
  private updateStartMarkers() {
    const g = this.g;
    const p = g.player;
    const m = this.story[this.progress];
    if (!m) return;
    const s = m.start();
    let mk = this.startMarkers.get('story');
    if (!mk) {
      mk = new Marker(g.scene, 0xfacc15);
      this.startMarkers.set('story', mk);
    }
    if (!mk.active || mk.x !== s.x || mk.z !== s.z) mk.set(s.x, s.z, 1.8);
    mk.update(this.time);
    if (Math.hypot(s.x - p.x, s.z - p.z) < 2 && !p.vehicle && g.police.heat === 0) {
      mk.hide();
      this.startStory();
    }
  }

  startStory() {
    const def = this.story[this.progress];
    if (!def) return;
    this.begin(def);
    this.g.big(def.title, def.brief, '#facc15');
    this.g.cinematic(4);
    this.g.audio.jingle('start');
  }

  startActivity(def: MissionDef) {
    for (const m of this.startMarkers.values()) m.hide();
    this.begin(def);
    this.g.audio.jingle('start');
  }

  private begin(def: MissionDef) {
    const run: MissionRun = { def, steps: [], idx: 0, t: 0, stepT: 0, actors: [], vehicles: [], data: {}, timer: null };
    run.steps = def.steps(run);
    this.run = run;
    this.enterStep();
  }

  private enterStep() {
    const r = this.run!;
    r.stepT = 0;
    const s = r.steps[r.idx];
    this.marker.hide();
    s.enter?.(r);
    this.g.hudObjective(s.obj);
  }

  private updateRun(dt: number) {
    const g = this.g;
    const r = this.run!;
    r.t += dt;
    r.stepT += dt;
    if (r.timer !== null) {
      r.timer -= dt;
      if (r.timer <= 0) {
        this.fail('時間到了');
        return;
      }
    }
    const s = r.steps[r.idx];
    const res = s.update(r, dt);
    if (res === 'next') {
      r.idx++;
      if (r.idx >= r.steps.length) this.complete();
      else this.enterStep();
    } else if (res && typeof res === 'object') this.fail(res.fail);
    void g;
  }

  complete() {
    const g = this.g;
    const r = this.run!;
    this.cleanup(false);
    if (!r.def.activity) {
      this.progress++;
      g.stats.missions = this.progress;
      const mins = Math.floor(r.t / 60);
      const secs = Math.floor(r.t % 60);
      g.big('任務完成', r.def.title, '#facc15', [
        ['獎金', `$${r.def.reward.toLocaleString()}`],
        ['用時', `${mins}:${String(secs).padStart(2, '0')}`],
        ['主線進度', `${this.progress} / ${this.story.length}`],
      ]);
      g.audio.jingle('complete');
      g.addCash(r.def.reward);
      if (this.progress >= this.story.length) {
        setTimeout(() => g.big('索拉港傳奇', '主線完成！繼續探索、收集與挑戰吧。', '#f59e0b'), 4500);
      }
      g.save();
    }
  }

  fail(reason: string) {
    const g = this.g;
    const r = this.run;
    if (!r) return;
    this.cleanup(true);
    g.big(r.def.activity ? '挑戰失敗' : '任務失敗', reason, '#ef4444');
    g.audio.jingle('fail');
  }

  /** Cancel silently (e.g. on death we call fail()). */
  cleanup(failed: boolean) {
    const g = this.g;
    const r = this.run;
    if (!r) return;
    this.marker.hide();
    for (const a of r.actors) if (g.actors.includes(a) && a !== g.player) {
      a.tag = '';
      a.blip = null;
      if (failed && a.team === 'enemy' && !a.dead) a.ai.aggro = true;
    }
    for (const v of r.vehicles) {
      v.tag = v.tag === 'armored' ? v.tag : '';
      v.blip = null;
    }
    g.hudObjective(null);
    g.hud({ timer: null, missionTitle: null });
    this.run = null;
  }

  /** Blips for the minimap / big map. */
  blips(out: Blip[]) {
    out.length = 0;
    const iconFor: Record<string, [string, string]> = {
      safehouse: ['⌂', '#4ade80'],
      garage: ['G', '#fb923c'],
      ammu: ['槍', '#fbbf24'],
      hospital: ['+', '#f87171'],
      police: ['警', '#60a5fa'],
      courier: ['遞', '#38bdf8'],
      store: ['$', '#34d399'],
    };
    for (const p of POIS) {
      const [icon, color] = iconFor[p.kind];
      out.push({ x: p.dx ?? p.x, z: p.dz ?? p.z, icon, color, label: p.name });
    }
    if (!this.run) {
      const m = this.story[this.progress];
      if (m) {
        const s = m.start();
        out.push({ x: s.x, z: s.z, icon: '★', color: '#facc15', label: m.title, big: true });
      }
      for (const r of RACES) out.push({ x: r.start[0], z: r.start[1], icon: '⚑', color: '#e879f9', label: r.name });
    }
    RAMPS.forEach((r, i) => {
      if (!this.stunts.has(i)) out.push({ x: r.x, z: r.z, icon: '⤴', color: '#7dd3fc', label: '特技跳台' });
    });
    if (this.marker.active) out.push({ x: this.marker.x, z: this.marker.z, icon: '●', color: '#facc15', route: true, big: true });
    if (this.waypoint && !this.marker.active) out.push({ x: this.waypoint.x, z: this.waypoint.z, icon: '◆', color: '#c084fc', route: true });
  }
}

// ======================================================================
// helpers for mission scripts
// ======================================================================
function gotoStep(g: Game, m: Missions, obj: string, x: number, z: number, r: number, opts: { vehicle?: () => Vehicle | null; onFoot?: boolean } = {}): Step {
  return {
    obj,
    enter: () => m.marker.set(x, z, r),
    update: () => {
      const p = g.player;
      const px = p.vehicle?.x ?? p.x;
      const pz = p.vehicle?.z ?? p.z;
      if (opts.vehicle) {
        const v = opts.vehicle();
        if (!v || v.destroyed) return { fail: '目標車輛被摧毀了' };
        if (p.vehicle !== v) {
          g.hudObjective(`回到【${v.spec.name}】`);
          m.marker.hide();
          return;
        }
        if (!m.marker.active) {
          m.marker.set(x, z, r);
          g.hudObjective(obj);
        }
      }
      if (opts.onFoot && p.vehicle) return;
      if (Math.hypot(px - x, pz - z) < r + 1) return 'next';
    },
  };
}

function spawnEnemies(g: Game, run: MissionRun, pts: [number, number][], weapons: WeaponId[], team: 'enemy' | 'gang' = 'enemy', accuracy = 0.32) {
  const out: Actor[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const a = g.spawnActor(team, gangOutfit(), x, z);
    a.setWeapon(weapons[i % weapons.length]);
    a.ai.aggro = true;
    a.ai.accuracy = accuracy;
    a.tag = 'mission';
    a.blip = 'enemy';
    a.hp = a.maxHp = 90;
    a.bounty = 150;
    run.actors.push(a);
    out.push(a);
  }
  return out;
}

function killAllStep(g: Game, obj: string, group: () => Actor[]): Step {
  return {
    obj,
    update: () => {
      const alive = group().filter((a) => !a.dead).length;
      g.hudObjective(`${obj}（剩餘 ${alive}）`);
      if (alive === 0) return 'next';
    },
  };
}

function loseHeatStep(g: Game, m: Missions): Step {
  return {
    obj: '甩掉警察',
    enter: () => m.marker.hide(),
    update: () => {
      if (g.police.heat === 0) return 'next';
    },
  };
}

function waitStep(seconds: number, obj: string, onEnter?: () => void): Step {
  return {
    obj,
    enter: onEnter,
    update: (r) => (r.stepT >= seconds ? 'next' : undefined),
  };
}

// ======================================================================
// Story missions
// ======================================================================
function buildStory(g: Game, m: Missions): MissionDef[] {
  const gar = poi('garage');
  const safe = poi('safehouse');
  return [
    {
      id: 'm1',
      title: '第一章 · 重返索拉港',
      brief: '十年後回到故鄉，老韓在修車廠等你。',
      reward: 1500,
      start: () => ({ x: safe.x + 3, z: safe.z - 6 }),
      steps: (run) => {
        let car: Vehicle | null = null;
        return [
          waitStep(4, '聽老韓說話', () => {
            g.setSubtitle('老韓（電話）：「小子，回來就好。路邊那台星途轎車是我的，開過來修車廠。」', 4);
          }),
          {
            obj: g.input.touch ? '坐上路邊的【星途轎車】（點 [上車]）' : '坐上路邊的【星途轎車】（按 [F]）',
            enter: () => {
              car = g.spawnVehicle('sedan', -230, -86.5, Math.PI / 2, 0x1a5276);
              car.tag = 'mission';
              car.blip = 'ally';
              run.vehicles.push(car);
              m.marker.set(car.x, car.z, 2.6);
            },
            update: () => {
              if (!car || car.destroyed) return { fail: '車子被毀了' };
              m.marker.set(car.x, car.z, 2.6);
              if (g.player.vehicle === car) return 'next';
            },
          },
          gotoStep(g, m, '開車到【老韓修車廠】', gar.dx!, gar.dz!, 4, { vehicle: () => car }),
          waitStep(5, '和老韓聊聊', () => {
            g.setSubtitle('老韓：「車開得還行嘛。最近紫蛇幫在港口一帶囂張得很，我需要你幫忙。休息一下再來找我。」', 5);
          }),
        ];
      },
    },
    {
      id: 'm2',
      title: '第二章 · 討債',
      brief: '紫蛇幫欠老韓一筆修車費，去港口倉庫把錢要回來。',
      reward: 3000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        let foes: Actor[] = [];
        let bag: ReturnType<Missions['addPickup']> | null = null;
        return [
          waitStep(3, '聽老韓交代', () => g.setSubtitle('老韓：「他們躲在港口 3 號倉庫。不給錢？那就讓他們知道痛。」', 3)),
          gotoStep(g, m, '前往【港口 3 號倉庫】', 392, -10, 6),
          {
            obj: '教訓紫蛇幫的小弟',
            enter: () => {
              foes = spawnEnemies(g, run, [
                [404, -24],
                [406, 4],
                [408, 22],
                [404, -8],
                [409, -38],
              ], ['pistol', 'fist', 'pistol', 'smg', 'fist'], 'enemy', 0.28);
              g.setSubtitle('紫蛇幫小弟：「老韓的人？兄弟們，抄傢伙！」', 3);
            },
            update: () => {
              const alive = foes.filter((a) => !a.dead).length;
              g.hudObjective(`教訓紫蛇幫的小弟（剩餘 ${alive}）`);
              if (alive === 0) return 'next';
            },
          },
          {
            obj: '撿起錢袋',
            enter: () => {
              bag = m.addPickup('mbag', 'cash', 406, -4, 1200, undefined, 0, true);
              m.marker.set(406, -4, 1.2);
            },
            update: () => (bag && !m.pickups.includes(bag) ? 'next' : undefined),
          },
          gotoStep(g, m, '把錢帶回【老韓修車廠】', gar.x, gar.z, 3),
        ];
      },
    },
    {
      id: 'm3',
      title: '第三章 · 閃電速遞',
      brief: '有位買家想要一台閃電 GT——從海濱停車場「借」一台來。',
      reward: 5000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        let car: Vehicle | null = null;
        let guards: Actor[] = [];
        return [
          waitStep(3, '聽老韓交代', () => g.setSubtitle('老韓：「海濱商圈有台黃色閃電 GT，車主是紫蛇幫的。車要完整送到港口貨櫃區。」', 3)),
          {
            obj: '找到並偷走黃色【閃電 GT】',
            enter: () => {
              car = g.spawnVehicle('sports', 186, 318, 0, 0xffcc00);
              car.tag = 'mission';
              car.blip = 'target';
              car.locked = false;
              run.vehicles.push(car);
              guards = spawnEnemies(g, run, [
                [190, 312],
                [182, 325],
              ], ['pistol', 'smg'], 'gang', 0.3);
              for (const a of guards) a.ai.aggro = false;
              m.marker.set(car.x, car.z, 3);
            },
            update: () => {
              if (!car || car.destroyed) return { fail: '閃電 GT 被毀了' };
              if (g.player.vehicle === car) {
                for (const a of guards) a.ai.aggro = true;
                g.police.addHeat(2, '車主報警了');
                return 'next';
              }
              if (Math.hypot(g.player.x - car.x, g.player.z - car.z) < 18) for (const a of guards) a.ai.aggro = true;
            },
          },
          {
            obj: '甩掉警察（不要讓車子毀損）',
            update: () => {
              if (!car || car.destroyed) return { fail: '閃電 GT 被毀了' };
              if (g.police.heat === 0) return 'next';
            },
          },
          gotoStep(g, m, '把車送到【港口貨櫃區】', 520, 230, 5, { vehicle: () => car }),
          {
            obj: '下車',
            update: () => {
              if (!car || car.destroyed) return { fail: '閃電 GT 被毀了' };
              if (!g.player.vehicle) {
                const bonus = Math.round((car.hp / car.spec.hp) * 2000);
                if (bonus > 0) g.addCash(bonus, '車況完好獎金');
                car.tag = '';
                return 'next';
              }
            },
          },
        ];
      },
    },
    {
      id: 'm4',
      title: '第四章 · 港口伏擊',
      brief: '紫蛇幫要報復——在港口碼頭擊退他們的三波攻勢。',
      reward: 8000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        const wave = (pts: [number, number][], w: WeaponId[], acc: number) => () => {
          const foes = spawnEnemies(g, run, pts, w, 'enemy', acc);
          run.data.foes = foes;
        };
        const alive = () => (run.data.foes as Actor[]) ?? [];
        return [
          waitStep(3, '聽老韓交代', () => {
            g.setSubtitle('老韓：「他們約在碼頭談判，肯定是陷阱。這把步槍你先拿去。」', 3);
            g.giveWeapon('rifle', 120);
          }),
          gotoStep(g, m, '前往【港口碼頭】', 540, 60, 6),
          {
            obj: '擊退第一波',
            enter: wave(
              [
                [520, 100],
                [530, 30],
                [505, 40],
                [548, 110],
              ],
              ['pistol', 'smg'],
              0.28,
            ),
            update: () => (alive().every((a) => a.dead) ? 'next' : undefined),
          },
          {
            obj: '擊退第二波',
            enter: wave(
              [
                [505, -40],
                [515, -20],
                [500, 150],
                [530, 160],
                [545, -30],
              ],
              ['smg', 'shotgun', 'pistol'],
              0.32,
            ),
            update: () => (alive().every((a) => a.dead) ? 'next' : undefined),
          },
          {
            obj: '擊敗紫蛇幫頭目【蛇眼】與手下',
            enter: () => {
              wave(
                [
                  [490, 60],
                  [495, 80],
                  [500, 40],
                  [480, 20],
                  [485, 100],
                ],
                ['rifle', 'smg', 'shotgun'],
                0.36,
              )();
              const boss = (run.data.foes as Actor[])[0];
              boss.hp = boss.maxHp = 320;
              boss.armor = 80;
              boss.blip = 'target';
              boss.bounty = 2000;
              g.setSubtitle('蛇眼：「老韓找了個外人來送死？很好。」', 3);
            },
            update: () => (alive().every((a) => a.dead) ? 'next' : undefined),
          },
          loseHeatStep(g, m),
        ];
      },
    },
    {
      id: 'm5',
      title: '第五章 · 鐵甲運鈔車',
      brief: '一台載滿黑錢的運鈔車正在市區移動。攔下它。',
      reward: 12000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        let truck: Vehicle | null = null;
        let guards: Actor[] = [];
        const bags: ReturnType<Missions['addPickup']>[] = [];
        return [
          waitStep(3, '聽老韓交代', () => g.setSubtitle('老韓：「紫蛇幫把錢洗進運鈔車。火力不夠？去槍械行買點好東西。」', 3)),
          {
            obj: '追上並破壞【運鈔裝甲車】',
            enter: () => {
              truck = g.spawnTrafficVehicle('armored', 120, 220) ?? g.spawnVehicle('armored', 180, -90, Math.PI / 2);
              truck.tag = 'mission';
              truck.blip = 'target';
              truck.damageScale = 0.7;
              truck.ai.cruise = 13;
              if (truck.ai.kind !== 'traffic') {
                truck.ai.kind = 'traffic';
                truck.crewCount = 2;
                truck.crew = 'enemy';
              }
              run.vehicles.push(truck);
            },
            update: () => {
              if (!truck) return;
              if (truck.hp < truck.spec.hp * 0.4 || truck.destroyed) {
                truck.ai.kind = 'parked';
                truck.crewCount = 0;
                guards = [];
                for (let i = 0; i < 3; i++) {
                  const ep = truck.exitPoint(i % 2 ? 1 : -1);
                  const a = g.spawnActor('enemy', policeOutfit(true), ep.x + i * 0.5, ep.z);
                  a.setWeapon(i === 0 ? 'shotgun' : 'smg');
                  a.ai.aggro = true;
                  a.ai.accuracy = 0.33;
                  a.tag = 'mission';
                  a.blip = 'enemy';
                  run.actors.push(a);
                  guards.push(a);
                }
                g.police.addHeat(3, '襲擊運鈔車');
                return 'next';
              }
              // escape when far
              if (Math.hypot(truck.x - g.focus.x, truck.z - g.focus.z) > 280) return { fail: '運鈔車跑掉了' };
            },
          },
          killAllStep(g, '解決押運警衛', () => guards),
          {
            obj: '搶走錢袋',
            enter: () => {
              const t = truck!;
              for (let i = 0; i < 3; i++) {
                const bx = t.x - Math.sin(t.yaw) * (t.spec.length / 2 + 1.5) + (i - 1) * 1.2;
                const bz = t.z - Math.cos(t.yaw) * (t.spec.length / 2 + 1.5);
                bags.push(m.addPickup(`mb${i}`, 'cash', bx, bz, 2000, undefined, 0, true));
              }
              m.marker.set(bags[0].x, bags[0].z, 1.5);
            },
            update: () => (bags.every((b) => !m.pickups.includes(b)) ? 'next' : undefined),
          },
          loseHeatStep(g, m),
          gotoStep(g, m, '回到【老韓修車廠】', gar.x, gar.z, 3),
        ];
      },
    },
    {
      id: 'm6',
      title: '最終章 · 太陽海岸大劫案',
      brief: '紫蛇幫的全部身家都存在太陽海岸聯合銀行。最後一票。',
      reward: 50000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        let escape: Vehicle | null = null;
        return [
          waitStep(4, '聽老韓交代', () => {
            g.setSubtitle('老韓：「金庫要 45 秒才能破解，警察一定會來。撐住，然後開車逃上山，我在天文台等你。」', 4);
            g.giveWeapon('rifle', 180);
            g.player.armor = 100;
          }),
          gotoStep(g, m, '前往【太陽海岸聯合銀行】', -45, -84, 4),
          {
            obj: '守住銀行門口，直到金庫被破解',
            enter: () => {
              run.timer = null;
              run.data.hold = 45;
              g.police.addHeat(3, '銀行警報響起');
              m.marker.set(-45, -84, 10);
            },
            update: (r, dt) => {
              const p = g.player;
              const inZone = Math.hypot(p.x + 45, p.z + 84) < 12;
              if (inZone) r.data.hold = (r.data.hold as number) - dt;
              const left = Math.max(0, r.data.hold as number);
              g.hudObjective(inZone ? `守住銀行門口：金庫破解中 ${Math.ceil(left)} 秒` : '回到銀行門口！');
              if (left <= 0) return 'next';
            },
          },
          {
            obj: '坐上逃亡車輛',
            enter: () => {
              g.police.addHeat(4, '金庫被攻破');
              escape = g.spawnVehicle('muscle', -20, -88, Math.PI / 2, 0x111111);
              escape.tag = 'mission';
              escape.blip = 'ally';
              escape.damageScale = 0.6;
              run.vehicles.push(escape);
              m.marker.set(escape.x, escape.z, 3);
              g.setSubtitle('老韓：「錢到手了！巷口有台野牛，快上車！」', 3);
            },
            update: () => {
              if (!escape || escape.destroyed) return { fail: '逃亡車被毀了' };
              m.marker.set(escape.x, escape.z, 3);
              if (g.player.vehicle === escape) return 'next';
            },
          },
          loseHeatStep(g, m),
          gotoStep(g, m, '開到【雲杉天文台】和老韓會合', 30, -640, 6),
          waitStep(6, '……', () => {
            g.setSubtitle('老韓：「你做到了，小子……不過紫蛇幫真正的老大『白蟒』還在外頭。休息一下，再來找我。」', 6);
          }),
        ];
      },
    },
    {
      id: 'm7',
      title: '第七章 · 沙漠交易',
      brief: '白蟒的人在塵水沙漠的紅岩台地交易軍火。去攪局，把貨搶過來。',
      reward: 15000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        let crate: ReturnType<Missions['addPickup']> | null = null;
        let foes: Actor[] = [];
        return [
          waitStep(3, '聽老韓交代', () => g.setSubtitle('老韓：「沿著環島公路往西，過了塵水鎮就是紅岩台地。他們人多，帶點重火力。」', 3)),
          gotoStep(g, m, '前往【塵水沙漠 · 紅岩台地】', -1060, -430, 12),
          {
            obj: '擊潰交易現場的紫蛇幫',
            enter: () => {
              const van = g.spawnVehicle('van', -1048, -442, 0.6, 0x1c2128);
              van.tag = 'mission';
              run.vehicles.push(van);
              const pick = g.spawnVehicle('pickup', -1072, -418, 2.2, 0x7b241c);
              pick.tag = 'mission';
              run.vehicles.push(pick);
              foes = spawnEnemies(
                g,
                run,
                [
                  [-1040, -450],
                  [-1055, -455],
                  [-1035, -425],
                  [-1078, -430],
                  [-1066, -404],
                  [-1050, -400],
                  [-1085, -448],
                ],
                ['rifle', 'smg', 'shotgun', 'smg'],
                'enemy',
                0.34,
              );
              g.setSubtitle('紫蛇幫：「是條子嗎？不管了，開火！」', 3);
            },
            update: () => {
              const alive = foes.filter((a) => !a.dead).length;
              g.hudObjective(`擊潰交易現場的紫蛇幫（剩餘 ${alive}）`);
              if (alive === 0) return 'next';
            },
          },
          {
            obj: '搶走軍火箱',
            enter: () => {
              crate = m.addPickup('mcrate', 'weapon', -1052, -432, 6, 'rpg', 0, true);
              m.marker.set(-1052, -432, 1.5);
            },
            update: () => (crate && !m.pickups.includes(crate) ? 'next' : undefined),
          },
          gotoStep(g, m, '把軍火送到【塵水鎮】老韓的朋友手上', -1250, -100, 12),
          waitStep(4, '……', () => g.setSubtitle('老韓（電話）：「幹得好。白蟒急了，他打算從機場坐直升機溜走。」', 4)),
        ];
      },
    },
    {
      id: 'm8',
      title: '第八章 · 機場劫機',
      brief: '白蟒準備搭直升機逃出索拉港。先一步搶走他的直升機。',
      reward: 20000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        let heli: Vehicle | null = null;
        let guards: Actor[] = [];
        return [
          waitStep(3, '聽老韓交代', () => g.setSubtitle('老韓：「直升機停在國際機場的東側停機坪，有人看守。搶到手就飛去鏡湖，我在山莊等你。」', 4)),
          gotoStep(g, m, '前往【索拉國際機場 · 東側停機坪】', -700, 800, 14),
          {
            obj: '解決看守，搶下直升機',
            enter: () => {
              heli = g.spawnVehicle('heli', -690, 815, -Math.PI / 2, 0x111111);
              heli.tag = 'mission';
              heli.blip = 'target';
              run.vehicles.push(heli);
              guards = spawnEnemies(
                g,
                run,
                [
                  [-680, 800],
                  [-700, 830],
                  [-675, 828],
                  [-712, 806],
                  [-665, 812],
                ],
                ['rifle', 'smg'],
                'enemy',
                0.33,
              );
              m.marker.set(-690, 815, 4);
            },
            update: () => {
              if (!heli || heli.destroyed) return { fail: '直升機被毀了' };
              const alive = guards.filter((a) => !a.dead).length;
              g.hudObjective(alive ? `解決看守（剩餘 ${alive}），搶下直升機` : (g.input.touch ? '坐上直升機（點 [上車]）' : '坐上直升機（按 [F]）'));
              if (g.player.vehicle === heli) {
                g.police.addHeat(3, '機場保全報警');
                return 'next';
              }
            },
          },
          {
            obj: '飛到【鏡湖山莊】並降落',
            enter: () => m.marker.set(560, -1000, 14),
            update: () => {
              if (!heli || heli.destroyed) return { fail: '直升機墜毀了' };
              if (g.player.vehicle !== heli) {
                g.hudObjective('回到直升機上');
                return;
              }
              const d = Math.hypot(heli.x - 560, heli.z + 1000);
              g.hudObjective(d < 40 ? (g.input.touch ? '降落在山莊旁（按住 [下降]）' : '降落在山莊旁（按住 [Shift] 下降）') : '飛到【鏡湖山莊】並降落');
              if (d < 30 && !heli.airborne && heli.speed < 3) return 'next';
            },
          },
          loseHeatStep(g, m),
          waitStep(4, '……', () => g.setSubtitle('老韓：「沒了直升機，白蟒只能開車沿北嶺公路逃。這次別讓他跑了。」', 4)),
        ];
      },
    },
    {
      id: 'm9',
      title: '最終章 · 北嶺追擊',
      brief: '白蟒開著跑車沿北嶺公路逃亡。攔下他，結束這一切。',
      reward: 30000,
      start: () => ({ x: gar.x - 2, z: gar.z + 4 }),
      steps: (run) => {
        let target: Vehicle | null = null;
        let boss: Actor | null = null;
        let loot: ReturnType<Missions['addPickup']> | null = null;
        return [
          waitStep(3, '聽老韓交代', () => g.setSubtitle('老韓：「他從北邊的環島公路跑。開台快車，或者……那架直升機也不錯。」', 4)),
          gotoStep(g, m, '前往【北嶺 · 環島公路】', -750, -1450, 16),
          {
            obj: '追上並破壞白蟒的跑車',
            enter: () => {
              // spawn around the player: the camera focus may still be at the previous position this frame
              target = g.spawnTrafficVehicle('sports', 70, 170, g.player.x, g.player.z) ?? g.spawnVehicle('sports', -620, -1500, Math.PI / 2, 0xf4f6f7);
              target.repaint(0xf4f6f7);
              target.tag = 'mission';
              target.blip = 'target';
              target.damageScale = 0.65;
              target.crew = 'enemy';
              target.crewCount = 1;
              if (target.ai.kind !== 'traffic') target.ai.kind = 'traffic';
              target.ai.pers = 1.35;
              target.ai.cruise = 30;
              run.vehicles.push(target);
              g.setSubtitle('白蟒（無線電）：「想追我？你們這些鄉下人追不上的！」', 3);
            },
            update: () => {
              const t = target!;
              t.ai.cruise = Math.max(t.ai.cruise, 28);
              if (t.hp < t.spec.hp * 0.3 || t.destroyed) {
                t.ai.kind = 'parked';
                t.crewCount = 0;
                const ep = t.exitPoint(1);
                boss = g.spawnActor('enemy', { skin: 0xf1c27d, shirt: 0xf4f6f7, pants: 0xf4f6f7, shoes: 0x111111, hair: 0xeeeeee, hairStyle: 'short', jacket: 0xf4f6f7, glasses: true, chain: true, watch: true, build: 1.1 }, ep.x, ep.z);
                boss.setWeapon('rifle');
                boss.ai.aggro = true;
                boss.ai.accuracy = 0.4;
                boss.hp = boss.maxHp = 380;
                boss.armor = 100;
                boss.tag = 'mission';
                boss.blip = 'target';
                run.actors.push(boss);
                g.setSubtitle('白蟒：「好啊，那就在這裡做個了斷！」', 3);
                return 'next';
              }
              if (run.stepT > 2 && Math.hypot(t.x - g.player.x, t.z - g.player.z) > 450) return { fail: '白蟒逃走了' };
            },
          },
          {
            obj: '擊倒白蟒',
            update: () => (boss && boss.dead ? 'next' : undefined),
          },
          {
            obj: '拿走白蟒的帳本',
            enter: () => {
              const b = boss!;
              loot = m.addPickup('mledger', 'cash', b.x + 1, b.z + 1, 10000, undefined, 0, true);
              m.marker.set(loot.x, loot.z, 1.5);
            },
            update: () => (loot && !m.pickups.includes(loot) ? 'next' : undefined),
          },
          waitStep(6, '……', () => g.setSubtitle('老韓（電話）：「紫蛇幫完了。索拉港——現在真的是你的了，小子。」', 6)),
        ];
      },
    },
  ];
}

// ======================================================================
// Activities
// ======================================================================
function raceActivity(g: Game, m: Missions, race: RaceDef): MissionDef {
  return {
    id: race.id,
    title: race.name,
    brief: '',
    reward: race.reward,
    activity: true,
    start: () => ({ x: race.start[0], z: race.start[1] }),
    steps: (run) => {
      let cp = 0;
      let t0 = 0;
      const car = () => g.player.vehicle;
      return [
        {
          obj: '準備……',
          enter: () => {
            const v = car();
            if (v) {
              v.x = race.start[0];
              v.z = race.start[1];
              v.yaw = race.start[2];
              v.vx = v.vz = 0;
              v.yawRate = 0;
            }
            g.hud({ missionTitle: race.name });
          },
          update: (r) => {
            const v = car();
            if (v) {
              v.vx = v.vz = 0;
              v.x = race.start[0];
              v.z = race.start[1];
            }
            const n = 3 - Math.floor(r.stepT);
            g.setStuntText(n > 0 ? String(n) : 'GO!');
            if (r.stepT >= 3) {
              t0 = run.t;
              g.audio.jingle('checkpoint');
              return 'next';
            }
            if (Math.floor(r.stepT) !== Math.floor(r.stepT - 1 / 60)) g.audio.ui('select');
          },
        },
        {
          obj: '通過所有檢查點',
          enter: () => {
            const [x, z] = race.cps[0];
            m.marker.set(x, z, 6);
            setTimeout(() => g.setStuntText(null), 700);
          },
          update: () => {
            const v = car();
            if (!v) return { fail: '你離開了車輛' };
            if (v.destroyed) return { fail: '車輛損毀' };
            const el = run.t - t0;
            g.hud({ timer: el });
            g.hudObjective(`檢查點 ${cp + 1} / ${race.cps.length}`);
            const [x, z] = race.cps[cp];
            if (Math.hypot(v.x - x, v.z - z) < 8) {
              cp++;
              g.audio.jingle('checkpoint');
              if (cp >= race.cps.length) {
                const best = m.raceBest[race.id];
                const medal = el <= race.gold ? '金牌' : el <= race.silver ? '銀牌' : el <= race.bronze ? '銅牌' : '完賽';
                const first = !best || best > race.bronze;
                if (!best || el < best) m.raceBest[race.id] = el;
                const pay = medal === '金牌' ? race.reward : medal === '銀牌' ? race.reward * 0.6 : medal === '銅牌' ? race.reward * 0.35 : 200;
                g.big(`${race.name} · ${medal}`, `成績 ${el.toFixed(2)} 秒　(金 ${race.gold}s / 銀 ${race.silver}s / 銅 ${race.bronze}s)　+$${Math.round(pay)}`, medal === '金牌' ? '#facc15' : '#e5e7eb');
                g.addCash(Math.round(pay));
                g.audio.jingle('complete');
                void first;
                g.save();
                return 'next';
              }
              const [nx, nz] = race.cps[cp];
              m.marker.set(nx, nz, 6);
            }
          },
        },
      ];
    },
  };
}

function courierJob(g: Game, m: Missions): MissionDef {
  const depot = poi('courier');
  return {
    id: 'courier',
    title: '快鴿速遞',
    brief: '',
    reward: 0,
    activity: true,
    start: () => ({ x: depot.x, z: depot.z }),
    steps: (run) => {
      let van: Vehicle | null = null;
      let n = 0;
      const total = 4;
      const steps: Step[] = [
        {
          obj: '坐上快遞廂型車',
          enter: () => {
            van = g.spawnVehicle('van', depot.dx!, depot.dz!, 0, 0x2e86c1);
            van.tag = 'mission';
            van.blip = 'ally';
            run.vehicles.push(van);
            m.marker.set(van.x, van.z, 3);
            g.hud({ missionTitle: '快鴿速遞 · 外送' });
          },
          update: () => {
            if (!van || van.destroyed) return { fail: '貨車被毀了' };
            if (g.player.vehicle === van) return 'next';
          },
        },
      ];
      for (let i = 0; i < total; i++) {
        steps.push({
          obj: '',
          enter: (r) => {
            let pt = randomSidewalkPoint();
            for (let k = 0; k < 20; k++) {
              const d = Math.hypot(pt.x - g.player.x, pt.z - g.player.z);
              if (d > 160 && d < 420) break;
              pt = randomSidewalkPoint();
            }
            r.data.pt = pt;
            const d = Math.hypot(pt.x - g.player.x, pt.z - g.player.z);
            r.timer = 20 + d / 9;
            m.marker.set(pt.x, pt.z, 4);
            g.hudObjective(`把包裹送到目的地（${i + 1}/${total}）`);
          },
          update: (r) => {
            if (!van || van.destroyed) return { fail: '貨車被毀了' };
            const pt = r.data.pt as { x: number; z: number };
            g.hud({ timer: r.timer });
            if (g.player.vehicle !== van) {
              g.hudObjective('回到廂型車上');
              return;
            }
            g.hudObjective(`把包裹送到目的地（${i + 1}/${total}）`);
            if (Math.hypot(van.x - pt.x, van.z - pt.z) < 6 && van.speed < 4) {
              const tip = Math.round(clamp(r.timer ?? 0, 0, 60) * 15);
              n++;
              g.addCash(400 + tip, `外送完成 +小費 $${tip}`);
              g.audio.jingle('checkpoint');
              r.timer = null;
              return 'next';
            }
          },
        });
      }
      steps.push(
        waitStep(0.1, '', () => {
          g.big('外送工作完成', `完成 ${n} 件包裹　獎金 +$1,000`, '#38bdf8');
          g.addCash(1000);
        }),
      );
      return steps;
    },
  };
}


