/**
 * Port Solara – pure layout data shared by the renderer, physics, AI and maps.
 * Coordinates: X east, Z south, Y up. 1 unit = 1 meter.
 */
import { clamp, fbm, lerp, rng, smoothstep } from '../core/math';

export const PITCH = 90;
export const ROAD_W = 14;
export const HALF_ROAD = ROAD_W / 2;
export const GRID_N = 9; // road lines per axis
export const GRID_MIN = -360;
export const GRID_MAX = 360;
export const LINES: number[] = Array.from({ length: GRID_N }, (_, i) => GRID_MIN + i * PITCH);
export const SIDEWALK_W = 4;
export const CURB_H = 0.18;
export const SEA_LEVEL = -0.6;
export const WORLD_HALF = 760;

export type District = 'downtown' | 'residential' | 'industrial' | 'commercial' | 'park';

export interface BlockInfo {
  i: number;
  j: number;
  cx: number;
  cz: number;
  district: District;
  special?: 'bank' | 'police' | 'hospital' | 'park' | 'plaza' | 'stadium';
}

export interface BuildingDef {
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
  style: 'glass' | 'office' | 'apartment' | 'brick' | 'house' | 'warehouse' | 'shop' | 'civic';
  tint: number;
  roofProps: boolean;
  name?: string;
}

export interface Ramp {
  x: number;
  z: number;
  yaw: number;
  len: number;
  wid: number;
  h: number;
}

export interface CountryRoad {
  id: string;
  pts: [number, number, number][]; // x, y, z
  width: number;
}

export const DISTRICT_NAMES: Record<string, string> = {
  downtown: '中央商務區',
  residential: '綠蔭住宅區',
  industrial: '鐵軌工業區',
  commercial: '海濱商圈',
  park: '日晷公園',
  harbor: '索拉港碼頭',
  beach: '金沙海灘',
  hills: '雲杉丘陵',
  west: '風車原野',
  sea: '外海',
};

// ---------------------------------------------------------------- Ramps
export const RAMPS: Ramp[] = [
  { x: 0, z: -405, yaw: Math.PI, len: 14, wid: 8, h: 3.2 },
  { x: -405, z: 135, yaw: -Math.PI / 2, len: 14, wid: 8, h: 3.4 },
  { x: 180, z: 405, yaw: Math.PI / 2, len: 16, wid: 8, h: 3.6 },
  { x: 470, z: -120, yaw: Math.PI, len: 14, wid: 8, h: 3.0 },
  { x: -135, z: -180, yaw: Math.PI / 2, len: 12, wid: 7, h: 2.4 },
  { x: 225, z: 90, yaw: -Math.PI / 2, len: 12, wid: 7, h: 2.6 },
];

// ---------------------------------------------------------------- Country roads
export const COUNTRY_ROADS: CountryRoad[] = [
  {
    id: 'hill',
    width: 11,
    pts: [
      [0, 0, -367],
      [0, 0.5, -400],
      [30, 3, -440],
      [70, 8, -480],
      [40, 15, -530],
      [-30, 22, -560],
      [-60, 27, -600],
      [-10, 31, -630],
      [30, 33, -640],
    ],
  },
  {
    id: 'west',
    width: 11,
    pts: [
      [-367, 0, 0],
      [-410, 0.4, 0],
      [-460, 2.5, -30],
      [-520, 5, -40],
      [-580, 6, 10],
      [-560, 5, 80],
      [-500, 3, 110],
      [-430, 0.5, 90],
      [-367, 0, 90],
    ],
  },
  {
    id: 'beach',
    width: 12,
    pts: [
      [-367, 0, 395],
      [-200, 0.3, 405],
      [0, 0.3, 405],
      [200, 0.3, 405],
      [367, 0, 395],
    ],
  },
  {
    id: 'harbor',
    width: 12,
    pts: [
      [367, 0, -260],
      [470, 0.2, -260],
      [470, 0.2, 270],
      [367, 0, 270],
    ],
  },
];

/** Closest point on country roads -> {dist, y}. */
export function nearestCountryRoad(x: number, z: number) {
  let best = Infinity;
  let by = 0;
  let bw = 0;
  for (const r of COUNTRY_ROADS) {
    for (let k = 0; k < r.pts.length - 1; k++) {
      const [ax, ay, az] = r.pts[k];
      const [bx, byy, bz] = r.pts[k + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const L2 = dx * dx + dz * dz;
      let t = ((x - ax) * dx + (z - az) * dz) / L2;
      t = clamp(t, 0, 1);
      const px = ax + dx * t;
      const pz = az + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        by = lerp(ay, byy, t);
        bw = r.width;
      }
    }
  }
  return { dist: best, y: by, width: bw };
}

// ---------------------------------------------------------------- Terrain
/** Raw natural terrain (ignores roads). */
function naturalHeight(x: number, z: number) {
  // Distance outside the flat city rectangle
  const ox = Math.max(0, Math.abs(x) - 372);
  const oz = Math.max(0, Math.abs(z) - 372);
  const out = Math.hypot(ox, oz);
  if (out <= 0) return 0;
  const n = fbm(x * 0.012 + 11, z * 0.012 - 7, 4);
  let h = 0;
  if (z < -372) {
    // northern hills / mountain
    const k = smoothstep(0, 230, -z - 372);
    h = k * (18 + 30 * n) + smoothstep(140, 290, -z - 372) * 10;
  } else if (x < -372) {
    // western rolling fields
    h = smoothstep(0, 140, -x - 372) * (3 + 10 * n);
  } else if (x > 372) {
    h = 0.15; // flat harbor
  } else if (z > 372) {
    // beach slopes down toward the sea
    h = 0.3 - smoothstep(0, 150, z - 372) * 1.6;
  }
  // coastline falloff
  const edge = Math.max(Math.abs(x) * (x > 0 ? 1.03 : 0.98), Math.abs(z) * (z > 0 ? 1.18 : 0.93));
  const coast = 600 + fbm(x * 0.008, z * 0.008, 3) * 40;
  if (x > 372 && Math.abs(z) < 330 && x < 585) {
    // harbor quay: crisp concrete edge
    return x < 580 ? 0.15 : -6;
  }
  const drop = smoothstep(coast - 40, coast + 30, edge);
  return lerp(h, -7, drop);
}

export function terrainHeight(x: number, z: number) {
  const nat = naturalHeight(x, z);
  if (Math.abs(x) <= 372 && Math.abs(z) <= 372) return nat;
  const r = nearestCountryRoad(x, z);
  const inner = r.width / 2 + 1;
  if (r.dist > inner + 14) return nat;
  const k = 1 - smoothstep(inner, inner + 14, r.dist);
  return lerp(nat, r.y, k);
}

function rampHeight(x: number, z: number) {
  for (const r of RAMPS) {
    const dx = x - r.x;
    const dz = z - r.z;
    if (Math.abs(dx) > r.len && Math.abs(dz) > r.len) continue;
    const c = Math.cos(r.yaw);
    const s = Math.sin(r.yaw);
    // local frame: lz along ramp facing (yaw), lx sideways
    const lz = dx * s + dz * c;
    const lx = dx * c - dz * s;
    if (Math.abs(lx) <= r.wid / 2 && lz >= -r.len / 2 && lz <= r.len / 2) {
      return ((lz + r.len / 2) / r.len) * r.h;
    }
  }
  return 0;
}

/** Is (x,z) on a city road surface? */
export function onCityRoad(x: number, z: number) {
  if (x < GRID_MIN - HALF_ROAD || x > GRID_MAX + HALF_ROAD || z < GRID_MIN - HALF_ROAD || z > GRID_MAX + HALF_ROAD)
    return false;
  const mx = (((x - GRID_MIN) % PITCH) + PITCH) % PITCH;
  const mz = (((z - GRID_MIN) % PITCH) + PITCH) % PITCH;
  return mx <= HALF_ROAD || mx >= PITCH - HALF_ROAD || mz <= HALF_ROAD || mz >= PITCH - HALF_ROAD;
}

/** Inside a city block (sidewalk or lot)? */
export function inCityBlock(x: number, z: number) {
  if (x < GRID_MIN || x > GRID_MAX || z < GRID_MIN || z > GRID_MAX) return false;
  return !onCityRoad(x, z);
}

/** Walk/drive surface height including curbs and ramps. */
export function groundHeight(x: number, z: number) {
  let h = terrainHeight(x, z);
  if (inCityBlock(x, z)) h += CURB_H;
  const rh = rampHeight(x, z);
  return h + rh;
}

export function districtAt(x: number, z: number): string {
  if (x > 372 && Math.abs(z) < 340) return 'harbor';
  if (z > 380) return terrainHeight(x, z) < SEA_LEVEL ? 'sea' : 'beach';
  if (z < -380) return 'hills';
  if (x < -380) return 'west';
  if (Math.abs(x) > 600 || Math.abs(z) > 600) return 'sea';
  const b = blockAt(x, z);
  if (b) return b.special === 'park' ? 'park' : b.district;
  return 'downtown';
}

// ---------------------------------------------------------------- Blocks
export const BLOCKS: BlockInfo[] = [];
for (let i = 0; i < GRID_N - 1; i++) {
  for (let j = 0; j < GRID_N - 1; j++) {
    const cx = GRID_MIN + PITCH / 2 + i * PITCH;
    const cz = GRID_MIN + PITCH / 2 + j * PITCH;
    let district: District = 'downtown';
    const ring = Math.max(Math.abs(cx), Math.abs(cz));
    if (ring > 140) {
      if (cx > 220) district = 'industrial';
      else if (cz > 220) district = 'commercial';
      else district = 'residential';
    }
    BLOCKS.push({ i, j, cx, cz, district });
  }
}
function setSpecial(cx: number, cz: number, s: BlockInfo['special']) {
  const b = BLOCKS.find((b) => b.cx === cx && b.cz === cz);
  if (b) {
    b.special = s;
    if (s === 'park') b.district = 'park';
  }
}
setSpecial(45, 45, 'park');
setSpecial(-45, -45, 'bank');
setSpecial(-135, 135, 'police');
setSpecial(135, -135, 'hospital');
setSpecial(-45, 45, 'plaza');
setSpecial(-225, -225, 'park');
setSpecial(225, 315, 'stadium');

export function blockAt(x: number, z: number): BlockInfo | undefined {
  if (x < GRID_MIN || x > GRID_MAX || z < GRID_MIN || z > GRID_MAX) return undefined;
  const i = Math.floor((x - GRID_MIN) / PITCH);
  const j = Math.floor((z - GRID_MIN) / PITCH);
  return BLOCKS[i * (GRID_N - 1) + j];
}

// ---------------------------------------------------------------- Buildings
const PALETTE = {
  glass: [0x9fb7c9, 0x7fa3b8, 0xa8b5c0, 0x6f8ea3, 0xb7c4cc],
  office: [0xd9d2c3, 0xc7c0b2, 0xb8b1a5, 0xe2dccf, 0xa9a39a],
  apartment: [0xe8d9c0, 0xd6b99a, 0xc9a98a, 0xe3cfb0, 0xbfa38d, 0xd8c7b5],
  brick: [0xa65a42, 0x8f4a3a, 0xb36b4f, 0x7d4636],
  house: [0xf0e6d2, 0xe6d5b8, 0xd9e2e6, 0xf2d7c4, 0xdde6d0, 0xf4efe6],
  warehouse: [0x8d9399, 0x9aa1a6, 0x7c858c, 0xa59d8f, 0x6f7b85],
  shop: [0xf2e8da, 0xe9dccb, 0xdfe7ea, 0xf7eadf],
  civic: [0xe9e4da, 0xdcd6ca],
};

export const BUILDINGS: BuildingDef[] = [];
const LOT = PITCH - ROAD_W - SIDEWALK_W * 2; // 68

function addB(r: () => number, b: Omit<BuildingDef, 'tint' | 'roofProps'> & { tint?: number; roofProps?: boolean }) {
  const pal = PALETTE[b.style];
  BUILDINGS.push({
    tint: b.tint ?? pal[Math.floor(r() * pal.length)],
    roofProps: b.roofProps ?? (b.style !== 'house' && b.h > 10),
    ...b,
  });
}

export interface ParkDef {
  cx: number;
  cz: number;
  w: number;
  d: number;
}
export const PARKS: ParkDef[] = [];
export const PLAZAS: ParkDef[] = [];

(function genBuildings() {
  const r = rng(1337);
  for (const b of BLOCKS) {
    const { cx, cz } = b;
    const half = LOT / 2;
    if (b.special === 'park') {
      PARKS.push({ cx, cz, w: LOT, d: LOT });
      continue;
    }
    if (b.special === 'plaza') {
      PLAZAS.push({ cx, cz, w: LOT, d: LOT });
      addB(r, { cx: cx, cz: cz - 18, w: 24, d: 14, h: 14, style: 'civic', name: '索拉市政廳' });
      continue;
    }
    if (b.special === 'bank') {
      addB(r, { cx, cz: cz - 6, w: 46, d: 40, h: 34, style: 'civic', name: '太陽海岸聯合銀行' });
      addB(r, { cx: cx - 26, cz: cz + 24, w: 14, d: 16, h: 58, style: 'glass' });
      addB(r, { cx: cx + 26, cz: cz + 24, w: 14, d: 16, h: 44, style: 'glass' });
      continue;
    }
    if (b.special === 'police') {
      addB(r, { cx: cx - 8, cz: cz - 10, w: 40, d: 30, h: 16, style: 'civic', name: '索拉港警察局' });
      addB(r, { cx: cx + 22, cz: cz + 20, w: 18, d: 22, h: 12, style: 'office' });
      continue;
    }
    if (b.special === 'hospital') {
      addB(r, { cx: cx, cz: cz - 8, w: 48, d: 28, h: 26, style: 'civic', name: '聖光綜合醫院' });
      addB(r, { cx: cx - 18, cz: cz + 20, w: 22, d: 18, h: 14, style: 'office' });
      continue;
    }
    if (b.special === 'stadium') {
      addB(r, { cx, cz, w: 56, d: 46, h: 18, style: 'warehouse', tint: 0xd8dde2, name: '海港體育館' });
      continue;
    }
    if (b.district === 'downtown') {
      // 2x2 towers of varying heights
      const dist = Math.hypot(cx, cz);
      const maxH = 150 - dist * 0.55;
      const split = r() < 0.5;
      if (split) {
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            const w = 22 + r() * 8;
            const d = 22 + r() * 8;
            const h = 22 + r() * maxH * 0.8;
            addB(r, {
              cx: cx + sx * (half / 2) + (r() - 0.5) * 3,
              cz: cz + sz * (half / 2) + (r() - 0.5) * 3,
              w,
              d,
              h,
              style: r() < 0.6 ? 'glass' : 'office',
            });
          }
      } else {
        const h = 50 + r() * maxH;
        addB(r, { cx, cz, w: 34 + r() * 10, d: 34 + r() * 10, h, style: 'glass' });
        // podium + side tower
        addB(r, { cx: cx - half + 9, cz: cz + half - 9, w: 16, d: 16, h: 14 + r() * 20, style: 'office' });
        addB(r, { cx: cx + half - 9, cz: cz - half + 9, w: 16, d: 16, h: 14 + r() * 26, style: 'office' });
      }
    } else if (b.district === 'residential') {
      if (r() < 0.45) {
        // apartments
        for (const s of [-1, 1]) {
          addB(r, {
            cx: cx + s * 16,
            cz: cz + (r() - 0.5) * 8,
            w: 24,
            d: 44 + r() * 10,
            h: 14 + r() * 22,
            style: r() < 0.65 ? 'apartment' : 'brick',
          });
        }
      } else {
        // suburban houses around the perimeter
        const n = 3;
        for (let a = 0; a < n; a++) {
          for (let c = 0; c < n; c++) {
            if (a === 1 && c === 1) continue;
            addB(r, {
              cx: cx - half + 11 + a * 23,
              cz: cz - half + 11 + c * 23,
              w: 12 + r() * 3,
              d: 10 + r() * 3,
              h: 5.5 + r() * 3,
              style: 'house',
            });
          }
        }
      }
    } else if (b.district === 'industrial') {
      addB(r, { cx: cx - 10, cz: cz - 8, w: 40, d: 30, h: 10 + r() * 6, style: 'warehouse' });
      addB(r, { cx: cx + 20, cz: cz + 20, w: 22, d: 22, h: 8 + r() * 6, style: r() < 0.5 ? 'brick' : 'warehouse' });
      if (r() < 0.5) addB(r, { cx: cx - 20, cz: cz + 22, w: 18, d: 16, h: 18, style: 'brick' });
    } else if (b.district === 'commercial') {
      for (const s of [-1, 1]) {
        addB(r, { cx: cx + s * 17, cz: cz - 14, w: 28, d: 26, h: 7 + r() * 8, style: 'shop' });
        addB(r, { cx: cx + s * 17, cz: cz + 16, w: 26, d: 24, h: 10 + r() * 20, style: r() < 0.5 ? 'apartment' : 'office' });
      }
    }
  }
  // Harbor warehouses
  for (let k = 0; k < 5; k++) {
    addB(r, { cx: 430, cz: -200 + k * 95, w: 34, d: 50, h: 12 + r() * 4, style: 'warehouse' });
  }
  // Beach front shops
  for (let k = -3; k <= 3; k++) {
    if (k === 0) continue;
    addB(r, { cx: k * 90, cz: 380, w: 16, d: 8, h: 5, style: 'shop' });
  }
  // Hill observatory & houses
  addB(r, { cx: 30, cz: -665, w: 26, d: 18, h: 10, style: 'civic', name: '雲杉天文台' });
  for (let k = 0; k < 7; k++) {
    const x = -140 + k * 45 + (r() - 0.5) * 20;
    const z = -440 - r() * 70;
    const rr = nearestCountryRoad(x, z);
    if (rr.dist < 18) continue;
    addB(r, { cx: x, cz: z, w: 14, d: 12, h: 7, style: 'house' });
  }
  // farm barns west
  addB(r, { cx: -620, cz: -60, w: 20, d: 14, h: 8, style: 'brick' });
  addB(r, { cx: -470, cz: 160, w: 16, d: 12, h: 6, style: 'house' });
})();

// Pre-compute building base heights (terrain may be uneven outside city)
export function buildingBase(b: BuildingDef) {
  if (Math.abs(b.cx) < 372 && Math.abs(b.cz) < 372) return CURB_H;
  let mn = Infinity;
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, 0],
  ]) {
    mn = Math.min(mn, terrainHeight(b.cx + (dx * b.w) / 2, b.cz + (dz * b.d) / 2));
  }
  return mn;
}

// ---------------------------------------------------------------- Road graph (city grid)
export interface RoadNode {
  id: number;
  x: number;
  z: number;
  links: number[];
}
export const ROAD_NODES: RoadNode[] = [];
(function genGraph() {
  for (let i = 0; i < GRID_N; i++)
    for (let j = 0; j < GRID_N; j++) ROAD_NODES.push({ id: i * GRID_N + j, x: LINES[i], z: LINES[j], links: [] });
  for (let i = 0; i < GRID_N; i++)
    for (let j = 0; j < GRID_N; j++) {
      const n = ROAD_NODES[i * GRID_N + j];
      if (i > 0) n.links.push((i - 1) * GRID_N + j);
      if (i < GRID_N - 1) n.links.push((i + 1) * GRID_N + j);
      if (j > 0) n.links.push(i * GRID_N + j - 1);
      if (j < GRID_N - 1) n.links.push(i * GRID_N + j + 1);
    }
})();

export function nearestNode(x: number, z: number) {
  const i = clamp(Math.round((x - GRID_MIN) / PITCH), 0, GRID_N - 1);
  const j = clamp(Math.round((z - GRID_MIN) / PITCH), 0, GRID_N - 1);
  return ROAD_NODES[i * GRID_N + j];
}

/** BFS/A* shortest path through the city grid; returns node list. */
export function findPath(from: RoadNode, to: RoadNode): RoadNode[] {
  if (from === to) return [from];
  const prev = new Map<number, number>();
  const g = new Map<number, number>([[from.id, 0]]);
  const open: RoadNode[] = [from];
  const closed = new Set<number>();
  while (open.length) {
    let bi = 0;
    let bf = Infinity;
    for (let k = 0; k < open.length; k++) {
      const n = open[k];
      const f = (g.get(n.id) ?? 0) + Math.abs(n.x - to.x) + Math.abs(n.z - to.z);
      if (f < bf) {
        bf = f;
        bi = k;
      }
    }
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    closed.add(cur.id);
    for (const l of cur.links) {
      if (closed.has(l)) continue;
      const nb = ROAD_NODES[l];
      const ng = (g.get(cur.id) ?? 0) + PITCH;
      if (ng < (g.get(l) ?? Infinity)) {
        g.set(l, ng);
        prev.set(l, cur.id);
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  const path: RoadNode[] = [];
  let c: number | undefined = to.id;
  while (c !== undefined) {
    path.unshift(ROAD_NODES[c]);
    if (c === from.id) break;
    c = prev.get(c);
  }
  return path;
}

/** Random sidewalk point (for pedestrians). */
export function randomSidewalkPoint(r: () => number = Math.random) {
  const b = BLOCKS[Math.floor(r() * BLOCKS.length)];
  return sidewalkPointOnBlock(b, r() * 4, r());
}

/** Point on the sidewalk ring of a block. side 0..4 (float), t 0..1 */
export function sidewalkPointOnBlock(b: BlockInfo, side: number, t: number) {
  const e = PITCH / 2 - HALF_ROAD - SIDEWALK_W / 2; // distance from block center to sidewalk mid-line
  const s = Math.floor(side) % 4;
  const u = -e + t * 2 * e;
  if (s === 0) return { x: b.cx + u, z: b.cz - e };
  if (s === 1) return { x: b.cx + e, z: b.cz + u };
  if (s === 2) return { x: b.cx - u, z: b.cz + e };
  return { x: b.cx - e, z: b.cz - u };
}
export const SIDEWALK_RING = PITCH / 2 - HALF_ROAD - SIDEWALK_W / 2;
