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
export const WORLD_HALF = 2000;

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
  desert: '塵水沙漠',
  town: '塵水鎮',
  airport: '索拉國際機場',
  mountain: '北嶺山脈',
  lake: '鏡湖林區',
  forest: '杉林高地',
  highway: '環島快速道路',
};

// ---------------------------------------------------------------- Ramps
export const RAMPS: Ramp[] = [
  { x: -110, z: 405, yaw: -Math.PI / 2, len: 14, wid: 8, h: 3.2 },
  { x: -405, z: 135, yaw: -Math.PI / 2, len: 14, wid: 8, h: 3.4 },
  { x: 180, z: 405, yaw: Math.PI / 2, len: 16, wid: 8, h: 3.6 },
  { x: 470, z: -120, yaw: Math.PI, len: 14, wid: 8, h: 3.0 },
  { x: -135, z: -180, yaw: Math.PI / 2, len: 12, wid: 7, h: 2.4 },
  { x: 225, z: 90, yaw: -Math.PI / 2, len: 12, wid: 7, h: 2.6 },
  // desert & airport
  { x: -1000, z: -500, yaw: Math.PI / 2, len: 18, wid: 9, h: 4.5 },
  { x: -1500, z: 250, yaw: Math.PI, len: 16, wid: 9, h: 4.0 },
  { x: -700, z: 760, yaw: -Math.PI / 2, len: 20, wid: 10, h: 5.0 },
];

// ---------------------------------------------------------------- Country roads & highways
/** Control points [x, z]; heights are derived from the terrain and smoothed. */
interface RoadDef {
  id: string;
  width: number;
  pts: [number, number][];
  highway?: boolean;
}
const ROAD_DEFS: RoadDef[] = [
  { id: 'hill', width: 11, pts: [[0, -367], [0, -400], [30, -440], [70, -480], [40, -530], [-30, -560], [-60, -600], [-10, -630], [30, -640]] },
  { id: 'west', width: 11, pts: [[-367, 0], [-410, 0], [-460, -30], [-520, -40], [-580, 10], [-560, 80], [-500, 110], [-430, 90], [-367, 90]] },
  { id: 'beach', width: 12, pts: [[-360, 367], [-330, 400], [-200, 405], [0, 405], [200, 405], [330, 400], [360, 367]] },
  { id: 'harbor', width: 12, pts: [[367, -270], [470, -270], [470, 270], [367, 270]] },
  {
    id: 'ring',
    width: 16,
    highway: true,
    pts: [
      [-367, -180], [-480, -200], [-650, -220], [-900, -160], [-1100, -110], [-1250, -100], [-1400, -150], [-1520, -320],
      [-1560, -650], [-1420, -1000], [-1150, -1280], [-750, -1450], [-300, -1520], [150, -1480], [550, -1330], [850, -1100],
      [980, -800], [900, -520], [700, -400], [560, -330], [470, -270],
    ],
  },
  { id: 'southwest', width: 12, pts: [[-1250, -100], [-1230, 150], [-1150, 400], [-1000, 600], [-850, 640], [-650, 560], [-480, 450], [-360, 367]] },
  { id: 'terminal', width: 12, pts: [[-850, 640], [-900, 690], [-1000, 700], [-1200, 700]] },
  { id: 'summit', width: 10, pts: [[-750, -1450], [-620, -1380], [-480, -1300], [-380, -1230], [-320, -1180]] },
  { id: 'lake', width: 10, pts: [[850, -1100], [760, -1030], [660, -1010], [560, -1000]] },
];

export interface CountryRoad {
  id: string;
  /** Densified points with smoothed heights: [x, y, z]. */
  pts: [number, number, number][];
  /** Original control points with heights (straight segments between them). */
  ctrl: [number, number, number][];
  width: number;
  highway: boolean;
}

// ---------------------------------------------------------------- Terrain
const inCityRect = (x: number, z: number, m = 0) => Math.abs(x) <= 372 + m && Math.abs(z) <= 372 + m;

/** Island outline (clockwise). Land is inside. */
const COAST: [number, number][] = [
  [-1800, -1780], [-900, -1830], [0, -1810], [700, -1770], [1150, -1520], [1260, -1000], [1180, -600], [950, -430],
  [640, -345], [600, -330], [600, 330], [640, 420], [560, 560], [300, 640], [0, 660], [-300, 640], [-470, 780],
  [-540, 1010], [-760, 1130], [-1200, 1160], [-1620, 1060], [-1830, 700], [-1890, 0], [-1860, -900],
];

function coastSigned(x: number, z: number) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = COAST.length - 1; i < COAST.length; j = i++) {
    const [xi, zi] = COAST[i];
    const [xj, zj] = COAST[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi;
    const dz = zj - zi;
    const t = clamp(((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - (xi + dx * t), z - (zi + dz * t)));
  }
  return inside ? best : -best;
}

interface Bump {
  x: number;
  z: number;
  h: number;
  r: number;
}
const BUMPS: Bump[] = [
  { x: 10, z: -650, h: 30, r: 200 }, // Spruce Hill (observatory)
  { x: -260, z: -1080, h: 190, r: 330 }, // North Ridge summit
  { x: 260, z: -1000, h: 140, r: 300 },
  { x: -880, z: -940, h: 120, r: 300 },
  { x: 650, z: -1480, h: 80, r: 240 },
  { x: -1450, z: -1320, h: 110, r: 260 },
  { x: -1650, z: 650, h: 60, r: 220 },
];
export const LAKE = { x: 730, z: -830, r: 150 };
export const AIRPORT = { minX: -1420, maxX: -560, minZ: 620, maxZ: 920, y: 1.5 };
export const TOWN = { x: -1250, z: -100, r: 260, y: 9 };

const gauss = (d: number, r: number) => Math.exp(-(d * d) / (r * r));

/** Biome weights for colouring and props. */
export function biomeAt(x: number, z: number) {
  // irregular edges so the desert does not end on a straight line
  const wob = (fbm(x * 0.0025 + 40, z * 0.0025 - 13, 3) - 0.5) * 520;
  const desert = smoothstep(-620, -980, x + wob) * (1 - smoothstep(330, 620, z - wob * 0.8));
  const beach = z > 372 && x > -520 ? smoothstep(372, 400, z) * smoothstep(-520, -420, x) * (1 - smoothstep(600, 660, x)) : 0;
  const airport = rectWeight(x, z, AIRPORT.minX, AIRPORT.maxX, AIRPORT.minZ, AIRPORT.maxZ, 70);
  const harbor = x > 372 && Math.abs(z) < 330 ? 1 : 0;
  const forest = smoothstep(300, 600, x) * smoothstep(-450, -700, z);
  return { desert, beach, airport, harbor, forest };
}

function rectWeight(x: number, z: number, x0: number, x1: number, z0: number, z1: number, fall: number) {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  return 1 - smoothstep(0, fall, Math.hypot(dx, dz));
}

/** Raw natural terrain (ignores roads). */
function naturalHeight(x: number, z: number) {
  if (inCityRect(x, z)) return 0;
  // harbor quay: crisp concrete edge
  if (x > 372 && Math.abs(z) < 330) return x < 585 ? 0.15 : x < 640 ? -6 : -8;
  const ox = Math.max(0, Math.abs(x) - 372);
  const oz = Math.max(0, Math.abs(z) - 372);
  const out = Math.hypot(ox, oz);
  const n = fbm(x * 0.006 + 11, z * 0.006 - 7, 4);
  let h = smoothstep(0, 260, out) * (5 + 16 * n);
  // mountains & hills
  for (const b of BUMPS) {
    const d = Math.hypot(x - b.x, z - b.z);
    if (d < b.r * 2.4) h += b.h * gauss(d, b.r) * (0.75 + 0.5 * n);
  }
  // ridged detail in the north
  const north = smoothstep(-700, -1100, z);
  if (north > 0) h += north * Math.abs(fbm(x * 0.004 - 3, z * 0.004 + 5, 4) - 0.5) * 140;
  const bio = biomeAt(x, z);
  // desert flats with gentle dunes
  if (bio.desert > 0) h = lerp(h, 8 + 5 * fbm(x * 0.01, z * 0.01, 3), bio.desert * (1 - north));
  // town plateau
  const td = Math.hypot(x - TOWN.x, z - TOWN.z);
  if (td < TOWN.r) h = lerp(h, TOWN.y, 1 - smoothstep(TOWN.r * 0.6, TOWN.r, td));
  // airport
  if (bio.airport > 0) h = lerp(h, AIRPORT.y, bio.airport);
  // beach slopes into the sea
  if (bio.beach > 0) h = lerp(h, 0.3 - smoothstep(0, 150, z - 372) * 1.6, bio.beach);
  // lake basin (filled by the global water plane)
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (ld < LAKE.r * 1.6) h = lerp(h, -4.5, 1 - smoothstep(LAKE.r * 0.7, LAKE.r * 1.35, ld));
  // coastline
  const sd = coastSigned(x, z) + (fbm(x * 0.008, z * 0.008, 3) - 0.5) * 70;
  return lerp(-8, h, smoothstep(-10, 70, sd));
}

// ---- roads: derive heights from terrain, then smooth and limit the grade
function buildRoad(def: RoadDef): CountryRoad {
  const dense: [number, number, number][] = [];
  const ctrlIdx: number[] = [];
  for (let k = 0; k < def.pts.length - 1; k++) {
    const [ax, az] = def.pts[k];
    const [bx, bz] = def.pts[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 15));
    ctrlIdx.push(dense.length);
    for (let s = 0; s < n; s++) {
      const t = s / n;
      dense.push([ax + (bx - ax) * t, 0, az + (bz - az) * t]);
    }
  }
  ctrlIdx.push(dense.length);
  const last = def.pts[def.pts.length - 1];
  dense.push([last[0], 0, last[1]]);
  const pinned = dense.map(([x, , z]) => inCityRect(x, z, 2));
  for (const p of dense) p[1] = Math.max(naturalHeight(p[0], p[2]), SEA_LEVEL + 1.2);
  for (let i = 0; i < dense.length; i++) if (pinned[i]) dense[i][1] = 0;
  // moving average
  for (let pass = 0; pass < 6; pass++) {
    const ys = dense.map((p) => p[1]);
    for (let i = 0; i < dense.length; i++) {
      if (pinned[i]) continue;
      let sum = 0;
      let c = 0;
      for (let k = -4; k <= 4; k++) {
        const j = i + k;
        if (j < 0 || j >= dense.length) continue;
        sum += ys[j];
        c++;
      }
      dense[i][1] = Math.max(sum / c, SEA_LEVEL + 1.2);
    }
  }
  // grade limit (max 11%)
  const G = 0.11;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < dense.length; i++) {
      const d = Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][2] - dense[i - 1][2]);
      if (!pinned[i]) dense[i][1] = clamp(dense[i][1], dense[i - 1][1] - d * G, dense[i - 1][1] + d * G);
    }
    for (let i = dense.length - 2; i >= 0; i--) {
      const d = Math.hypot(dense[i][0] - dense[i + 1][0], dense[i][2] - dense[i + 1][2]);
      if (!pinned[i]) dense[i][1] = clamp(dense[i][1], dense[i + 1][1] - d * G, dense[i + 1][1] + d * G);
    }
  }
  const ctrl = ctrlIdx.map((i) => dense[i]);
  return { id: def.id, pts: dense, ctrl, width: def.width, highway: !!def.highway };
}

export const COUNTRY_ROADS: CountryRoad[] = ROAD_DEFS.map(buildRoad);

// spatial index of road segments for fast nearest-road queries
const ROAD_CELL = 100;
const ROAD_REACH = 40;
interface Seg {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  w: number;
}
const roadCells = new Map<number, Seg[]>();
const cellKey = (cx: number, cz: number) => (cx + 500) * 1000 + (cz + 500);
for (const r of COUNTRY_ROADS) {
  for (let k = 0; k < r.pts.length - 1; k++) {
    const [ax, ay, az] = r.pts[k];
    const [bx, by, bz] = r.pts[k + 1];
    const seg: Seg = { ax, ay, az, bx, by, bz, w: r.width };
    const x0 = Math.floor((Math.min(ax, bx) - ROAD_REACH) / ROAD_CELL);
    const x1 = Math.floor((Math.max(ax, bx) + ROAD_REACH) / ROAD_CELL);
    const z0 = Math.floor((Math.min(az, bz) - ROAD_REACH) / ROAD_CELL);
    const z1 = Math.floor((Math.max(az, bz) + ROAD_REACH) / ROAD_CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const key = cellKey(cx, cz);
        let arr = roadCells.get(key);
        if (!arr) roadCells.set(key, (arr = []));
        arr.push(seg);
      }
  }
}

/** Closest point on country roads -> {dist, y, width}. Only roads within ~40 m are considered. */
export function nearestCountryRoad(x: number, z: number) {
  let best = Infinity;
  let by = 0;
  let bw = 0;
  const arr = roadCells.get(cellKey(Math.floor(x / ROAD_CELL), Math.floor(z / ROAD_CELL)));
  if (arr) {
    for (const s of arr) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? clamp(((x - s.ax) * dx + (z - s.az) * dz) / L2, 0, 1) : 0;
      const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t));
      if (d < best) {
        best = d;
        by = lerp(s.ay, s.by, t);
        bw = s.w;
      }
    }
  }
  return { dist: best, y: by, width: bw };
}

export function terrainHeight(x: number, z: number) {
  const nat = naturalHeight(x, z);
  if (inCityRect(x, z)) return nat;
  const r = nearestCountryRoad(x, z);
  const inner = r.width / 2 + 1;
  if (r.dist > inner + 16) return nat;
  const k = 1 - smoothstep(inner, inner + 16, r.dist);
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
  if (terrainHeight(x, z) < SEA_LEVEL - 0.5) return Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.4 ? 'lake' : 'sea';
  if (x > 372 && Math.abs(z) < 340) return 'harbor';
  if (inCityRect(x, z)) {
    const b = blockAt(x, z);
    if (b) return b.special === 'park' ? 'park' : b.district;
    return 'downtown';
  }
  const r = nearestCountryRoad(x, z);
  if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r) return 'town';
  const bio = biomeAt(x, z);
  if (bio.airport > 0.5) return 'airport';
  if (r.dist < 12 && r.width >= 16) return 'highway';
  if (bio.beach > 0.5) return 'beach';
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 2.2) return 'lake';
  if (z < -800) return 'mountain';
  if (bio.forest > 0.5) return 'forest';
  if (bio.desert > 0.5) return 'desert';
  if (z < -380) return 'hills';
  return 'west';
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

export const GAS_STATIONS = [
  { x: -1200, z: -60, yaw: Math.PI, name: '快加油 · 塵水站' },
  { x: 1000, z: -690, yaw: -Math.PI / 2, name: '快加油 · 北線站' },
  { x: -640, z: -260, yaw: 0, name: '快加油 · 西郊站' },
];
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

  // ---- Dustwater town (along the ring highway)
  const place = (b: Omit<BuildingDef, 'tint' | 'roofProps'> & { tint?: number }) => {
    if (clearOfRoads(b.cx, b.cz, b.w, b.d)) addB(r, b);
  };
  const townRow: [number, number, number, number, BuildingDef['style'], string?][] = [
    // x, side (+1 south / -1 north), width, height, style, name
    [-1370, -1, 34, 7, 'brick', '仙人掌汽車旅館'],
    [-1325, -1, 18, 5, 'shop', '塵水小館'],
    [-1290, -1, 20, 6, 'shop'],
    [-1215, -1, 24, 8, 'civic', '塵水鎮警長辦公室'],
    [-1170, -1, 22, 7, 'civic', '塵水鎮診所'],
    [-1130, -1, 16, 5, 'shop'],
    [-1365, 1, 20, 6, 'warehouse'],
    [-1320, 1, 16, 5, 'house'],
    [-1255, 1, 22, 7, 'brick', '老鷹酒吧'],
    [-1160, 1, 18, 5, 'shop', '鐵砧槍械行 · 沙漠店'],
    [-1120, 1, 14, 5, 'house'],
  ];
  for (const [x, side, w, h, style, name] of townRow) {
    const rz = townRoadZ(x);
    place({ cx: x, cz: rz + side * 26, w, d: 16, h, style, name });
  }
  for (let k = 0; k < 14; k++) {
    const x = -1400 + k * 22 + (r() - 0.5) * 6;
    const side = k % 2 ? 1 : -1;
    place({ cx: x, cz: townRoadZ(x) + side * (70 + r() * 30), w: 11, d: 9, h: 4.5, style: 'house' });
  }
  // gas station kiosks
  for (const g of GAS_STATIONS) place({ cx: g.x, cz: g.z, w: 16, d: 10, h: 5, style: 'shop', name: g.name });

  // ---- Solara International Airport
  addB(r, { cx: -1100, cz: 738, w: 180, d: 40, h: 22, style: 'glass', name: '索拉國際機場', tint: 0xa8c0d0 });
  addB(r, { cx: -800, cz: 745, w: 10, d: 10, h: 36, style: 'civic' });
  for (const [x, z] of [
    [-1330, 760],
    [-1385, 690],
  ])
    addB(r, { cx: x, cz: z, w: 52, d: 40, h: 16, style: 'warehouse', tint: 0xc8ced4 });

  // ---- Mirror Lake lodge & cabins
  addB(r, { cx: 515, cz: -1015, w: 26, d: 18, h: 9, style: 'brick', name: '鏡湖山莊' });
  for (const [x, z] of [
    [600, -1065],
    [645, -1080],
    [470, -965],
    [455, -1050],
  ])
    place({ cx: x, cz: z, w: 10, d: 8, h: 5, style: 'house' });

  // ---- North Ridge relay station
  addB(r, { cx: -300, cz: -1160, w: 14, d: 10, h: 6, style: 'civic', name: '北嶺轉播站' });
})();

/** Z of the ring highway through Dustwater for a given X. */
function townRoadZ(x: number) {
  if (x < -1250) return -150 + ((x + 1400) / 150) * 50;
  return -100 + ((x + 1250) / 150) * -10;
}

/** True when a footprint stays clear of all country roads. */
function clearOfRoads(cx: number, cz: number, w: number, d: number) {
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const rr = nearestCountryRoad(cx + (dx * w) / 2, cz + (dz * d) / 2);
    if (rr.dist < rr.width / 2 + 2) return false;
  }
  return true;
}

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

// ---------------------------------------------------------------- Road graph (city grid + country roads)
export interface RoadNode {
  id: number;
  x: number;
  z: number;
  links: number[];
}
export const ROAD_NODES: RoadNode[] = [];
/** Road width per directed link "a-b". */
const LINK_W = new Map<string, number>();
export const GRID_NODE_COUNT = GRID_N * GRID_N;
export const linkWidth = (a: number, b: number) => LINK_W.get(`${a}-${b}`) ?? ROAD_W;

(function genGraph() {
  for (let i = 0; i < GRID_N; i++)
    for (let j = 0; j < GRID_N; j++) ROAD_NODES.push({ id: i * GRID_N + j, x: LINES[i], z: LINES[j], links: [] });
  const link = (a: number, b: number, w: number) => {
    if (a === b) return;
    if (!ROAD_NODES[a].links.includes(b)) ROAD_NODES[a].links.push(b);
    if (!ROAD_NODES[b].links.includes(a)) ROAD_NODES[b].links.push(a);
    LINK_W.set(`${a}-${b}`, w);
    LINK_W.set(`${b}-${a}`, w);
  };
  for (let i = 0; i < GRID_N; i++)
    for (let j = 0; j < GRID_N; j++) {
      const id = i * GRID_N + j;
      if (i < GRID_N - 1) link(id, (i + 1) * GRID_N + j, ROAD_W);
      if (j < GRID_N - 1) link(id, i * GRID_N + j + 1, ROAD_W);
    }
  // country roads: control points become nodes (merged when they coincide, snapped to the grid at the city edge)
  const nodeAt = (x: number, z: number) => {
    let best = -1;
    let bd = Infinity;
    for (const n of ROAD_NODES) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    if (bd < 15) return best;
    const n: RoadNode = { id: ROAD_NODES.length, x, z, links: [] };
    ROAD_NODES.push(n);
    return n.id;
  };
  for (const r of COUNTRY_ROADS) {
    let prev = -1;
    for (let k = 0; k < r.ctrl.length; k++) {
      const [x, , z] = r.ctrl[k];
      if (k > 0) {
        // split long straight segments so turns and spawning stay local
        const [px, , pz] = r.ctrl[k - 1];
        const L = Math.hypot(x - px, z - pz);
        const pieces = Math.ceil(L / 160);
        for (let p = 1; p < pieces; p++) {
          const id = nodeAt(px + ((x - px) * p) / pieces, pz + ((z - pz) * p) / pieces);
          link(prev, id, r.width);
          prev = id;
        }
      }
      const id = nodeAt(x, z);
      if (prev >= 0) link(prev, id, r.width);
      prev = id;
    }
  }
})();

export function nearestNode(x: number, z: number) {
  let best = ROAD_NODES[0];
  let bd = Infinity;
  for (const n of ROAD_NODES) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** A* shortest path through the road graph; returns node list. */
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
      const f = (g.get(n.id) ?? 0) + Math.hypot(n.x - to.x, n.z - to.z);
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
      const ng = (g.get(cur.id) ?? 0) + Math.hypot(nb.x - cur.x, nb.z - cur.z);
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
