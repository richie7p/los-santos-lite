/** Procedural canvas textures – no external assets required. */
import * as THREE from 'three';
import { fbm, rng } from '../core/math';

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c: HTMLCanvasElement, color = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function noiseFill(ctx: Ctx, w: number, h: number, base: [number, number, number], amp: number, scale: number, seed = 1) {
  const img = ctx.createImageData(w, h);
  const r = rng(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x * scale + seed * 13, y * scale, 4) - 0.5;
      const grain = (r() - 0.5) * 0.35;
      const v = (n + grain * 0.4) * amp;
      const i = (y * w + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, base[0] + v));
      img.data[i + 1] = Math.max(0, Math.min(255, base[1] + v));
      img.data[i + 2] = Math.max(0, Math.min(255, base[2] + v));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------ ground textures
export function asphaltTexture() {
  const c = canvas(512);
  const ctx = c.getContext('2d')!;
  noiseFill(ctx, 512, 512, [62, 64, 68], 60, 0.05, 3);
  // aggregate speckles
  const r = rng(9);
  for (let k = 0; k < 9000; k++) {
    const g = 40 + r() * 70;
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${0.25 + r() * 0.35})`;
    ctx.fillRect(r() * 512, r() * 512, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  // cracks / patches
  ctx.strokeStyle = 'rgba(25,25,28,0.45)';
  for (let k = 0; k < 6; k++) {
    ctx.lineWidth = 0.6 + r();
    ctx.beginPath();
    let x = r() * 512;
    let y = r() * 512;
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (r() - 0.5) * 40;
      y += (r() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = `rgba(30,31,34,${0.18 + r() * 0.15})`;
    ctx.fillRect(r() * 480, r() * 480, 30 + r() * 80, 20 + r() * 60);
  }
  return toTexture(c);
}

export function sidewalkTexture() {
  const c = canvas(256);
  const ctx = c.getContext('2d')!;
  noiseFill(ctx, 256, 256, [178, 174, 166], 40, 0.06, 5);
  ctx.strokeStyle = 'rgba(90,88,84,0.55)';
  ctx.lineWidth = 2;
  for (let k = 0; k <= 4; k++) {
    ctx.beginPath();
    ctx.moveTo(0, k * 64);
    ctx.lineTo(256, k * 64);
    ctx.moveTo(k * 64, 0);
    ctx.lineTo(k * 64, 256);
    ctx.stroke();
  }
  const r = rng(4);
  for (let k = 0; k < 30; k++) {
    ctx.fillStyle = `rgba(80,76,70,${r() * 0.15})`;
    ctx.beginPath();
    ctx.arc(r() * 256, r() * 256, 2 + r() * 8, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

export function grassTexture() {
  const c = canvas(512);
  const ctx = c.getContext('2d')!;
  noiseFill(ctx, 512, 512, [86, 122, 58], 70, 0.03, 7);
  const r = rng(11);
  for (let k = 0; k < 14000; k++) {
    const g = 90 + r() * 80;
    ctx.strokeStyle = `rgba(${g * 0.6},${g},${g * 0.35},0.35)`;
    const x = r() * 512;
    const y = r() * 512;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
    ctx.stroke();
  }
  return toTexture(c);
}

/** Neutral detail texture multiplied over vertex-coloured terrain. */
export function terrainDetailTexture() {
  const c = canvas(512);
  const ctx = c.getContext('2d')!;
  noiseFill(ctx, 512, 512, [236, 236, 236], 55, 0.04, 21);
  const r = rng(17);
  for (let k = 0; k < 12000; k++) {
    const g = 185 + r() * 70;
    ctx.fillStyle = `rgba(${g},${g},${g},0.3)`;
    ctx.fillRect(r() * 512, r() * 512, 1, 1 + r() * 2);
  }
  return toTexture(c, true);
}

export function roofTexture() {
  const c = canvas(256);
  const ctx = c.getContext('2d')!;
  noiseFill(ctx, 256, 256, [120, 120, 118], 50, 0.08, 31);
  ctx.strokeStyle = 'rgba(60,60,60,0.35)';
  for (let k = 0; k < 8; k++) {
    ctx.beginPath();
    ctx.moveTo(0, k * 32);
    ctx.lineTo(256, k * 32);
    ctx.stroke();
  }
  return toTexture(c);
}

export function waterNormalTexture() {
  const S = 256;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // tileable: sample on a torus-like wrap via sin/cos combos
      const u = (x / S) * Math.PI * 2;
      const v = (y / S) * Math.PI * 2;
      h[y * S + x] =
        Math.sin(u * 3 + Math.cos(v * 2) * 1.3) * 0.5 +
        Math.sin(v * 5 + Math.sin(u * 2) * 1.7) * 0.35 +
        Math.sin((u + v) * 7) * 0.15 +
        Math.sin((u * 2 - v * 3) * 3) * 0.12;
    }
  const c = canvas(S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const l = h[y * S + ((x - 1 + S) % S)];
      const rr = h[y * S + ((x + 1) % S)];
      const t = h[((y - 1 + S) % S) * S + x];
      const b = h[((y + 1) % S) * S + x];
      let nx = (l - rr) * 2;
      let ny = (t - b) * 2;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

// ------------------------------------------------------------ facades
export type FacadeStyle = 'glass' | 'office' | 'apartment' | 'brick' | 'house' | 'warehouse' | 'shop' | 'civic';

export interface FacadeSet {
  map: THREE.Texture;
  emissive: THREE.Texture;
  /** G = roughness, B = metalness */
  orm: THREE.Texture;
  /** Window recesses, frames and masonry relief. */
  normal: THREE.Texture;
  /** World meters covered by one texture tile (u, v). */
  tileW: number;
  tileH: number;
}

interface FacadeSpec {
  tileW: number;
  tileH: number;
  cols: number;
  rows: number;
  draw: (c: Ctx, e: Ctx, o: Ctx, S: number, r: () => number, cols: number, rows: number) => void;
}

const LIT = ['#ffd99a', '#ffe6b8', '#fff1d6', '#cfe6ff', '#ffc98a'];

function windowGrid(
  c: Ctx,
  e: Ctx,
  o: Ctx,
  S: number,
  r: () => number,
  cols: number,
  rows: number,
  opt: { mx: number; my: number; glass: string; frame?: string; litChance: number; sill?: string },
) {
  const cw = S / cols;
  const rh = S / rows;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const x = i * cw + cw * opt.mx;
      const y = j * rh + rh * opt.my;
      const w = cw * (1 - opt.mx * 2);
      const h = rh * (1 - opt.my * 2);
      if (opt.frame) {
        c.fillStyle = opt.frame;
        c.fillRect(x - 3, y - 3, w + 6, h + 6);
      }
      const g = c.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, opt.glass);
      g.addColorStop(1, shade(opt.glass, -18));
      c.fillStyle = g;
      c.fillRect(x, y, w, h);
      // reflection streak
      c.fillStyle = 'rgba(255,255,255,0.08)';
      c.fillRect(x + w * 0.1, y, w * 0.18, h);
      if (opt.sill) {
        c.fillStyle = opt.sill;
        c.fillRect(x - 4, y + h, w + 8, 4);
      }
      o.fillStyle = 'rgb(0,30,200)';
      o.fillRect(x, y, w, h);
      if (r() < opt.litChance) {
        e.fillStyle = LIT[Math.floor(r() * LIT.length)];
        e.globalAlpha = 0.55 + r() * 0.45;
        e.fillRect(x, y, w, h);
        // blinds / silhouette variation
        e.fillStyle = '#000';
        e.globalAlpha = 0.35;
        if (r() < 0.5) e.fillRect(x, y, w, h * r() * 0.6);
        e.globalAlpha = 1;
      }
    }
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

const FACADES: Record<FacadeStyle, FacadeSpec> = {
  glass: {
    tileW: 12,
    tileH: 14,
    cols: 4,
    rows: 4,
    draw(c, e, o, S, r, cols, rows) {
      c.fillStyle = '#dfe6ec';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,140,40)';
      o.fillRect(0, 0, S, S);
      windowGrid(c, e, o, S, r, cols, rows, { mx: 0.035, my: 0.06, glass: '#4d6b84', litChance: 0.38 });
      // spandrel bands
      c.fillStyle = 'rgba(30,40,55,0.55)';
      for (let j = 0; j < rows; j++) c.fillRect(0, j * (S / rows), S, S / rows / 10);
    },
  },
  office: {
    tileW: 12,
    tileH: 14,
    cols: 4,
    rows: 4,
    draw(c, e, o, S, r, cols, rows) {
      c.fillStyle = '#ece8e0';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,220,0)';
      o.fillRect(0, 0, S, S);
      // horizontal ribbon windows
      const rh = S / rows;
      for (let j = 0; j < rows; j++) {
        c.fillStyle = '#3a4d5e';
        c.fillRect(0, j * rh + rh * 0.3, S, rh * 0.5);
        o.fillStyle = 'rgb(0,40,160)';
        o.fillRect(0, j * rh + rh * 0.3, S, rh * 0.5);
        for (let i = 0; i < cols; i++) {
          c.fillStyle = '#c8c2b8';
          c.fillRect(i * (S / cols) - 2, j * rh + rh * 0.3, 5, rh * 0.5);
          if (r() < 0.4) {
            e.fillStyle = LIT[Math.floor(r() * LIT.length)];
            e.globalAlpha = 0.6 + r() * 0.4;
            e.fillRect(i * (S / cols) + 3, j * rh + rh * 0.3, S / cols - 6, rh * 0.5);
            e.globalAlpha = 1;
          }
        }
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(0, j * rh + rh * 0.8, S, 4);
      }
    },
  },
  apartment: {
    tileW: 12,
    tileH: 12,
    cols: 4,
    rows: 4,
    draw(c, e, o, S, r, cols, rows) {
      c.fillStyle = '#f1ece4';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,235,0)';
      o.fillRect(0, 0, S, S);
      windowGrid(c, e, o, S, r, cols, rows, {
        mx: 0.22,
        my: 0.22,
        glass: '#556779',
        frame: '#ffffff',
        litChance: 0.35,
        sill: '#bfb6aa',
      });
      // balconies
      const cw = S / cols;
      const rh = S / rows;
      for (let i = 0; i < cols; i += 2)
        for (let j = 0; j < rows; j++) {
          if (r() < 0.5) continue;
          c.fillStyle = 'rgba(70,70,70,0.75)';
          c.fillRect(i * cw + cw * 0.12, j * rh + rh * 0.62, cw * 0.76, 3);
          for (let k = 0; k < 7; k++) c.fillRect(i * cw + cw * 0.12 + k * cw * 0.12, j * rh + rh * 0.62, 2, rh * 0.2);
        }
    },
  },
  brick: {
    tileW: 10,
    tileH: 12,
    cols: 3,
    rows: 4,
    draw(c, e, o, S, r, cols, rows) {
      c.fillStyle = '#d9b7a8';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,250,0)';
      o.fillRect(0, 0, S, S);
      // bricks
      const bh = 8;
      for (let y = 0; y < S; y += bh) {
        const off = (y / bh) % 2 ? 10 : 0;
        for (let x = -off; x < S; x += 20) {
          const v = 200 + (r() - 0.5) * 40;
          c.fillStyle = `rgb(${v},${v * 0.82},${v * 0.74})`;
          c.fillRect(x + 1, y + 1, 18, bh - 2);
        }
      }
      windowGrid(c, e, o, S, r, cols, rows, {
        mx: 0.24,
        my: 0.18,
        glass: '#3f4c58',
        frame: '#efe9df',
        litChance: 0.4,
        sill: '#e8e0d4',
      });
    },
  },
  house: {
    tileW: 8,
    tileH: 6,
    cols: 2,
    rows: 2,
    draw(c, e, o, S, r) {
      c.fillStyle = '#f4f1ea';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,240,0)';
      o.fillRect(0, 0, S, S);
      // siding lines
      c.strokeStyle = 'rgba(0,0,0,0.08)';
      for (let y = 0; y < S; y += 10) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(S, y);
        c.stroke();
      }
      // two windows upper, window + door lower
      const win = (x: number, y: number, w: number, h: number) => {
        c.fillStyle = '#ffffff';
        c.fillRect(x - 6, y - 6, w + 12, h + 12);
        c.fillStyle = '#4f6070';
        c.fillRect(x, y, w, h);
        c.fillStyle = '#ffffff';
        c.fillRect(x + w / 2 - 2, y, 4, h);
        c.fillRect(x, y + h / 2 - 2, w, 4);
        o.fillStyle = 'rgb(0,40,120)';
        o.fillRect(x, y, w, h);
        if (r() < 0.45) {
          e.fillStyle = LIT[Math.floor(r() * 2)];
          e.globalAlpha = 0.85;
          e.fillRect(x, y, w, h);
          e.globalAlpha = 1;
        }
      };
      win(S * 0.12, S * 0.12, S * 0.26, S * 0.22);
      win(S * 0.62, S * 0.12, S * 0.26, S * 0.22);
      win(S * 0.12, S * 0.6, S * 0.26, S * 0.22);
      c.fillStyle = '#7a4b33';
      c.fillRect(S * 0.62, S * 0.56, S * 0.2, S * 0.44);
      c.fillStyle = '#d8c18a';
      c.fillRect(S * 0.78, S * 0.78, 6, 6);
    },
  },
  warehouse: {
    tileW: 12,
    tileH: 10,
    cols: 3,
    rows: 1,
    draw(c, e, o, S, r) {
      c.fillStyle = '#e6e6e6';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,170,90)';
      o.fillRect(0, 0, S, S);
      for (let x = 0; x < S; x += 8) {
        c.fillStyle = 'rgba(0,0,0,0.12)';
        c.fillRect(x, 0, 3, S);
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.fillRect(x + 3, 0, 2, S);
      }
      // high strip windows
      for (let i = 0; i < 3; i++) {
        const x = i * (S / 3) + 18;
        c.fillStyle = '#5c6a76';
        c.fillRect(x, S * 0.1, S / 3 - 36, S * 0.12);
        if (r() < 0.5) {
          e.fillStyle = '#ffe6b0';
          e.globalAlpha = 0.6;
          e.fillRect(x, S * 0.1, S / 3 - 36, S * 0.12);
          e.globalAlpha = 1;
        }
      }
      // roller door
      c.fillStyle = '#9aa0a6';
      c.fillRect(S * 0.36, S * 0.45, S * 0.3, S * 0.55);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = S * 0.45; y < S; y += 6) c.fillRect(S * 0.36, y, S * 0.3, 2);
      c.fillStyle = 'rgba(240,190,40,0.9)';
      c.fillRect(S * 0.36, S * 0.43, S * 0.3, 6);
    },
  },
  shop: {
    tileW: 10,
    tileH: 8,
    cols: 3,
    rows: 2,
    draw(c, e, o, S, r) {
      c.fillStyle = '#f3efe8';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,235,0)';
      o.fillRect(0, 0, S, S);
      const aw = ['#d94f3d', '#2f7dd1', '#2c9b6b', '#e2a224', '#8c4fd1'][Math.floor(r() * 5)];
      // storefront glass at the bottom half
      c.fillStyle = '#2f3d49';
      c.fillRect(S * 0.05, S * 0.58, S * 0.9, S * 0.4);
      o.fillStyle = 'rgb(0,25,200)';
      o.fillRect(S * 0.05, S * 0.58, S * 0.9, S * 0.4);
      e.fillStyle = '#fff1d2';
      e.globalAlpha = 0.9;
      e.fillRect(S * 0.05, S * 0.58, S * 0.9, S * 0.4);
      e.globalAlpha = 1;
      // awning
      for (let x = 0; x < S; x += 32) {
        c.fillStyle = aw;
        c.fillRect(x, S * 0.5, 16, S * 0.07);
        c.fillStyle = '#ffffff';
        c.fillRect(x + 16, S * 0.5, 16, S * 0.07);
      }
      // upper windows
      for (let i = 0; i < 3; i++) {
        const x = i * (S / 3) + 22;
        c.fillStyle = '#ffffff';
        c.fillRect(x - 4, S * 0.12 - 4, S / 3 - 36, S * 0.24);
        c.fillStyle = '#4c5d6c';
        c.fillRect(x, S * 0.12, S / 3 - 44, S * 0.24 - 8);
        if (r() < 0.4) {
          e.fillStyle = LIT[0];
          e.globalAlpha = 0.8;
          e.fillRect(x, S * 0.12, S / 3 - 44, S * 0.24 - 8);
          e.globalAlpha = 1;
        }
      }
    },
  },
  civic: {
    tileW: 12,
    tileH: 12,
    cols: 4,
    rows: 3,
    draw(c, e, o, S, r, cols, rows) {
      c.fillStyle = '#f2eee6';
      c.fillRect(0, 0, S, S);
      o.fillStyle = 'rgb(0,230,0)';
      o.fillRect(0, 0, S, S);
      // stone blocks
      c.strokeStyle = 'rgba(0,0,0,0.07)';
      for (let y = 0; y < S; y += 24) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(S, y);
        c.stroke();
      }
      windowGrid(c, e, o, S, r, cols, rows, {
        mx: 0.28,
        my: 0.15,
        glass: '#43525f',
        frame: '#d8d2c6',
        litChance: 0.5,
      });
      // pilasters
      for (let i = 0; i <= cols; i++) {
        c.fillStyle = 'rgba(255,255,255,0.6)';
        c.fillRect(i * (S / cols) - 6, 0, 12, S);
        c.fillStyle = 'rgba(0,0,0,0.08)';
        c.fillRect(i * (S / cols) + 6, 0, 3, S);
      }
    },
  },
};

export function makeFacade(style: FacadeStyle, seed: number): FacadeSet {
  const spec = FACADES[style];
  const S = 512;
  const cc = canvas(S);
  const ec = canvas(S);
  const oc = canvas(S);
  const c = cc.getContext('2d')!;
  const e = ec.getContext('2d')!;
  const o = oc.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  spec.draw(c, e, o, S, rng(seed), spec.cols, spec.rows);
  // grime gradient toward the bottom of each tile
  const g = c.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(40,35,30,0.10)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  const map = toTexture(cc);
  const emissive = toTexture(ec);
  const orm = toTexture(oc, false);
  // relief: glass (metallic in the ORM map) sits recessed behind the wall,
  // plus a little texture from the colour map (mortar lines, siding, panels)
  const od = o.getImageData(0, 0, S, S).data;
  const cd = c.getImageData(0, 0, S, S).data;
  const h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const glass = od[i * 4 + 2] / 255;
    const lum = (cd[i * 4] * 0.3 + cd[i * 4 + 1] * 0.59 + cd[i * 4 + 2] * 0.11) / 255;
    h[i] = (1 - glass) * 1.0 + lum * 0.12;
  }
  const normal = normalFromHeight(h, S, style === 'glass' ? 2.5 : 4);
  return { map, emissive, orm, normal, tileW: spec.tileW, tileH: spec.tileH };
}

/** Tangent-space normal map from a tiling height field (Sobel). */
export function normalFromHeight(h: Float32Array, S: number, strength: number) {
  const c = canvas(S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const at = (x: number, y: number) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

// ------------------------------------------------------------ sprites & labels
export function radialSprite(inner: string, outer: string, size = 128) {
  const c = canvas(size);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function signTexture(text: string, bg: string, fg: string, w = 512, h = 128) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = fg;
  ctx.font = `900 ${Math.floor(h * 0.48)}px "Noto Sans TC","Microsoft JhengHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2, w - 30);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
