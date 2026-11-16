import { describe, expect, it } from 'vitest';
import { POIS, RACES, TAPES } from '../content';
import { WEAPONS, WEAPON_ORDER, VEHICLES } from '../data';
import {
  BUILDINGS,
  CURB_H,
  LINES,
  RAMPS,
  ROAD_NODES,
  SEA_LEVEL,
  findPath,
  groundHeight,
  inCityBlock,
  nearestCountryRoad,
  nearestNode,
  onCityRoad,
  terrainHeight,
} from '../world/layout';

const insideBuilding = (x: number, z: number, pad = 0) =>
  BUILDINGS.find((b) => Math.abs(x - b.cx) < b.w / 2 + pad && Math.abs(z - b.cz) < b.d / 2 + pad);

describe('city layout', () => {
  it('city is flat with raised kerbs on blocks', () => {
    expect(terrainHeight(0, 0)).toBe(0);
    expect(onCityRoad(0, 0)).toBe(true);
    expect(groundHeight(0, 0)).toBe(0);
    expect(inCityBlock(45, 45)).toBe(true);
    expect(groundHeight(45, 45)).toBeCloseTo(CURB_H);
  });

  it('no building sits on a city road', () => {
    for (const b of BUILDINGS) {
      if (Math.abs(b.cx) > 372 || Math.abs(b.cz) > 372) continue;
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
        [0, 0],
      ]) {
        expect(onCityRoad(b.cx + (dx * b.w) / 2, b.cz + (dz * b.d) / 2), `${b.style} at ${b.cx},${b.cz}`).toBe(false);
      }
    }
  });

  it('the sea surrounds the island', () => {
    expect(terrainHeight(0, 740)).toBeLessThan(SEA_LEVEL);
    expect(terrainHeight(-740, 0)).toBeLessThan(SEA_LEVEL);
  });

  it('road graph routes between any two intersections', () => {
    const a = nearestNode(-360, -360);
    const b = nearestNode(360, 360);
    const path = findPath(a, b);
    expect(path[0]).toBe(a);
    expect(path[path.length - 1]).toBe(b);
    // Manhattan grid: 8 steps each way
    expect(path.length).toBe(17);
    for (let i = 1; i < path.length; i++) expect(path[i - 1].links).toContain(path[i].id);
    expect(ROAD_NODES.length).toBe(LINES.length * LINES.length);
  });
});

describe('content placement', () => {
  it('points of interest are reachable (not inside buildings)', () => {
    for (const p of POIS) {
      expect(insideBuilding(p.x, p.z), p.id).toBeUndefined();
      if (p.dx !== undefined) expect(onCityRoad(p.dx, p.dz!), `${p.id} drive-in`).toBe(true);
    }
  });

  it('race checkpoints are on roads', () => {
    for (const r of RACES) {
      for (const [x, z] of r.cps) {
        const onRoad = onCityRoad(x, z) || nearestCountryRoad(x, z).dist < 12;
        expect(onRoad, `${r.id} ${x},${z}`).toBe(true);
      }
      expect(r.gold).toBeLessThan(r.silver);
      expect(r.silver).toBeLessThan(r.bronze);
    }
  });

  it('stunt ramps are on land and lift the ground', () => {
    for (const r of RAMPS) {
      expect(terrainHeight(r.x, r.z)).toBeGreaterThan(SEA_LEVEL);
      const top = groundHeight(r.x + Math.sin(r.yaw) * (r.len / 2 - 0.5), r.z + Math.cos(r.yaw) * (r.len / 2 - 0.5));
      expect(top - terrainHeight(r.x, r.z)).toBeGreaterThan(r.h * 0.7);
    }
  });

  it('collectible tapes are on land', () => {
    const onPier = (x: number, z: number) => x > 49 && x < 71 && z > 450 && z < 590;
    for (const [x, z] of TAPES) expect(terrainHeight(x, z) > SEA_LEVEL || onPier(x, z), `${x},${z}`).toBe(true);
  });
});

describe('data', () => {
  it('weapons are consistent', () => {
    expect(WEAPON_ORDER).toHaveLength(8);
    for (const w of WEAPON_ORDER) {
      const s = WEAPONS[w];
      expect(s.rate).toBeGreaterThan(0);
      if (w !== 'fist') {
        expect(s.mag).toBeGreaterThan(0);
        expect(s.maxAmmo).toBeGreaterThanOrEqual(s.mag);
      }
    }
  });

  it('vehicles are consistent', () => {
    for (const v of Object.values(VEHICLES)) {
      expect(v.wheelbase).toBeLessThan(v.length);
      expect(v.maxSpeed).toBeGreaterThan(20);
      expect(v.colors.length).toBeGreaterThan(0);
    }
  });
});
