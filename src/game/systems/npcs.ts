/** Pedestrians and NPC behaviour: wandering, crossing streets, fleeing, fighting. */
import * as THREE from 'three';
import { angleDiff, clamp, damp, lerpAngle, pick, rand } from '../core/math';
import { WEAPONS } from '../data';
import { Actor } from '../entities/actor';
import { randomOutfit } from '../entities/character';
import { BLOCKS, GRID_N, PITCH, SIDEWALK_RING, sidewalkPointOnBlock, type BlockInfo } from '../world/layout';
import type { Game } from '../Game';

const tmpFrom = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpMuz = new THREE.Vector3();

export class NPCs {
  maxPeds = 34;
  private spawnT = 0;
  private footT = 0;

  constructor(private g: Game) {}

  update(dt: number) {
    const g = this.g;
    // stream pedestrians
    this.spawnT -= dt;
    let civs = 0;
    for (const a of g.actors) if (a.team === 'civilian' && !a.dead) civs++;
    const cap = g.env.night > 0.6 ? Math.round(this.maxPeds * 0.6) : this.maxPeds;
    if (this.spawnT <= 0 && civs < cap) {
      this.spawnT = 0.15;
      this.spawnPed();
    }

    for (const a of [...g.actors]) {
      if (a === g.player) continue;
      const d = Math.hypot(a.x - g.focus.x, a.z - g.focus.z);
      if (a.dead) {
        a.deadTime += dt;
        a.move(dt, g.world, 0, 0, 6, false);
        a.animate(dt);
        if ((a.deadTime > 40 || (d > 120 && a.deadTime > 3)) && !a.tag) g.removeActor(a);
        continue;
      }
      if (a.vehicle) continue;
      if (a.invuln > 0) a.invuln -= dt;
      if (!a.tag && d > (a.team === 'civilian' ? 170 : 260)) {
        g.removeActor(a);
        continue;
      }
      // LOD: no shadows from distant people
      const far = d > 45;
      if (far !== a.farLod) {
        a.farLod = far;
        a.rig.root.traverse((o) => ((o as THREE.Mesh).castShadow = !far));
      }
      const hostile = a.team === 'police' || a.team === 'gang' || a.team === 'enemy';
      if (hostile && (a.ai.aggro || a.team === 'enemy' || (a.team === 'police' && g.police.heat > 0))) this.combatAI(a, dt);
      else if (a.team === 'ally') this.allyAI(a, dt);
      else this.civilianAI(a, dt);
      a.animate(dt);
    }

    // occasional footstep sound for the player
    const p = g.player;
    if (!p.vehicle && p.onGround && p.speed > 1) {
      this.footT -= dt * p.speed;
      if (this.footT <= 0) {
        this.footT = 2.4;
        g.audio.footstep(0);
      }
    }
  }

  private spawnPed() {
    const g = this.g;
    for (let attempt = 0; attempt < 5; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const r = rand(45, 130);
      const x = g.focus.x + Math.sin(ang) * r;
      const z = g.focus.z + Math.cos(ang) * r;
      const bi = Math.floor((x + 360) / PITCH);
      const bj = Math.floor((z + 360) / PITCH);
      if (bi < 0 || bj < 0 || bi >= GRID_N - 1 || bj >= GRID_N - 1) continue;
      const b = BLOCKS[bi * (GRID_N - 1) + bj];
      const perim = Math.random() * 4;
      const pt = sidewalkPointOnBlock(b, perim, perim % 1);
      // out of view if near
      const cam = g.camera.position;
      const vx = pt.x - cam.x;
      const vz = pt.z - cam.z;
      const dot = (vx * Math.sin(g.camYaw) + vz * Math.cos(g.camYaw)) / (Math.hypot(vx, vz) || 1);
      if (r < 80 && dot > 0.6) continue;
      const a = g.spawnActor('civilian', randomOutfit(), pt.x, pt.z);
      a.ai.mode = 'wander';
      a.ai.blockIdx = BLOCKS.indexOf(b);
      a.ai.perim = perim;
      a.ai.dir = Math.random() < 0.5 ? 1 : -1;
      a.ai.lane = rand(-1.3, 1.3);
      a.ai.speed = rand(1.2, 1.7);
      a.hp = a.maxHp = 60;
      return;
    }
  }

  private civilianAI(a: Actor, dt: number) {
    const g = this.g;
    const ai = a.ai;
    ai.timer -= dt;
    a.pose = 'move';
    switch (ai.mode) {
      case 'wander': {
        const b = BLOCKS[ai.blockIdx];
        if (!b) {
          ai.mode = 'idle';
          break;
        }
        ai.perim = (ai.perim + (ai.dir * ai.speed * dt) / (SIDEWALK_RING * 2) + 4) % 4;
        const pt = sidewalkPointOnBlock(b, ai.perim, ai.perim % 1);
        // inward lateral offset
        const ox = Math.sign(b.cx - pt.x) * (Math.abs(b.cx - pt.x) > SIDEWALK_RING - 0.5 ? ai.lane : 0);
        const oz = Math.sign(b.cz - pt.z) * (Math.abs(b.cz - pt.z) > SIDEWALK_RING - 0.5 ? ai.lane : 0);
        this.steerTo(a, pt.x + ox, pt.z + oz, ai.speed, dt);
        // at a corner, sometimes cross the street
        const frac = ai.perim % 1;
        if ((frac < 0.01 || frac > 0.99) && ai.timer <= 0) {
          ai.timer = 4;
          if (Math.random() < 0.3) this.startCrossing(a, b);
        }
        // stop & idle occasionally
        if (Math.random() < dt * 0.02) {
          ai.mode = 'idle';
          ai.timer = rand(2, 6);
        }
        break;
      }
      case 'idle':
        a.move(dt, g.world, 0, 0, 20, false);
        a.pose = 'idle';
        if (ai.timer <= 0) ai.mode = 'wander';
        break;
      case 'cross': {
        const d = Math.hypot(ai.tx - a.x, ai.tz - a.z);
        this.steerTo(a, ai.tx, ai.tz, ai.speed * 1.15, dt);
        if (d < 1.2 || ai.timer < -20) {
          ai.mode = 'wander';
          ai.timer = 3;
        }
        break;
      }
      case 'flee': {
        const awayX = a.x - ai.tx;
        const awayZ = a.z - ai.tz;
        const L = Math.hypot(awayX, awayZ) || 1;
        a.sprinting = true;
        this.steerTo(a, a.x + (awayX / L) * 10, a.z + (awayZ / L) * 10, 6.2, dt);
        if (ai.timer <= 0) {
          a.sprinting = false;
          this.rejoinSidewalk(a);
        }
        break;
      }
      case 'cower':
        a.move(dt, g.world, 0, 0, 20, false);
        a.pose = 'cower';
        if (ai.timer <= 0) {
          ai.mode = 'flee';
          ai.timer = 8;
        }
        break;
      case 'handsUp':
        a.move(dt, g.world, 0, 0, 20, false);
        a.pose = 'handsUp';
        a.yaw = lerpAngle(a.yaw, Math.atan2(g.player.x - a.x, g.player.z - a.z), damp(6, dt));
        if (ai.timer <= 0) {
          if (a.tag === 'clerk') {
            ai.mode = 'guard';
            break;
          }
          ai.mode = 'flee';
          ai.tx = g.player.x;
          ai.tz = g.player.z;
          ai.timer = 10;
        }
        break;
      case 'guard':
      case 'follow':
      default:
        a.move(dt, g.world, 0, 0, 20, false);
        a.pose = 'idle';
        if (ai.mode !== 'guard' && ai.timer <= 0) this.rejoinSidewalk(a);
        break;
    }
  }

  private startCrossing(a: Actor, b: BlockInfo) {
    const ai = a.ai;
    const pt = sidewalkPointOnBlock(b, ai.perim, ai.perim % 1);
    const sx = Math.sign(pt.x - b.cx);
    const sz = Math.sign(pt.z - b.cz);
    const goX = Math.random() < 0.5;
    const ni = b.i + (goX ? sx : 0);
    const nj = b.j + (goX ? 0 : sz);
    if (ni < 0 || nj < 0 || ni >= GRID_N - 1 || nj >= GRID_N - 1) return;
    const nb = BLOCKS[ni * (GRID_N - 1) + nj];
    ai.mode = 'cross';
    ai.tx = goX ? nb.cx - sx * SIDEWALK_RING : pt.x;
    ai.tz = goX ? pt.z : nb.cz - sz * SIDEWALK_RING;
    ai.blockIdx = BLOCKS.indexOf(nb);
    // perimeter parameter of the destination corner
    const lx = ai.tx - nb.cx;
    const lz = ai.tz - nb.cz;
    ai.perim = perimOf(lx, lz);
    ai.timer = 0;
  }

  rejoinSidewalk(a: Actor) {
    const ai = a.ai;
    const bi = clamp(Math.floor((a.x + 360) / PITCH), 0, GRID_N - 2);
    const bj = clamp(Math.floor((a.z + 360) / PITCH), 0, GRID_N - 2);
    const b = BLOCKS[bi * (GRID_N - 1) + bj];
    ai.blockIdx = BLOCKS.indexOf(b);
    ai.perim = perimOf(clamp(a.x - b.cx, -SIDEWALK_RING, SIDEWALK_RING), clamp(a.z - b.cz, -SIDEWALK_RING, SIDEWALK_RING));
    const pt = sidewalkPointOnBlock(b, ai.perim, ai.perim % 1);
    ai.mode = 'cross';
    ai.tx = pt.x;
    ai.tz = pt.z;
    ai.timer = 0;
  }

  steerTo(a: Actor, tx: number, tz: number, speed: number, dt: number, face = true) {
    const dx = tx - a.x;
    const dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    const s = d < 0.3 ? 0 : Math.min(speed, d * 3);
    a.move(dt, this.g.world, (dx / (d || 1)) * s, (dz / (d || 1)) * s, 24, face);
    a.pose = s > 0.2 ? 'move' : 'idle';
  }

  private allyAI(a: Actor, dt: number) {
    const g = this.g;
    if (a.ai.mode === 'guard') {
      // stand still and look at the player when near
      a.move(dt, g.world, 0, 0, 20, false);
      a.pose = 'idle';
      if (Math.hypot(g.player.x - a.x, g.player.z - a.z) < 12) a.yaw = lerpAngle(a.yaw, Math.atan2(g.player.x - a.x, g.player.z - a.z), damp(4, dt));
      return;
    }
    const p = g.player;
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d > 4) this.steerTo(a, p.x, p.z, d > 10 ? 6 : 3.5, dt);
    else {
      a.move(dt, g.world, 0, 0, 20, false);
      a.pose = 'idle';
    }
  }

  /** Police, gangs and mission enemies. */
  combatAI(a: Actor, dt: number) {
    const g = this.g;
    const ai = a.ai;
    const p = g.player;
    const tx = p.vehicle ? p.vehicle.x : p.x;
    const tz = p.vehicle ? p.vehicle.z : p.z;
    const ty = p.vehicle ? p.vehicle.y + 1 : p.y + 1.2;
    const dx = tx - a.x;
    const dz = tz - a.z;
    const dist = Math.hypot(dx, dz);
    ai.fireCd -= dt;
    ai.timer -= dt;
    ai.losT -= dt;
    if (ai.losT <= 0) {
      ai.losT = 0.3 + Math.random() * 0.2;
      const seen = dist < 90 && g.combat.los(a.x, a.y + 1.5, a.z, tx, ty, tz);
      ai.alerted = seen;
      if (seen) {
        ai.lastSeenX = tx;
        ai.lastSeenZ = tz;
        if (a.team === 'police') g.police.reportSeen();
      }
    }
    const w = WEAPONS[a.weapon];
    const engage = a.weapon === 'fist' ? 1.6 : Math.min(w.range * 0.75, a.team === 'police' ? 40 : 45);
    if (p.dead) {
      a.pose = 'idle';
      a.move(dt, g.world, 0, 0, 20, false);
      return;
    }
    if (ai.alerted && dist < engage) {
      // attack: face, strafe a bit, shoot
      a.yaw = lerpAngle(a.yaw, Math.atan2(dx, dz), damp(10, dt));
      if (a.weapon === 'fist') {
        a.pose = 'move';
        a.move(dt, g.world, 0, 0, 20, false);
        if (ai.fireCd <= 0) {
          ai.fireCd = 1.0;
          a.rig.punch();
          if (dist < 1.8) g.combat.damageActor(p, 9, a, tmpDir.set(dx, 0, dz).normalize(), false, 'fist');
        }
        return;
      }
      if (ai.timer <= 0) {
        ai.timer = rand(1.2, 2.6);
        ai.strafe = Math.random() < 0.5 ? -1 : Math.random() < 0.5 ? 1 : 0;
      }
      const rx = -dz / (dist || 1);
      const rz = dx / (dist || 1);
      const s = ai.strafe * 2.2;
      a.move(dt, g.world, rx * s, rz * s, 20, false);
      a.pose = 'aim';
      a.aimPitch = Math.atan2(ty - (a.y + 1.4), dist);
      if (ai.fireCd <= 0) {
        if (ai.burst <= 0) {
          ai.burst = w.auto ? Math.floor(rand(3, 7)) : Math.floor(rand(1, 3));
        }
        ai.burst--;
        ai.fireCd = ai.burst > 0 ? 1 / w.rate : rand(0.7, 1.6) / (a.team === 'enemy' ? 1.2 : 1);
        this.npcShoot(a, tx, ty, tz, dist);
      }
    } else {
      // chase the last known position
      a.pose = 'move';
      const gx = ai.alerted ? tx : ai.lastSeenX || tx;
      const gz = ai.alerted ? tz : ai.lastSeenZ || tz;
      const sp = a.team === 'police' || a.team === 'enemy' ? 5.6 : 5;
      a.sprinting = true;
      this.steerTo(a, gx, gz, sp, dt);
      if (Math.hypot(gx - a.x, gz - a.z) < 2 && !ai.alerted) {
        // lost the player: look around
        a.pose = 'idle';
      }
    }
  }

  npcShoot(a: Actor, tx: number, ty: number, tz: number, dist: number) {
    const g = this.g;
    const p = g.player;
    const w = WEAPONS[a.weapon];
    a.rig.kick();
    a.rig.muzzleWorld(tmpMuz);
    tmpFrom.set(a.x, a.y + 1.45, a.z);
    tmpDir.set(tx - tmpFrom.x, ty - tmpFrom.y, tz - tmpFrom.z).normalize();
    // accuracy: worse at range, vs fast movers and when the player is focusing
    let acc = a.ai.accuracy;
    const pSpeed = p.vehicle ? p.vehicle.speed : p.speed;
    acc *= clamp(1.25 - dist / 55, 0.25, 1);
    acc *= pSpeed > 6 ? 0.55 : pSpeed > 2 ? 0.8 : 1;
    if (g.focusActive) acc *= 0.6;
    const spread = w.spread + (1 - acc) * 7;
    const dmgMul = a.team === 'police' ? 0.42 : 0.38;
    g.combat.fire(a, a.weapon, tmpFrom, tmpDir, tmpMuz, spread, dmgMul * g.difficultyDamage);
  }
}

function perimOf(lx: number, lz: number) {
  const e = SIDEWALK_RING;
  // choose closest side
  const dTop = Math.abs(lz + e);
  const dRight = Math.abs(lx - e);
  const dBottom = Math.abs(lz - e);
  const dLeft = Math.abs(lx + e);
  const m = Math.min(dTop, dRight, dBottom, dLeft);
  if (m === dTop) return clamp((lx + e) / (2 * e), 0, 0.999);
  if (m === dRight) return 1 + clamp((lz + e) / (2 * e), 0, 0.999);
  if (m === dBottom) return 2 + clamp((e - lx) / (2 * e), 0, 0.999);
  return 3 + clamp((e - lz) / (2 * e), 0, 0.999);
}


