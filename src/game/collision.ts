export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export function yawForward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function yawRight(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function resolveCircleAabb(
  x: number,
  z: number,
  r: number,
  b: AABB
): { x: number; z: number; hit: boolean; nx: number; nz: number; depth: number } {
  const nx0 = clamp(x, b.minX, b.maxX);
  const nz0 = clamp(z, b.minZ, b.maxZ);
  const dx = x - nx0;
  const dz = z - nz0;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r && d2 > 1e-10) {
    return { x, z, hit: false, nx: 0, nz: 0, depth: 0 };
  }
  if (d2 < 1e-8) {
    const left = x - b.minX + r;
    const right = b.maxX - x + r;
    const top = z - b.minZ + r;
    const bot = b.maxZ - z + r;
    const m = Math.min(left, right, top, bot);
    if (m === left) return { x: b.minX - r, z, hit: true, nx: -1, nz: 0, depth: m };
    if (m === right) return { x: b.maxX + r, z, hit: true, nx: 1, nz: 0, depth: m };
    if (m === top) return { x, z: b.minZ - r, hit: true, nx: 0, nz: -1, depth: m };
    return { x, z: b.maxZ + r, hit: true, nx: 0, nz: 1, depth: m };
  }
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const nz = dz / d;
  const depth = r - d;
  return { x: x + nx * depth, z: z + nz * depth, hit: true, nx, nz, depth };
}

export function resolveCircleList(
  x: number,
  z: number,
  r: number,
  list: AABB[]
): { x: number; z: number; hit: boolean; nx: number; nz: number; depth: number } {
  let hit = false;
  let nx = 0;
  let nz = 0;
  let depth = 0;
  for (let i = 0; i < list.length; i++) {
    const res = resolveCircleAabb(x, z, r, list[i]!);
    if (res.hit) {
      x = res.x;
      z = res.z;
      hit = true;
      nx = res.nx;
      nz = res.nz;
      depth = Math.max(depth, res.depth);
    }
  }
  return { x, z, hit, nx, nz, depth };
}

export function circlesOverlap(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number
): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  const r = ar + br;
  return dx * dx + dz * dz < r * r;
}

export function separateCircles(
  ax: number,
  az: number,
  ar: number,
  bx: number,
  bz: number,
  br: number,
  massA = 1,
  massB = 1
): { ax: number; az: number; bx: number; bz: number; hit: boolean; nx: number; nz: number } {
  const dx = ax - bx;
  const dz = az - bz;
  const d2 = dx * dx + dz * dz;
  const min = ar + br;
  if (d2 >= min * min) {
    return { ax, az, bx, bz, hit: false, nx: 0, nz: 0 };
  }
  const d = Math.sqrt(Math.max(d2, 1e-8));
  const nx = dx / d;
  const nz = dz / d;
  const pen = min - d;
  const inv = 1 / (massA + massB);
  return {
    ax: ax + nx * pen * massB * inv,
    az: az + nz * pen * massB * inv,
    bx: bx - nx * pen * massA * inv,
    bz: bz - nz * pen * massA * inv,
    hit: true,
    nx,
    nz,
  };
}
