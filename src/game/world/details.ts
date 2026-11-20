/**
 * Region detail pass: street furniture, district props and landmarks that make
 * each part of the island feel distinct. Almost everything is instanced so the
 * extra detail costs few draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StaticWorld } from '../core/collision';
import { rng, smoothstep } from '../core/math';
import {
  AIRPORT,
  BLOCKS,
  BUILDINGS,
  COUNTRY_ROADS,
  CURB_H,
  GRID_MAX,
  GRID_MIN,
  HALF_ROAD,
  LAKE,
  LINES,
  PITCH,
  SEA_LEVEL,
  SIDEWALK_RING,
  TOWN,
  VILLAS,
  biomeAt,
  buildingBase,
  groundHeight,
  nearestCountryRoad,
  sidewalkPointOnBlock,
  terrainHeight,
  townRoadZ,
} from './layout';
import { signTexture } from './textures';

export interface Emitter {
  x: number;
  y: number;
  z: number;
  kind: 'smoke' | 'fire';
}

export interface DetailCtx {
  root: THREE.Group;
  col: StaticWorld;
  lampMats: THREE.Matrix4[];
  lampPositions: THREE.Vector3[];
  nightMaterials: { mat: THREE.MeshStandardMaterial; max: number }[];
  animated: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  asphalt: THREE.Texture;
}

// ------------------------------------------------------------------ helpers
const UP = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const sc = new THREE.Vector3();

/** Paint a geometry with a flat vertex colour (lets many colours share one material). */
function paint(g: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}
/** Merge [geometry, colour] parts into one vertex-coloured geometry. */
function parts(list: [THREE.BufferGeometry, number][]) {
  return mergeGeometries(list.map(([g, c]) => paint(g, c)))!;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (rt: number, rb: number, h: number, seg: number, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);

const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
const vcMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 });

class Inst {
  mats: THREE.Matrix4[] = [];
  colors: THREE.Color[] = [];
  constructor(
    public geo: THREE.BufferGeometry,
    public mat: THREE.Material,
    public shadow = true,
  ) {}
  add(x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx, color?: number) {
    q.setFromAxisAngle(UP, yaw);
    this.mats.push(new THREE.Matrix4().compose(v3.set(x, y, z), q, sc.set(sx, sy, sz)));
    if (color !== undefined) this.colors.push(new THREE.Color(color));
    return this;
  }
  build(root: THREE.Group) {
    if (!this.mats.length) return;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.mats.length);
    this.mats.forEach((m, i) => im.setMatrixAt(i, m));
    if (this.colors.length === this.mats.length) this.colors.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = this.shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    root.add(im);
  }
}

// ------------------------------------------------------------------ textures
function storefrontTextures(seed: number) {
  const r = rng(seed);
  const W = 512;
  const H = 256;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  };
  const cc = mk();
  const ec = mk();
  const c = cc.getContext('2d')!;
  const e = ec.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const brands = ['#d62828', '#f77f00', '#2a9d8f', '#264653', '#8338ec', '#ff006e', '#3a86ff', '#e9c46a', '#06d6a0', '#118ab2'];
  const names = ['咖啡', '便當', '藥局', '書店', '花店', '眼鏡', '服飾', '麵包', '茶飲', '電器', '理髮', '銀樓', '牙醫', '餐廳', '超市', '鞋店'];
  for (let u = 0; u < 2; u++) {
    const x0 = u * (W / 2);
    const brand = brands[Math.floor(r() * brands.length)];
    // wall
    c.fillStyle = '#d9d4cb';
    c.fillRect(x0, 0, W / 2, H);
    // sign band
    c.fillStyle = brand;
    c.fillRect(x0 + 6, 10, W / 2 - 12, 48);
    c.fillStyle = '#fff';
    c.font = '900 34px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(names[Math.floor(r() * names.length)], x0 + W / 4, 35);
    e.fillStyle = brand;
    e.globalAlpha = 0.9;
    e.fillRect(x0 + 6, 10, W / 2 - 12, 48);
    e.globalAlpha = 1;
    // glass front with mullions and a door
    c.fillStyle = '#2b3a46';
    c.fillRect(x0 + 10, 70, W / 2 - 20, H - 80);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(x0 + 20, 70, 30, H - 80);
    c.fillStyle = '#5a5f66';
    for (let k = 0; k <= 3; k++) c.fillRect(x0 + 10 + k * ((W / 2 - 20) / 3) - 2, 70, 4, H - 80);
    c.fillStyle = '#1d262e';
    c.fillRect(x0 + W / 4 - 22, 110, 44, H - 120);
    // interior light at night
    const g = e.createLinearGradient(0, 70, 0, H);
    g.addColorStop(0, '#fff2d0');
    g.addColorStop(1, '#ffd9a0');
    e.fillStyle = g;
    e.globalAlpha = r() < 0.85 ? 0.85 : 0.2;
    e.fillRect(x0 + 10, 70, W / 2 - 20, H - 80);
    e.globalAlpha = 1;
    // shelves / silhouettes
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 3; k++) c.fillRect(x0 + 16, 120 + k * 40, W / 2 - 32, 6);
  }
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const em = new THREE.CanvasTexture(ec);
  em.colorSpace = THREE.SRGBColorSpace;
  em.wrapS = THREE.RepeatWrapping;
  return { map, em };
}

function chainLinkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(200,205,210,0.9)';
  x.lineWidth = 2;
  for (let k = -64; k < 128; k += 12) {
    x.beginPath();
    x.moveTo(k, 0);
    x.lineTo(k + 64, 64);
    x.moveTo(k + 64, 0);
    x.lineTo(k, 64);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function stripeTexture(a: string, b: string) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = a;
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = b;
  for (let k = 0; k < 64; k += 8) x.fillRect(0, k, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ main
export function buildDetails(ctx: DetailCtx) {
  const { root, col, lampMats, lampPositions, nightMaterials, animated } = ctx;
  const r = rng(9090);
  const emitters: Emitter[] = [];
  const group = new THREE.Group();
  group.name = 'details';
  root.add(group);
  const insts: Inst[] = [];
  const I = (geo: THREE.BufferGeometry, mat: THREE.Material = vcMat, shadow = true) => {
    const i = new Inst(geo, mat, shadow);
    insts.push(i);
    return i;
  };
  const addLamp = (x: number, y: number, z: number, yaw: number) => {
    q.setFromAxisAngle(UP, yaw);
    lampMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.clone(), new THREE.Vector3(1, 1, 1)));
    lampPositions.push(new THREE.Vector3(x + Math.sin(yaw) * 2.2, y + 7.6, z + Math.cos(yaw) * 2.2));
    col.addBox(x, z, 0.35, 0.35, y - 1, y + 8, 'metal');
  };
  const emissive = (color: number, max: number) => {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
    nightMaterials.push({ mat: m, max });
    return m;
  };

  // shared prop geometries
  const hydrant = I(parts([[cyl(0.16, 0.2, 0.6, 8, 0, 0.3), 0xc0392b], [cyl(0.2, 0.2, 0.08, 8, 0, 0.62), 0xc0392b], [cyl(0.06, 0.06, 0.4, 6, 0, 0.42).rotateZ(Math.PI / 2), 0xd4ac0d]]));
  const bin = I(parts([[cyl(0.32, 0.28, 1.0, 10, 0, 0.5), 0x1e4d2b], [cyl(0.34, 0.34, 0.08, 10, 0, 1.02), 0x163a20]]));
  const planter = I(parts([[box(1.4, 0.6, 1.4, 0, 0.3), 0xa8a39a], [new THREE.IcosahedronGeometry(0.75, 1).scale(1, 0.7, 1).translate(0, 0.95, 0), 0x4a7a36]]));
  const manhole = I(new THREE.CircleGeometry(0.45, 14).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }), false);
  const newsbox = I(parts([[box(0.5, 1.0, 0.45, 0, 0.5), 0x1f6feb], [box(0.42, 0.3, 0.02, 0, 0.75, 0.235), 0xe6edf3]]));
  const busStop = I(
    parts([
      [box(3.6, 0.1, 1.5, 0, 2.55, 0), 0x3b4046],
      [box(3.6, 2.3, 0.05, 0, 1.3, -0.68), 0x9fb3c8],
      [box(0.08, 2.5, 0.08, -1.75, 1.25, -0.68), 0x3b4046],
      [box(0.08, 2.5, 0.08, 1.75, 1.25, -0.68), 0x3b4046],
      [box(0.08, 2.5, 0.08, -1.75, 1.25, 0.6), 0x3b4046],
      [box(0.08, 2.5, 0.08, 1.75, 1.25, 0.6), 0x3b4046],
      [box(2.4, 0.08, 0.45, 0, 0.5, -0.4), 0x7a5a3c],
    ]),
    vcMetal,
  );
  const adPanel = I(box(0.06, 1.9, 1.3, 1.82, 1.2, 0), emissive(0xf0e6ff, 0.9));
  const awning = I(box(1, 0.14, 1.6, 0, 0, 0.8), new THREE.MeshStandardMaterial({ roughness: 0.7 }));
  const hedge = I(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x3f6b2f, roughness: 0.95 }));
  const mailbox = I(parts([[cyl(0.04, 0.04, 1.1, 5, 0, 0.55), 0x444444], [box(0.25, 0.25, 0.45, 0, 1.2, 0), 0x2c3e50]]));
  const poolWater = I(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2bb3d9, roughness: 0.05, metalness: 0.1, emissive: 0x0a6e8a, emissiveIntensity: 0.15 }), false);
  const poolRim = I(new THREE.BoxGeometry(1, 0.12, 1), new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.6 }), false);
  const fencePost = I(cyl(0.06, 0.06, 1.2, 5, 0, 0.6), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 }));
  const fenceRail = I(box(1, 0.08, 0.05, 0, 0, 0), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 }), false);
  const woodRail = I(box(1, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: 0x7b5b3a, roughness: 0.9 }), false);
  const woodPost = I(cyl(0.09, 0.1, 1.4, 5, 0, 0.7), new THREE.MeshStandardMaterial({ color: 0x6b4e36, roughness: 0.95 }));
  const crate = I(new THREE.BoxGeometry(1.2, 1.2, 1.2).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: 0x9c7a4c, roughness: 0.9 }));
  const pallet = I(parts([[box(1.2, 0.14, 1.0, 0, 0.07), 0x8a6a45], [box(1.1, 0.8, 0.9, 0, 0.55), 0xc9b48a]]));
  const barrel = I(parts([[cyl(0.32, 0.32, 0.95, 10, 0, 0.48), 0x2f5d8a], [cyl(0.33, 0.33, 0.05, 10, 0, 0.3), 0x1d3d5c], [cyl(0.33, 0.33, 0.05, 10, 0, 0.7), 0x1d3d5c]]));
  const bollard = I(parts([[cyl(0.22, 0.26, 0.6, 8, 0, 0.3), 0x2b2b2b], [cyl(0.32, 0.22, 0.12, 8, 0, 0.62), 0x2b2b2b]]));
  const rock = I(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95, flatShading: true }));
  const redRock = I(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xa8603c, roughness: 0.95, flatShading: true }));
  const shrub = I(new THREE.IcosahedronGeometry(1, 0).scale(1, 0.6, 1), new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 1, flatShading: true }));
  const log = I(cyl(0.32, 0.36, 1, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5e4630, roughness: 0.95 }));
  const picnic = I(
    parts([
      [box(2, 0.08, 0.8, 0, 0.75), 0x8a6a45],
      [box(2, 0.06, 0.3, 0, 0.45, 0.6), 0x8a6a45],
      [box(2, 0.06, 0.3, 0, 0.45, -0.6), 0x8a6a45],
      [box(0.08, 0.75, 1.6, -0.8, 0.37), 0x6b4e36],
      [box(0.08, 0.75, 1.6, 0.8, 0.37), 0x6b4e36],
    ]),
  );
  const sunbed = I(parts([[box(0.7, 0.08, 1.9, 0, 0.35), 0xf4f4f4], [box(0.7, 0.08, 0.7, 0, 0.6, -0.8).rotateX(0.5), 0xf4f4f4], [box(0.05, 0.35, 1.7, -0.3, 0.17), 0x999999], [box(0.05, 0.35, 1.7, 0.3, 0.17), 0x999999]]));
  const towel = I(new THREE.PlaneGeometry(1, 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 0.9 }), false);
  const hayBale = I(cyl(0.7, 0.7, 1.4, 12).rotateZ(Math.PI / 2).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 1 }));
  const tent = I(new THREE.ConeGeometry(1.6, 2, 4).rotateY(Math.PI / 4).translate(0, 1, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
  const telePole = I(parts([[cyl(0.13, 0.17, 9, 6, 0, 4.5), 0x5b4632], [box(2.2, 0.12, 0.12, 0, 8.4), 0x5b4632]]));
  const guardRail = I(parts([[box(4, 0.32, 0.08, 0, 0.62), 0xb8bec4], [box(0.12, 0.7, 0.12, -1.9, 0.35), 0x7f868c]]), vcMetal);
  const trailer = I(
    parts([
      [new THREE.CapsuleGeometry(1.25, 7, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.95).translate(0, 1.6, 0), 0xe9e4d8],
      [box(9.2, 0.35, 2.35, 0, 1.3, 0), 0x2a9d8f],
      [box(1.6, 0.8, 0.05, 1.5, 1.9, 1.2), 0x3d4d5a],
      [box(1.6, 0.8, 0.05, -2, 1.9, 1.2), 0x3d4d5a],
      [box(0.8, 0.4, 0.8, 0, 0.2, 1.6), 0x8a8a8a],
    ]),
  );
  const wreck = I(parts([[box(1.9, 0.9, 4.4, 0, 0.75), 0x7a4a2e], [box(1.6, 0.6, 2, 0, 1.45, -0.3), 0x5e3a24], [cyl(0.32, 0.32, 0.25, 8).rotateZ(Math.PI / 2).translate(0.95, 0.32, 1.4), 0x222222]]));
  const forklift = I(
    parts([
      [box(1.3, 1.1, 2.2, 0, 0.85, 0), 0xf2b705],
      [box(1.2, 0.08, 1.2, 0, 2.2, -0.3), 0x333333],
      [box(0.08, 2.1, 0.08, 0.55, 1.2, -0.85), 0x333333],
      [box(0.08, 2.1, 0.08, -0.55, 1.2, -0.85), 0x333333],
      [box(0.1, 2.4, 0.1, 0.35, 1.2, 1.2), 0x555555],
      [box(0.1, 2.4, 0.1, -0.35, 1.2, 1.2), 0x555555],
      [box(0.15, 0.08, 1.2, 0.3, 0.1, 1.8), 0x555555],
      [box(0.15, 0.08, 1.2, -0.3, 0.1, 1.8), 0x555555],
    ]),
  );
  const tallLight = I(parts([[cyl(0.18, 0.28, 18, 6, 0, 9), 0x6b7177], [box(2.4, 0.5, 1, 0, 18.2, 0.4), 0x3b4046]]), vcMetal);
  const tallLightHead = I(box(2.2, 0.15, 0.8, 0, 17.92, 0.45), emissive(0xfff1d6, 3), false);

  // ======================================================== CITY
  // storefront podiums along the busy streets
  {
    const tex = storefrontTextures(77);
    const tex2 = storefrontTextures(91);
    const geos: THREE.BufferGeometry[][] = [[], []];
    for (const b of BUILDINGS) {
      if (Math.abs(b.cx) > 372 || Math.abs(b.cz) > 372) continue;
      if (b.style === 'house' || b.style === 'warehouse' || b.h < 9) continue;
      const base = buildingBase(b);
      const H = 4.6;
      const g = new THREE.BoxGeometry(b.w + 0.3, H, b.d + 0.3);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let f = 0; f < 6; f++) {
        const fw = f < 2 ? b.d : b.w;
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          uv.setXY(i, (uv.getX(i) * fw) / 8 + Math.floor(r() * 2) * 0.5, uv.getY(i));
        }
      }
      // drop the top & bottom faces
      const idx = g.index!;
      const keep: number[] = [];
      for (let i = 0; i < idx.count; i += 3) {
        const face = Math.floor(idx.getX(i) / 4);
        if (face === 2 || face === 3) continue;
        keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      }
      g.setIndex(keep);
      g.clearGroups();
      g.translate(b.cx, base + H / 2, b.cz);
      geos[r() < 0.5 ? 0 : 1].push(g);
      // awnings on the side facing the street
      const blk = BLOCKS.find((bl) => Math.abs(bl.cx - b.cx) < PITCH / 2 && Math.abs(bl.cz - b.cz) < PITCH / 2);
      if (blk && r() < 0.75) {
        const dx = b.cx - blk.cx;
        const dz = b.cz - blk.cz;
        const alongX = Math.abs(dz) > Math.abs(dx);
        const sgn = alongX ? Math.sign(dz) || 1 : Math.sign(dx) || 1;
        const n = Math.max(1, Math.floor((alongX ? b.w : b.d) / 9));
        const colr = [0xd62828, 0x2a9d8f, 0xf77f00, 0x264653, 0x6a4c93, 0x1d7874][Math.floor(r() * 6)];
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          if (alongX) awning.add(b.cx + t * b.w, base + 3.6, b.cz + sgn * (b.d / 2 + 0.15), sgn > 0 ? 0 : Math.PI, 6.5, 1, 1, colr);
          else awning.add(b.cx + sgn * (b.w / 2 + 0.15), base + 3.6, b.cz + t * b.d, sgn > 0 ? Math.PI / 2 : -Math.PI / 2, 6.5, 1, 1, colr);
        }
      }
    }
    [tex, tex2].forEach((t, i) => {
      if (!geos[i].length) return;
      const m = new THREE.MeshStandardMaterial({ map: t.map, emissive: 0xffffff, emissiveMap: t.em, emissiveIntensity: 0, roughness: 0.55, metalness: 0.1 });
      nightMaterials.push({ mat: m, max: 0.6 });
      const mesh = new THREE.Mesh(mergeGeometries(geos[i])!, m);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      group.add(mesh);
    });
  }

  // ======================================================== ARCHITECTURE
  {
    const ledgeParts: THREE.BufferGeometry[] = [];
    const crownParts: THREE.BufferGeometry[] = [];
    const ring = (out: THREE.BufferGeometry[], cx: number, cz: number, w: number, d: number, y: number, h: number, o: number, color: number) => {
      // four slabs around a footprint, protruding by `o`
      out.push(paint(box(w + o * 2, h, o, cx, y, cz + d / 2 + o / 2), color));
      out.push(paint(box(w + o * 2, h, o, cx, y, cz - d / 2 - o / 2), color));
      out.push(paint(box(o, h, d, cx + w / 2 + o / 2, y, cz), color));
      out.push(paint(box(o, h, d, cx - w / 2 - o / 2, y, cz), color));
    };
    const balcony = I(parts([[box(2.6, 0.12, 1.2, 0, 0, 0.6), 0xd8d3c8], [box(2.6, 0.9, 0.05, 0, 0.5, 1.18), 0x7f8a94], [box(0.05, 0.9, 1.2, -1.28, 0.5, 0.6), 0x7f8a94], [box(0.05, 0.9, 1.2, 1.28, 0.5, 0.6), 0x7f8a94]]), vcMetal);
    const penthouse = I(parts([[box(1, 1, 1, 0, 0.5, 0), 0xbfbab0], [box(1.06, 0.08, 1.06, 0, 1.0, 0), 0x8f8a80]]));
    const dish = I(parts([[cyl(0.04, 0.04, 0.8, 5, 0, 0.4), 0x888888], [new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.35).rotateX(-1.1).translate(0, 0.9, 0.1), 0xe6e6e6]]), vcMetal);
    const mast = I(parts([[cyl(0.06, 0.1, 9, 6, 0, 4.5), 0x9aa0a6], [box(1.2, 0.06, 0.06, 0, 6, 0), 0x9aa0a6], [box(0.8, 0.06, 0.06, 0, 7.5, 0), 0x9aa0a6]]), vcMetal);
    const chimney = I(parts([[box(0.8, 2.2, 0.8, 0, 1.1, 0), 0x8f4a3a], [box(1.0, 0.15, 1.0, 0, 2.25, 0), 0x6b3a2e]]));
    const solar = I(parts([[box(1.8, 0.05, 1.1, 0, 0, 0).rotateX(-0.45), 0x1c2b4a], [box(1.82, 0.02, 0.04, 0, 0.02, 0).rotateX(-0.45), 0xb0b8c0]]), vcMetal);
    const porchG = I(parts([[box(4.2, 0.2, 2.2, 0, 0.1, 1.1), 0xcfc8bb], [box(4.4, 0.12, 2.4, 0, 2.7, 1.2), 0x7a4b36], [cyl(0.07, 0.07, 2.6, 6, -1.9, 1.35, 2.1), 0xf2efe8], [cyl(0.07, 0.07, 2.6, 6, 1.9, 1.35, 2.1), 0xf2efe8], [box(1.4, 0.18, 0.4, 0, 0.09, 2.4), 0xbab3a6]]));
    const garage = I(parts([[box(3.2, 2.3, 0.06, 0, 1.15, 0), 0xe6e1d6], ...[0.5, 1.0, 1.5, 2.0].map((y): [THREE.BufferGeometry, number] => [box(3.2, 0.03, 0.07, 0, y, 0.005), 0xb9b3a7])]));
    const crownLightMat = emissive(0x9ee7ff, 1.6);
    for (const b of BUILDINGS) {
      const base = buildingBase(b);
      const tint = new THREE.Color(b.tint);
      const ledgeCol = tint.clone().lerp(new THREE.Color(0xffffff), 0.35).getHex();
      if (b.style === 'house') {
        const top = base + b.h;
        chimney.add(b.cx + b.w * 0.3, top + 0.4, b.cz - b.d * 0.15);
        if (r() < 0.35) solar.add(b.cx - b.w * 0.15, top + 1.2, b.cz + b.d * 0.22, 0, 1, 1, 1);
        // porch & garage on the street side (city houses face the nearest block edge)
        const blk = BLOCKS.find((bl) => Math.abs(bl.cx - b.cx) < PITCH / 2 && Math.abs(bl.cz - b.cz) < PITCH / 2);
        let yaw = 0;
        if (blk) {
          const dx = b.cx - blk.cx;
          const dz = b.cz - blk.cz;
          yaw = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : dz > 0 ? 0 : Math.PI;
        }
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        const half = Math.abs(fx) > 0.5 ? b.w / 2 : b.d / 2;
        const side = Math.abs(fx) > 0.5 ? b.d : b.w;
        porchG.add(b.cx + fx * half + -fz * side * 0.18, base, b.cz + fz * half + fx * side * 0.18, yaw);
        if (r() < 0.5) garage.add(b.cx + fx * (half + 0.03) - -fz * side * 0.25, base, b.cz + fz * (half + 0.03) - fx * side * 0.25, yaw);
        continue;
      }
      if (b.style === 'warehouse' || b.h < 8) continue;
      // horizontal ledges every few floors and a heavier crown cornice
      const step = b.style === 'glass' ? 14 : b.style === 'brick' ? 12 : 10.5;
      const masses = b.style === 'glass' && b.h > 70 ? [{ w: b.w, d: b.d, y0: base, h: b.h * 0.72 }, { w: b.w * 0.74, d: b.d * 0.74, y0: base + b.h * 0.72 + 0.6, h: b.h * 0.28 - 0.6 }] : [{ w: b.w, d: b.d, y0: base, h: b.h }];
      for (const m of masses) {
        for (let y = m.y0 + step; y < m.y0 + m.h - 2; y += step) ring(ledgeParts, b.cx, b.cz, m.w, m.d, y, b.style === 'glass' ? 0.18 : 0.3, b.style === 'glass' ? 0.12 : 0.22, ledgeCol);
        ring(crownParts, b.cx, b.cz, m.w, m.d, m.y0 + m.h - 0.2, 0.7, 0.35, tint.clone().multiplyScalar(0.8).getHex());
      }
      const roofY = base + b.h + 0.6;
      // apartment balconies on the two long facades
      if (b.style === 'apartment') {
        const alongX = b.w >= b.d;
        const len = alongX ? b.w : b.d;
        const n = Math.floor((len - 2) / 4);
        for (let y = base + 6.2; y < base + b.h - 2.5; y += 3) {
          for (let k = 0; k < n; k++) {
            if (r() < 0.3) continue;
            const t = -len / 2 + 2 + (k + 0.5) * ((len - 4) / n);
            for (const sgn of [-1, 1]) {
              if (alongX) balcony.add(b.cx + t, y, b.cz + sgn * (b.d / 2), sgn > 0 ? 0 : Math.PI);
              else balcony.add(b.cx + sgn * (b.w / 2), y, b.cz + t, sgn > 0 ? Math.PI / 2 : -Math.PI / 2);
            }
          }
        }
      }
      // rooftop machinery
      if (b.h > 24 && b.roofProps) {
        const top = b.style === 'glass' && b.h > 70 ? base + b.h + 0.6 : roofY;
        const scaleW = b.style === 'glass' && b.h > 70 ? 0.74 : 1;
        penthouse.add(b.cx - b.w * 0.18 * scaleW, top, b.cz + b.d * 0.15 * scaleW, 0, Math.min(8, b.w * 0.3), 4, Math.min(7, b.d * 0.28));
        if (r() < 0.6) dish.add(b.cx + b.w * 0.3 * scaleW, top, b.cz - b.d * 0.3 * scaleW, r() * 6.28);
        if (r() < 0.4 && b.h < 70) mast.add(b.cx + b.w * 0.32, top, b.cz + b.d * 0.32);
      }
      // glowing crown on tall glass towers
      if (b.style === 'glass' && b.h > 55) {
        const w = b.h > 70 ? b.w * 0.74 : b.w;
        const d = b.h > 70 ? b.d * 0.74 : b.d;
        const g: THREE.BufferGeometry[] = [];
        ring(g, b.cx, b.cz, w, d, base + b.h + 0.15, 0.25, 0.4, 0xffffff);
        const me = new THREE.Mesh(mergeGeometries(g)!, crownLightMat);
        group.add(me);
      }
    }
    const lm = new THREE.Mesh(mergeGeometries(ledgeParts)!, vcMat);
    lm.castShadow = lm.receiveShadow = true;
    group.add(lm);
    const cm = new THREE.Mesh(mergeGeometries(crownParts)!, vcMat);
    cm.castShadow = cm.receiveShadow = true;
    group.add(cm);
  }

  // downtown street trees with iron grates
  {
    const sTree = I(parts([[cyl(0.11, 0.16, 3.2, 6, 0, 1.6), 0x5e4630], [new THREE.IcosahedronGeometry(1.5, 1).scale(1, 1.15, 1).translate(0, 4.1, 0), 0x4e7f39], [new THREE.IcosahedronGeometry(1.1, 1).translate(0.6, 3.5, 0.3), 0x5a8c41]]));
    const grate = I(new THREE.BoxGeometry(1.4, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.7, roughness: 0.5 }), false);
    for (const b of BLOCKS) {
      if (b.district !== 'downtown' && b.district !== 'commercial') continue;
      if (b.special === 'park' || b.special === 'plaza') continue;
      for (let side = 0; side < 4; side++) {
        const yaw = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][side];
        const out = { x: Math.sin(yaw), z: Math.cos(yaw) };
        for (const t of [0.12, 0.88]) {
          const p = sidewalkPointOnBlock(b, side, t);
          const x = p.x + out.x * 1.3;
          const z = p.z + out.z * 1.3;
          sTree.add(x, CURB_H, z, r() * 6.28, 0.9 + r() * 0.3);
          grate.add(x, CURB_H + 0.02, z);
          col.addBox(x, z, 0.4, 0.4, 0, 4, 'wood');
        }
      }
    }
  }

  // kerbside furniture on every block
  for (const b of BLOCKS) {
    const e = SIDEWALK_RING + 1.4; // near the kerb
    // hydrant at one corner
    const sx = r() < 0.5 ? 1 : -1;
    const sz = r() < 0.5 ? 1 : -1;
    hydrant.add(b.cx + sx * (e - 2), CURB_H, b.cz + sz * e);
    col.addBox(b.cx + sx * (e - 2), b.cz + sz * e, 0.4, 0.4, 0, 1, 'metal');
    for (let side = 0; side < 4; side++) {
      const yaw = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][side];
      const out = { x: Math.sin(yaw), z: Math.cos(yaw) };
      // bins
      if (r() < 0.6) {
        const p = sidewalkPointOnBlock(b, side, 0.32 + r() * 0.1);
        bin.add(p.x + out.x * 1.2, CURB_H, p.z + out.z * 1.2);
        col.addBox(p.x + out.x * 1.2, p.z + out.z * 1.2, 0.6, 0.6, 0, 1, 'metal');
      }
      if (b.district === 'downtown' || b.district === 'commercial') {
        if (r() < 0.35) {
          const p = sidewalkPointOnBlock(b, side, 0.62);
          planter.add(p.x - out.x * 0.9, CURB_H, p.z - out.z * 0.9);
          col.addBox(p.x - out.x * 0.9, p.z - out.z * 0.9, 1.4, 1.4, 0, 0.6, 'building');
        }
        if (r() < 0.25) {
          const p = sidewalkPointOnBlock(b, side, 0.78);
          newsbox.add(p.x + out.x * 1.1, CURB_H, p.z + out.z * 1.1, yaw + Math.PI);
        }
        // bus stop: one side of most busy blocks
        if (side === (b.i + b.j) % 4 && r() < 0.7) {
          const p = sidewalkPointOnBlock(b, side, 0.55);
          const x = p.x + out.x * 0.6;
          const z = p.z + out.z * 0.6;
          busStop.add(x, CURB_H, z, yaw);
          adPanel.add(x, CURB_H, z, yaw);
          col.addBox(x - out.x * 0.68, z - out.z * 0.68, Math.abs(out.z) * 3.6 + 0.1, Math.abs(out.x) * 3.6 + 0.1, 0, 2.4, 'glass');
        }
      }
    }
  }
  // manhole covers on the roads
  for (const a of LINES)
    for (let k = 0; k < LINES.length - 1; k++) {
      const s = LINES[k] + 20 + r() * (PITCH - 40);
      const off = (r() - 0.5) * 6;
      manhole.add(a + off, 0.035, s);
      if (r() < 0.6) manhole.add(s, 0.035, a + off);
    }

  // residential: hedges, mailboxes and backyard pools around houses
  for (const b of BUILDINGS) {
    if (b.style !== 'house') continue;
    const inCity = Math.abs(b.cx) < 372 && Math.abs(b.cz) < 372;
    const base = buildingBase(b);
    const L = Math.max(b.w, b.d) + 7;
    const y = inCity ? CURB_H : base;
    // which side faces the street?
    let fx = 0;
    let fz = 1;
    if (inCity) {
      const blk = BLOCKS.find((bl) => Math.abs(bl.cx - b.cx) < PITCH / 2 && Math.abs(bl.cz - b.cz) < PITCH / 2);
      if (blk) {
        const dx = b.cx - blk.cx;
        const dz = b.cz - blk.cz;
        if (Math.abs(dx) > Math.abs(dz)) {
          fx = Math.sign(dx);
          fz = 0;
        } else {
          fx = 0;
          fz = Math.sign(dz) || 1;
        }
      }
    }
    // hedges on the two sides and the back
    const sides: [number, number, number][] = [];
    if (fz !== 0) {
      sides.push([b.cx - L / 2, b.cz, Math.PI / 2], [b.cx + L / 2, b.cz, Math.PI / 2], [b.cx, b.cz - fz * (L / 2), 0]);
    } else {
      sides.push([b.cx, b.cz - L / 2, 0], [b.cx, b.cz + L / 2, 0], [b.cx - fx * (L / 2), b.cz, Math.PI / 2]);
    }
    for (const [x, z, yaw] of sides) {
      if (!inCity && nearestCountryRoad(x, z).dist < 8) continue;
      hedge.add(x, inCity ? y : terrainHeight(x, z), z, yaw, L, 1.1 + r() * 0.3, 0.7);
      col.addBox(x, z, yaw === 0 ? L : 0.7, yaw === 0 ? 0.7 : L, y - 1, y + 1.2, 'wood');
    }
    // mailbox at the front
    mailbox.add(b.cx + fx * (L / 2 - 0.5) + (fz !== 0 ? 2.5 : 0), y, b.cz + fz * (L / 2 - 0.5) + (fx !== 0 ? 2.5 : 0));
    // pool behind some houses
    if (inCity && r() < 0.3) {
      const px = b.cx - fx * (b.d / 2 + 2.6);
      const pz = b.cz - fz * (b.d / 2 + 2.6);
      const yaw = fz !== 0 ? 0 : Math.PI / 2;
      poolRim.add(px, y + 0.06, pz, yaw, 6.6, 1, 3.6);
      poolWater.add(px, y + 0.13, pz, yaw, 6, 1, 3);
      col.addBox(px, pz, yaw === 0 ? 6.6 : 3.6, yaw === 0 ? 3.6 : 6.6, y - 1, y + 0.13, 'building');
    }
  }

  // industrial: smokestacks with smoke, storage tanks, pallets
  {
    const stack = I(parts([[cyl(0.9, 1.3, 22, 12, 0, 11), 0xb8b2a8], [cyl(0.95, 0.95, 1.6, 12, 0, 18), 0xc0392b], [cyl(0.95, 0.95, 1.6, 12, 0, 20.5), 0xc0392b]]));
    const tank = I(parts([[cyl(7, 7, 11, 24, 0, 5.5), 0xdedad2], [new THREE.SphereGeometry(7, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.18).translate(0, 4.4, 0), 0xcfcac0], [box(0.2, 11, 0.6, 7.05, 5.5, 0), 0x8a8a8a]]), vcMetal);
    for (const b of BUILDINGS) {
      if (b.style !== 'warehouse' && b.style !== 'brick') continue;
      if (!(b.cx > 220 && Math.abs(b.cx) < 372 && Math.abs(b.cz) < 372)) continue;
      if (r() < 0.45) {
        const base = buildingBase(b);
        const x = b.cx + (r() - 0.5) * b.w * 0.5;
        const z = b.cz + (r() - 0.5) * b.d * 0.5;
        stack.add(x, base + b.h, z);
        emitters.push({ x, y: base + b.h + 22.5, z, kind: 'smoke' });
      }
      for (let k = 0; k < 3; k++) {
        if (r() < 0.4) continue;
        const a = r() * Math.PI * 2;
        const x = b.cx + Math.sin(a) * (b.w / 2 + 2);
        const z = b.cz + Math.cos(a) * (b.d / 2 + 2);
        if (inLot(x, z)) pallet.add(x, CURB_H, z, r() * 3);
      }
    }
    for (const [x, z] of [
      [515, 230],
      [535, 255],
      [555, 230],
      [520, -300],
      [545, -300],
    ]) {
      tank.add(x, 0.15, z);
      col.addBox(x, z, 12, 12, 0, 11, 'metal');
    }
  }

  // ======================================================== HARBOUR
  {
    // quay bollards and light towers
    for (let z = -320; z <= 320; z += 7) bollard.add(582, 0.15, z);
    for (let z = -300; z <= 300; z += 60) {
      tallLight.add(576, 0.15, z, -Math.PI / 2);
      tallLightHead.add(576, 0.15, z, -Math.PI / 2);
      lampPositions.push(new THREE.Vector3(576, 18, z));
      col.addBox(576, z, 0.6, 0.6, 0, 18, 'metal');
    }
    // rail siding with a parked freight train
    const railMat = new THREE.MeshStandardMaterial({ color: 0x6d6d6d, metalness: 0.8, roughness: 0.35 });
    const rails = I(box(0.1, 0.15, 1, 0, 0.25, 0), railMat, false);
    const sleeper = I(box(2.4, 0.14, 0.26, 0, 0.17, 0), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 }), false);
    for (const x of [489.25, 490.75]) rails.add(x, 0.15, 0, 0, 1, 1, 640);
    for (let z = -320; z <= 320; z += 0.8) sleeper.add(490, 0.15, z);
    const boxcar = I(parts([[box(2.9, 3.4, 13, 0, 2.3, 0), 0x8b3a2b], [box(3.0, 0.15, 13.1, 0, 4.05, 0), 0x5e2a20], [box(2.0, 0.6, 12, 0, 0.6, 0), 0x222222]]));
    const loco = I(parts([[box(3, 3.6, 16, 0, 2.4, 0), 0x1d4ed8], [box(3.05, 0.6, 16.05, 0, 2.6, 0), 0xf2b705], [box(2.6, 1.4, 4, 0, 4.7, 5), 0x1d4ed8], [box(2.0, 0.6, 15, 0, 0.6, 0), 0x222222]]));
    loco.add(490, 0.15, -160);
    col.addBox(490, -160, 3.2, 16.4, 0, 6, 'metal');
    const carColors = [0x8b3a2b, 0x2e6b46, 0x5d6d7e, 0x7d6608];
    for (let k = 0; k < 9; k++) {
      const z = -145 + k * 14;
      boxcar.add(490, 0.15, z, 0, 1, 1, 1, carColors[k % carColors.length]);
      col.addBox(490, z, 3.2, 13.4, 0, 4.3, 'metal');
    }
    // forklifts & crate stacks between the warehouses
    for (let k = 0; k < 6; k++) {
      const x = 400 + r() * 40;
      const z = -235 + k * 95 + 45;
      forklift.add(x, 0.15, z, r() * 6.28);
      col.addBox(x, z, 1.8, 1.8, 0, 2.2, 'metal');
      for (let c = 0; c < 6; c++) {
        const cx = x + (r() - 0.5) * 14;
        const cz = z + (r() - 0.5) * 10;
        const h = 1 + Math.floor(r() * 3);
        for (let s = 0; s < h; s++) crate.add(cx, 0.15 + s * 1.2, cz, r() * 0.4);
        col.addBox(cx, cz, 1.3, 1.3, 0, 0.15 + h * 1.2, 'wood');
      }
    }
    // tugboats in the water
    const tug = I(
      parts([
        [new THREE.CapsuleGeometry(2.2, 9, 4, 10).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.4, 0), 0xc0392b],
        [box(3, 2.2, 4, 0, 2.4, -1), 0xf4f6f7],
        [box(2.6, 0.9, 3, 0, 4, -1.2), 0xf4f6f7],
        [cyl(0.35, 0.35, 2, 8, 0, 5.2, -2.5), 0x222222],
      ]),
    );
    tug.add(612, SEA_LEVEL, -120, 0.3);
    tug.add(604, SEA_LEVEL, 210, -0.2);
  }

  // ======================================================== BEACH & PIER
  {
    const towerG = I(
      parts([
        [box(0.15, 2.4, 0.15, -1, 1.2, -1), 0xf4f4f4],
        [box(0.15, 2.4, 0.15, 1, 1.2, -1), 0xf4f4f4],
        [box(0.15, 2.4, 0.15, -1, 1.2, 1), 0xf4f4f4],
        [box(0.15, 2.4, 0.15, 1, 1.2, 1), 0xf4f4f4],
        [box(2.6, 0.15, 2.6, 0, 2.45, 0), 0xe0dccf],
        [box(2.4, 1.6, 2.2, 0, 3.3, -0.2), 0xd62828],
        [box(2.6, 0.12, 2.8, 0, 4.2, 0), 0xf4f4f4],
        [box(0.9, 0.08, 3.2, 0, 1.2, 2.2).rotateX(0.75), 0xe0dccf],
      ]),
    );
    for (const x of [-230, -20, 200]) {
      const z = 452;
      towerG.add(x, terrainHeight(x, z), z, Math.PI);
      col.addBox(x, z, 2.6, 2.6, terrainHeight(x, z) - 1, terrainHeight(x, z) + 4.2, 'wood');
    }
    // volleyball nets
    const net = I(parts([[cyl(0.06, 0.06, 2.6, 6, -4.5, 1.3), 0xdddddd], [cyl(0.06, 0.06, 2.6, 6, 4.5, 1.3), 0xdddddd], [box(9, 0.9, 0.03, 0, 2.05), 0x222222]]));
    for (const x of [-120, 100]) net.add(x, terrainHeight(x, 440), 440);
    // sunbeds & towels near the umbrellas
    const towelColors = [0xe63946, 0xf1faee, 0x457b9d, 0xf4a261, 0x2a9d8f, 0xffb703];
    for (let k = 0; k < 70; k++) {
      const x = -320 + r() * 640;
      const z = 430 + r() * 36;
      const h = terrainHeight(x, z);
      if (h < SEA_LEVEL + 0.3) continue;
      if (r() < 0.5) sunbed.add(x, h, z, Math.PI + (r() - 0.5) * 0.4);
      else towel.add(x, h + 0.03, z, r() * 0.6, 1, 1, 1, towelColors[k % towelColors.length]);
    }
    // food kiosks along the boardwalk
    const kiosk = I(
      parts([
        [box(3.2, 2.4, 2.4, 0, 1.2, 0), 0xf4ede1],
        [box(3.6, 0.15, 3.2, 0, 2.6, 0.4), 0x2a9d8f],
        [box(3, 0.1, 0.5, 0, 1.1, 1.35), 0xc9b48a],
        [box(2.6, 1, 0.05, 0, 1.75, 1.21), 0x3b4d5a],
      ]),
    );
    for (const x of [-280, -160, -60, 60, 160, 260]) {
      kiosk.add(x, terrainHeight(x, 421), 421, Math.PI);
      col.addBox(x, 421, 3.4, 2.6, terrainHeight(x, 421) - 1, terrainHeight(x, 421) + 2.6, 'wood');
    }
    // raised boardwalk along the beach road
    const deck = new THREE.Mesh(box(660, 0.25, 4, 0, 0, 0), new THREE.MeshStandardMaterial({ color: 0x7d6650, roughness: 0.9 }));
    deck.position.set(0, 0.55, 414.5);
    deck.receiveShadow = true;
    group.add(deck);
    // pier lamps
    for (let z = 460; z <= 580; z += 24) {
      addLamp(50.6, 2.5, z, Math.PI / 2);
      addLamp(69.4, 2.5, z + 12, -Math.PI / 2);
    }
  }

  // ======================================================== HILLS: villas
  for (const v of VILLAS) {
    const base = terrainHeight(v.x, v.z);
    // terrace & pool on the downhill (south) side
    poolRim.add(v.x, base + 0.06, v.z + v.d / 2 + 4, 0, v.w * 0.7 + 0.6, 1, 4.6);
    poolWater.add(v.x, base + 0.13, v.z + v.d / 2 + 4, 0, v.w * 0.7, 1, 4);
    col.addBox(v.x, v.z + v.d / 2 + 4, v.w * 0.7 + 0.6, 4.6, base - 1, base + 0.13, 'building');
    for (let k = -2; k <= 2; k++) planter.add(v.x + k * (v.w / 5), base, v.z - v.d / 2 - 2.5);
  }
  // viewpoint railing & picnic tables near the observatory
  for (let k = 0; k < 12; k++) {
    const x = -20 + k * 4;
    const z = -688;
    woodPost.add(x, terrainHeight(x, z), z);
    woodRail.add(x + 2, terrainHeight(x, z) + 1.1, z, 0, 4, 1, 1);
  }
  for (const [x, z] of [
    [0, -672],
    [12, -678],
    [55, -660],
  ])
    picnic.add(x, terrainHeight(x, z), z, r() * 3);

  // ======================================================== MOUNTAINS, FOREST & LAKE
  for (let k = 0; k < 1400; k++) {
    const x = (r() - 0.5) * 3800;
    const z = -400 - r() * 1350;
    const h = terrainHeight(x, z);
    if (h < 2) continue;
    if (nearestCountryRoad(x, z).dist < 12) continue;
    const s = 0.6 + r() * r() * 3.5;
    rock.add(x, h - s * 0.3, z, r() * 6.28, s * 1.3, s * 0.8, s);
    if (s > 1.4) col.addBox(x, z, s * 1.6, s * 1.6, h - 2, h + s * 0.5, 'building');
  }
  for (let k = 0; k < 140; k++) {
    const x = 300 + r() * 900;
    const z = -500 - r() * 1000;
    const h = terrainHeight(x, z);
    if (h < 1 || nearestCountryRoad(x, z).dist < 10) continue;
    log.add(x, h + 0.25, z, r() * 6.28, 3 + r() * 4, 1, 1);
  }
  // campsites by the lake
  for (const [cx, cz] of [
    [LAKE.x + 170, LAKE.z + 40],
    [LAKE.x - 40, LAKE.z + 200],
  ]) {
    const h = terrainHeight(cx, cz);
    const tentColors = [0xe76f51, 0x2a9d8f, 0xf4a261];
    for (let t = 0; t < 3; t++) {
      const a = (t / 3) * Math.PI * 2;
      tent.add(cx + Math.sin(a) * 6, terrainHeight(cx + Math.sin(a) * 6, cz + Math.cos(a) * 6), cz + Math.cos(a) * 6, a, 1, 1, 1, tentColors[t]);
    }
    log.add(cx + 1.6, h + 0.25, cz, 0, 2, 1, 1);
    log.add(cx - 1.6, h + 0.25, cz, Math.PI / 2, 2, 1, 1);
    emitters.push({ x: cx, y: h + 0.3, z: cz, kind: 'fire' });
    picnic.add(cx + 9, h, cz - 4, 0.4);
  }
  // canoes on the shore & a ranger lookout
  const canoe = I(new THREE.CapsuleGeometry(0.45, 3.6, 4, 8).rotateX(Math.PI / 2).scale(1, 0.45, 1), new THREE.MeshStandardMaterial({ color: 0xd35400, roughness: 0.6 }));
  for (let k = 0; k < 4; k++) {
    const a = 2.3 + k * 0.18;
    const x = LAKE.x + Math.cos(a) * LAKE.r * 1.32;
    const z = LAKE.z + Math.sin(a) * LAKE.r * 1.32;
    canoe.add(x, Math.max(terrainHeight(x, z), SEA_LEVEL) + 0.2, z, a);
  }
  {
    const x = LAKE.x + 210;
    const z = LAKE.z - 120;
    const h = terrainHeight(x, z);
    const lookout = new THREE.Mesh(
      parts([
        [box(0.3, 12, 0.3, -2, 6, -2), 0x6b4e36],
        [box(0.3, 12, 0.3, 2, 6, -2), 0x6b4e36],
        [box(0.3, 12, 0.3, -2, 6, 2), 0x6b4e36],
        [box(0.3, 12, 0.3, 2, 6, 2), 0x6b4e36],
        [box(5, 0.3, 5, 0, 12, 0), 0x8a6a45],
        [box(4.6, 2, 4.6, 0, 13.3, 0), 0x9c7a55],
        [new THREE.ConeGeometry(4, 2, 4).rotateY(Math.PI / 4).translate(0, 15.3, 0), 0x5e3a24],
      ]),
      vcMat,
    );
    lookout.position.set(x, h, z);
    lookout.castShadow = true;
    group.add(lookout);
    col.addBox(x, z, 4.6, 4.6, h - 1, h + 16, 'wood');
  }

  // ======================================================== DESERT
  {
    // mesas and buttes
    const mesaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const spots: [number, number][] = [];
    for (let k = 0; k < 60 && spots.length < 12; k++) {
      const x = -1750 + r() * 1100;
      const z = -1000 + r() * 1350;
      if (biomeAt(x, z).desert < 0.8) continue;
      if (nearestCountryRoad(x, z).dist < 70) continue;
      if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 60) continue;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 120)) continue;
      spots.push([x, z]);
    }
    for (const [x, z] of spots) {
      const R = 16 + r() * 22;
      const H = 14 + r() * 26;
      const tiers: [THREE.BufferGeometry, number][] = [];
      let y = 0;
      const bands = [0xa8603c, 0xc07a4e, 0x9a5434, 0xd09060];
      const nT = 2 + Math.floor(r() * 2);
      for (let t = 0; t < nT; t++) {
        const rr = R * (1 - t * 0.28);
        const hh = (H / nT) * (0.8 + r() * 0.4);
        const g = new THREE.CylinderGeometry(rr * 0.92, rr, hh, 9, 1);
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const k2 = 0.85 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.3;
          p.setX(i, p.getX(i) * k2);
          p.setZ(i, p.getZ(i) * k2);
        }
        g.translate(0, y + hh / 2, 0);
        tiers.push([g, bands[t % bands.length]]);
        y += hh;
      }
      const mesh = new THREE.Mesh(parts(tiers), mesaMat);
      const base = terrainHeight(x, z) - 2;
      mesh.position.set(x, base, z);
      mesh.rotation.y = r() * 6;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      col.addBox(x, z, R * 1.4, R * 1.4, base, base + y, 'building');
    }
    // boulders, shrubs, wrecks
    for (let k = 0; k < 2600; k++) {
      const x = -1850 + r() * 1300;
      const z = -1100 + r() * 1600;
      const bio = biomeAt(x, z);
      if (bio.desert < 0.5 || bio.airport > 0.05) continue;
      if (nearestCountryRoad(x, z).dist < 10) continue;
      if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r * 0.6) continue;
      const h = terrainHeight(x, z);
      if (r() < 0.25) {
        const s = 0.5 + r() * r() * 3;
        redRock.add(x, h - s * 0.3, z, r() * 6.28, s * 1.2, s * 0.7, s);
        if (s > 1.5) col.addBox(x, z, s * 1.5, s * 1.5, h - 1, h + s * 0.4, 'building');
      } else shrub.add(x, h, z, r() * 6.28, 0.6 + r() * 0.8, 0.5 + r() * 0.5, 0.6 + r() * 0.8);
    }
    for (const [x, z, yaw] of [
      [-1020, -360, 0.4],
      [-1480, -480, 2.1],
      [-1320, 260, 1.2],
      [-890, -60, 2.8],
      [-1650, -100, 0.9],
    ]) {
      const h = terrainHeight(x, z);
      wreck.add(x, h - 0.15, z, yaw);
      col.addBox(x, z, 2.4, 2.4, h - 1, h + 1.6, 'metal');
    }
    // trailer park north-east of town
    for (let k = 0; k < 8; k++) {
      const x = -1170 + (k % 4) * 22;
      const z = -215 - Math.floor(k / 4) * 16;
      const h = terrainHeight(x, z);
      trailer.add(x, h, z, Math.PI / 2 + (r() - 0.5) * 0.2);
      col.addBox(x, z, 3, 9.5, h - 1, h + 3, 'metal');
      if (r() < 0.6) barrel.add(x + 2.5, h, z + 3);
    }
    // farm windpumps (animated)
    for (const [x, z] of [
      [-1380, -380],
      [-560, 230],
      [-1580, 120],
    ]) {
      const h = terrainHeight(x, z);
      const tower = new THREE.Mesh(
        parts([
          [box(0.15, 10, 0.15, -1, 5, -1).rotateZ(0.08), 0x777777],
          [box(0.15, 10, 0.15, 1, 5, -1).rotateZ(-0.08), 0x777777],
          [box(0.15, 10, 0.15, -1, 5, 1).rotateZ(0.08), 0x777777],
          [box(0.15, 10, 0.15, 1, 5, 1).rotateZ(-0.08), 0x777777],
          [box(1.6, 0.12, 1.6, 0, 9.8, 0), 0x666666],
          [box(0.15, 0.6, 2.4, 0, 10.4, -1.4), 0xb03a2e],
        ]),
        vcMetal,
      );
      tower.position.set(x, h, z);
      tower.castShadow = true;
      group.add(tower);
      const rotor = new THREE.Group();
      for (let b = 0; b < 12; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.04).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 0.5 }));
        blade.rotation.z = (b / 12) * Math.PI * 2;
        rotor.add(blade);
      }
      rotor.position.set(x, h + 10.4, z + 0.3);
      group.add(rotor);
      animated.push({ obj: rotor, axis: 'z', speed: 1.4 });
      col.addBox(x, z, 2.4, 2.4, h - 1, h + 10, 'metal');
    }
  }

  // ======================================================== DUSTWATER TOWN
  {
    const plank = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95 });
    // boardwalks both sides of main street, following the two straight segments
    for (const [x0, x1] of [
      [-1400, -1250],
      [-1250, -1100],
    ]) {
      const z0 = townRoadZ(x0);
      const z1 = townRoadZ(x1);
      const L = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      const nx = -(z1 - z0) / L;
      const nz = (x1 - x0) / L;
      for (const side of [-1, 1]) {
        const off = 10.5 * side;
        const cx = (x0 + x1) / 2 + nx * off;
        const cz = (z0 + z1) / 2 + nz * off;
        const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, L), plank);
        m.position.set(cx, terrainHeight(cx, cz) + 0.18, cz);
        m.rotation.y = yaw;
        m.receiveShadow = true;
        group.add(m);
        // street lamps & power poles
        for (let t = 0.1; t < 1; t += 0.2) {
          const lx = x0 + (x1 - x0) * t + nx * (off + 1.6 * side);
          const lz = z0 + (z1 - z0) * t + nz * (off + 1.6 * side);
          addLamp(lx, terrainHeight(lx, lz), lz, side > 0 ? yaw - Math.PI / 2 : yaw + Math.PI / 2);
        }
      }
    }
    // porch roofs in front of the main street buildings
    const porch = I(parts([[box(1, 0.15, 3, 0, 3.4, 1.5), 0x7b5b3a], [box(0.15, 3.4, 0.15, -0.45, 1.7, 2.9), 0x6b4e36]]));
    for (const b of BUILDINGS) {
      if (b.style === 'house' || Math.hypot(b.cx - TOWN.x, b.cz - TOWN.z) > TOWN.r) continue;
      if (Math.abs(b.cz - townRoadZ(b.cx)) > 40) continue;
      const toRoad = Math.sign(townRoadZ(b.cx) - b.cz) || 1;
      const base = buildingBase(b);
      porch.add(b.cx, base, b.cz + toRoad * (b.d / 2), toRoad > 0 ? 0 : Math.PI, b.w * 0.95, 1, 1);
      for (let k = 0; k < 3; k++) if (r() < 0.6) barrel.add(b.cx + (r() - 0.5) * b.w, base, b.cz + toRoad * (b.d / 2 + 1), 0);
    }
    // picket fences around the back-row houses
    for (const b of BUILDINGS) {
      if (b.style !== 'house' || Math.hypot(b.cx - TOWN.x, b.cz - TOWN.z) > TOWN.r) continue;
      const L = b.w + 6;
      const base = buildingBase(b);
      for (let k = 0; k <= L; k += 2) {
        for (const s of [-1, 1]) fencePost.add(b.cx - L / 2 + k, base, b.cz + s * (b.d / 2 + 3));
      }
      for (const s of [-1, 1]) {
        fenceRail.add(b.cx, base + 0.5, b.cz + s * (b.d / 2 + 3), 0, L, 1, 1);
        fenceRail.add(b.cx, base + 0.95, b.cz + s * (b.d / 2 + 3), 0, L, 1, 1);
      }
      hayBale.add(b.cx + L / 2 + 3, base, b.cz, r() * 3);
    }
    // church with a steeple
    {
      const x = -1440;
      const z = -40;
      const h = terrainHeight(x, z);
      const church = new THREE.Mesh(
        parts([
          [box(12, 7, 20, 0, 3.5, 0), 0xf2ede4],
          [new THREE.CylinderGeometry(0, 8.6, 5, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.75).translate(0, 9.5, 0), 0x7a3b2e],
          [box(4, 10, 4, 0, 5, 11), 0xf2ede4],
          [new THREE.ConeGeometry(3, 7, 4).rotateY(Math.PI / 4).translate(0, 13.5, 11), 0x7a3b2e],
          [box(0.3, 2, 0.3, 0, 18, 11), 0xd4ac0d],
          [box(1.2, 0.3, 0.3, 0, 18.5, 11), 0xd4ac0d],
          [box(2.4, 3.5, 0.1, 0, 1.75, 13.02), 0x5e3a24],
        ]),
        vcMat,
      );
      church.position.set(x, h, z);
      church.castShadow = church.receiveShadow = true;
      group.add(church);
      col.addBox(x, z, 12, 20, h - 1, h + 9, 'building');
      col.addBox(x, z + 11, 4, 4, h - 1, h + 17, 'building');
    }
    // motel neon sign
    {
      const x = -1345;
      const rz = townRoadZ(x);
      const z = rz - 13;
      const h = terrainHeight(x, z);
      const pole = new THREE.Mesh(cyl(0.25, 0.3, 9, 8), new THREE.MeshStandardMaterial({ color: 0x555b61, metalness: 0.6 }));
      pole.position.set(x, h + 4.5, z);
      group.add(pole);
      const t = signTexture('MOTEL 仙人掌', '#16213e', '#ff4fa3', 512, 160);
      const sm = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3, side: THREE.DoubleSide });
      nightMaterials.push({ mat: sm, max: 2.2 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.9), sm);
      sign.position.set(x, h + 9.5, z);
      group.add(sign);
      const vac = signTexture('有空房', '#16213e', '#3ee6ff', 256, 96);
      const vm = new THREE.MeshStandardMaterial({ map: vac, emissive: 0xffffff, emissiveMap: vac, emissiveIntensity: 0.3, side: THREE.DoubleSide });
      nightMaterials.push({ mat: vm, max: 2.2 });
      const v2 = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.1), vm);
      v2.position.set(x, h + 7.9, z);
      group.add(v2);
      col.addBox(x, z, 0.6, 0.6, h - 1, h + 9, 'metal');
    }
  }

  // ======================================================== AIRPORT
  {
    const ay = AIRPORT.y;
    // perimeter chain-link fence
    const fenceMat = new THREE.MeshStandardMaterial({ map: chainLinkTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
    const fencePanel = I(new THREE.PlaneGeometry(1, 2.4).translate(0, 1.2, 0), fenceMat, false);
    const fencePole = I(cyl(0.05, 0.05, 2.6, 5, 0, 1.3), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7 }));
    const { minX, maxX, minZ, maxZ } = AIRPORT;
    const edge = (x0: number, z0: number, x1: number, z1: number) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      for (let t = 0; t < L; t += 6) {
        const x = x0 + ((x1 - x0) * (t + 3)) / L;
        const z = z0 + ((z1 - z0) * (t + 3)) / L;
        if (nearestCountryRoad(x, z).dist < 9) continue;
        const h = terrainHeight(x, z);
        fencePanel.add(x, h, z, yaw, 6, 1, 1);
        fencePole.add(x0 + ((x1 - x0) * t) / L, h, z0 + ((z1 - z0) * t) / L);
      }
    };
    edge(minX, maxZ + 10, maxX, maxZ + 10);
    edge(minX - 10, minZ + 60, minX - 10, maxZ + 10);
    edge(maxX + 10, minZ + 120, maxX + 10, maxZ + 10);
    // taxiway centre line on the apron and stand markings
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 });
    const ymark = I(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), yellowMat, false);
    for (let x = -1330; x < -790; x += 6) ymark.add(x, ay + 0.06, 812, 0, 3.5, 1, 0.3);
    for (const sx of [-1200, -1060, -920]) {
      for (let z = 770; z < 812; z += 4) ymark.add(sx + 12, ay + 0.06, z, 0, 0.3, 1, 2.2);
      ymark.add(sx + 12, ay + 0.06, 772, 0, 6, 1, 0.3);
    }
    // jet bridges from the terminal to the parked airliners
    const bridge = I(parts([[box(3, 3, 1, 0, 5, 0), 0xc9ced3], [box(0.4, 4.2, 0.4, 0, 2.1, 0.3), 0x6b7177]]), vcMetal);
    for (const px of [-1200, -1060, -920]) {
      const bx = px + 12;
      bridge.add(bx, ay, 750, 0, 1, 1, 34);
      col.addBox(bx, 750, 3.2, 34, ay + 3.4, ay + 6.6, 'metal');
    }
    // baggage carts, tugs and a fuel truck
    const cart = I(parts([[box(1.4, 0.9, 2.2, 0, 0.75), 0x5d6d7e], [box(1.4, 0.1, 2.2, 0, 1.6), 0x34495e]]));
    for (let k = 0; k < 14; k++) cart.add(-1230 + k * 6.5 + r() * 2, ay, 810 + (r() - 0.5) * 6, Math.PI / 2 + (r() - 0.5) * 0.3);
    const fuel = I(parts([[box(2.4, 2, 2.4, 0, 1.4, 3.2), 0xf4f6f7], [cyl(1.2, 1.2, 6, 14, 0, 1.6, -1).rotateX(Math.PI / 2), 0xd62828], [box(2.2, 0.5, 9, 0, 0.5, 0.6), 0x222222]]));
    fuel.add(-1130, ay, 800, Math.PI / 2);
    col.addBox(-1130, 800, 9, 2.6, ay, ay + 3, 'metal');
    // windsock & rotating radar
    const sockPole = new THREE.Mesh(cyl(0.08, 0.1, 7, 6, 0, 3.5), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    sockPole.position.set(-600, ay, 900);
    group.add(sockPole);
    const sock = new THREE.Group();
    sock.position.set(-600, ay + 6.8, 900);
    const sockMesh = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3, 10, 1, true).rotateZ(Math.PI / 2).translate(1.5, 0, 0), new THREE.MeshStandardMaterial({ color: 0xff6b1a, side: THREE.DoubleSide }));
    sock.add(sockMesh);
    group.add(sock);
    animated.push({ obj: sock, axis: 'y', speed: 0.15 });
    const radarBase = new THREE.Mesh(box(3, 12, 3, 0, 6, 0), new THREE.MeshStandardMaterial({ color: 0xe9e4da }));
    radarBase.position.set(-640, terrainHeight(-640, 640), 640);
    group.add(radarBase);
    col.addBox(-640, 640, 3, 3, radarBase.position.y - 1, radarBase.position.y + 12, 'building');
    const dish = new THREE.Group();
    dish.position.set(-640, radarBase.position.y + 12.6, 640);
    const dishMesh = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4f6f7, metalness: 0.4 }));
    dish.add(dishMesh);
    group.add(dish);
    animated.push({ obj: dish, axis: 'y', speed: 1.2 });
    // car park lines and lamps
    const white = I(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }), false);
    for (let x = -1183; x < -1018; x += 6) white.add(x, terrainHeight(x, 684) + 0.06, 684, 0, 0.15, 1, 5);
    for (let x = -1170; x < -1020; x += 40) addLamp(x, terrainHeight(x, 678), 678, Math.PI);
    // apron floodlights
    for (const x of [-1320, -1140, -980, -820]) {
      tallLight.add(x, ay, 828, Math.PI);
      tallLightHead.add(x, ay, 828, Math.PI);
      lampPositions.push(new THREE.Vector3(x, 18, 820));
      col.addBox(x, 828, 0.6, 0.6, ay, ay + 18, 'metal');
    }
  }

  // ======================================================== HIGHWAYS & COUNTRYSIDE
  {
    const ring = COUNTRY_ROADS.find((rd) => rd.id === 'ring')!;
    // telegraph poles along the western half, power pylons across the north
    const wire: number[] = [];
    let prev: THREE.Vector3 | null = null;
    let along = 0;
    const pylon = I(
      parts([
        [box(0.4, 34, 0.4, -1.8, 17, -1.8).rotateZ(0.05).rotateX(0.05), 0x9aa0a6],
        [box(0.4, 34, 0.4, 1.8, 17, -1.8).rotateZ(-0.05).rotateX(0.05), 0x9aa0a6],
        [box(0.4, 34, 0.4, -1.8, 17, 1.8).rotateZ(0.05).rotateX(-0.05), 0x9aa0a6],
        [box(0.4, 34, 0.4, 1.8, 17, 1.8).rotateZ(-0.05).rotateX(-0.05), 0x9aa0a6],
        [box(14, 0.4, 0.6, 0, 30, 0), 0x9aa0a6],
        [box(10, 0.4, 0.6, 0, 25, 0), 0x9aa0a6],
        [box(0.3, 8, 0.3, 0, 30, 0).rotateZ(0.6), 0x9aa0a6],
        [box(0.3, 8, 0.3, 0, 30, 0).rotateZ(-0.6), 0x9aa0a6],
      ]),
      vcMetal,
    );
    const pylonWire: number[] = [];
    let prevPylon: THREE.Vector3 | null = null;
    for (let i = 1; i < ring.pts.length; i++) {
      const [ax, , az] = ring.pts[i - 1];
      const [bx, , bz] = ring.pts[i];
      const L = Math.hypot(bx - ax, bz - az);
      along += L;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      const nx = -uz;
      const nz = ux;
      // western desert stretch: wooden telegraph poles every ~45 m
      if (ax < -600 && az > -1100 && along % 45 < L) {
        const x = bx + nx * 13;
        const z = bz + nz * 13;
        if (nearestCountryRoad(x, z).dist > 9) {
          const h = terrainHeight(x, z);
          telePole.add(x, h, z, Math.atan2(ux, uz) + Math.PI / 2);
          col.addBox(x, z, 0.4, 0.4, h - 1, h + 9, 'wood');
          const top = new THREE.Vector3(x, h + 8.4, z);
          if (prev && prev.distanceTo(top) < 80) for (const off of [-0.9, 0.9]) catenary(wire, prev, top, off, ux, uz, 1.4);
          prev = top;
        }
      }
      // northern stretch: steel pylons every ~150 m, 45 m off the road
      if (az < -1150 && along % 150 < L) {
        const x = bx + nx * 45;
        const z = bz + nz * 45;
        const h = terrainHeight(x, z);
        if (h > SEA_LEVEL + 1) {
          pylon.add(x, h, z, Math.atan2(ux, uz) + Math.PI / 2);
          col.addBox(x, z, 4.4, 4.4, h - 1, h + 34, 'metal');
          const top = new THREE.Vector3(x, h + 29.6, z);
          if (prevPylon && prevPylon.distanceTo(top) < 260) for (const off of [-6.5, 0, 6.5]) catenary(pylonWire, prevPylon, top, off, ux, uz, 6);
          prevPylon = top;
        }
      }
    }
    const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    for (const arr of [wire, pylonWire]) {
      if (!arr.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      group.add(new THREE.LineSegments(g, wireMat));
    }
    // guardrails where the highway runs on an embankment or through a cutting
    for (const road of COUNTRY_ROADS) {
      if (road.width < 12) continue;
      for (let i = 1; i < road.pts.length; i++) {
        const [ax, ay, az] = road.pts[i - 1];
        const [bx, , bz] = road.pts[i];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        const ux = (bx - ax) / L;
        const uz = (bz - az) / L;
        for (const side of [-1, 1]) {
          const ox = -uz * side;
          const oz = ux * side;
          const probe = terrainHeight(ax + ox * (road.width / 2 + 18), az + oz * (road.width / 2 + 18));
          if (Math.abs(probe - ay) < 3.5) continue;
          for (let t = 0; t < L; t += 4) {
            const x = ax + ux * (t + 2) + ox * (road.width / 2 + 0.6);
            const z = az + uz * (t + 2) + oz * (road.width / 2 + 0.6);
            guardRail.add(x, terrainHeight(x, z), z, Math.atan2(ux, uz) + Math.PI / 2);
          }
        }
      }
    }
    // western farmland: striped crop fields, hay bales, silos and fences
    const crops = [stripeTexture('#6a8f3a', '#557a2c'), stripeTexture('#c9b05a', '#b39a45'), stripeTexture('#7a5c3a', '#6b4f31')];
    const fields: [number, number, number, number][] = [
      [-560, -110, 80, 60],
      [-640, -140, 80, 70],
      [-650, 120, 90, 60],
      [-520, 250, 80, 60],
      [-720, 300, 70, 70],
      [-480, -260, 70, 50],
    ];
    fields.forEach(([cx, cz, w, d], i) => {
      if (nearestCountryRoad(cx, cz).dist < w / 2 + 6) return;
      const g = new THREE.PlaneGeometry(w, d, Math.ceil(w / 6), Math.ceil(d / 6));
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const x = cx + p.getX(k);
        const z = cz + p.getZ(k);
        p.setXYZ(k, x, terrainHeight(x, z) + 0.12, z);
        uv.setXY(k, (uv.getX(k) * w) / 8, (uv.getY(k) * d) / 8);
      }
      g.computeVertexNormals();
      const t = crops[i % crops.length];
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.receiveShadow = true;
      group.add(m);
      // fence around the field
      for (let s = 0; s < w; s += 4) {
        for (const zz of [cz - d / 2, cz + d / 2]) {
          const x = cx - w / 2 + s;
          woodPost.add(x, terrainHeight(x, zz), zz);
          woodRail.add(x + 2, terrainHeight(x + 2, zz) + 1, zz, 0, 4, 1, 1);
        }
      }
      for (let s = 0; s < d; s += 4) {
        for (const xx of [cx - w / 2, cx + w / 2]) {
          const z = cz - d / 2 + s;
          woodPost.add(xx, terrainHeight(xx, z), z);
          woodRail.add(xx, terrainHeight(xx, z + 2) + 1, z + 2, Math.PI / 2, 4, 1, 1);
        }
      }
      for (let k = 0; k < 6; k++) {
        const x = cx + (r() - 0.5) * (w - 10);
        const z = cz + (r() - 0.5) * (d - 10);
        hayBale.add(x, terrainHeight(x, z), z, r() * 3);
      }
    });
    const silo = I(parts([[cyl(3, 3, 14, 16, 0, 7), 0xb8bec4], [new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 14, 0), 0x9aa0a6]]), vcMetal);
    for (const [x, z] of [
      [-600, -75],
      [-485, 172],
    ]) {
      const h = terrainHeight(x, z);
      silo.add(x, h, z);
      col.addBox(x, z, 6, 6, h - 1, h + 17, 'metal');
    }
  }

  for (const i of insts) i.build(group);
  return { emitters };
}

/** Is this point on an industrial lot (not road, not sidewalk)? */
function inLot(x: number, z: number) {
  if (x < GRID_MIN || x > GRID_MAX || z < GRID_MIN || z > GRID_MAX) return false;
  const mx = (((x - GRID_MIN) % PITCH) + PITCH) % PITCH;
  const mz = (((z - GRID_MIN) % PITCH) + PITCH) % PITCH;
  const m = HALF_ROAD + 4.5;
  return mx > m && mx < PITCH - m && mz > m && mz < PITCH - m;
}

/** Sagging wire between two points (line-segment pairs appended to `out`). */
function catenary(out: number[], a: THREE.Vector3, b: THREE.Vector3, off: number, ux: number, uz: number, sag: number) {
  const nx = -uz * off;
  const nz = ux * off;
  const N = 8;
  let px = a.x + nx;
  let py = a.y;
  let pz = a.z + nz;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const x = a.x + (b.x - a.x) * t + nx;
    const z = a.z + (b.z - a.z) * t + nz;
    const y = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag;
    out.push(px, py, pz, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
}

