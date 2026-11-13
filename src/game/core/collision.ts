/**
 * Static world collision: axis-aligned boxes stored in a uniform XZ grid.
 * Supports circle push-out (characters / vehicle sample circles) and ray casts
 * (bullets, camera, line of sight).
 */
export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** Material hint for impact FX. */
  kind?: 'building' | 'prop' | 'metal' | 'wood' | 'glass';
  stamp?: number;
}

export interface RayHit {
  t: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  box: Box | null;
}

const CELL = 24;

export class StaticWorld {
  private cells = new Map<number, Box[]>();
  private stamp = 1;
  readonly boxes: Box[] = [];

  private key(cx: number, cz: number) {
    return (cx + 1000) * 4000 + (cz + 1000);
  }

  add(b: Box) {
    this.boxes.push(b);
    const x0 = Math.floor(b.minX / CELL);
    const x1 = Math.floor(b.maxX / CELL);
    const z0 = Math.floor(b.minZ / CELL);
    const z1 = Math.floor(b.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(b);
      }
    }
  }

  addBox(cx: number, cz: number, w: number, d: number, y0: number, y1: number, kind: Box['kind'] = 'building') {
    const b: Box = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: y0, maxY: y1, kind };
    this.add(b);
    return b;
  }

  /** Iterate boxes overlapping an XZ rectangle (each box visited once). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, fn: (b: Box) => void) {
    const s = ++this.stamp;
    const x0 = Math.floor(minX / CELL);
    const x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL);
    const z1 = Math.floor(maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (!arr) continue;
        for (const b of arr) {
          if (b.stamp === s) continue;
          b.stamp = s;
          fn(b);
        }
      }
    }
  }

  /**
   * Push a vertical cylinder (circle in XZ spanning [y, y+h]) out of boxes.
   * Returns push vector and contact normal of the deepest hit.
   */
  resolveCircle(x: number, z: number, r: number, y: number, h: number) {
    let ox = x;
    let oz = z;
    let hit = false;
    let nx = 0;
    let nz = 0;
    this.query(x - r, z - r, x + r, z + r, (b) => {
      if (y + h <= b.minY || y >= b.maxY - 0.05) return;
      const px = Math.max(b.minX, Math.min(ox, b.maxX));
      const pz = Math.max(b.minZ, Math.min(oz, b.maxZ));
      let dx = ox - px;
      let dz = oz - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        dx /= d;
        dz /= d;
        ox = px + dx * r;
        oz = pz + dz * r;
        nx = dx;
        nz = dz;
      } else {
        // center inside box: push out along the shallowest axis
        const l = ox - b.minX;
        const rr = b.maxX - ox;
        const t = oz - b.minZ;
        const bt = b.maxZ - oz;
        const m = Math.min(l, rr, t, bt);
        if (m === l) {
          ox = b.minX - r;
          nx = -1;
          nz = 0;
        } else if (m === rr) {
          ox = b.maxX + r;
          nx = 1;
          nz = 0;
        } else if (m === t) {
          oz = b.minZ - r;
          nx = 0;
          nz = -1;
        } else {
          oz = b.maxZ + r;
          nx = 0;
          nz = 1;
        }
      }
    });
    return { x: ox, z: oz, hit, nx, nz };
  }

  /** Highest box top under (x,z) that is below `maxY` (for standing on things). */
  supportHeight(x: number, z: number, maxY: number) {
    let best = -Infinity;
    this.query(x, z, x, z, (b) => {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return;
      if (b.maxY <= maxY && b.maxY > best) best = b.maxY;
    });
    return best;
  }

  /** Ray vs boxes. Direction must be normalized. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxT;
    const s = ++this.stamp;
    // DDA over grid cells
    let cx = Math.floor(ox / CELL);
    let cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL : cx * CELL) - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL : cz * CELL) - oz) / dz : Infinity;
    let tCell = 0;
    for (let iter = 0; iter < 400 && tCell <= bestT; iter++) {
      const arr = this.cells.get(this.key(cx, cz));
      if (arr) {
        for (const b of arr) {
          if (b.stamp === s) continue;
          b.stamp = s;
          const h = rayBox(ox, oy, oz, dx, dy, dz, b, bestT);
          if (h) {
            bestT = h.t;
            best = h;
          }
        }
      }
      if (tMaxX < tMaxZ) {
        tCell = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tCell = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
    }
    return best;
  }
}

export function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: Box,
  maxT: number,
): RayHit | null {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (mn[i] - o[i]) * inv;
    let t2 = (mx[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null; // origin inside the box
  return {
    t: tmin,
    x: ox + dx * tmin,
    y: oy + dy * tmin,
    z: oz + dz * tmin,
    nx: axis === 0 ? sign : 0,
    ny: axis === 1 ? sign : 0,
    nz: axis === 2 ? sign : 0,
    box: b,
  };
}

/** Ray vs sphere; returns distance or -1. */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}

/** Ray vs oriented box (rotation about Y). Returns distance or -1. */
export function rayOBB(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  yaw: number,
  hw: number,
  hh: number,
  hl: number,
  maxT: number,
) {
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  const rx = ox - cx;
  const rz = oz - cz;
  const lox = rx * c + rz * s;
  const loz = -rx * s + rz * c;
  const ldx = dx * c + dz * s;
  const ldz = -dx * s + dz * c;
  const h = rayBox(lox, oy - cy, loz, ldx, dy, ldz, { minX: -hw, maxX: hw, minY: -hh, maxY: hh, minZ: -hl, maxZ: hl }, maxT);
  return h ? h.t : -1;
}
