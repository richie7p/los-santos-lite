export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const angleDiff = (from: number, to: number) => wrapAngle(to - from);
export const lerpAngle = (a: number, b: number, t: number) => a + angleDiff(a, b) * t;

/** Unit vector for a yaw angle (rotation about +Y; yaw 0 faces +Z). */
export const fwdX = (yaw: number) => Math.sin(yaw);
export const fwdZ = (yaw: number) => Math.cos(yaw);
export const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

export const dist2D = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
export const pick = <T,>(arr: readonly T[], r: () => number = Math.random): T => arr[Math.floor(r() * arr.length)];

// --- Value noise for terrain ---
function hash2(x: number, z: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x: number, z: number, oct = 4) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise(x * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export function formatMoney(n: number) {
  return '$' + Math.round(n).toLocaleString('en-US');
}
