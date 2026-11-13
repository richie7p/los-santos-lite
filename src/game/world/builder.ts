/** Builds all static world geometry for Port Solara. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StaticWorld } from '../core/collision';
import { rng, smoothstep } from '../core/math';
import {
  BLOCKS,
  BUILDINGS,
  COUNTRY_ROADS,
  CURB_H,
  GRID_MAX,
  GRID_MIN,
  HALF_ROAD,
  LINES,
  PARKS,
  PITCH,
  PLAZAS,
  RAMPS,
  ROAD_W,
  SEA_LEVEL,
  SIDEWALK_W,
  WORLD_HALF,
  buildingBase,
  nearestCountryRoad,
  terrainHeight,
  type BuildingDef,
} from './layout';
import {
  type FacadeStyle,
  asphaltTexture,
  grassTexture,
  makeFacade,
  roofTexture,
  sidewalkTexture,
  signTexture,
  terrainDetailTexture,
  waterNormalTexture,
} from './textures';

export interface AnimatedProp {
  obj: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  speed: number;
}

export interface WorldBuild {
  root: THREE.Group;
  water: THREE.Mesh;
  nightMaterials: { mat: THREE.MeshStandardMaterial; max: number }[];
  animated: AnimatedProp[];
  lampPositions: THREE.Vector3[];
  update(dt: number, time: number): void;
  setNight(n: number): void;
}

// ------------------------------------------------------------ geometry helpers
/** Box with UVs measured in texture tiles and per-vertex tint colour. */
function tiledBox(
  w: number,
  h: number,
  d: number,
  tileW: number,
  tileH: number,
  tint: THREE.Color,
  uOffset = 0,
  withTop = false,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z ; 4 verts each
  for (let f = 0; f < 6; f++) {
    const faceW = f < 2 ? d : w;
    const faceH = f === 2 || f === 3 ? d : h;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (f === 2 || f === 3) uv.setXY(i, (u * w) / tileW, (v * d) / tileW);
      else uv.setXY(i, (u * faceW) / tileW + uOffset, (v * faceH) / tileH);
    }
  }
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // subtle AO darkening toward the ground
    const y = pos.getY(i) + h / 2;
    const ao = 0.82 + 0.18 * Math.min(1, y / 6);
    colors[i * 3] = tint.r * ao;
    colors[i * 3 + 1] = tint.g * ao;
    colors[i * 3 + 2] = tint.b * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (!withTop) {
    // drop top & bottom faces (index range 12..23 in position order -> groups)
    const idx = g.index!;
    const keep: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const face = Math.floor(a / 4);
      if (face === 2 || face === 3) continue;
      keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
    g.setIndex(keep);
  }
  g.clearGroups();
  return g;
}

function colorBox(w: number, h: number, d: number, color: THREE.Color, uvScale = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (uvScale) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) {
      const fw = f < 2 ? d : w;
      const fh = f === 2 || f === 3 ? d : h;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, (uv.getX(i) * fw) / uvScale, (uv.getY(i) * fh) / uvScale);
      }
    }
  }
  g.clearGroups();
  return g;
}

function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) {
  const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

function merge(geoms: THREE.BufferGeometry[]) {
  if (!geoms.length) return new THREE.BufferGeometry();
  const m = mergeGeometries(geoms, false)!;
  geoms.forEach((g) => g.dispose());
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, cast = true, receive = true) {
  const me = new THREE.Mesh(g, m);
  me.castShadow = cast;
  me.receiveShadow = receive;
  me.matrixAutoUpdate = false;
  me.updateMatrix();
  return me;
}

// ------------------------------------------------------------ main build
export function buildWorld(scene: THREE.Scene, col: StaticWorld, maxAniso: number): WorldBuild {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const nightMaterials: WorldBuild['nightMaterials'] = [];
  const animated: AnimatedProp[] = [];
  const lampPositions: THREE.Vector3[] = [];
  let poolMesh: THREE.InstancedMesh | null = null;
  const r = rng(4242);

  const tex = {
    asphalt: asphaltTexture(),
    sidewalk: sidewalkTexture(),
    grass: grassTexture(),
    detail: terrainDetailTexture(),
    roof: roofTexture(),
  };
  Object.values(tex).forEach((t) => (t.anisotropy = maxAniso));

  // ---------------------------------------------------------- terrain
  {
    const SIZE = WORLD_HALF * 2;
    const SEG = 220;
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xe3cf9e);
    const cWetSand = new THREE.Color(0xb59f72);
    const cGrass = new THREE.Color(0x5f8a3e);
    const cDryGrass = new THREE.Color(0xa7a35a);
    const cRock = new THREE.Color(0x8a8378);
    const cConcrete = new THREE.Color(0x85847f);
    const cSea = new THREE.Color(0x4e6f6c);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // slope estimate
      const hx = terrainHeight(x + 2, z) - h;
      const hz = terrainHeight(x, z + 2) - h;
      const slope = Math.hypot(hx, hz) / 2;
      const n = (Math.sin(x * 0.05) * Math.cos(z * 0.07) + 1) * 0.5;
      if (x > 372 && Math.abs(z) < 330 && h > 0) tmp.copy(cConcrete);
      else if (h < SEA_LEVEL - 0.2) tmp.copy(cSea);
      else if (h < 0.6 && (z > 372 || Math.abs(x) > 500 || Math.abs(z) > 500)) tmp.copy(cSand).lerp(cWetSand, smoothstep(0.05, SEA_LEVEL, h));
      else {
        tmp.copy(cGrass).lerp(cDryGrass, x < -380 ? 0.55 + n * 0.3 : n * 0.35);
        tmp.lerp(cRock, smoothstep(0.35, 0.8, slope));
      }
      const rd = nearestCountryRoad(x, z);
      if (rd.dist < rd.width / 2 + 3 && (Math.abs(x) > 372 || Math.abs(z) > 372)) tmp.lerp(new THREE.Color(0x8b7e66), 0.5);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // detail UV
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (SIZE / 18), uv.getY(i) * (SIZE / 18));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.detail, roughness: 0.95 });
    const t = mesh(g, m, false, true);
    t.name = 'terrain';
    root.add(t);
  }

  // ---------------------------------------------------------- water
  const waterNormal = waterNormalTexture();
  waterNormal.repeat.set(60, 60);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1d5a73,
    roughness: 0.08,
    metalness: 0.1,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    transparent: true,
    opacity: 0.88,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA_LEVEL;
  water.receiveShadow = true;
  water.name = 'water';
  root.add(water);

  // ---------------------------------------------------------- city roads
  {
    const span = GRID_MAX - GRID_MIN + ROAD_W;
    const geoms: THREE.BufferGeometry[] = [];
    const mkStrip = (cx: number, cz: number, w: number, d: number) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 12 + cx / 12, (uv.getY(i) * d) / 12 - cz / 12);
      g.translate(cx, 0.02, cz);
      return g;
    };
    // horizontal full strips, vertical strips only between intersections (avoids overlap flicker)
    for (const z of LINES) geoms.push(mkStrip(0, z, span, ROAD_W));
    for (const x of LINES)
      for (let k = 0; k < LINES.length - 1; k++) {
        const z0 = LINES[k] + HALF_ROAD;
        const z1 = LINES[k + 1] - HALF_ROAD;
        geoms.push(mkStrip(x, (z0 + z1) / 2, ROAD_W, z1 - z0));
      }
    const m = new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.92, color: 0xc8c8c8 });
    root.add(mesh(merge(geoms), m, false, true));

    // lane markings: dashed centre lines + edge lines + crosswalks
    const white: THREE.Matrix4[] = [];
    const yellow: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const addMark = (arr: THREE.Matrix4[], x: number, z: number, w: number, l: number, ry: number) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      arr.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.035, z), q, new THREE.Vector3(w, 1, l)));
    };
    for (const a of LINES)
      for (let k = 0; k < LINES.length - 1; k++) {
        const b0 = LINES[k] + HALF_ROAD + 4;
        const b1 = LINES[k + 1] - HALF_ROAD - 4;
        // double yellow centre
        for (const off of [-0.18, 0.18]) {
          addMark(yellow, a + off, (b0 + b1) / 2, 0.14, b1 - b0, 0);
          addMark(yellow, (b0 + b1) / 2, a + off, 0.14, b1 - b0, Math.PI / 2);
        }
        // dashed lane dividers
        for (let s = b0 + 2; s < b1 - 2; s += 7) {
          for (const off of [-3.5, 3.5]) {
            addMark(white, a + off, s, 0.13, 3, 0);
            addMark(white, s, a + off, 0.13, 3, Math.PI / 2);
          }
        }
        // stop lines
        for (const sgn of [-1, 1]) {
          addMark(white, a + sgn * 3.5, b0 - 1.2, ROAD_W / 2 - 0.4, 0.45, 0);
          addMark(white, a - sgn * 3.5, b1 + 1.2, ROAD_W / 2 - 0.4, 0.45, 0);
        }
      }
    // zebra crosswalks
    for (const x of LINES)
      for (const z of LINES) {
        for (const [dx, dz, rot] of [
          [0, -HALF_ROAD - 2, 0],
          [0, HALF_ROAD + 2, 0],
          [-HALF_ROAD - 2, 0, Math.PI / 2],
          [HALF_ROAD + 2, 0, Math.PI / 2],
        ] as const) {
          for (let s = -5.5; s <= 5.5; s += 1.6) {
            if (rot === 0) addMark(white, x + s, z + dz, 0.8, 3, 0);
            else addMark(white, x + dx, z + s, 0.8, 3, Math.PI / 2);
          }
        }
      }
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    const mkInst = (arr: THREE.Matrix4[], color: number) => {
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const im = new THREE.InstancedMesh(pg, mat, arr.length);
      arr.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.receiveShadow = true;
      root.add(im);
    };
    mkInst(white, 0xe9e9e4);
    mkInst(yellow, 0xe2b53a);
  }

  // ---------------------------------------------------------- country roads
  {
    const geoms: THREE.BufferGeometry[] = [];
    for (const road of COUNTRY_ROADS) {
      const pts: THREE.Vector3[] = [];
      // densify
      for (let k = 0; k < road.pts.length - 1; k++) {
        const [ax, , az] = road.pts[k];
        const [bx, , bz] = road.pts[k + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const n = Math.max(2, Math.ceil(L / 4));
        for (let s = 0; s < n; s++) {
          const t = s / n;
          const x = ax + (bx - ax) * t;
          const z = az + (bz - az) * t;
          pts.push(new THREE.Vector3(x, 0, z));
        }
      }
      const last = road.pts[road.pts.length - 1];
      pts.push(new THREE.Vector3(last[0], 0, last[2]));
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      let along = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L;
        const nz = dx / L;
        if (i > 0) along += p.distanceTo(pts[i - 1]);
        for (const s of [-1, 1]) {
          const x = p.x + nx * s * (road.width / 2);
          const z = p.z + nz * s * (road.width / 2);
          pos.push(x, terrainHeight(x, z) + 0.06, z);
          uv.push(s < 0 ? 0 : road.width / 12, along / 12);
        }
        if (i > 0) {
          const o = (i - 1) * 2;
          idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      geoms.push(g);
    }
    const m = new THREE.MeshStandardMaterial({
      map: tex.asphalt,
      roughness: 0.9,
      color: 0xb8b8b8,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      side: THREE.DoubleSide,
    });
    root.add(mesh(merge(geoms), m, false, true));
  }

  // ---------------------------------------------------------- blocks: sidewalks & lots
  {
    const swGeoms: THREE.BufferGeometry[] = [];
    const grassGeoms: THREE.BufferGeometry[] = [];
    const plazaGeoms: THREE.BufferGeometry[] = [];
    const curbColor = new THREE.Color(0xffffff);
    const bw = PITCH - ROAD_W;
    for (const b of BLOCKS) {
      swGeoms.push(placed(colorBox(bw, CURB_H, bw, curbColor, 4), b.cx, CURB_H / 2, b.cz));
      const lot = bw - SIDEWALK_W * 2;
      const pg = new THREE.PlaneGeometry(lot, lot);
      pg.rotateX(-Math.PI / 2);
      const uv = pg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * lot) / 10, (uv.getY(i) * lot) / 10);
      pg.translate(b.cx, CURB_H + 0.012, b.cz);
      const green = b.special === 'park' || (b.district === 'residential' && !b.special);
      if (green) grassGeoms.push(pg);
      else plazaGeoms.push(pg);
    }
    root.add(mesh(merge(swGeoms), new THREE.MeshStandardMaterial({ map: tex.sidewalk, vertexColors: true, roughness: 0.85 }), false, true));
    const lotMatProps = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
    root.add(mesh(merge(grassGeoms), new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 0.95, ...lotMatProps }), false, true));
    root.add(
      mesh(
        merge(plazaGeoms),
        new THREE.MeshStandardMaterial({ map: tex.sidewalk, color: 0xd6d0c4, roughness: 0.8, ...lotMatProps }),
        false,
        true,
      ),
    );
  }

  // ---------------------------------------------------------- buildings
  const styles: FacadeStyle[] = ['glass', 'office', 'apartment', 'brick', 'house', 'warehouse', 'shop', 'civic'];
  const wallGeoms: Record<string, THREE.BufferGeometry[]> = {};
  const roofGeoms: THREE.BufferGeometry[] = [];
  const pitchedRoofGeoms: THREE.BufferGeometry[] = [];
  const acUnits: THREE.Matrix4[] = [];
  const tanks: THREE.Matrix4[] = [];
  const facades = Object.fromEntries(styles.map((s, i) => [s, makeFacade(s, 100 + i * 17)])) as Record<
    FacadeStyle,
    ReturnType<typeof makeFacade>
  >;
  const tint = new THREE.Color();
  const roofColor = new THREE.Color(0xffffff);

  const addBuildingMass = (b: BuildingDef, x: number, z: number, w: number, d: number, y0: number, h: number) => {
    const f = facades[b.style];
    tint.setHex(b.tint);
    const g = tiledBox(w, h, d, f.tileW, f.tileH, tint, Math.floor(r() * 4) * 0.25);
    (wallGeoms[b.style] ??= []).push(placed(g, x, y0 + h / 2, z));
    // roof slab + parapet
    if (b.style !== 'house') {
      roofGeoms.push(placed(colorBox(w + 0.6, 0.6, d + 0.6, roofColor.clone().multiplyScalar(0.85), 6), x, y0 + h + 0.3, z));
      roofGeoms.push(placed(colorBox(w - 0.8, 0.1, d - 0.8, roofColor, 6), x, y0 + h + 0.62, z));
    }
    col.addBox(x, z, w, d, y0 - 2, y0 + h + 0.6, 'building');
  };

  for (const b of BUILDINGS) {
    const base = buildingBase(b);
    if (b.style === 'glass' && b.h > 70) {
      const h0 = b.h * 0.72;
      addBuildingMass(b, b.cx, b.cz, b.w, b.d, base, h0);
      addBuildingMass(b, b.cx, b.cz, b.w * 0.74, b.d * 0.74, base + h0 + 0.6, b.h - h0);
      // antenna
      roofGeoms.push(placed(colorBox(0.5, 12, 0.5, new THREE.Color(0x777777)), b.cx, base + b.h + 7, b.cz));
    } else {
      addBuildingMass(b, b.cx, b.cz, b.w, b.d, base, b.h);
    }
    if (b.style === 'house') {
      // gabled roof
      const rh = 2.6;
      const shape = new THREE.Shape();
      shape.moveTo(-b.w / 2 - 0.5, 0);
      shape.lineTo(0, rh);
      shape.lineTo(b.w / 2 + 0.5, 0);
      shape.lineTo(-b.w / 2 - 0.5, 0);
      const rg = new THREE.ExtrudeGeometry(shape, { depth: b.d + 1, bevelEnabled: false });
      rg.translate(0, 0, -(b.d + 1) / 2);
      const n = rg.attributes.position.count;
      const c = new Float32Array(n * 3);
      const rc = new THREE.Color(pickRoof(r));
      for (let i = 0; i < n; i++) {
        c[i * 3] = rc.r;
        c[i * 3 + 1] = rc.g;
        c[i * 3 + 2] = rc.b;
      }
      rg.setAttribute('color', new THREE.BufferAttribute(c, 3));
      pitchedRoofGeoms.push(placed(rg, b.cx, base + b.h, b.cz));
    }
    if (b.roofProps) {
      const top = base + b.h + 0.6;
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const px = b.cx + (r() - 0.5) * b.w * 0.5;
        const pz = b.cz + (r() - 0.5) * b.d * 0.5;
        acUnits.push(new THREE.Matrix4().compose(new THREE.Vector3(px, top + 0.7, pz), new THREE.Quaternion(), new THREE.Vector3(2.4, 1.4, 1.8)));
      }
      if (r() < 0.35 && b.h < 60)
        tanks.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(b.cx + b.w * 0.25, top + 1.8, b.cz - b.d * 0.2),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1),
          ),
        );
    }
    if (b.name) {
      const st = signTexture(b.name, '#1c2733', '#f5f0e6', 1024, 160);
      const sm = new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.2 });
      nightMaterials.push({ mat: sm, max: 1.1 });
      const sw = Math.min(b.w * 0.8, 22);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.156), sm);
      sign.position.set(b.cx, base + Math.min(b.h - 2, 9), b.cz + b.d / 2 + 0.08);
      root.add(sign);
    }
  }
  for (const s of styles) {
    const f = facades[s];
    if (!wallGeoms[s]) continue;
    const isGlass = s === 'glass';
    const m = new THREE.MeshStandardMaterial({
      map: f.map,
      vertexColors: true,
      roughnessMap: f.orm,
      metalnessMap: f.orm,
      roughness: 1,
      metalness: isGlass ? 0.8 : 0.85,
      emissive: 0xffffff,
      emissiveMap: f.emissive,
      emissiveIntensity: 0,
    });
    f.map.anisotropy = maxAniso;
    nightMaterials.push({ mat: m, max: 1.15 });
    root.add(mesh(merge(wallGeoms[s]), m, true, true));
  }
  root.add(mesh(merge(roofGeoms), new THREE.MeshStandardMaterial({ map: tex.roof, vertexColors: true, roughness: 0.9 }), true, true));
  root.add(mesh(merge(pitchedRoofGeoms), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), true, true));
  {
    const acg = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(acg, new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.6, metalness: 0.4 }), acUnits.length);
    acUnits.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    root.add(im);
    const tg = mergeGeometries([
      new THREE.CylinderGeometry(1.3, 1.3, 2.6, 12).translate(0, 0.6, 0),
      new THREE.ConeGeometry(1.4, 0.8, 12).translate(0, 2.3, 0),
      new THREE.CylinderGeometry(0.1, 0.1, 1.6, 4).translate(0.9, -1.2, 0.9),
      new THREE.CylinderGeometry(0.1, 0.1, 1.6, 4).translate(-0.9, -1.2, -0.9),
      new THREE.CylinderGeometry(0.1, 0.1, 1.6, 4).translate(-0.9, -1.2, 0.9),
      new THREE.CylinderGeometry(0.1, 0.1, 1.6, 4).translate(0.9, -1.2, -0.9),
    ])!;
    const ti = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0x8a6a4c, roughness: 0.9 }), tanks.length);
    tanks.forEach((m, i) => ti.setMatrixAt(i, m));
    ti.castShadow = true;
    root.add(ti);
  }

  // ---------------------------------------------------------- street furniture (instanced)
  const lampMats: THREE.Matrix4[] = [];
  const treeMats: THREE.Matrix4[] = [];
  const palmMats: THREE.Matrix4[] = [];
  const signalMats: THREE.Matrix4[] = [];
  const benchMats: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const quat = (ry: number) => new THREE.Quaternion().setFromAxisAngle(up, ry);
  const one = new THREE.Vector3(1, 1, 1);
  const curbOff = PITCH / 2 - HALF_ROAD - 0.9; // from block centre to lamp line
  for (const b of BLOCKS) {
    for (let side = 0; side < 4; side++) {
      for (let k = -1; k <= 1; k++) {
        const t = k * 24;
        let x = b.cx;
        let z = b.cz;
        let ry = 0;
        if (side === 0) {
          x += t;
          z -= curbOff;
          ry = Math.PI;
        } else if (side === 1) {
          x += curbOff;
          z += t;
          ry = Math.PI / 2;
        } else if (side === 2) {
          x -= t;
          z += curbOff;
          ry = 0;
        } else {
          x -= curbOff;
          z -= t;
          ry = -Math.PI / 2;
        }
        if (k === 0) {
          lampMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H, z), quat(ry), one));
          lampPositions.push(new THREE.Vector3(x + Math.sin(ry) * 2.2, CURB_H + 7.6, z + Math.cos(ry) * 2.2));
          col.addBox(x, z, 0.35, 0.35, 0, 8, 'metal');
        } else if (b.district === 'residential' || b.special === 'park' || b.special === 'plaza') {
          const s = 0.85 + r() * 0.4;
          treeMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H, z), quat(r() * 6.28), new THREE.Vector3(s, s, s)));
          col.addBox(x, z, 0.5, 0.5, 0, 6, 'wood');
        } else if (b.district === 'commercial') {
          const s = 0.9 + r() * 0.3;
          palmMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H, z), quat(r() * 6.28), new THREE.Vector3(s, s, s)));
          col.addBox(x, z, 0.5, 0.5, 0, 8, 'wood');
        } else if (r() < 0.4) {
          benchMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x - Math.sin(ry) * 1.5, CURB_H, z - Math.cos(ry) * 1.5), quat(ry), one));
        }
      }
    }
  }
  // park & plaza trees
  for (const p of PARKS) {
    for (let k = 0; k < 26; k++) {
      const x = p.cx + (r() - 0.5) * (p.w - 8);
      const z = p.cz + (r() - 0.5) * (p.d - 8);
      if (Math.abs(x - p.cx) < 8 && Math.abs(z - p.cz) < 8) continue;
      const s = 0.9 + r() * 0.7;
      treeMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, CURB_H, z), quat(r() * 6.28), new THREE.Vector3(s, s, s)));
      col.addBox(x, z, 0.6, 0.6, 0, 6, 'wood');
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      benchMats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.cx + Math.sin(a) * 12, CURB_H, p.cz + Math.cos(a) * 12), quat(a + Math.PI), one));
    }
  }
  for (const p of PLAZAS) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      palmMats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.cx + Math.sin(a) * 22, CURB_H, p.cz + 8 + Math.cos(a) * 14), quat(a), one));
    }
  }
  // countryside trees
  for (let k = 0; k < 1100; k++) {
    const x = (r() - 0.5) * 1300;
    const z = (r() - 0.5) * 1300;
    if (Math.abs(x) < 385 && Math.abs(z) < 385) continue;
    if (x > 360 && Math.abs(z) < 340) continue; // harbor
    const h = terrainHeight(x, z);
    if (h < 0.8) continue;
    if (nearestCountryRoad(x, z).dist < 10) continue;
    const s = 0.9 + r() * 0.8;
    treeMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.2, z), quat(r() * 6.28), new THREE.Vector3(s, s * (0.9 + r() * 0.5), s)));
    col.addBox(x, z, 0.7, 0.7, h - 1, h + 6, 'wood');
  }
  // beach palms
  for (let k = 0; k < 40; k++) {
    const x = -340 + k * 17 + (r() - 0.5) * 6;
    const z = 418 + (r() - 0.5) * 8;
    const h = terrainHeight(x, z);
    palmMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h, z), quat(r() * 6.28), new THREE.Vector3(1, 0.9 + r() * 0.4, 1)));
    col.addBox(x, z, 0.5, 0.5, h - 1, h + 8, 'wood');
  }
  // traffic signals at downtown intersections
  for (const x of LINES)
    for (const z of LINES) {
      if (Math.abs(x) > 180 || Math.abs(z) > 180) continue;
      for (const [sx, sz] of [
        [1, 1],
        [-1, -1],
      ]) {
        const px = x + sx * (HALF_ROAD + 1.2);
        const pz = z + sz * (HALF_ROAD + 1.2);
        signalMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, CURB_H, pz), quat(sx > 0 ? -Math.PI / 2 : Math.PI / 2), one));
        col.addBox(px, pz, 0.3, 0.3, 0, 6, 'metal');
      }
    }

  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.5, metalness: 0.7 });
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 0 });
  nightMaterials.push({ mat: lampHeadMat, max: 6 });
  addInstanced(root, lampGeometry(), lampMat, lampMats, true);
  addInstanced(root, new THREE.BoxGeometry(0.7, 0.18, 1.2).translate(0, 7.62, 2.2), lampHeadMat, lampMats, false);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4e36, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f7d3a, roughness: 0.85, flatShading: true });
  addInstanced(root, new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6).translate(0, 1.6, 0), trunkMat, treeMats, true);
  addInstanced(root, treeCanopyGeometry(), leafMat, treeMats, true);
  addInstanced(root, palmTrunkGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a6d4f, roughness: 0.9 }), palmMats, true);
  addInstanced(root, palmLeavesGeometry(), new THREE.MeshStandardMaterial({ color: 0x5b8f3c, roughness: 0.8, side: THREE.DoubleSide, flatShading: true }), palmMats, true);
  addInstanced(root, signalGeometry(), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.5 }), signalMats, true);
  const signalLightMat = new THREE.MeshStandardMaterial({ color: 0x33ff88, emissive: 0x22ff66, emissiveIntensity: 1.5 });
  addInstanced(root, new THREE.SphereGeometry(0.16, 8, 6).translate(0.18, 5.6, 4.2), signalLightMat, signalMats, false);
  addInstanced(root, benchGeometry(), new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.8 }), benchMats, true);

  // fake light pools under street lamps (cheap night lighting)
  const poolTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,214,150,1)');
    gr.addColorStop(0.45, 'rgba(255,190,120,0.45)');
    gr.addColorStop(1, 'rgba(255,170,90,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    fog: true,
  });
  {
    const pg = new THREE.PlaneGeometry(16, 16);
    pg.rotateX(-Math.PI / 2);
    const mats = lampPositions.map((p) => new THREE.Matrix4().makeTranslation(p.x, CURB_H + 0.04, p.z));
    const im = new THREE.InstancedMesh(pg, poolMat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.renderOrder = 2;
    im.visible = false;
    root.add(im);
    poolMesh = im;
  }

  // ---------------------------------------------------------- districts: harbor
  {
    const contMats: THREE.Matrix4[] = [];
    const contColors: THREE.Color[] = [];
    const cc = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x7d3c98, 0x839192, 0x1f618d, 0xa04000];
    for (let row = 0; row < 6; row++)
      for (let k = 0; k < 9; k++) {
        if (r() < 0.2) continue;
        const x = 505 + row * 9;
        const z = -230 + k * 50 + (r() - 0.5) * 4;
        const stack = 1 + Math.floor(r() * 3);
        for (let s = 0; s < stack; s++) {
          contMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.15 + 1.3 + s * 2.6, z), quat(0), new THREE.Vector3(1, 1, 1)));
          contColors.push(new THREE.Color(cc[Math.floor(r() * cc.length)]));
        }
        col.addBox(x, z, 2.5, 12.2, 0, 0.15 + stack * 2.6, 'metal');
      }
    const cg = containerGeometry();
    const im = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.5 }), contMats.length);
    contMats.forEach((m, i) => {
      im.setMatrixAt(i, m);
      im.setColorAt(i, contColors[i]);
    });
    im.castShadow = im.receiveShadow = true;
    root.add(im);
    // gantry cranes
    for (const z of [-150, 20, 190]) {
      const crane = gantryCrane();
      crane.position.set(570, 0.15, z);
      root.add(crane);
      col.addBox(570 - 7, z, 1.5, 1.5, 0, 40, 'metal');
      col.addBox(570 + 7, z, 1.5, 1.5, 0, 40, 'metal');
    }
    // cargo ship
    const ship = cargoShip();
    ship.position.set(640, SEA_LEVEL, 30);
    root.add(ship);
    col.addBox(640, 30, 26, 160, -5, 12, 'metal');
  }

  // ---------------------------------------------------------- beach pier & ferris wheel
  {
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x8c6a4a, roughness: 0.9 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(22, 0.6, 140), pierMat);
    deck.position.set(60, 2.2, 520);
    deck.castShadow = deck.receiveShadow = true;
    root.add(deck);
    col.add({ minX: 49, maxX: 71, minZ: 450, maxZ: 590, minY: -10, maxY: 2.5, kind: 'wood' });
    const posts: THREE.Matrix4[] = [];
    for (let z = 455; z < 590; z += 8)
      for (const x of [51, 69]) posts.push(new THREE.Matrix4().makeTranslation(x, -2, z));
    addInstanced(root, new THREE.CylinderGeometry(0.35, 0.35, 8, 6), pierMat, posts, true);
    const fw = ferrisWheel(nightMaterials);
    fw.root.position.set(60, 2.5, 560);
    root.add(fw.root);
    animated.push({ obj: fw.wheel, axis: 'z', speed: 0.12 });
    col.addBox(60, 560, 4, 4, 2, 40, 'metal');
    // beach umbrellas
    const umb: THREE.Matrix4[] = [];
    const umbC: THREE.Color[] = [];
    for (let k = 0; k < 40; k++) {
      const x = -320 + r() * 640;
      const z = 435 + r() * 40;
      const h = terrainHeight(x, z);
      if (h < SEA_LEVEL + 0.2) continue;
      umb.push(new THREE.Matrix4().makeTranslation(x, h, z));
      umbC.push(new THREE.Color([0xe74c3c, 0xf1c40f, 0x3498db, 0x1abc9c, 0xffffff][k % 5]));
    }
    const ug = mergeGeometries([new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5).translate(0, 1.2, 0), new THREE.ConeGeometry(1.5, 0.6, 10).translate(0, 2.5, 0)])!;
    const ui = new THREE.InstancedMesh(ug, new THREE.MeshStandardMaterial({ roughness: 0.7 }), umb.length);
    umb.forEach((m, i) => {
      ui.setMatrixAt(i, m);
      ui.setColorAt(i, umbC[i]);
    });
    ui.castShadow = true;
    root.add(ui);
  }

  // ---------------------------------------------------------- hills: observatory dome & landmark letters
  {
    const base = terrainHeight(30, -665);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(8, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x9aa7b0, metalness: 0.8, roughness: 0.3 }),
    );
    dome.position.set(30, base + 10.6, -665);
    dome.castShadow = true;
    root.add(dome);
    // big hillside letters (original landmark)
    const letters = 'SOLARA';
    const lm = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
    nightMaterials.push({ mat: lm, max: 0.6 });
    for (let k = 0; k < letters.length; k++) {
      const x = -150 + k * 15;
      const z = -560 + k * 1.5;
      const h = terrainHeight(x, z);
      const lt = signTexture(letters[k], 'rgba(0,0,0,0)', '#ffffff', 128, 128);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 12),
        new THREE.MeshStandardMaterial({ map: lt, transparent: true, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: lt, emissiveIntensity: 0, side: THREE.DoubleSide }),
      );
      nightMaterials.push({ mat: plane.material as THREE.MeshStandardMaterial, max: 0.8 });
      plane.position.set(x, h + 6, z);
      plane.rotation.x = -0.15;
      root.add(plane);
    }
    void lm;
  }

  // ---------------------------------------------------------- west: wind turbines
  for (let k = 0; k < 7; k++) {
    const x = -470 - (k % 3) * 55 + (r() - 0.5) * 20;
    const z = -150 + k * 48;
    if (nearestCountryRoad(x, z).dist < 12) continue;
    const h = terrainHeight(x, z);
    const t = windTurbine();
    t.root.position.set(x, h, z);
    t.root.rotation.y = 0.4;
    root.add(t.root);
    animated.push({ obj: t.rotor, axis: 'z', speed: 0.6 + r() * 0.4 });
    col.addBox(x, z, 2, 2, h - 1, h + 40, 'metal');
  }

  // ---------------------------------------------------------- stunt ramps
  {
    const rampMat = new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.6, metalness: 0.3 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    for (const rp of RAMPS) {
      const shape = new THREE.Shape();
      shape.moveTo(-rp.len / 2, 0);
      shape.lineTo(rp.len / 2, rp.h);
      shape.lineTo(rp.len / 2, 0);
      shape.lineTo(-rp.len / 2, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: rp.wid, bevelEnabled: false });
      g.translate(0, 0, -rp.wid / 2);
      g.rotateY(-Math.PI / 2);
      const m = new THREE.Mesh(g, rampMat);
      const base = terrainHeight(rp.x, rp.z);
      m.position.set(rp.x, base, rp.z);
      m.rotation.y = rp.yaw;
      m.castShadow = m.receiveShadow = true;
      root.add(m);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(rp.wid + 0.05, 0.3, 0.3), stripeMat);
      stripe.position.set(rp.x + Math.sin(rp.yaw) * (rp.len / 2), base + rp.h - 0.1, rp.z + Math.cos(rp.yaw) * (rp.len / 2));
      stripe.rotation.y = rp.yaw;
      root.add(stripe);
    }
  }

  // ---------------------------------------------------------- billboards (original brands)
  {
    const ads: [string, string, string][] = [
      ['極光汽水 · 冰爽一夏', '#e2483b', '#fff'],
      ['夜鴞速遞 24H', '#1f2a44', '#ffd166'],
      ['星火電信 6G', '#5b2a86', '#fff'],
      ['海鹽咖啡', '#0f766e', '#fefae0'],
      ['雷鳥機車', '#f59e0b', '#111'],
      ['藍鯨保險', '#1d4ed8', '#fff'],
    ];
    for (let k = 0; k < 14; k++) {
      const b = BUILDINGS[Math.floor(r() * BUILDINGS.length)];
      if (b.style === 'house' || b.h < 14) continue;
      const ad = ads[k % ads.length];
      const t = signTexture(ad[0], ad[1], ad[2], 1024, 512);
      const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.05, roughness: 0.5 });
      nightMaterials.push({ mat: m, max: 0.9 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), m);
      const base = buildingBase(b);
      p.position.set(b.cx, base + b.h + 4.5, b.cz + b.d / 2 - 1);
      root.add(p);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(14.4, 7.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x222 }));
      frame.position.set(b.cx, base + b.h + 4.5, b.cz + b.d / 2 - 1.2);
      root.add(frame);
    }
  }

  // ---------------------------------------------------------- update hooks
  let night = 0;
  const update = (dt: number, time: number) => {
    for (const a of animated) a.obj.rotation[a.axis] += a.speed * dt;
    waterNormal.offset.set(time * 0.004, time * 0.0025);
    // signal light colour cycle (cosmetic)
    const ph = Math.floor(time / 6) % 3;
    signalLightMat.color.setHex(ph === 0 ? 0x33ff88 : ph === 1 ? 0xffcc33 : 0xff4433);
    signalLightMat.emissive.copy(signalLightMat.color);
  };
  const setNight = (n: number) => {
    if (Math.abs(n - night) < 0.002) return;
    night = n;
    for (const { mat, max } of nightMaterials) mat.emissiveIntensity = Math.max(mat === lampHeadMat ? 0 : 0.02, n * max);
    poolMat.opacity = smoothstep(0.3, 0.9, n) * 0.6;
    if (poolMesh) poolMesh.visible = n > 0.3;
  };
  return { root, water, nightMaterials, animated, lampPositions, update, setNight };
}

function pickRoof(r: () => number) {
  return [0x8e3b2f, 0x5c5f66, 0x3f4a5a, 0x7a4b36, 0x6b6f4f][Math.floor(r() * 5)];
}

function addInstanced(root: THREE.Group, g: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], shadow: boolean) {
  if (!mats.length) return;
  const im = new THREE.InstancedMesh(g, m, mats.length);
  mats.forEach((mm, i) => im.setMatrixAt(i, mm));
  im.castShadow = shadow;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  root.add(im);
  return im;
}

// ------------------------------------------------------------ prop geometries
function lampGeometry() {
  return mergeGeometries([
    new THREE.CylinderGeometry(0.12, 0.18, 7.8, 8).translate(0, 3.9, 0),
    new THREE.BoxGeometry(0.12, 0.12, 2.4).translate(0, 7.7, 1.1),
    new THREE.CylinderGeometry(0.3, 0.35, 0.5, 8).translate(0, 0.25, 0),
  ])!;
}
function treeCanopyGeometry() {
  const a = new THREE.IcosahedronGeometry(2.1, 1).translate(0, 4.6, 0);
  const b = new THREE.IcosahedronGeometry(1.6, 1).translate(0.9, 3.9, 0.5);
  const c = new THREE.IcosahedronGeometry(1.5, 1).translate(-0.8, 4.0, -0.6);
  return mergeGeometries([a, b, c].map((g) => (g.index ? g.toNonIndexed() : g)))!;
}
function palmTrunkGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    parts.push(new THREE.CylinderGeometry(0.2 - k * 0.012, 0.24 - k * 0.012, 1.4, 6).translate(k * 0.08, 0.7 + k * 1.3, 0));
  }
  return mergeGeometries(parts)!;
}
function palmLeavesGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const g = new THREE.PlaneGeometry(0.9, 3.6, 1, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + 1.8;
      p.setZ(i, -y * y * 0.09);
    }
    g.translate(0, 1.8, 0);
    g.rotateX(-1.25);
    g.rotateY((k / 7) * Math.PI * 2);
    g.translate(0.45, 8.1, 0);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}
function signalGeometry() {
  return mergeGeometries([
    new THREE.CylinderGeometry(0.12, 0.14, 6, 8).translate(0, 3, 0),
    new THREE.BoxGeometry(0.14, 0.14, 4.4).translate(0, 5.9, 2.2),
    new THREE.BoxGeometry(0.45, 1.3, 0.4).translate(0, 5.6, 4.2),
  ])!;
}
function benchGeometry() {
  return mergeGeometries([
    new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 0.45, 0),
    new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.7, -0.24),
    new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(-0.8, 0.22, 0),
    new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(0.8, 0.22, 0),
  ])!;
}
function containerGeometry() {
  const g = new THREE.BoxGeometry(2.45, 2.6, 12.2, 1, 1, 12);
  // corrugation by pushing every other x-face vertex row
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    if (Math.abs(Math.abs(x) - 1.225) < 0.01) {
      const k = Math.round((z + 6.1) / (12.2 / 12));
      if (k % 2 === 0) p.setX(i, x * 1.02);
    }
  }
  g.computeVertexNormals();
  return g;
}
function gantryCrane() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xd35400, roughness: 0.6, metalness: 0.4 });
  const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    me.position.set(x, y, z);
    me.castShadow = true;
    g.add(me);
  };
  add(1.4, 36, 1.4, -7, 18, -5);
  add(1.4, 36, 1.4, 7, 18, -5);
  add(1.4, 36, 1.4, -7, 18, 5);
  add(1.4, 36, 1.4, 7, 18, 5);
  add(60, 2.2, 3, 15, 37, 0);
  add(16, 1, 12, 0, 22, 0);
  add(4, 3, 4, 20, 34.5, 0);
  return g;
}
function cargoShip() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(24, 9, 150), new THREE.MeshStandardMaterial({ color: 0x1f3a5f, roughness: 0.7 }));
  hull.position.y = 2;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(24, 1, 150), new THREE.MeshStandardMaterial({ color: 0x8b2e2e, roughness: 0.8 }));
  deck.position.y = 7;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 12), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
  bridge.position.set(0, 13, 62);
  g.add(hull, deck, bridge);
  const cols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x839192];
  for (let k = 0; k < 9; k++)
    for (let s = 0; s < 2; s++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(20, 2.6, 12), new THREE.MeshStandardMaterial({ color: cols[(k + s) % 5], roughness: 0.6 }));
      c.position.set(0, 8.8 + s * 2.6, -60 + k * 13);
      c.castShadow = true;
      g.add(c);
    }
  return g;
}
function ferrisWheel(night: WorldBuild['nightMaterials']) {
  const root = new THREE.Group();
  const wheel = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.6, roughness: 0.35 });
  const lights = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff5fa2, emissiveIntensity: 0 });
  night.push({ mat: lights, max: 3 });
  const R = 18;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 64), steel);
  const rim2 = rim.clone();
  rim.position.z = 1.2;
  rim2.position.z = -1.2;
  wheel.add(rim, rim2);
  const lightRing = new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.15, 6, 64), lights);
  wheel.add(lightRing);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, R * 2, 4), steel);
    spoke.rotation.z = a;
    wheel.add(spoke);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1.6),
      new THREE.MeshStandardMaterial({ color: [0xe74c3c, 0xf1c40f, 0x3498db, 0x2ecc71][k % 4], roughness: 0.5 }),
    );
    cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(cab);
  }
  wheel.position.y = R + 3;
  root.add(wheel);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, R + 6, 6), steel);
    leg.position.set(s * 6, (R + 3) / 2, 2);
    leg.rotation.z = s * 0.3;
    root.add(leg);
    const leg2 = leg.clone();
    leg2.position.z = -2;
    root.add(leg2);
  }
  return { root, wheel };
}
function windTurbine() {
  const root = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xf4f6f7, roughness: 0.5 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.3, 36, 10), m);
  tower.position.y = 18;
  tower.castShadow = true;
  root.add(tower);
  const nac = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 4), m);
  nac.position.set(0, 36.5, 0);
  root.add(nac);
  const rotor = new THREE.Group();
  rotor.position.set(0, 36.5, 2.2);
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.9, 15, 0.2).translate(0, 7.5, 0), m);
    blade.rotation.z = (k / 3) * Math.PI * 2;
    blade.castShadow = true;
    rotor.add(blade);
  }
  root.add(rotor);
  return { root, rotor };
}
