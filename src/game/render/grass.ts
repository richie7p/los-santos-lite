/** Wind-swept grass tufts scattered on grassy ground around the camera. */
import * as THREE from 'three';
import type { StaticWorld } from '../core/collision';
import { BLOCKS, GRID_MIN, GRID_N, PITCH, SEA_LEVEL, biomeAt, nearestCountryRoad, terrainHeight } from '../world/layout';

const CELL = 1.7;
const RADIUS = 48;
const MAX = 7000;

function bladeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 128, 128);
  for (let k = 0; k < 26; k++) {
    const bx = 8 + Math.random() * 112;
    const h = 60 + Math.random() * 66;
    const lean = (Math.random() - 0.5) * 30;
    const g = x.createLinearGradient(0, 128, 0, 128 - h);
    g.addColorStop(0, 'rgba(70,95,40,1)');
    g.addColorStop(1, 'rgba(190,215,130,1)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(bx - 3, 128);
    x.quadraticCurveTo(bx + lean * 0.4, 128 - h * 0.6, bx + lean, 128 - h);
    x.quadraticCurveTo(bx + lean * 0.4 + 2, 128 - h * 0.6, bx + 3, 128);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Three crossed quads, base at y = 0. */
function tuftGeometry() {
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(1.1, 0.75).translate(0, 0.375, 0);
    g.rotateY((k / 3) * Math.PI);
    geos.push(g);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    pos.push(...(g.attributes.position.array as Float32Array));
    uv.push(...(g.attributes.uv.array as Float32Array));
    // normals pointing up so lighting matches the ground
    for (let i = 0; i < g.attributes.position.count; i++) nor.push(0, 1, 0);
    for (const i of g.index!.array as Uint16Array) idx.push(i + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

const hash = (x: number, z: number, s: number) => {
  const v = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private uniforms = { uTime: { value: 0 } };
  private cx = Infinity;
  private cz = Infinity;
  enabled = true;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private world: StaticWorld,
  ) {
    const mat = new THREE.MeshStandardMaterial({
      map: bladeTexture(),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.9,
      vertexColors: false,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float sway = sin(uTime * 1.8 + ip.x * 0.21 + ip.z * 0.17) * 0.5 + sin(uTime * 3.1 + ip.x * 0.7) * 0.2;
          transformed.x += sway * 0.14 * position.y;
          transformed.z += sway * 0.08 * position.y;`,
        );
    };
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, MAX);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); // allocate per-instance colours up front
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  /** Where grass may grow, and how lush/dry it is (null = none). */
  private kind(x: number, z: number): number | null {
    if (Math.abs(x) <= 367 && Math.abs(z) <= 367) {
      // only lawns: parks and residential lots, never sidewalks or buildings
      const i = Math.floor((x - GRID_MIN) / PITCH);
      const j = Math.floor((z - GRID_MIN) / PITCH);
      if (i < 0 || j < 0 || i >= GRID_N - 1 || j >= GRID_N - 1) return null;
      const b = BLOCKS[i * (GRID_N - 1) + j];
      if (!(b.special === 'park' || (b.district === 'residential' && !b.special))) return null;
      if (Math.abs(x - b.cx) > 33.5 || Math.abs(z - b.cz) > 33.5) return null;
      if (this.world.supportHeight(x, z, 999) > -Infinity) return null;
      return 0;
    }
    const h = terrainHeight(x, z);
    if (h < SEA_LEVEL + 1 || h > 125) return null;
    const bio = biomeAt(x, z);
    if (bio.harbor || bio.beach > 0.2 || bio.airport > 0.2) return null;
    const rd = nearestCountryRoad(x, z);
    if (rd.dist < rd.width / 2 + 1.5) return null;
    const slope = Math.abs(terrainHeight(x + 1, z) - h) + Math.abs(terrainHeight(x, z + 1) - h);
    if (slope > 0.8) return null;
    if (this.world.supportHeight(x, z, 999) > -Infinity) return null;
    if (bio.desert > 0.4) return hash(x, z, 9) < 0.12 ? 2 : null;
    return bio.forest > 0.4 || z < -500 ? 1 : 0;
  }

  update(cam: THREE.Vector3, time: number) {
    this.uniforms.uTime.value = time;
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    if (Math.hypot(cam.x - this.cx, cam.z - this.cz) < 9) return;
    this.cx = cam.x;
    this.cz = cam.z;
    let n = 0;
    const gx0 = Math.floor((cam.x - RADIUS) / CELL);
    const gx1 = Math.floor((cam.x + RADIUS) / CELL);
    const gz0 = Math.floor((cam.z - RADIUS) / CELL);
    const gz1 = Math.floor((cam.z + RADIUS) / CELL);
    for (let gx = gx0; gx <= gx1 && n < MAX; gx++) {
      for (let gz = gz0; gz <= gz1 && n < MAX; gz++) {
        const x = (gx + hash(gx, gz, 1)) * CELL;
        const z = (gz + hash(gx, gz, 2)) * CELL;
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d > RADIUS) continue;
        // thin out towards the edge of the ring
        if (hash(gx, gz, 3) < (d / RADIUS) * 0.55) continue;
        const k = this.kind(x, z);
        if (k === null) continue;
        const y = Math.abs(x) <= 367 && Math.abs(z) <= 367 ? 0.19 : terrainHeight(x, z);
        const sc = 0.7 + hash(gx, gz, 4) * 0.7;
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(gx, gz, 5) * 6.28);
        this.m.compose(this.p.set(x, y - 0.03, z), this.q, this.s.set(sc, sc * (k === 2 ? 0.7 : 1), sc));
        this.mesh.setMatrixAt(n, this.m);
        const v = hash(gx, gz, 6) * 0.25;
        if (k === 0) this.c.setRGB(0.62 + v, 0.78 + v * 0.5, 0.45);
        else if (k === 1) this.c.setRGB(0.42 + v, 0.6 + v * 0.4, 0.38);
        else this.c.setRGB(1.0, 0.85 + v * 0.3, 0.55);
        this.mesh.setColorAt(n, this.c);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
