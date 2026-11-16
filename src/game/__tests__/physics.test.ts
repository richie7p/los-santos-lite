import { describe, expect, it } from 'vitest';
import { StaticWorld } from '../core/collision';
import { Actor } from '../entities/actor';
import { playerOutfit } from '../entities/character';
import { Vehicle, type VehicleEvents } from '../entities/vehicle';

const events = (): VehicleEvents & { impacts: number; destroyed: number } => {
  const e = {
    impacts: 0,
    destroyed: 0,
    onImpact: () => void e.impacts++,
    onLand: () => {},
    onDestroyed: () => void e.destroyed++,
    skid: () => {},
    smoke: () => {},
    fire: () => {},
    tireSmoke: () => {},
  };
  return e;
};

const step = (v: Vehicle, w: StaticWorld, ev: VehicleEvents, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) v.update(1 / 60, w, ev);
};

describe('vehicle physics', () => {
  it('accelerates forward and respects its top speed', () => {
    const w = new StaticWorld();
    const v = new Vehicle('sedan', 0xffffff);
    v.place(0, -200, 0); // on the road x=0, facing +Z
    v.input = { throttle: 1, steer: 0, handbrake: false };
    const ev = events();
    step(v, w, ev, 2);
    expect(v.forwardSpeed).toBeGreaterThan(10);
    expect(v.z).toBeGreaterThan(-200);
    step(v, w, ev, 20);
    expect(v.forwardSpeed).toBeLessThanOrEqual(v.spec.maxSpeed + 0.5);
  });

  it('steers right when steer is positive', () => {
    const w = new StaticWorld();
    const v = new Vehicle('sedan', 0xffffff);
    v.place(0, -200, 0);
    v.vz = 15;
    v.input = { throttle: 0.5, steer: 1, handbrake: false };
    step(v, w, events(), 1);
    // facing +Z, the right-hand side is -X and yaw decreases
    expect(v.yaw).toBeLessThan(-0.2);
    expect(v.x).toBeLessThan(0);
  });

  it('stops at a wall, reports the impact and takes damage', () => {
    const w = new StaticWorld();
    w.addBox(0, -180, 20, 2, -1, 10);
    const v = new Vehicle('sedan', 0xffffff);
    v.place(0, -200, 0);
    v.vz = 25;
    v.input = { throttle: 1, steer: 0, handbrake: false };
    const ev = events();
    step(v, w, ev, 2);
    expect(v.z).toBeLessThan(-180);
    expect(ev.impacts).toBeGreaterThan(0);
    expect(v.hp).toBeLessThan(v.spec.hp);
  });

  it('brakes and reverses', () => {
    const w = new StaticWorld();
    const v = new Vehicle('compact', 0xffffff);
    v.place(0, -200, 0);
    v.vz = 10;
    v.input = { throttle: -1, steer: 0, handbrake: false };
    step(v, w, events(), 3);
    expect(v.forwardSpeed).toBeLessThan(0);
  });
});

describe('actor movement', () => {
  it('walks and is blocked by walls', () => {
    const w = new StaticWorld();
    w.addBox(0, 10, 20, 2, -1, 10); // wall from z=9..11
    const a = new Actor('player', playerOutfit());
    a.setPos(0, 0);
    for (let t = 0; t < 5; t += 1 / 60) a.move(1 / 60, w, 0, 5);
    expect(a.z).toBeGreaterThan(8);
    expect(a.z).toBeLessThanOrEqual(9 - a.radius + 0.01);
  });

  it('jumps and lands', () => {
    const w = new StaticWorld();
    const a = new Actor('player', playerOutfit());
    a.setPos(0, 0);
    a.jump();
    let maxY = 0;
    for (let t = 0; t < 2; t += 1 / 60) {
      a.move(1 / 60, w, 0, 0);
      maxY = Math.max(maxY, a.y);
    }
    expect(maxY).toBeGreaterThan(0.6);
    expect(a.onGround).toBe(true);
    expect(a.y).toBeCloseTo(0, 1);
  });
});
