/** Heat (wanted) level, police dispatch, evasion and the police helicopter. */
import * as THREE from 'three';
import { clamp, damp, lerp, pick, rand } from '../core/math';
import type { Actor } from '../entities/actor';
import { policeOutfit } from '../entities/character';
import type { Vehicle } from '../entities/vehicle';
import { groundHeight, nearestNode, ROAD_NODES } from '../world/layout';
import type { Game } from '../Game';

interface Heli {
  root: THREE.Group;
  rotor: THREE.Object3D;
  tail: THREE.Object3D;
  light: THREE.SpotLight;
  beam: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  angle: number;
  fireCd: number;
  crashing: boolean;
  vy: number;
  gunner: Actor;
}

export class Police {
  heat = 0;
  searching = false;
  lastSeenX = 0;
  lastSeenZ = 0;
  unseenT = 0;
  private seenThisFrame = false;
  private dispatchT = 0;
  heli: Heli | null = null;
  private heliCooldown = 0;
  searchRadius = 0;

  /** Created once so that the light count never changes (avoids shader recompiles). */
  private spot: THREE.SpotLight;

  constructor(private g: Game) {
    this.spot = new THREE.SpotLight(0xf0f4ff, 0, 140, 0.22, 0.5, 1.2);
    g.scene.add(this.spot, this.spot.target);
  }

  /** Raise heat to at least `level` (or add 1 if `add`). */
  addHeat(level: number, reason?: string, add = false) {
    const prev = this.heat;
    const target = add ? Math.min(5, this.heat + 1) : Math.max(this.heat, level);
    this.heat = clamp(target, 0, 5);
    if (this.heat > prev) {
      this.g.audio.jingle('heat');
      if (reason) this.g.toast(`${reason}　通緝 ${'★'.repeat(this.heat)}`, 'heat');
      this.reportSeen();
      this.dispatchT = Math.min(this.dispatchT, 1.5);
    }
  }

  clear(silent = false) {
    if (this.heat > 0 && !silent) {
      this.g.toast('成功甩掉警方！', 'good');
      this.g.audio.jingle('checkpoint');
    }
    this.heat = 0;
    this.searching = false;
    for (const a of this.g.actors) {
      if (a.team === 'police') {
        a.ai.aggro = false;
        a.ai.mode = 'idle';
        a.ai.timer = 5;
      }
    }
    for (const v of this.g.vehicles) if (v.ai.kind === 'police') {
      v.siren = false;
      v.ai.kind = 'traffic';
      v.ai.wps = [];
      if (v.crewCount === 0) v.ai.kind = 'parked';
      else this.toTraffic(v);
    }
    this.removeHeli(false);
  }

  private toTraffic(v: Vehicle) {
    const n = nearestNode(v.x, v.z);
    v.ai.kind = 'traffic';
    v.ai.fromNode = n.id;
    v.ai.toNode = pick(n.links);
    const b = ROAD_NODES[v.ai.toNode];
    v.ai.wps = [{ x: b.x, z: b.z }];
    v.ai.wp = 0;
  }

  reportSeen() {
    this.seenThisFrame = true;
  }

  update(dt: number) {
    const g = this.g;
    const p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x;
    const pz = p.vehicle ? p.vehicle.z : p.z;
    // police cars' crews also spot the player
    if (this.heat > 0) {
      for (const v of g.vehicles) {
        if (v.ai.kind !== 'police' || v.crewCount === 0) continue;
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d < 70 && g.combat.los(v.x, v.y + 1.5, v.z, px, (p.vehicle?.y ?? p.y) + 1.2, pz)) this.seenThisFrame = true;
      }
      if (this.heli && !this.heli.crashing && Math.hypot(this.heli.x - px, this.heli.z - pz) < 90) this.seenThisFrame = true;
    }

    if (this.heat > 0) {
      if (this.seenThisFrame) {
        this.lastSeenX = px;
        this.lastSeenZ = pz;
        this.unseenT = 0;
        this.searching = false;
      } else {
        this.unseenT += dt;
        if (this.unseenT > 2.5) this.searching = true;
      }
      this.searchRadius = 45 + this.heat * 28;
      const outside = Math.hypot(px - this.lastSeenX, pz - this.lastSeenZ) > this.searchRadius;
      const need = 5 + this.heat * 2.5;
      if (this.searching && outside && this.unseenT > need) this.clear();
      else if (this.searching && this.unseenT > need * 3.5) this.clear();

      // dispatch
      this.dispatchT -= dt;
      if (this.dispatchT <= 0) {
        this.dispatchT = 4;
        this.dispatch();
      }
      // helicopter at 3+
      this.heliCooldown -= dt;
      if (this.heat >= 3 && !this.heli && this.heliCooldown <= 0) this.spawnHeli();
    }
    this.seenThisFrame = false;

    // drive police cars
    for (const v of [...g.vehicles]) {
      if (v.ai.kind !== 'police') continue;
      if (v.destroyed || v.crewCount === 0) {
        v.siren = v.siren && !v.destroyed;
        v.input = { throttle: 0, steer: 0, handbrake: true };
        if (Math.hypot(v.x - g.focus.x, v.z - g.focus.z) > 260 && !v.tag) g.removeVehicle(v);
        continue;
      }
      const d = Math.hypot(v.x - px, v.z - pz);
      if (this.heat === 0) continue;
      v.siren = true;
      const playerDriving = !!p.vehicle && p.vehicle.speed > 4;
      if (!playerDriving && d < 22) {
        // stop and bail out
        v.input = { throttle: -1, steer: 0, handbrake: v.speed < 3 };
        if (v.speed < 2.5) this.bailOut(v);
      } else {
        g.traffic.driveTo(v, px, pz, dt, { speed: v.spec.maxSpeed * (playerDriving ? 0.92 : 0.6), ram: playerDriving, stopDist: playerDriving ? 0 : 14 });
      }
      if (d > 320) g.removeVehicle(v);
    }

    this.updateHeli(dt);
  }

  private dispatch() {
    const g = this.g;
    const wantCars = [0, 1, 2, 3, 4, 5][this.heat];
    let cars = 0;
    let cops = 0;
    for (const v of g.vehicles) if (v.ai.kind === 'police' && !v.destroyed && v.crewCount > 0) cars++;
    for (const a of g.actors) if (a.team === 'police' && !a.dead) cops++;
    if (cops > 4 + this.heat * 3) return;
    if (cars >= wantCars) return;
    // spawn at a road node 110-200m from the last known position, out of sight
    const cands = ROAD_NODES.filter((n) => {
      const d = Math.hypot(n.x - this.lastSeenX, n.z - this.lastSeenZ);
      return d > 110 && d < 220;
    });
    if (!cands.length) {
      // outside the city: spawn behind the player on the closest node anyway
      const n = nearestNode(this.lastSeenX, this.lastSeenZ);
      cands.push(n);
    }
    const n = pick(cands);
    const swat = this.heat >= 4 && Math.random() < 0.5;
    const v = g.spawnVehicle(swat ? 'van' : 'police', n.x + rand(-3, 3), n.z + rand(-3, 3), Math.atan2(this.lastSeenX - n.x, this.lastSeenZ - n.z), swat ? 0x1c2128 : undefined);
    v.ai.kind = 'police';
    v.siren = true;
    v.crew = 'police';
    v.crewCount = swat ? 4 : 2;
    v.tag = '';
    v.headlightsOn = g.env.night > 0.4;
    (v as Vehicle & { swat?: boolean }).swat = swat;
  }

  bailOut(v: Vehicle) {
    const g = this.g;
    const swat = (v as Vehicle & { swat?: boolean }).swat;
    for (let i = 0; i < v.crewCount; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const ep = v.exitPoint(side);
      const a = g.spawnActor('police', policeOutfit(!!swat), ep.x + rand(-0.5, 0.5), ep.z + rand(-0.5, 0.5));
      a.setWeapon(swat || this.heat >= 4 ? 'rifle' : this.heat >= 3 ? pick(['smg', 'pistol', 'shotgun'] as const) : 'pistol');
      a.ai.aggro = true;
      a.ai.accuracy = swat ? 0.5 : 0.36;
      a.hp = a.maxHp = swat ? 160 : 110;
      a.armor = swat ? 60 : 20;
    }
    v.crewCount = 0;
    v.ai.kind = 'police';
  }

  // ---------------------------------------------------------------- helicopter
  private spawnHeli() {
    const g = this.g;
    const root = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f3a5f, metalness: 0.5, roughness: 0.4 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f7, metalness: 0.4, roughness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1b2633, metalness: 0.9, roughness: 0.05 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12).scale(1, 0.9, 1.7), bodyMat);
    const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.42, 16, 12, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.12).scale(1, 0.9, 1.7), whiteMat);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1.2), glass);
    canopy.position.set(0, 0.2, 1.1);
    canopy.rotation.x = 0.5;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 5, 8).rotateX(Math.PI / 2), bodyMat);
    tail.position.set(0, 0.3, -4);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.8), bodyMat);
    fin.position.set(0, 0.9, -6.3);
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.15), whiteMat);
    tailRotor.position.set(0.15, 0.9, -6.3);
    const rotor = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 9), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      b.rotation.y = (k * Math.PI) / 2;
      rotor.add(b);
    }
    rotor.position.y = 1.5;
    const skid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 3), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    skid.position.y = -1.3;
    root.add(body, stripe, canopy, tail, fin, tailRotor, rotor, skid);
    root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    const light = this.spot;
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(7, 40, 20, 1, true).translate(0, -20, 0),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    root.add(beam);
    g.scene.add(root);
    const p = g.player;
    const a = Math.random() * Math.PI * 2;
    const gunner = g.spawnActor('police', policeOutfit(true), p.x, p.z);
    gunner.rig.root.visible = false;
    gunner.setWeapon('rifle');
    gunner.ai.accuracy = 0.35;
    gunner.tag = 'heli';
    gunner.invuln = 1e9;
    this.heli = {
      root,
      rotor,
      tail: tailRotor,
      light,
      beam,
      x: p.x + Math.sin(a) * 180,
      y: 60,
      z: p.z + Math.cos(a) * 180,
      yaw: 0,
      hp: 1400,
      angle: a,
      fireCd: 3,
      crashing: false,
      vy: 0,
      gunner,
    };
    g.toast('警用直升機已出動！', 'heat');
  }

  heliHit(x: number, y: number, z: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number) {
    const h = this.heli;
    if (!h || h.crashing) return -1;
    // sphere test
    const lx = h.x - ox;
    const ly = h.y - oy;
    const lz = h.z - oz;
    const t = lx * dx + ly * dy + lz * dz;
    if (t < 0 || t > maxT) return -1;
    const d2 = lx * lx + ly * ly + lz * lz - t * t;
    void x;
    void y;
    void z;
    return d2 < 2.4 * 2.4 ? t : -1;
  }

  damageHeli(dmg: number) {
    const h = this.heli;
    if (!h || h.crashing) return;
    h.hp -= dmg;
    if (h.hp <= 0) {
      h.crashing = true;
      h.vy = 0;
      this.g.toast('擊落警用直升機！', 'good');
      this.g.addCash(1500, '擊落直升機');
      this.g.stats.kills++;
    }
  }

  private updateHeli(dt: number) {
    const h = this.heli;
    if (!h) return;
    const g = this.g;
    const p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x;
    const pz = p.vehicle ? p.vehicle.z : p.z;
    h.rotor.rotation.y += dt * 28;
    h.tail.rotation.x += dt * 40;
    if (h.crashing) {
      h.vy -= 12 * dt;
      h.y += h.vy * dt;
      h.yaw += dt * 4;
      h.x += Math.sin(h.yaw) * 6 * dt;
      h.z += Math.cos(h.yaw) * 6 * dt;
      if (Math.random() < 0.8) g.fx.smokePuff(h.x, h.y, h.z, 1, 1.5);
      g.fx.fire(h.x, h.y, h.z, 1.5);
      if (h.y <= groundHeight(h.x, h.z) + 1) {
        g.combat.explode(h.x, h.y, h.z, 12, 500, g.player);
        this.removeHeli(true);
        this.heliCooldown = 40;
      }
    } else {
      if (this.heat === 0) {
        // fly away
        h.y += dt * 8;
        h.x += Math.sin(h.yaw) * 20 * dt;
        h.z += Math.cos(h.yaw) * 20 * dt;
        if (h.y > 150) this.removeHeli(true);
      } else {
        h.angle += dt * 0.25;
        const R = 34;
        const tx = (this.searching ? this.lastSeenX : px) + Math.sin(h.angle) * R;
        const tz = (this.searching ? this.lastSeenZ : pz) + Math.cos(h.angle) * R;
        const ty = Math.max(groundHeight(px, pz) + 32, 38);
        const k = damp(0.7, dt);
        const ox = h.x;
        const oz = h.z;
        h.x = lerp(h.x, tx, k);
        h.z = lerp(h.z, tz, k);
        h.y = lerp(h.y, ty, k);
        // face the player
        h.yaw = Math.atan2(px - h.x, pz - h.z);
        const vel = Math.hypot(h.x - ox, h.z - oz) / Math.max(dt, 1e-3);
        h.root.rotation.x = clamp(vel * 0.01, 0, 0.25);
        // gunner fire
        h.fireCd -= dt;
        const d = Math.hypot(px - h.x, pz - h.z, (p.vehicle?.y ?? p.y) - h.y);
        if (h.fireCd <= 0 && !this.searching && d < 90) {
          h.fireCd = rand(0.12, 0.2);
          if (Math.random() < 0.08) h.fireCd = rand(1.5, 2.8);
          h.gunner.x = h.x;
          h.gunner.y = h.y - 2.6;
          h.gunner.z = h.z;
          g.npcs.npcShoot(h.gunner, px, (p.vehicle?.y ?? p.y) + 1.1, pz, d * 0.8);
        }
      }
    }
    h.root.position.set(h.x, h.y, h.z);
    h.root.rotation.y = h.yaw;
    const night = g.env.night;
    h.light.intensity = h.crashing ? 0 : night * 900;
    (h.beam.material as THREE.MeshBasicMaterial).opacity = h.crashing ? 0 : 0.06 * night;
    // spotlight sweeps around the player / search area
    const sx = this.searching ? this.lastSeenX + Math.sin(performance.now() / 900) * this.searchRadius * 0.5 : px;
    const sz = this.searching ? this.lastSeenZ + Math.cos(performance.now() / 1100) * this.searchRadius * 0.5 : pz;
    h.light.position.set(h.x, h.y - 1.5, h.z);
    h.light.target.position.set(sx, groundHeight(sx, sz), sz);
    const bdx = sx - h.x;
    const bdz = sz - h.z;
    const bdy = groundHeight(sx, sz) - h.y;
    const bl = Math.hypot(bdx, bdy, bdz);
    h.beam.scale.set(1, bl / 40, 1);
    h.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(bdx, bdy, bdz).normalize());
    h.beam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h.yaw));
  }

  removeHeli(silent: boolean) {
    const h = this.heli;
    if (!h) return;
    this.spot.intensity = 0;
    this.g.scene.remove(h.root);
    h.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
    this.g.removeActor(h.gunner);
    this.heli = null;
    void silent;
  }
}
