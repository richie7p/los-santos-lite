/**
 * Headlight pools on the road at night: one additive, instanced quad per car with its lights on.
 * Cheap stand-in for real spot lights (a single draw call for all traffic).
 */
import * as THREE from 'three';
import type { Vehicle } from '../entities/vehicle';

const MAX = 48;

function beamTexture() {
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // v = 0 at the bumper, 1 at the far end; the beam widens and fades with distance
      const v = 1 - y / (H - 1);
      const u = (x / (W - 1)) * 2 - 1;
      const spread = 0.35 + v * 0.65;
      const side = Math.max(0, 1 - Math.pow(Math.abs(u) / spread, 2.2));
      const along = Math.pow(1 - v, 1.4) * Math.min(1, v * 6);
      const a = Math.min(1, side * along * 1.25);
      const i = (y * W + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 236;
      img.data[i + 2] = 200;
      img.data[i + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class HeadlightBeams {
  readonly mesh: THREE.InstancedMesh;
  private mat: THREE.MeshBasicMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    // 5.5 m wide, 16 m long, lying on the road, starting at the local origin and pointing +Z
    const g = new THREE.PlaneGeometry(5.5, 16).rotateX(-Math.PI / 2).translate(0, 0, 8);
    this.mat = new THREE.MeshBasicMaterial({
      map: beamTexture(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(g, this.mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  update(vehicles: Vehicle[], cam: THREE.Vector3, night: number, wet: number) {
    this.mat.opacity = Math.max(0, (night - 0.3) / 0.7) * (0.34 + wet * 0.2);
    if (this.mat.opacity <= 0.001) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    let n = 0;
    for (const v of vehicles) {
      if (n >= MAX) break;
      if (!v.headlightsOn || v.destroyed || v.airborne || v.spec.flying) continue;
      if ((v.x - cam.x) ** 2 + (v.z - cam.z) ** 2 > 160 * 160) continue;
      const front = v.spec.length / 2 - 0.2;
      this.p.set(v.x + v.fx * front, v.y + 0.07, v.z + v.fz * front);
      this.q.setFromAxisAngle(this.up, v.yaw);
      this.s.set(v.spec.bike ? 0.55 : 1, 1, v.spec.bike ? 0.75 : 1);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
