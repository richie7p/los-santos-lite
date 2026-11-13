/** Hitscan weapons, projectiles, explosions and damage application. */
import * as THREE from 'three';
import { rayOBB, raySphere } from '../core/collision';
import { clamp, rand } from '../core/math';
import { WEAPONS, type WeaponId } from '../data';
import type { Actor } from '../entities/actor';
import type { Vehicle } from '../entities/vehicle';
import { SEA_LEVEL, groundHeight } from '../world/layout';
import type { Game } from '../Game';

export interface ShotResult {
  x: number;
  y: number;
  z: number;
  dist: number;
  actor: Actor | null;
  vehicle: Vehicle | null;
  head: boolean;
  nx: number;
  ny: number;
  nz: number;
  surface: 'concrete' | 'metal' | 'flesh' | 'dirt' | 'water' | 'wood' | 'glass';
}

interface Projectile {
  kind: 'rocket' | 'grenade';
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  owner: Actor | null;
  trailT: number;
}

const spheres: [number, number, number, number, boolean][] = [];
const rocketGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8).rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x5a6b4a, emissive: 0xff8833, emissiveIntensity: 0.3 });
const grenadeGeo = new THREE.SphereGeometry(0.08, 8, 6);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3e4a2f, roughness: 0.7 });

export class Combat {
  projectiles: Projectile[] = [];
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpN = new THREE.Vector3();

  constructor(private g: Game) {}

  /** Cast a ray against world, terrain, vehicles and actors. */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    ignoreActor: Actor | null,
    ignoreVehicle: Vehicle | null,
  ): ShotResult {
    let best = maxDist;
    const res: ShotResult = { x: ox + dx * maxDist, y: oy + dy * maxDist, z: oz + dz * maxDist, dist: maxDist, actor: null, vehicle: null, head: false, nx: -dx, ny: -dy, nz: -dz, surface: 'concrete' };
    const wh = this.g.world.raycast(ox, oy, oz, dx, dy, dz, maxDist);
    if (wh && wh.t < best) {
      best = wh.t;
      Object.assign(res, { x: wh.x, y: wh.y, z: wh.z, dist: wh.t, nx: wh.nx, ny: wh.ny, nz: wh.nz });
      const k = wh.box?.kind;
      res.surface = k === 'metal' ? 'metal' : k === 'wood' ? 'wood' : k === 'glass' ? 'glass' : 'concrete';
    }
    // terrain / water march
    const step = 1.5;
    for (let t = 0.5; t < best; t += step) {
      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;
      const gh = Math.max(groundHeight(px, pz), SEA_LEVEL);
      if (py < gh) {
        // refine
        let lo = t - step;
        let hi = t;
        for (let i = 0; i < 6; i++) {
          const m = (lo + hi) / 2;
          const my = oy + dy * m;
          const mg = Math.max(groundHeight(ox + dx * m, oz + dz * m), SEA_LEVEL);
          if (my < mg) hi = m;
          else lo = m;
        }
        best = hi;
        const water = groundHeight(ox + dx * hi, oz + dz * hi) < SEA_LEVEL;
        Object.assign(res, { x: ox + dx * hi, y: oy + dy * hi, z: oz + dz * hi, dist: hi, nx: 0, ny: 1, nz: 0, surface: water ? 'water' : 'dirt' });
        break;
      }
    }
    // vehicles
    for (const v of this.g.vehicles) {
      if (v === ignoreVehicle) continue;
      const cx = v.x - ox;
      const cz = v.z - oz;
      const proj = cx * dx + cz * dz;
      if (proj < -5 || proj > best + 5) continue;
      const s = v.spec;
      const t = rayOBB(ox, oy, oz, dx, dy, dz, v.x, v.y + s.height / 2 + 0.1, v.z, v.yaw, s.width / 2, s.height / 2, s.length / 2, best);
      if (t >= 0 && t < best) {
        best = t;
        Object.assign(res, { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, dist: t, vehicle: v, actor: null, nx: -dx, ny: -dy, nz: -dz, surface: 'metal' });
      }
    }
    // actors
    for (const a of this.g.actors) {
      if (a === ignoreActor || a.vehicle) continue;
      const cx = a.x - ox;
      const cz = a.z - oz;
      const proj = cx * dx + cz * dz;
      if (proj < -1 || proj > best + 1) continue;
      const lat2 = cx * cx + cz * cz - proj * proj;
      if (lat2 > 2.5) continue;
      a.hitSpheres(spheres);
      for (const [sx, sy, sz, r, head] of spheres) {
        const t = raySphere(ox, oy, oz, dx, dy, dz, sx, sy, sz, r);
        if (t >= 0 && t < best) {
          best = t;
          const hx = ox + dx * t;
          const hy = oy + dy * t;
          const hz = oz + dz * t;
          const n = this.tmpN.set(hx - sx, hy - sy, hz - sz).normalize();
          Object.assign(res, { x: hx, y: hy, z: hz, dist: t, actor: a, vehicle: null, head, nx: n.x, ny: n.y, nz: n.z, surface: 'flesh' });
        }
      }
    }
    return res;
  }

  /** Line of sight between two points (static world only). */
  los(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const h = this.g.world.raycast(ax, ay, az, dx / d, dy / d, dz / d, d);
    return !h;
  }

  /**
   * Fire a weapon. `dir` must be normalized. Returns the main hit for feedback.
   * `from` is where the ray starts (camera for the player, muzzle for NPCs), `muzzle` is used for tracers.
   */
  fire(shooter: Actor, weapon: WeaponId, from: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, spreadDeg: number, damageMul = 1) {
    const w = WEAPONS[weapon];
    const g = this.g;
    const isPlayer = shooter === g.player;
    if (weapon === 'rpg') {
      this.spawnRocket(shooter, muzzle, dir);
      g.audio.shot('rpg', g.distToListener(muzzle));
      g.alertGunfire(shooter, muzzle.x, muzzle.z);
      return null;
    }
    if (weapon === 'grenade') {
      this.throwGrenade(shooter, muzzle, dir);
      g.audio.shot('throw', g.distToListener(muzzle));
      return null;
    }
    let main: ShotResult | null = null;
    const spread = THREE.MathUtils.degToRad(spreadDeg);
    for (let p = 0; p < w.pellets; p++) {
      const d = this.tmpA.copy(dir);
      if (spread > 0) {
        // random cone
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread;
        const up = Math.abs(d.y) > 0.95 ? this.tmpB.set(1, 0, 0) : this.tmpB.set(0, 1, 0);
        const u = new THREE.Vector3().crossVectors(d, up).normalize();
        const v = new THREE.Vector3().crossVectors(d, u).normalize();
        d.addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).normalize();
      }
      const hit = this.raycast(from.x, from.y, from.z, d.x, d.y, d.z, w.range, shooter, shooter.vehicle);
      if (!main || (hit.actor && !main.actor)) main = hit;
      const hp = this.tmpB.set(hit.x, hit.y, hit.z);
      if (w.tracer && (p === 0 || Math.random() < 0.3)) g.fx.tracer(muzzle, hp, w.tracer);
      const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
      if (hit.dist < w.range - 0.01) {
        g.fx.impact(hp, n, hit.surface, !hit.actor && !hit.vehicle);
        if (isPlayer || g.distToListener(hp) < 25) g.audio.impact(hit.surface === 'metal' ? 'metal' : hit.surface === 'flesh' ? 'flesh' : 'concrete', g.distToListener(hp));
      }
      // falloff for shotgun
      const fall = weapon === 'shotgun' ? clamp(1.25 - hit.dist / w.range, 0.2, 1) : 1;
      const dmg = w.damage * damageMul * fall;
      if (hit.actor) this.damageActor(hit.actor, hit.head ? dmg * w.headshot : dmg, shooter, d, hit.head, weapon);
      else if (hit.vehicle) this.damageVehicle(hit.vehicle, dmg * 0.6, shooter);
      else if (hit.surface === 'water' && hit.dist < w.range - 0.01) g.fx.splash(hit.x, hit.y, hit.z);
    }
    g.fx.muzzleFlash(muzzle, weapon === 'shotgun' || weapon === 'sniper' ? 1 : weapon === 'pistol' ? 0.45 : 0.6);
    g.audio.shot(w.sound, g.distToListener(muzzle));
    g.alertGunfire(shooter, muzzle.x, muzzle.z);
    return main;
  }

  /** Melee: short range cone. */
  melee(attacker: Actor) {
    const g = this.g;
    const fx = Math.sin(attacker.yaw);
    const fz = Math.cos(attacker.yaw);
    let best: Actor | null = null;
    let bd = 2.2;
    for (const a of g.actors) {
      if (a === attacker || a.dead || a.vehicle) continue;
      const dx = a.x - attacker.x;
      const dz = a.z - attacker.z;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.4) continue;
      best = a;
      bd = d;
    }
    g.audio.shot('fist', g.distToListener(this.tmpA.set(attacker.x, attacker.y, attacker.z)));
    if (best) {
      const dir = this.tmpA.set(fx, 0, fz);
      this.damageActor(best, WEAPONS.fist.damage * (attacker === g.player && g.focusActive ? 2 : 1), attacker, dir, false, 'fist');
      best.knock.x += fx * 4;
      best.knock.z += fz * 4;
      g.fx.impact(new THREE.Vector3(best.x, best.y + 1.4, best.z), new THREE.Vector3(-fx, 0, -fz), 'flesh');
      g.audio.impact('flesh', 0);
      if (attacker === g.player) g.shake(0.15);
    }
  }

  damageActor(a: Actor, dmg: number, by: Actor | null, dir: THREE.Vector3 | null, head: boolean, weapon: WeaponId | 'explosion' | 'vehicle' | 'fall') {
    const g = this.g;
    if (a.dead || a.invuln > 0) return;
    if (a === g.player && g.godMode) return;
    let d = dmg;
    if (a.armor > 0) {
      const absorbed = Math.min(a.armor, d * 0.65);
      a.armor -= absorbed;
      d -= absorbed;
    }
    a.hp -= d;
    a.lastHitBy = by;
    if (dir && weapon !== 'fist') {
      const push = weapon === 'shotgun' ? 2.5 : weapon === 'sniper' ? 3 : 0.6;
      a.knock.x += dir.x * push;
      a.knock.z += dir.z * push;
    }
    if (a === g.player) {
      g.onPlayerDamaged(d, by);
    }
    g.onActorHurt(a, by);
    if (a.hp <= 0) {
      a.hp = 0;
      a.dead = true;
      a.deadTime = 0;
      // fall direction: hit from the front -> fall backwards
      let fallDir = 1;
      if (dir) fallDir = dir.x * Math.sin(a.yaw) + dir.z * Math.cos(a.yaw) < 0 ? 1 : -1;
      a.rig.die(fallDir);
      if (dir) {
        a.vx += dir.x * (weapon === 'explosion' ? 9 : 2.5);
        a.vz += dir.z * (weapon === 'explosion' ? 9 : 2.5);
        if (weapon === 'explosion') a.vy = 6;
      }
      g.onActorKilled(a, by, head);
    } else if (by === g.player) {
      g.onPlayerHit(a, head);
    }
  }

  damageVehicle(v: Vehicle, dmg: number, by: Actor | null) {
    if (v.destroyed) return;
    if (by) v.lastHitBy = by;
    v.damage(dmg, this.g.vehicleEvents);
    this.g.onVehicleHurt(v, by);
    if (by === this.g.player) this.g.onPlayerHit(null, false);
  }

  explode(x: number, y: number, z: number, radius: number, damage: number, by: Actor | null) {
    const g = this.g;
    g.fx.explosion(new THREE.Vector3(x, y, z), radius / 7);
    g.audio.explosion(g.distToListener(this.tmpA.set(x, y, z)));
    const dl = g.distToListener(this.tmpA.set(x, y, z));
    g.shake(clamp(1.4 - dl / 60, 0, 1.2));
    g.alertGunfire(by, x, z, 80);
    for (const a of g.actors) {
      if (a.vehicle) continue;
      const d = Math.hypot(a.x - x, a.y + 1 - y, a.z - z);
      if (d > radius) continue;
      const f = 1 - d / radius;
      const dir = this.tmpB.set(a.x - x, 0, a.z - z).normalize();
      this.damageActor(a, damage * f * f + 10, by, dir.clone(), false, 'explosion');
      if (!a.dead) {
        a.knock.x += dir.x * 10 * f;
        a.knock.z += dir.z * 10 * f;
      }
    }
    for (const v of g.vehicles) {
      const d = Math.hypot(v.x - x, v.y - y, v.z - z);
      if (d > radius * 1.2) continue;
      const f = 1 - d / (radius * 1.2);
      this.damageVehicle(v, damage * 3.2 * f, by);
      v.vx += ((v.x - x) / (d || 1)) * 8 * f;
      v.vz += ((v.z - z) / (d || 1)) * 8 * f;
      if (!v.airborne && f > 0.3) {
        v.airborne = true;
        v.vy = 6 * f;
        v.airTime = 0;
        v.maxAir = v.y;
      }
      v.yawRate += rand(-2, 2) * f;
      if (v.driver && v.driver !== g.player && !v.driver.dead) this.damageActor(v.driver, damage * f * 0.6, by, null, false, 'explosion');
    }
    // the player inside a vehicle takes damage through the vehicle
    const pv = g.player.vehicle;
    if (pv) {
      const d = Math.hypot(pv.x - x, pv.z - z);
      if (d < radius) this.damageActor(g.player, damage * 0.4 * (1 - d / radius), by, null, false, 'explosion');
    }
  }

  spawnRocket(owner: Actor, from: THREE.Vector3, dir: THREE.Vector3) {
    const m = new THREE.Mesh(rocketGeo, rocketMat);
    m.position.copy(from);
    m.lookAt(from.clone().add(dir));
    this.g.scene.add(m);
    this.projectiles.push({ kind: 'rocket', mesh: m, pos: from.clone(), vel: dir.clone().multiplyScalar(70), life: 5, owner, trailT: 0 });
  }

  throwGrenade(owner: Actor, from: THREE.Vector3, dir: THREE.Vector3) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    m.position.copy(from);
    this.g.scene.add(m);
    const v = dir.clone().multiplyScalar(18);
    v.y += 5;
    if (owner.vehicle) v.add(new THREE.Vector3(owner.vehicle.vx, 0, owner.vehicle.vz));
    this.projectiles.push({ kind: 'grenade', mesh: m, pos: from.clone(), vel: v, life: 2.6, owner, trailT: 0 });
  }

  update(dt: number) {
    const g = this.g;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      let boom = p.life <= 0;
      if (p.kind === 'rocket') {
        const step = p.vel.length() * dt;
        const d = this.tmpA.copy(p.vel).normalize();
        const hit = this.raycast(p.pos.x, p.pos.y, p.pos.z, d.x, d.y, d.z, step + 0.3, p.owner, p.owner?.vehicle ?? null);
        if (hit.dist < step + 0.3) {
          p.pos.set(hit.x - d.x * 0.3, hit.y - d.y * 0.3, hit.z - d.z * 0.3);
          boom = true;
        } else p.pos.addScaledVector(p.vel, dt);
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = 0.012;
          g.fx.smokePuff(p.pos.x, p.pos.y, p.pos.z, 0.1, 0.5);
          g.fx.fire(p.pos.x, p.pos.y, p.pos.z, 0.4);
        }
        p.mesh.position.copy(p.pos);
        if (boom) {
          this.explode(p.pos.x, p.pos.y, p.pos.z, 8, WEAPONS.rpg.damage, p.owner);
        }
      } else {
        p.vel.y -= 20 * dt;
        const next = this.tmpA.copy(p.pos).addScaledVector(p.vel, dt);
        const gh = groundHeight(next.x, next.z) + 0.08;
        if (next.y < gh) {
          next.y = gh;
          p.vel.y = Math.abs(p.vel.y) * 0.35;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
        }
        const res = g.world.resolveCircle(next.x, next.z, 0.1, next.y - 0.1, 0.2);
        if (res.hit) {
          const vn = p.vel.x * res.nx + p.vel.z * res.nz;
          p.vel.x -= 1.6 * vn * res.nx;
          p.vel.z -= 1.6 * vn * res.nz;
          next.x = res.x;
          next.z = res.z;
        }
        p.pos.copy(next);
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.x += dt * 10;
        if (boom) this.explode(p.pos.x, p.pos.y, p.pos.z, 7, WEAPONS.grenade.damage, p.owner);
      }
      if (boom) {
        g.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.projectiles) this.g.scene.remove(p.mesh);
    this.projectiles.length = 0;
  }
}
