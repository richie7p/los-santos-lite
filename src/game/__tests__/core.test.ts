import { describe, expect, it } from 'vitest';
import { StaticWorld, rayOBB, raySphere } from '../core/collision';
import { angleDiff, clamp, lerpAngle, rng, wrapAngle } from '../core/math';

describe('math', () => {
  it('wraps angles into [-PI, PI)', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it('interpolates angles the short way round', () => {
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(lerpAngle(3, -3, 1)).toBeCloseTo(3 + (2 * Math.PI - 6));
  });

  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });

  it('seeded rng is deterministic', () => {
    const a = rng(42);
    const b = rng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('collision', () => {
  const w = new StaticWorld();
  w.addBox(0, 0, 10, 10, 0, 20); // spans -5..5
  w.addBox(100, 0, 4, 4, 0, 5);

  it('pushes a circle out of a box along the contact normal', () => {
    const r = w.resolveCircle(5.2, 0, 0.5, 0, 1.8);
    expect(r.hit).toBe(true);
    expect(r.x).toBeCloseTo(5.5);
    expect(r.nx).toBeCloseTo(1);
  });

  it('ignores boxes the circle is above', () => {
    const r = w.resolveCircle(100, 0, 0.5, 6, 1.8);
    expect(r.hit).toBe(false);
  });

  it('raycasts with distance and face normal, across grid cells', () => {
    const h = w.raycast(-50, 1, 0, 1, 0, 0, 200);
    expect(h).not.toBeNull();
    expect(h!.t).toBeCloseTo(45);
    expect(h!.nx).toBe(-1);
    const far = w.raycast(50, 1, 0, 1, 0, 0, 200);
    expect(far!.t).toBeCloseTo(48);
  });

  it('respects the max distance', () => {
    expect(w.raycast(-50, 1, 0, 1, 0, 0, 30)).toBeNull();
  });

  it('reports the support height under a point', () => {
    expect(w.supportHeight(100, 0, 10)).toBe(5);
    expect(w.supportHeight(100, 0, 3)).toBe(-Infinity);
  });

  it('ray vs sphere and rotated box', () => {
    expect(raySphere(0, 0, 0, 0, 0, 1, 0, 0, 10, 1)).toBeCloseTo(9);
    expect(raySphere(0, 0, 0, 0, 0, 1, 5, 0, 10, 1)).toBe(-1);
    // a long thin box rotated 90deg lies along X, so a ray along +Z hits it 2m in front
    const t = rayOBB(3, 0, -10, 0, 0, 1, 0, 0, 0, Math.PI / 2, 0.5, 0.5, 5, 100);
    expect(t).toBeCloseTo(9.5);
  });
});
