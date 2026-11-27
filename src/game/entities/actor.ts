/** A person in the world: the player, pedestrians, police and enemies. */
import * as THREE from 'three';
import { clamp, damp, lerpAngle } from '../core/math';
import type { StaticWorld } from '../core/collision';
import { type WeaponId } from '../data';
import { groundHeight, SEA_LEVEL } from '../world/layout';
import { CharacterRig, type Outfit, type Pose } from './character';
import type { Vehicle } from './vehicle';

export type Team = 'player' | 'civilian' | 'police' | 'gang' | 'enemy' | 'ally';

export type AIMode = 'wander' | 'cross' | 'flee' | 'cower' | 'chase' | 'attack' | 'guard' | 'idle' | 'follow' | 'drive' | 'handsUp' | 'roam' | 'chat';

export interface AIState {
  mode: AIMode;
  blockIdx: number;
  perim: number;
  dir: 1 | -1;
  lane: number;
  speed: number;
  tx: number;
  tz: number;
  timer: number;
  fireCd: number;
  burst: number;
  alerted: boolean;
  homeX: number;
  homeZ: number;
  strafe: number;
  accuracy: number;
  aggro: boolean;
  lastSeenX: number;
  lastSeenZ: number;
  losT: number;
  /** >0: pedestrian roams around (homeX, homeZ) instead of using city sidewalks. */
  roamR: number;
}

let NEXT_ID = 1;

export class Actor {
  readonly id = NEXT_ID++;
  readonly rig: CharacterRig;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  yaw = 0;
  hp = 100;
  maxHp = 100;
  armor = 0;
  dead = false;
  deadTime = 0;
  onGround = true;
  inWater = false;
  speed = 0;
  pose: Pose = 'idle';
  aimPitch = 0;
  sprinting = false;
  weapon: WeaponId = 'fist';
  vehicle: Vehicle | null = null;
  radius = 0.32;
  tag = '';
  /** Reward for killing (mission targets). */
  bounty = 0;
  knock = { x: 0, z: 0 };
  ai: AIState;
  lastHitBy: Actor | null = null;
  invuln = 0;
  blip: 'enemy' | 'target' | 'ally' | null = null;
  farLod = false;

  constructor(
    public team: Team,
    outfit: Outfit,
  ) {
    this.rig = new CharacterRig(outfit);
    this.ai = {
      mode: 'idle',
      blockIdx: 0,
      perim: 0,
      dir: 1,
      lane: 0,
      speed: 1.4,
      tx: 0,
      tz: 0,
      timer: 0,
      fireCd: 0,
      burst: 0,
      alerted: false,
      homeX: 0,
      homeZ: 0,
      strafe: 1,
      accuracy: 0.35,
      aggro: false,
      lastSeenX: 0,
      lastSeenZ: 0,
      losT: 0,
      roamR: 0,
    };
  }

  setPos(x: number, z: number, y?: number) {
    this.x = x;
    this.z = z;
    this.y = y ?? groundHeight(x, z);
    this.vx = this.vz = this.vy = 0;
    this.syncRig();
  }

  setWeapon(w: WeaponId) {
    this.weapon = w;
    this.rig.setWeapon(w);
  }

  syncRig() {
    this.rig.root.position.set(this.x, this.y, this.z);
    this.rig.root.rotation.y = this.yaw;
  }

  /** Approximate hit spheres: [x,y,z,r,isHead]. */
  hitSpheres(out: [number, number, number, number, boolean][]) {
    out.length = 0;
    if (this.dead) {
      // lying on the ground
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      for (let k = 0; k < 3; k++) out.push([this.x - fx * (0.3 + k * 0.5), this.y + 0.2, this.z - fz * (0.3 + k * 0.5), 0.3, k === 2]);
      return out;
    }
    const crouch = this.pose === 'cower' ? -0.35 : 0;
    out.push([this.x, this.y + 0.55 + crouch, this.z, 0.3, false]);
    out.push([this.x, this.y + 1.0 + crouch, this.z, 0.3, false]);
    out.push([this.x, this.y + 1.35 + crouch, this.z, 0.27, false]);
    out.push([this.x, this.y + 1.68 + crouch, this.z, 0.15, true]);
    return out;
  }

  get headY() {
    return this.y + 1.65;
  }
  get chestY() {
    return this.y + 1.25;
  }

  /**
   * Integrate horizontal movement toward a desired velocity, with collision against
   * static boxes and simple gravity / ground following.
   */
  move(dt: number, world: StaticWorld, wishX: number, wishZ: number, accel = 30, faceMove = true) {
    if (this.vehicle) return;
    const k = damp(this.onGround ? accel / 4 : 1.5, dt);
    this.vx += (wishX - this.vx) * k + this.knock.x;
    this.vz += (wishZ - this.vz) * k + this.knock.z;
    this.knock.x = this.knock.z = 0;
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    // world bounds
    nx = clamp(nx, -1990, 1990);
    nz = clamp(nz, -1990, 1990);
    const res = world.resolveCircle(nx, nz, this.radius, this.y + 0.3, 1.5);
    if (res.hit) {
      // remove velocity into the wall
      const vn = this.vx * res.nx + this.vz * res.nz;
      if (vn < 0) {
        this.vx -= vn * res.nx;
        this.vz -= vn * res.nz;
      }
    }
    this.x = res.x;
    this.z = res.z;
    this.speed = Math.hypot(this.vx, this.vz);
    if (faceMove && this.speed > 0.4) this.yaw = lerpAngle(this.yaw, Math.atan2(this.vx, this.vz), damp(10, dt));
    // vertical
    let g = groundHeight(this.x, this.z);
    // standing on low boxes (pier deck etc.)
    const sup = world.supportHeight(this.x, this.z, this.y + 0.6);
    if (sup > g) g = sup;
    this.inWater = g < SEA_LEVEL - 0.9;
    if (this.inWater) g = SEA_LEVEL - 1.2;
    if (this.onGround) {
      if (g < this.y - 0.5) {
        this.onGround = false;
      } else {
        // smooth step up/down
        this.y += (g - this.y) * damp(25, dt);
        this.vy = 0;
      }
    }
    if (!this.onGround) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        this.y = g;
        this.onGround = true;
        const impact = -this.vy;
        this.vy = 0;
        return impact;
      }
    }
    return 0;
  }

  jump(v = 6.2) {
    if (this.onGround && !this.inWater) {
      this.vy = v;
      this.onGround = false;
    }
  }

  animate(dt: number) {
    this.rig.animate(dt, this.dead ? 'dead' : this.pose, this.speed, this.aimPitch, this.sprinting);
    this.syncRig();
  }

  dispose(scene: THREE.Object3D) {
    scene.remove(this.rig.root);
    this.rig.dispose();
  }
}
