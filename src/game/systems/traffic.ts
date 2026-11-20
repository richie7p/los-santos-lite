/** Ambient traffic, parked cars and AI driving (lane following & pursuit). */
import { angleDiff, clamp, pick, rand } from '../core/math';
import { CIVILIAN_TYPES, type VehicleType } from '../data';
import { FIXED_VEHICLES } from '../content';
import type { Vehicle } from '../entities/vehicle';
import { findPath, GRID_N, HALF_ROAD, LINES, linkWidth, nearestNode, ROAD_NODES, TOWN } from '../world/layout';
import type { Game } from '../Game';

const TURN_IN = 11;

interface ParkSlot {
  type?: VehicleType;
  x: number;
  z: number;
  yaw: number;
  vehicle: Vehicle | null;
  cooldown: number;
}

export class Traffic {
  maxCars = 22;
  private slots: ParkSlot[] = [];
  private spawnT = 0;

  constructor(private g: Game) {
    // parking slots along the kerb (outer lane edge)
    const off = HALF_ROAD - 1.3;
    for (let i = 0; i < GRID_N; i++)
      for (let k = 0; k < GRID_N - 1; k++) {
        const a = LINES[i];
        const b0 = LINES[k] + 16;
        const b1 = LINES[k + 1] - 16;
        for (let s = b0; s < b1; s += 13) {
          if (Math.random() < 0.55) continue;
          const side = Math.random() < 0.5 ? 1 : -1;
          // vertical road x=a: cars park facing +z on right side (x - off) or -z on the other
          this.slots.push({ x: a - side * off, z: s, yaw: side > 0 ? 0 : Math.PI, vehicle: null, cooldown: 0 });
          if (Math.random() < 0.5) this.slots.push({ x: s, z: a + side * off, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, vehicle: null, cooldown: 0 });
        }
      }
    // Dustwater main street (both sides of the highway) and the airport car park
    for (let x = TOWN.x - 130; x < TOWN.x + 130; x += 14) {
      if (Math.random() < 0.45) continue;
      const rz = x < -1250 ? -150 + ((x + 1400) / 150) * 50 : -100 + ((x + 1250) / 150) * -10;
      const side = Math.random() < 0.5 ? 1 : -1;
      this.slots.push({ x, z: rz + side * 11, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, vehicle: null, cooldown: 0 });
    }
    for (let x = -1180; x < -1020; x += 6) if (Math.random() < 0.6 && Math.abs(x + 1060) > 4) this.slots.push({ x, z: 684, yaw: 0, vehicle: null, cooldown: 0 });
    for (const f of FIXED_VEHICLES) this.slots.push({ type: f.type, x: f.x, z: f.z, yaw: f.yaw, vehicle: null, cooldown: 0 });
  }

  /** Lane centre offset for a road link (keeps the inner/outer choice). */
  private laneFor(a: number, b: number, outer: boolean) {
    const w = linkWidth(a, b);
    if (w >= 16) return outer ? 5.8 : 2.2;
    if (w >= 14) return outer ? 5.0 : 1.9;
    return w * 0.26;
  }
  private cruiseFor(a: number, b: number) {
    const w = linkWidth(a, b);
    return w >= 16 ? 24 : w >= 14 ? 12 : 17;
  }

  update(dt: number) {
    const g = this.g;
    const px = g.focus.x;
    const pz = g.focus.z;
    // parked cars stream in/out
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const d = Math.abs(s.x - px) + Math.abs(s.z - pz);
      if (s.vehicle) {
        if (s.vehicle.parkedSlot !== i) {
          s.vehicle = null;
          s.cooldown = 30;
        } else if (d > 260 && !s.vehicle.tag) {
          g.removeVehicle(s.vehicle);
          s.vehicle = null;
        }
      } else {
        s.cooldown -= dt;
        if (d < 170 && (d > 60 || s.type) && s.cooldown <= 0) {
          const v = g.spawnVehicle(s.type ?? pick(CIVILIAN_TYPES), s.x, s.z, s.yaw);
          v.ai.kind = 'parked';
          v.parkedSlot = i;
          s.vehicle = v;
        }
      }
    }

    // moving traffic
    this.spawnT -= dt;
    let count = 0;
    for (const v of g.vehicles) if (v.ai.kind === 'traffic') count++;
    if (this.spawnT <= 0 && count < this.maxCars) {
      this.spawnT = 0.25;
      this.spawnTraffic();
    }
    for (const v of [...g.vehicles]) {
      if (v.ai.kind === 'traffic') {
        v.headlightsOn = g.env.night > 0.4;
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d > 300 || v.destroyed) {
          if (!v.tag && (d > 300 || (v.destroyed && d > 120))) {
            g.removeVehicle(v);
            continue;
          }
        }
        if (!v.destroyed && v.crewCount > 0) this.driveTraffic(v, dt);
        else v.input = { throttle: 0, steer: 0, handbrake: true };
      } else if (v.ai.kind === 'none' && !v.isPlayer && !v.tag) {
        if (Math.hypot(v.x - px, v.z - pz) > 320) g.removeVehicle(v);
      } else if (v.ai.kind === 'parked') {
        if (v.parkedSlot >= 0 && Math.hypot(v.x - this.slots[v.parkedSlot].x, v.z - this.slots[v.parkedSlot].z) > 3) v.parkedSlot = -1;
        if (v.parkedSlot < 0 && !v.tag && Math.hypot(v.x - px, v.z - pz) > 320) {
          g.removeVehicle(v);
          continue;
        }
        v.input = { throttle: 0, steer: 0, handbrake: true };
      }
    }
  }

  private spawnTraffic() {
    const type: VehicleType = Math.random() < 0.05 ? 'police' : pick(CIVILIAN_TYPES);
    this.spawnOnLane(type, 90, 240);
  }

  /** Spawn an AI-driven car on a random lane within a distance band from the focus. */
  spawnOnLane(type: VehicleType, minD: number, maxD: number): Vehicle | null {
    const g = this.g;
    const cam = g.camera;
    for (let attempt = 0; attempt < 12; attempt++) {
      const near = ROAD_NODES.filter((n) => Math.abs(n.x - g.focus.x) < maxD + 170 && Math.abs(n.z - g.focus.z) < maxD + 170);
      if (!near.length) return null;
      const a = pick(near);
      const b = ROAD_NODES[pick(a.links)];
      const t = rand(0.25, 0.75);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const L = Math.hypot(dx, dz);
      const ux = dx / L;
      const uz = dz / L;
      const outer = Math.random() < 0.5;
      const lane = this.laneFor(a.id, b.id, outer);
      const x = a.x + dx * t - uz * lane;
      const z = a.z + dz * t + ux * lane;
      const d = Math.hypot(x - g.focus.x, z - g.focus.z);
      if (d < minD || d > maxD) continue;
      // avoid popping in right in front of the camera
      const vx = x - cam.position.x;
      const vz = z - cam.position.z;
      const dot = (vx * Math.sin(g.camYaw) + vz * Math.cos(g.camYaw)) / (Math.hypot(vx, vz) || 1);
      if (d < 160 && dot > 0.5 && g.phase !== 'title') continue;
      let clear = true;
      for (const o of g.vehicles) if (Math.abs(o.x - x) + Math.abs(o.z - z) < 14) clear = false;
      if (!clear) continue;
      const v = g.spawnVehicle(type, x, z, Math.atan2(ux, uz));
      v.ai.kind = 'traffic';
      v.ai.lane = lane;
      v.ai.fromNode = a.id;
      v.ai.toNode = b.id;
      v.ai.outer = outer;
      v.ai.pers = rand(0.85, 1.1);
      v.ai.cruise = this.cruiseFor(a.id, b.id) * v.ai.pers * (type === 'police' ? 1.15 : 1);
      v.crew = type === 'police' ? 'police' : type === 'armored' ? 'enemy' : 'civilian';
      v.crewCount = type === 'police' ? 2 : 1;
      v.ai.wps = [this.segEnd(a.id, b.id, lane)];
      v.ai.wp = 0;
      v.vx = ux * 8;
      v.vz = uz * 8;
      v.headlightsOn = g.env.night > 0.4;
      return v;
    }
    return null;
  }

  private segStart(aId: number, bId: number, lane: number) {
    const a = ROAD_NODES[aId];
    const b = ROAD_NODES[bId];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / L;
    const uz = (b.z - a.z) / L;
    return { x: a.x + ux * TURN_IN - uz * lane, z: a.z + uz * TURN_IN + ux * lane, turn: 1 };
  }
  private segEnd(aId: number, bId: number, lane: number) {
    const a = ROAD_NODES[aId];
    const b = ROAD_NODES[bId];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / L;
    const uz = (b.z - a.z) / L;
    return { x: b.x - ux * TURN_IN - uz * lane, z: b.z - uz * TURN_IN + ux * lane };
  }

  private extendRoute(v: Vehicle) {
    const to = ROAD_NODES[v.ai.toNode];
    const opts = to.links.filter((l) => l !== v.ai.fromNode);
    const next = opts.length ? pick(opts) : v.ai.fromNode;
    const from = ROAD_NODES[v.ai.fromNode];
    const nn = ROAD_NODES[next];
    const turn = Math.abs(angleDiff(Math.atan2(to.x - from.x, to.z - from.z), Math.atan2(nn.x - to.x, nn.z - to.z)));
    v.ai.lane = this.laneFor(to.id, next, v.ai.outer);
    if (v.ai.cruise < 18 || linkWidth(to.id, next) >= 16) v.ai.cruise = this.cruiseFor(to.id, next) * v.ai.pers * (v.type === 'police' ? 1.15 : 1);
    const st = this.segStart(to.id, next, v.ai.lane);
    st.turn = turn;
    v.ai.wps.push(st);
    v.ai.wps.push(this.segEnd(to.id, next, v.ai.lane));
    v.ai.fromNode = to.id;
    v.ai.toNode = next;
  }

  /** Follow lanes with simple collision avoidance. */
  driveTraffic(v: Vehicle, dt: number) {
    const ai = v.ai;
    if (ai.wp >= ai.wps.length - 1) {
      this.extendRoute(v);
      if (ai.wps.length > 8) {
        ai.wps.splice(0, ai.wp);
        ai.wp = 0;
      }
    }
    let target = ai.wps[ai.wp];
    let d = Math.hypot(target.x - v.x, target.z - v.z);
    if (d < 5.5) {
      ai.wp++;
      target = ai.wps[ai.wp] ?? target;
      d = Math.hypot(target.x - v.x, target.z - v.z);
    }
    const desired = Math.atan2(target.x - v.x, target.z - v.z);
    const diff = angleDiff(v.yaw, desired);
    let cruise = ai.cruise;
    if (Math.abs(diff) > 0.35) cruise = Math.min(cruise, 7);
    const next = ai.wps[ai.wp + 1];
    if (target.turn === undefined && next?.turn !== undefined && next.turn > 0.35 && d < 16 + cruise * 0.8) cruise = Math.min(cruise, next.turn > 1 ? 8 : 13);
    cruise = Math.min(cruise, this.obstacleLimit(v, dt));
    this.applyDrive(v, diff, cruise, dt);
  }

  /** How fast can we go considering what's ahead. Also handles honking & unsticking. */
  private obstacleLimit(v: Vehicle, dt: number) {
    const g = this.g;
    const ai = v.ai;
    if (ai.ignoreT > 0) {
      ai.ignoreT -= dt;
      return 99;
    }
    const fx = v.fx;
    const fz = v.fz;
    let limit = 99;
    const check = (x: number, z: number, isPlayer: boolean, lateral = 2.3) => {
      const rx = x - v.x;
      const rz = z - v.z;
      const f = rx * fx + rz * fz;
      if (f <= 0 || f > 24) return;
      const l = Math.abs(rx * -fz + rz * fx);
      if (l > lateral) return;
      const lim = Math.max(0, (f - v.spec.length / 2 - 3.5) * 0.9);
      if (lim < limit) {
        limit = lim;
        if (isPlayer && lim < 1) {
          ai.honk -= dt;
          if (ai.honk <= 0) {
            ai.honk = rand(2, 5);
            if (Math.hypot(v.x - g.focus.x, v.z - g.focus.z) < 30) g.audio.horn();
          }
        }
      }
    };
    for (const o of g.vehicles) {
      if (o === v) continue;
      if (Math.abs(o.x - v.x) > 26 || Math.abs(o.z - v.z) > 26) continue;
      check(o.x, o.z, o.isPlayer, 2.0 + o.spec.width / 2);
    }
    for (const a of g.actors) {
      if (a.vehicle || a.dead) continue;
      if (Math.abs(a.x - v.x) > 26 || Math.abs(a.z - v.z) > 26) continue;
      check(a.x, a.z, a === g.player, 1.8);
    }
    // stuck detection
    if (v.speed < 0.6 && limit > 2) {
      ai.stuckT += dt;
      if (ai.stuckT > 3) {
        ai.reverseT = 1.4;
        ai.stuckT = 0;
      }
    } else if (v.speed < 0.6 && limit <= 2) {
      ai.stuckT += dt * 0.5;
      if (ai.stuckT > 6) {
        ai.ignoreT = 2.5;
        ai.stuckT = 0;
      }
    } else ai.stuckT = Math.max(0, ai.stuckT - dt);
    return limit;
  }

  private applyDrive(v: Vehicle, diff: number, cruise: number, dt: number) {
    const ai = v.ai;
    if (ai.reverseT > 0) {
      ai.reverseT -= dt;
      v.input = { throttle: -0.7, steer: clamp(diff * 2, -1, 1), handbrake: false };
      return;
    }
    const steer = clamp(-diff * 2.4, -1, 1);
    const vF = v.forwardSpeed;
    const err = cruise - vF;
    const throttle = cruise < 0.3 ? -1 : clamp(err * 0.45, -1, 1);
    v.input = { throttle, steer, handbrake: cruise < 0.3 && vF < 1 };
  }

  /** Pursuit / mission driving towards a world point, routing through the road grid. */
  driveTo(v: Vehicle, tx: number, tz: number, dt: number, opts: { speed: number; ram?: boolean; stopDist?: number }) {
    const g = this.g;
    const ai = v.ai;
    const dist = Math.hypot(tx - v.x, tz - v.z);
    const stop = opts.stopDist ?? 0;
    ai.pathT -= dt;
    const direct = dist < 55 && g.combat.los(v.x, v.y + 1.2, v.z, tx, g.focus.y + 1, tz);
    if (!direct && (ai.pathT <= 0 || ai.wps.length === 0)) {
      ai.pathT = 1.5;
      const a = nearestNode(v.x, v.z);
      const b = nearestNode(tx, tz);
      const path = findPath(a, b);
      ai.wps = path.map((n) => ({ x: n.x, z: n.z }));
      ai.wps.push({ x: tx, z: tz });
      // skip the first node if we are already past it
      ai.wp = 0;
      if (ai.wps.length > 2) {
        const n0 = ai.wps[0];
        const n1 = ai.wps[1];
        const toN0 = (n0.x - v.x) * (n1.x - n0.x) + (n0.z - v.z) * (n1.z - n0.z);
        if (toN0 < 0) ai.wp = 1;
      }
    }
    let target = { x: tx, z: tz };
    if (!direct && ai.wps.length) {
      target = ai.wps[Math.min(ai.wp, ai.wps.length - 1)];
      if (Math.hypot(target.x - v.x, target.z - v.z) < 8 && ai.wp < ai.wps.length - 1) ai.wp++;
      target = ai.wps[Math.min(ai.wp, ai.wps.length - 1)];
    }
    const desired = Math.atan2(target.x - v.x, target.z - v.z);
    const diff = angleDiff(v.yaw, desired);
    let speed = opts.speed;
    if (Math.abs(diff) > 0.6) speed = Math.min(speed, 11);
    if (Math.abs(diff) > 1.4) speed = Math.min(speed, 7);
    if (dist < stop + 8) speed = Math.min(speed, Math.max(0, (dist - stop) * 1.2));
    // stuck handling
    if (v.speed < 1 && speed > 3) {
      ai.stuckT += dt;
      if (ai.stuckT > 1.8) {
        ai.reverseT = 1.2;
        ai.stuckT = 0;
      }
    } else ai.stuckT = 0;
    // target directly behind & close: reverse
    if (Math.abs(diff) > 2.4 && dist < 20 && !opts.ram) {
      v.input = { throttle: -0.8, steer: clamp(diff * 1.5, -1, 1), handbrake: false };
      return;
    }
    this.applyDrive(v, diff, speed, dt);
  }
}
