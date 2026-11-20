/** Arcade vehicle physics: bicycle-model steering, tyre grip, drifting, jumps, damage. */
import * as THREE from 'three';
import { clamp, damp, lerp, rand } from '../core/math';
import type { StaticWorld } from '../core/collision';
import { type VehicleSpec, type VehicleType, VEHICLES } from '../data';
import { groundHeight, SEA_LEVEL } from '../world/layout';
import type { Actor } from './actor';
import { createVehicleRig, disposeVehicleRig, type VehicleRig } from './vehicleMesh';

export interface DriveInput {
  throttle: number; // -1..1 (negative = brake / reverse)
  steer: number; // -1 (left) .. 1 (right)
  handbrake: boolean;
  /** Helicopters: +1 climb, -1 descend. */
  lift?: number;
}

export interface VehicleAI {
  kind: 'none' | 'traffic' | 'police' | 'mission' | 'parked';
  wps: { x: number; z: number; turn?: number }[];
  outer: boolean;
  pers: number;
  wp: number;
  lane: number;
  cruise: number;
  stuckT: number;
  ignoreT: number;
  fromNode: number;
  toNode: number;
  honk: number;
  pathT: number;
  reverseT: number;
}

export interface VehicleEvents {
  onImpact(v: Vehicle, speed: number, x: number, y: number, z: number): void;
  onLand(v: Vehicle, airTime: number, impact: number): void;
  onDestroyed(v: Vehicle): void;
  skid(x: number, y: number, z: number, yaw: number): void;
  smoke(x: number, y: number, z: number, dark: number, size?: number): void;
  fire(x: number, y: number, z: number, size?: number): void;
  tireSmoke(x: number, y: number, z: number): void;
}

let NEXT_ID = 1;

export class Vehicle {
  readonly id = NEXT_ID++;
  readonly spec: VehicleSpec;
  readonly rig: VehicleRig;
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  yawRate = 0;
  steerAngle = 0;
  pitch = 0;
  roll = 0;
  visPitch = 0;
  visRoll = 0;
  hp: number;
  destroyed = false;
  burning = false;
  burnT = 0;
  driver: Actor | null = null;
  /** Virtual NPC occupants (spawned as actors only when they get out). */
  crew: 'civilian' | 'police' | 'gang' | 'enemy' | null = null;
  crewCount = 0;
  parkedSlot = -1;
  /** Who last damaged this vehicle (for blame when it explodes). */
  lastHitBy: Actor | null = null;
  isPlayer = false;
  siren = false;
  tag = '';
  locked = false;
  airborne = false;
  airTime = 0;
  maxAir = 0;
  input: DriveInput = { throttle: 0, steer: 0, handbrake: false };
  ai: VehicleAI = { kind: 'none', wps: [], wp: 0, outer: false, pers: 1, lane: 2.2, cruise: 12, stuckT: 0, ignoreT: 0, fromNode: -1, toNode: -1, honk: 0, pathT: 0, reverseT: 0 };
  sinking = false;
  private skidT = 0;
  private smokeT = 0;
  private lastVF = 0;
  lateralSlip = 0;
  blip: 'target' | 'ally' | 'enemy' | null = null;
  damageScale = 1;
  /** Road grip multiplier (lower when wet). */
  gripMul = 1;
  headlightsOn = false;
  color: number;

  constructor(type: VehicleType, color?: number) {
    this.spec = VEHICLES[type];
    this.color = color ?? this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)];
    this.rig = createVehicleRig(type, this.color);
    this.hp = this.spec.hp;
  }

  get type() {
    return this.spec.type;
  }
  get fx() {
    return Math.sin(this.yaw);
  }
  get fz() {
    return Math.cos(this.yaw);
  }
  get forwardSpeed() {
    return this.vx * this.fx + this.vz * this.fz;
  }
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.y = groundHeight(x, z);
    this.vx = this.vz = this.vy = 0;
    this.yawRate = 0;
    this.syncRig(0);
  }

  repaint(color: number) {
    this.color = color;
    this.rig.paint.color.setHex(color);
  }

  repair() {
    this.hp = this.spec.hp;
    this.burning = false;
    this.burnT = 0;
  }

  damage(amount: number, events: VehicleEvents) {
    if (this.destroyed) return;
    this.hp -= amount * this.damageScale;
    if (this.hp <= 0 && !this.burning) {
      this.burning = true;
      this.burnT = this.hp < -600 ? 0.05 : 3.5 + Math.random() * 1.5;
    }
    void events;
  }

  /** Circle samples along the body used for collisions. */
  samples(out: { x: number; z: number; r: number; o: number }[]) {
    out.length = 0;
    const r = this.spec.width / 2;
    const n = Math.max(2, Math.round(this.spec.length / this.spec.width) + 1);
    const span = this.spec.length / 2 - r;
    for (let i = 0; i < n; i++) {
      const o = -span + (2 * span * i) / (n - 1);
      out.push({ x: this.x + this.fx * o, z: this.z + this.fz * o, r, o });
    }
    return out;
  }

  /** Helicopter rotor speed 0..1. */
  rotor = 0;

  update(dt: number, world: StaticWorld, ev: VehicleEvents) {
    if (this.spec.flying) {
      this.updateFlight(dt, world, ev);
      return;
    }
    const s = this.spec;
    const fx = this.fx;
    const fz = this.fz;
    const rx = -fz;
    const rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const inp = this.destroyed || this.sinking ? { throttle: 0, steer: 0, handbrake: true } : this.input;
    const hand = inp.handbrake;

    // steering (speed sensitive)
    const steerTarget = -inp.steer * s.steer * (1 / (1 + Math.abs(vF) / 22));
    this.steerAngle = lerp(this.steerAngle, steerTarget, damp(9, dt));

    if (!this.airborne) {
      const t = inp.throttle;
      if (t > 0.05) {
        if (vF < -0.5) vF += s.brake * dt * t;
        else vF += s.accel * t * dt * Math.max(0, 1 - Math.pow(Math.max(0, vF) / s.maxSpeed, 2));
      } else if (t < -0.05) {
        if (vF > 0.5) vF -= s.brake * dt * -t;
        else vF -= s.accel * 0.6 * -t * dt * Math.max(0, 1 - Math.pow(Math.max(0, -vF) / (s.maxSpeed * 0.3), 2));
      } else {
        vF -= Math.sign(vF) * Math.min(Math.abs(vF), 2.2 * dt);
      }
      vF -= vF * Math.abs(vF) * 0.0006 * dt * 60 * 0.05;
      if (hand) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 7 * dt);

      // lateral grip
      const gripK = (hand ? s.grip * 0.18 : s.grip * (Math.abs(vR) > 6 ? 0.55 : 1)) * this.gripMul;
      vR *= Math.exp(-gripK * dt);
      this.lateralSlip = vR;

      // yaw from bicycle model
      let desired = (vF / s.wheelbase) * Math.tan(this.steerAngle);
      if (hand && Math.abs(vF) > 5) desired *= 1.7;
      this.yawRate = lerp(this.yawRate, desired, damp(hand ? 4 : 9, dt));
    } else {
      this.yawRate *= Math.exp(-0.5 * dt);
    }
    this.yaw += this.yawRate * dt;

    // recompose velocity in the old basis (lets the car slip)
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;

    // integrate position
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // static collisions
    this.collideWorld(world, ev, dt);

    // ground follow (4 wheels)
    const hw = s.width / 2 - 0.2;
    const hb = s.wheelbase / 2;
    const nfx = this.fx;
    const nfz = this.fz;
    const nrx = -nfz;
    const nrz = nfx;
    const gFL = groundHeight(this.x + nfx * hb - nrx * hw, this.z + nfz * hb - nrz * hw);
    const gFR = groundHeight(this.x + nfx * hb + nrx * hw, this.z + nfz * hb + nrz * hw);
    const gRL = groundHeight(this.x - nfx * hb - nrx * hw, this.z - nfz * hb - nrz * hw);
    const gRR = groundHeight(this.x - nfx * hb + nrx * hw, this.z - nfz * hb + nrz * hw);
    let gAvg = (gFL + gFR + gRL + gRR) / 4;
    const support = world.supportHeight(this.x, this.z, this.y + 0.8);
    if (support > gAvg) gAvg = support;
    const targetPitch = Math.atan2((gFL + gFR) / 2 - (gRL + gRR) / 2, s.wheelbase);
    const targetRoll = Math.atan2((gFR + gRR) / 2 - (gFL + gFR + gRL + gRR) / 4, hw) * 0.5;

    if (gAvg < SEA_LEVEL - 0.6 && !this.sinking && !this.airborne) {
      this.sinking = true;
    }
    if (this.sinking) {
      this.vx *= Math.exp(-2 * dt);
      this.vz *= Math.exp(-2 * dt);
      this.y = lerp(this.y, SEA_LEVEL - 2.5, damp(0.6, dt));
      this.hp -= 120 * dt;
      if (this.hp < -200 && !this.destroyed) {
        this.destroyed = true;
      }
    } else if (!this.airborne) {
      const prevY = this.y;
      if (gAvg < this.y - 0.35 && Math.abs(vF) > 6) {
        // drove off an edge / ramp lip: go ballistic
        this.airborne = true;
        this.airTime = 0;
        this.maxAir = this.y;
        // a little extra pop off ramps feels better than strict physics
        if (this.vy > 2) this.vy *= 1.2;
      } else {
        this.y = lerp(this.y, gAvg, damp(18, dt));
        this.vy = clamp((this.y - prevY) / Math.max(dt, 1e-3), -20, 20);
        this.pitch = lerp(this.pitch, targetPitch, damp(12, dt));
        this.roll = lerp(this.roll, targetRoll, damp(12, dt));
      }
    }
    if (this.airborne) {
      this.airTime += dt;
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      this.maxAir = Math.max(this.maxAir, this.y);
      this.pitch = lerp(this.pitch, -0.15, damp(0.8, dt));
      if (this.y <= gAvg) {
        const impact = -this.vy;
        this.y = gAvg;
        this.airborne = false;
        ev.onLand(this, this.airTime, impact);
        if (impact > 12) this.damage((impact - 12) * 25, ev);
        this.vy = 0;
      }
    }

    // visual suspension: pitch from acceleration, roll from cornering
    const accel = (vF - this.lastVF) / Math.max(dt, 1e-3);
    this.lastVF = vF;
    this.visPitch = lerp(this.visPitch, clamp(-accel * 0.004, -0.06, 0.06), damp(6, dt));
    this.visRoll = lerp(this.visRoll, clamp(this.yawRate * vF * 0.0035, -0.08, 0.08), damp(6, dt));

    // skids & tyre smoke
    const slipping = !this.airborne && ((Math.abs(vR) > 4 && this.speed > 6) || (hand && Math.abs(vF) > 6));
    const launching = !this.airborne && inp.throttle > 0.8 && Math.abs(vF) < 6 && Math.abs(vF) > 0.3 && s.accel > 12;
    this.skidT -= dt;
    if ((slipping || launching) && this.skidT <= 0) {
      this.skidT = 0.035;
      for (const sx of [-1, 1]) {
        const wx = this.x - nfx * hb + nrx * hw * sx;
        const wz = this.z - nfz * hb + nrz * hw * sx;
        ev.skid(wx, groundHeight(wx, wz), wz, this.yaw);
        if (Math.random() < 0.35) ev.tireSmoke(wx, this.y, wz);
      }
    }

    // damage smoke / fire
    this.smokeT -= dt;
    const hpFrac = this.hp / s.hp;
    if (!this.destroyed && hpFrac < 0.35 && this.smokeT <= 0) {
      this.smokeT = hpFrac < 0.15 ? 0.06 : 0.14;
      const ex = this.x + nfx * (s.length / 2 - 0.6);
      const ez = this.z + nfz * (s.length / 2 - 0.6);
      ev.smoke(ex, this.y + s.hood + 0.1, ez, 1 - hpFrac * 2, 0.8);
    }
    if (this.burning && !this.destroyed) {
      this.burnT -= dt;
      if (Math.random() < 0.7) ev.fire(this.x + nfx * (s.length / 2 - 0.8), this.y + s.hood, this.z + nfz * (s.length / 2 - 0.8), 1.2);
      if (this.burnT <= 0) {
        this.destroyed = true;
        ev.onDestroyed(this);
      }
    }
    if (this.destroyed && !this.sinking && Math.random() < 0.25) ev.smoke(this.x, this.y + 1.5, this.z, 1, 1.4);

    this.syncRig(dt, inp.throttle);
  }

  private collideWorld(world: StaticWorld, ev: VehicleEvents, dt: number) {
    const smp: { x: number; z: number; r: number; o: number }[] = [];
    this.samples(smp);
    for (const p of smp) {
      const res = world.resolveCircle(p.x, p.z, p.r, this.y + 0.25, 1.2);
      if (!res.hit) continue;
      const dx = res.x - p.x;
      const dz = res.z - p.z;
      this.x += dx;
      this.z += dz;
      const vn = this.vx * res.nx + this.vz * res.nz;
      if (vn < 0) {
        const e = 0.25;
        this.vx -= (1 + e) * vn * res.nx;
        this.vz -= (1 + e) * vn * res.nz;
        // spin from off-centre hits
        const torque = p.o * (res.nx * this.fz - res.nz * this.fx);
        this.yawRate += torque * vn * 0.08;
        const sp = -vn;
        if (sp > 3) {
          ev.onImpact(this, sp, res.x - res.nx * p.r, this.y + 0.6, res.z - res.nz * p.r);
          if (sp > 6) this.damage((sp - 5) * (sp - 5) * 3.5 * (this.spec.mass / 1500), ev);
        }
      }
    }
    void dt;
  }

  /** Arcade helicopter: W/S tilt forward/back, A/D yaw, lift climbs/descends. */
  private updateFlight(dt: number, world: StaticWorld, ev: VehicleEvents) {
    const s = this.spec;
    const occupied = this.isPlayer || !!this.driver;
    const want = occupied && !this.destroyed && !this.burning && !this.sinking ? 1 : 0;
    this.rotor = clamp(this.rotor + (want ? dt * 0.45 : -dt * 0.18), 0, 1);
    const power = clamp((this.rotor - 0.5) / 0.5, 0, 1);
    const inp = this.destroyed || this.burning ? { throttle: 0, steer: 0, handbrake: false, lift: -1 } : this.input;
    const fx = this.fx;
    const fz = this.fz;
    const rx = -fz;
    const rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    // vertical: rotor lift fights gravity
    let targetVy = (inp.lift ?? 0) * 9;
    // ground effect: gentle touchdown
    const agl = this.y - Math.max(groundHeight(this.x, this.z), world.supportHeight(this.x, this.z, this.y + 1.5));
    if (targetVy < 0 && agl < 8) targetVy = Math.max(targetVy, -2.5 - agl * 0.4);
    if (!this.burning) {
      this.vy += (targetVy * power - this.vy) * Math.min(1, dt * 2.4 * Math.max(0.2, power));
      this.vy -= 9.8 * (1 - power) * dt;
    } else this.vy -= 9.8 * dt;
    if (this.burning) this.yawRate += 2.5 * dt;
    // horizontal: tilt drives speed
    const targetF = inp.throttle * s.maxSpeed * power;
    vF += (targetF - vF) * Math.min(1, dt * (Math.abs(targetF) > Math.abs(vF) ? 0.55 : 0.9));
    vR *= Math.exp(-1.4 * dt);
    if (!this.burning) this.yawRate = lerp(this.yawRate, -inp.steer * s.steer * Math.max(0.15, power), damp(4, dt));
    this.yaw += this.yawRate * dt;
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;
    this.x = clamp(this.x + this.vx * dt, -1990, 1990);
    this.z = clamp(this.z + this.vz * dt, -1990, 1990);
    this.y = Math.min(450, this.y + this.vy * dt);
    // buildings and props
    const res = world.resolveCircle(this.x, this.z, 3.2, this.y + 0.3, 2.6);
    if (res.hit) {
      const vn = this.vx * res.nx + this.vz * res.nz;
      this.x = res.x;
      this.z = res.z;
      if (vn < 0) {
        this.vx -= 1.4 * vn * res.nx;
        this.vz -= 1.4 * vn * res.nz;
        if (-vn > 4) {
          ev.onImpact(this, -vn, this.x - res.nx * 3, this.y + 2, this.z - res.nz * 3);
          this.damage((-vn - 3) * (-vn - 3) * 14, ev);
        }
      }
    }
    // ground, rooftops and water
    let ground = groundHeight(this.x, this.z);
    const roof = world.supportHeight(this.x, this.z, this.y + 1.5);
    if (roof > ground) ground = roof;
    this.airborne = this.y > ground + 0.25;
    if (this.y <= ground) {
      const impact = -this.vy;
      this.y = ground;
      if (this.vy < 0) this.vy = 0;
      if (impact > 8) this.damage((impact - 7) * 140, ev);
      if (this.burning && !this.destroyed) {
        this.destroyed = true;
        ev.onDestroyed(this);
      }
      // skid friction on the ground
      const k = Math.exp(-3.5 * dt);
      this.vx *= k;
      this.vz *= k;
      if (ground < SEA_LEVEL - 0.6 && !this.sinking) this.sinking = true;
    }
    if (this.sinking) {
      this.y = lerp(this.y, SEA_LEVEL - 2.5, damp(0.6, dt));
      this.hp -= 150 * dt;
      if (this.hp < -200) this.destroyed = true;
    }
    // attitude
    const tilt = this.airborne ? 1 : 0.2;
    this.pitch = lerp(this.pitch, -inp.throttle * 0.22 * power * tilt, damp(3, dt));
    this.roll = lerp(this.roll, (-inp.steer * 0.12 + vR * 0.01) * power * tilt, damp(3, dt));
    if (this.burning && !this.destroyed && Math.random() < 0.8) ev.fire(this.x, this.y + 2, this.z, 1.3);
    if (this.hp < s.hp * 0.35 && !this.destroyed && Math.random() < 0.3) ev.smoke(this.x, this.y + 2.6, this.z, 0.7, 1);
    if (this.hp <= 0 && !this.burning && !this.destroyed) {
      this.burning = true;
      this.burnT = 99;
    }
    this.syncRig(dt, 0);
  }

  syncRig(dt: number, throttle = 0) {
    const r = this.rig;
    const occupied = (this.crewCount > 0 || this.isPlayer || !!this.driver) && !this.destroyed;
    r.driver.visible = occupied && !this.isPlayer && this.crewCount > 0;
    r.driverPlayer.visible = occupied && this.isPlayer;
    r.passenger.visible = !this.destroyed && this.crewCount >= 2;
    if (r.rotor) {
      r.rotor.rotation.y += this.rotor * 32 * dt;
      r.tailRotor!.rotation.x += this.rotor * 45 * dt;
    }
    r.root.position.set(this.x, this.y, this.z);
    r.root.rotation.set(0, this.yaw, 0);
    r.body.rotation.set(-this.pitch + this.visPitch, 0, -this.roll + this.visRoll);
    const vF = this.forwardSpeed;
    for (const w of r.wheels) {
      if (w.front) w.pivot.rotation.y = this.steerAngle;
      w.spin.rotation.x += (vF / this.spec.wheelR) * dt;
      w.pivot.position.y = this.spec.wheelR + (this.airborne ? -0.12 : 0);
    }
    r.body.position.y = this.airborne ? 0.04 : 0;
    const braking = throttle < -0.1 && vF > 0.5;
    const reversing = vF < -0.5;
    r.brake.emissiveIntensity = braking ? 3.5 : reversing ? 2 : this.headlightsOn ? 1.2 : 0.3;
    r.head.emissiveIntensity = this.destroyed ? 0 : this.headlightsOn ? 4 : 0.5;
    if (this.destroyed) {
      r.paint.color.setHex(0x1a1a1a);
      r.paint.clearcoat = 0;
      r.paint.roughness = 0.95;
      r.paint.metalness = 0.1;
    }
    if (r.sirenR && r.sirenB) {
      if (this.siren && !this.destroyed) {
        const t = performance.now() / 1000;
        const ph = Math.floor(t * 8) % 4;
        r.sirenR.emissiveIntensity = ph < 2 ? (ph === 0 ? 8 : 0) : 0;
        r.sirenB.emissiveIntensity = ph >= 2 ? (ph === 2 ? 8 : 0) : 0;
        if (ph === 1) r.sirenR.emissiveIntensity = 6;
        if (ph === 3) r.sirenB.emissiveIntensity = 6;
      } else {
        r.sirenR.emissiveIntensity = 0;
        r.sirenB.emissiveIntensity = 0;
      }
    }
  }

  /** Where the driver exits (left side). */
  exitPoint(side = 1) {
    const rx = -this.fz;
    const rz = this.fx;
    const off = this.spec.width / 2 + 0.7;
    // side 1 = driver (left = -right vector)
    return { x: this.x - rx * off * side + this.fx * 0.4, z: this.z - rz * off * side + this.fz * 0.4 };
  }

  dispose() {
    disposeVehicleRig(this.rig);
  }

  randomizeDamageLook() {
    this.hp = this.spec.hp * rand(0.6, 1);
  }
}
