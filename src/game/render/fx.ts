/** Pooled visual effects: GPU particles, tracers, decals, flashes, skid marks. */
import * as THREE from 'three';
import { rand } from '../core/math';
import { radialSprite } from '../world/textures';

const PARTICLE_VS = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;
const PARTICLE_FS = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float a = smoothstep(0.5, uSoft, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  size1?: number;
  color: THREE.Color | number;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

class ParticleSystem {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  readonly material: THREE.ShaderMaterial;
  private tmpC = new THREE.Color();

  constructor(capacity: number, additive: boolean) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 0.0 : 0.15 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }

  spawn(p: ParticleSpawn) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0;
    this.vel[i * 3 + 1] = p.vy ?? 0;
    this.vel[i * 3 + 2] = p.vz ?? 0;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.s0[i] = p.size;
    this.s1[i] = p.size1 ?? p.size;
    this.a0[i] = p.alpha ?? 1;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
    const c = typeof p.color === 'number' ? this.tmpC.setHex(p.color) : p.color;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t) * Math.min(1, t * 12 + 0.3);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

class RingInstances {
  readonly mesh: THREE.InstancedMesh;
  private cursor = 0;
  private dummy = new THREE.Object3D();
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private n: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.receiveShadow = true;
  }
  add(pos: THREE.Vector3, normal: THREE.Vector3, size: number, spin = Math.random() * 6.28) {
    const d = this.dummy;
    d.position.copy(pos).addScaledVector(normal, 0.02);
    d.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z);
    d.rotateZ(spin);
    d.scale.setScalar(size);
    d.updateMatrix();
    this.mesh.setMatrixAt(this.cursor, d.matrix);
    this.cursor = (this.cursor + 1) % this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  addMatrix(m: THREE.Matrix4) {
    this.mesh.setMatrixAt(this.cursor, m);
    this.cursor = (this.cursor + 1) % this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}
interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
}
interface Shock {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  size: number;
}

export class FX {
  readonly group = new THREE.Group();
  private glow = new ParticleSystem(2500, true);
  private smoke = new ParticleSystem(2500, false);
  private tracers: Tracer[] = [];
  private tracerCursor = 0;
  private flashes: Flash[] = [];
  private flashCursor = 0;
  private shocks: Shock[] = [];
  private shockCursor = 0;
  private decals: RingInstances;
  private skids: RingInstances;
  readonly muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
  readonly blastLight = new THREE.PointLight(0xff7a30, 0, 40, 2);
  private c = new THREE.Color();
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.add(this.glow.points, this.smoke.points, this.muzzleLight, this.blastLight);

    const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1).translate(0, 0, 0.5);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(
        tracerGeo,
        new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    const flashTex = radialSprite('rgba(255,240,200,1)', 'rgba(255,120,20,0)');
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: flashTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ sprite: s, life: 0, max: 1 });
    }
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.visible = false;
      this.group.add(m);
      this.shocks.push({ mesh: m, life: 0, max: 1, size: 1 });
    }
    // bullet holes
    const holeTex = radialSprite('rgba(10,10,10,0.95)', 'rgba(30,30,30,0)', 64);
    this.decals = new RingInstances(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }),
      240,
    );
    this.group.add(this.decals.mesh);
    // skid marks
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.skids = new RingInstances(
      sg,
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      900,
    );
    this.group.add(this.skids.mesh);
  }

  setViewport(heightPx: number, fovDeg: number) {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.glow.material.uniforms.uScale.value = s;
    this.smoke.material.uniforms.uScale.value = s;
  }

  update(dt: number) {
    this.glow.update(dt);
    this.smoke.update(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / 0.07);
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.sprite.material.opacity = k;
      if (f.life <= 0) f.sprite.visible = false;
    }
    for (const s of this.shocks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const t = 1 - s.life / s.max;
      s.mesh.scale.setScalar(0.5 + t * s.size);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.7;
      if (s.life <= 0) s.mesh.visible = false;
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 400);
    this.blastLight.intensity = Math.max(0, this.blastLight.intensity - dt * 900);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffd28a) {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    // draw a streak covering part of the path (looks like a fast round)
    const start = this.v.copy(from).lerp(to, Math.random() * 0.3);
    t.mesh.position.copy(start);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, Math.min(len * 0.7, 30));
    (t.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    t.mesh.visible = true;
    t.life = 0.07;
  }

  muzzleFlash(pos: THREE.Vector3, size = 0.6) {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.sprite.position.copy(pos);
    f.sprite.scale.setScalar(size * rand(0.8, 1.25));
    f.sprite.material.rotation = Math.random() * 6.28;
    f.sprite.visible = true;
    f.sprite.material.opacity = 1;
    f.life = f.max = 0.05;
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 25;
    for (let i = 0; i < 2; i++)
      this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vy: 0.6, vx: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), life: 0.6, size: 0.15, size1: 0.6, color: 0xbbbbbb, alpha: 0.25, drag: 2 });
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, kind: 'concrete' | 'metal' | 'flesh' | 'dirt' | 'water' | 'wood' | 'glass', decal = true) {
    const n = normal;
    if (kind === 'flesh') {
      for (let i = 0; i < 5; i++)
        this.smoke.spawn({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          vx: n.x * 2 + rand(-1.5, 1.5),
          vy: rand(-0.5, 2),
          vz: n.z * 2 + rand(-1.5, 1.5),
          life: rand(0.2, 0.4),
          size: 0.06,
          size1: 0.18,
          color: this.c.setRGB(0.32, 0.01, 0.01),
          alpha: 0.75,
          gravity: 9,
        });
      return;
    }
    if (kind === 'water') {
      for (let i = 0; i < 10; i++)
        this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-1, 1), vy: rand(2, 5), vz: rand(-1, 1), life: 0.6, size: 0.15, size1: 0.35, color: 0xe8f4ff, alpha: 0.8, gravity: 12 });
      return;
    }
    const sparks = kind === 'metal' ? 10 : 4;
    for (let i = 0; i < sparks; i++)
      this.glow.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: n.x * 4 + rand(-3, 3),
        vy: n.y * 4 + rand(0, 4),
        vz: n.z * 4 + rand(-3, 3),
        life: rand(0.12, 0.3),
        size: 0.07,
        color: 0xffc070,
        gravity: 14,
      });
    const dustC = kind === 'dirt' ? 0x8a7a5a : kind === 'wood' ? 0x7a5a3a : 0xb0aca4;
    for (let i = 0; i < 4; i++)
      this.smoke.spawn({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: n.x * 1.5 + rand(-0.5, 0.5),
        vy: n.y * 1.5 + rand(0, 0.8),
        vz: n.z * 1.5 + rand(-0.5, 0.5),
        life: rand(0.4, 0.8),
        size: 0.15,
        size1: 0.7,
        color: dustC,
        alpha: 0.55,
        drag: 3,
      });
    if (decal) this.decals.add(pos, this.n.copy(n), rand(0.12, 0.2));
  }

  explosion(pos: THREE.Vector3, scale = 1) {
    for (let i = 0; i < 40 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      const sp = rand(3, 10) * scale;
      this.glow.spawn({
        x: pos.x,
        y: pos.y + 0.5,
        z: pos.z,
        vx: Math.cos(a) * sp * u,
        vy: rand(2, 9) * scale,
        vz: Math.sin(a) * sp * u,
        life: rand(0.35, 0.8),
        size: rand(1.2, 2.6) * scale,
        size1: rand(2.5, 4.5) * scale,
        color: this.c.setHSL(rand(0.03, 0.1), 1, rand(0.5, 0.65)),
        drag: 3.5,
        gravity: -1,
      });
    }
    for (let i = 0; i < 30 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(1, 5) * scale;
      this.smoke.spawn({
        x: pos.x + rand(-1, 1),
        y: pos.y + rand(0, 2),
        z: pos.z + rand(-1, 1),
        vx: Math.cos(a) * sp,
        vy: rand(2, 6),
        vz: Math.sin(a) * sp,
        life: rand(1.6, 3.2),
        size: rand(1.5, 3) * scale,
        size1: rand(5, 9) * scale,
        color: this.c.setRGB(0.12, 0.11, 0.1),
        alpha: 0.75,
        drag: 1.4,
        gravity: -0.6,
      });
    }
    for (let i = 0; i < 26; i++)
      this.glow.spawn({
        x: pos.x,
        y: pos.y + 0.5,
        z: pos.z,
        vx: rand(-14, 14),
        vy: rand(4, 16),
        vz: rand(-14, 14),
        life: rand(0.5, 1.2),
        size: 0.12,
        color: 0xffd080,
        gravity: 18,
      });
    const s = this.shocks[this.shockCursor];
    this.shockCursor = (this.shockCursor + 1) % this.shocks.length;
    s.mesh.position.set(pos.x, pos.y + 0.3, pos.z);
    s.mesh.visible = true;
    s.life = s.max = 0.45;
    s.size = 14 * scale;
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.sprite.position.set(pos.x, pos.y + 1.5, pos.z);
    f.sprite.scale.setScalar(12 * scale);
    f.sprite.visible = true;
    f.life = f.max = 0.18;
    this.blastLight.position.set(pos.x, pos.y + 3, pos.z);
    this.blastLight.intensity = 400 * scale;
    this.n.set(0, 1, 0);
    this.decals.add(this.v.set(pos.x, pos.y + 0.05, pos.z), this.n, 4 * scale);
  }

  smokePuff(x: number, y: number, z: number, dark: number, size = 1) {
    this.smoke.spawn({
      x: x + rand(-0.3, 0.3),
      y,
      z: z + rand(-0.3, 0.3),
      vx: rand(-0.4, 0.4),
      vy: rand(1.2, 2.5),
      vz: rand(-0.4, 0.4),
      life: rand(1.2, 2),
      size: 0.6 * size,
      size1: 2.6 * size,
      color: this.c.setScalar(0.75 - dark * 0.65),
      alpha: 0.45 + dark * 0.3,
      drag: 0.8,
    });
  }

  fire(x: number, y: number, z: number, size = 1) {
    this.glow.spawn({
      x: x + rand(-0.5, 0.5) * size,
      y,
      z: z + rand(-0.5, 0.5) * size,
      vy: rand(1.5, 3.5),
      life: rand(0.3, 0.6),
      size: rand(0.6, 1.1) * size,
      size1: 0.1,
      color: this.c.setHSL(rand(0.03, 0.1), 1, 0.55),
    });
  }

  tireSmoke(x: number, y: number, z: number) {
    this.smoke.spawn({ x, y: y + 0.2, z, vx: rand(-0.5, 0.5), vy: rand(0.5, 1.2), vz: rand(-0.5, 0.5), life: rand(0.8, 1.4), size: 0.4, size1: 2.2, color: 0xc8c8c8, alpha: 0.16, drag: 1.5 });
  }

  sparks(pos: THREE.Vector3, count = 8) {
    for (let i = 0; i < count; i++)
      this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-5, 5), vy: rand(1, 5), vz: rand(-5, 5), life: rand(0.15, 0.4), size: 0.08, color: 0xffd080, gravity: 14 });
  }

  pickupSparkle(x: number, y: number, z: number, color: number) {
    this.glow.spawn({ x: x + rand(-0.4, 0.4), y: y + rand(0, 0.6), z: z + rand(-0.4, 0.4), vy: rand(0.5, 1.5), life: 0.8, size: 0.12, color });
  }

  splash(x: number, y: number, z: number) {
    for (let i = 0; i < 30; i++)
      this.smoke.spawn({ x, y, z, vx: rand(-3, 3), vy: rand(3, 8), vz: rand(-3, 3), life: rand(0.6, 1.1), size: 0.25, size1: 0.7, color: 0xeaf6ff, alpha: 0.85, gravity: 14 });
  }

  skid(x: number, y: number, z: number, yaw: number, width = 0.28) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 0.03, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(width, 1, 0.6),
    );
    this.skids.addMatrix(m);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.group.removeFromParent();
  }
}
