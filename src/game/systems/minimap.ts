/** Radar minimap and full-screen map, drawn on 2D canvases. Includes GPS routing. */
import {
  BLOCKS,
  BUILDINGS,
  COUNTRY_ROADS,
  GRID_MAX,
  GRID_MIN,
  LINES,
  PARKS,
  PITCH,
  ROAD_W,
  SEA_LEVEL,
  WORLD_HALF,
  findPath,
  nearestNode,
  terrainHeight,
} from '../world/layout';
import type { Blip } from './missions';
import type { Game } from '../Game';

const MAP_RES = 2; // metres per pixel of the base image
const SIZE = Math.round((WORLD_HALF * 2) / MAP_RES);

function buildBase(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = px * MAP_RES - WORLD_HALF;
      const z = py * MAP_RES - WORLD_HALF;
      const h = terrainHeight(x, z);
      let r: number, g: number, b: number;
      if (h < SEA_LEVEL) {
        const deep = Math.min(1, (SEA_LEVEL - h) / 6);
        r = 38 - deep * 14;
        g = 74 - deep * 20;
        b = 102 - deep * 20;
      } else if (x > 372 && Math.abs(z) < 330) {
        r = 92;
        g = 96;
        b = 100;
      } else if (h < 0.7 && (z > 372 || Math.abs(x) > 480 || Math.abs(z) > 480)) {
        r = 176;
        g = 160;
        b = 118;
      } else {
        const k = Math.min(1, h / 45);
        r = 64 + k * 50;
        g = 92 + k * 30;
        b = 60 + k * 30;
      }
      const i = (py * SIZE + px) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tx = (x: number) => (x + WORLD_HALF) / MAP_RES;
  // city blocks
  ctx.fillStyle = '#4b5361';
  for (const bl of BLOCKS) {
    const s = (PITCH - ROAD_W) / MAP_RES;
    ctx.fillRect(tx(bl.cx) - s / 2, tx(bl.cz) - s / 2, s, s);
  }
  ctx.fillStyle = '#4f7a46';
  for (const p of PARKS) ctx.fillRect(tx(p.cx) - p.w / 2 / MAP_RES, tx(p.cz) - p.d / 2 / MAP_RES, p.w / MAP_RES, p.d / MAP_RES);
  // roads
  ctx.fillStyle = '#20242b';
  const span = (GRID_MAX - GRID_MIN + ROAD_W) / MAP_RES;
  for (const l of LINES) {
    ctx.fillRect(tx(GRID_MIN) - ROAD_W / 2 / MAP_RES, tx(l) - ROAD_W / 2 / MAP_RES, span, ROAD_W / MAP_RES);
    ctx.fillRect(tx(l) - ROAD_W / 2 / MAP_RES, tx(GRID_MIN) - ROAD_W / 2 / MAP_RES, ROAD_W / MAP_RES, span);
  }
  ctx.strokeStyle = '#20242b';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of COUNTRY_ROADS) {
    ctx.lineWidth = r.width / MAP_RES;
    ctx.beginPath();
    r.pts.forEach(([x, , z], i) => (i ? ctx.lineTo(tx(x), tx(z)) : ctx.moveTo(tx(x), tx(z))));
    ctx.stroke();
  }
  // buildings
  ctx.fillStyle = '#7d8592';
  for (const b of BUILDINGS) ctx.fillRect(tx(b.cx) - b.w / 2 / MAP_RES, tx(b.cz) - b.d / 2 / MAP_RES, b.w / MAP_RES, b.d / MAP_RES);
  return c;
}

export class MapRenderer {
  private base: HTMLCanvasElement;
  mini: HTMLCanvasElement | null = null;
  big: HTMLCanvasElement | null = null;
  private route: { x: number; z: number }[] = [];
  private routeKey = '';
  private routeT = 0;
  private blips: Blip[] = [];

  constructor(private g: Game) {
    this.base = buildBase();
  }

  /** Recompute GPS route occasionally. */
  private updateRoute(tx: number, tz: number, px: number, pz: number) {
    const a = nearestNode(px, pz);
    const b = nearestNode(tx, tz);
    const key = `${a.id}-${b.id}`;
    if (key === this.routeKey) return;
    this.routeKey = key;
    const inCity = (x: number, z: number) => Math.abs(x) < 380 && Math.abs(z) < 380;
    if (!inCity(tx, tz) && !inCity(px, pz)) {
      this.route = [{ x: px, z: pz }, { x: tx, z: tz }];
      return;
    }
    const path = findPath(a, b).map((n) => ({ x: n.x, z: n.z }));
    this.route = [{ x: px, z: pz }, ...path, { x: tx, z: tz }];
  }

  draw(dt: number) {
    const g = this.g;
    g.missions.blips(this.blips);
    // dynamic entity blips
    for (const a of g.actors) {
      if (a.dead || a === g.player || a.vehicle) continue;
      if (a.blip === 'enemy' || (a.team === 'police' && g.police.heat > 0) || (a.ai.aggro && (a.team === 'gang' || a.team === 'enemy')))
        this.blips.push({ x: a.x, z: a.z, icon: '•', color: a.team === 'police' ? '#60a5fa' : '#ef4444' });
      else if (a.blip === 'target') this.blips.push({ x: a.x, z: a.z, icon: '▼', color: '#ef4444', big: true });
      else if (a.tag === 'han') this.blips.push({ x: a.x, z: a.z, icon: '韓', color: '#fb923c' });
    }
    for (const v of g.vehicles) {
      if (v.isPlayer) continue;
      if (v.blip === 'target') this.blips.push({ x: v.x, z: v.z, icon: v.type === 'armored' ? '$' : '▼', color: v.type === 'armored' ? '#22c55e' : '#ef4444', big: true });
      else if (v.blip === 'ally') this.blips.push({ x: v.x, z: v.z, icon: '▲', color: '#38bdf8', big: true });
      else if (v.ai.kind === 'police' && g.police.heat > 0 && !v.destroyed) {
        const flash = Math.floor(performance.now() / 250) % 2 === 0;
        this.blips.push({ x: v.x, z: v.z, icon: '■', color: flash ? '#ef4444' : '#3b82f6' });
      }
    }
    if (g.police.heli) this.blips.push({ x: g.police.heli.x, z: g.police.heli.z, icon: '✚', color: '#60a5fa', big: true });

    const routeBlip = this.blips.find((b) => b.route);
    const p = g.player;
    const px = p.vehicle?.x ?? p.x;
    const pz = p.vehicle?.z ?? p.z;
    this.routeT -= dt;
    if (routeBlip) {
      if (this.routeT <= 0) {
        this.routeT = 0.5;
        this.updateRoute(routeBlip.x, routeBlip.z, px, pz);
      }
      if (this.route.length) this.route[0] = { x: px, z: pz };
    } else this.route = [];

    if (this.mini) this.drawMini(this.mini, px, pz);
    if (this.big && g.phase === 'map') this.drawBig(this.big, px, pz);
  }

  private drawMini(c: HTMLCanvasElement, px: number, pz: number) {
    const g = this.g;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const speed = g.player.vehicle?.speed ?? 0;
    const scale = (W / 260) * (1 - Math.min(0.45, speed / 90)); // px per metre (zooms out with speed)
    const rot = g.camYaw + Math.PI; // camera heading points up
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1b3a4b';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.62);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.base, -WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2, WORLD_HALF * 2);
    // police search area
    if (g.police.heat > 0 && g.police.searching) {
      ctx.fillStyle = 'rgba(96,165,250,0.18)';
      ctx.strokeStyle = 'rgba(96,165,250,0.6)';
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.arc(g.police.lastSeenX, g.police.lastSeenZ, g.police.searchRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // GPS
    if (this.route.length > 1) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 5 / scale;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.route.forEach((r, i) => (i ? ctx.lineTo(r.x, r.z) : ctx.moveTo(r.x, r.z)));
      ctx.stroke();
    }
    ctx.restore();
    // blips (unrotated icons, clamped to edge)
    const cx = W / 2;
    const cy = H * 0.62;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of this.blips) {
      let dx = (b.x - px) * scale;
      let dy = (b.z - pz) * scale;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      dx = rx;
      dy = ry;
      let sx = cx + dx;
      let sy = cy + dy;
      const pad = 9;
      const out = sx < pad || sx > W - pad || sy < pad || sy > H - pad;
      if (out) {
        if (!b.big && !b.route) continue;
        sx = Math.max(pad, Math.min(W - pad, sx));
        sy = Math.max(pad, Math.min(H - pad, sy));
      }
      this.icon(ctx, sx, sy, b, b.big ? 9 : 7);
    }
    // player arrow
    ctx.save();
    ctx.translate(cx, cy);
    const heading = g.player.vehicle ? g.player.vehicle.yaw : g.player.yaw;
    ctx.rotate(rot - heading + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // north indicator
    const nx = cx + Math.sin(-rot) * 0 + (0 * cos - -1 * sin) * (H * 0.5);
    const ny = cy + (0 * sin + -1 * cos) * (H * 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const nnx = Math.max(10, Math.min(W - 10, nx));
    const nny = Math.max(10, Math.min(H - 10, ny));
    ctx.beginPath();
    ctx.arc(nnx, nny, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', nnx, nny + 0.5);
  }

  private icon(ctx: CanvasRenderingContext2D, x: number, y: number, b: Blip, r: number) {
    ctx.fillStyle = 'rgba(10,12,16,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.font = `bold ${Math.round(r * 1.25)}px "Noto Sans TC",sans-serif`;
    ctx.fillText(b.icon, x, y + 0.5);
  }

  /** Full map: fit whole island. Returns transform for click handling. */
  bigView = { ox: 0, oy: 0, s: 1 };
  private drawBig(c: HTMLCanvasElement, px: number, pz: number) {
    const g = this.g;
    const ctx = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    const s = Math.min(W, H) / (WORLD_HALF * 1.75);
    const ox = W / 2;
    const oy = H / 2;
    this.bigView = { ox, oy, s };
    ctx.fillStyle = '#16303e';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.drawImage(this.base, -WORLD_HALF, -WORLD_HALF, WORLD_HALF * 2, WORLD_HALF * 2);
    if (this.route.length > 1) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 4 / s;
      ctx.beginPath();
      this.route.forEach((r, i) => (i ? ctx.lineTo(r.x, r.z) : ctx.moveTo(r.x, r.z)));
      ctx.stroke();
    }
    if (g.police.heat > 0 && g.police.searching) {
      ctx.fillStyle = 'rgba(96,165,250,0.2)';
      ctx.beginPath();
      ctx.arc(g.police.lastSeenX, g.police.lastSeenZ, g.police.searchRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // district labels
    ctx.font = '600 13px "Noto Sans TC",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const [name, x, z] of [
      ['中央商務區', 0, 0],
      ['綠蔭住宅區', -260, -260],
      ['鐵軌工業區', 300, -60],
      ['海濱商圈', 60, 300],
      ['索拉港碼頭', 520, 40],
      ['金沙海灘', -120, 470],
      ['雲杉丘陵', -150, -520],
      ['風車原野', -560, -120],
    ] as [string, number, number][])
      ctx.fillText(name, ox + x * s, oy + z * s);
    for (const b of this.blips) this.icon(ctx, ox + b.x * s, oy + b.z * s, b, b.big ? 10 : 8);
    // player
    ctx.save();
    ctx.translate(ox + px * s, oy + pz * s);
    ctx.rotate(-(g.player.vehicle?.yaw ?? g.player.yaw) + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Convert a click on the big map to world coordinates. */
  bigToWorld(cx: number, cy: number) {
    const { ox, oy, s } = this.bigView;
    return { x: (cx - ox) / s, z: (cy - oy) / s };
  }

  blipList() {
    return this.blips;
  }
}
