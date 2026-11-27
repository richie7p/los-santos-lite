/** Procedural humanoid with hierarchical rig and procedural animation. */
import * as THREE from 'three';
import { clamp, damp, lerp, pick } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from '../data';
import { bodyMat, buildBody, type BodyGeometry } from './characterMesh';

// ---- faces: eyes, brows, nose and mouth merged into one vertex-coloured mesh
const faceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
const faceCache = new Map<string, THREE.BufferGeometry>();
function faceGeometry(skin: number, hair: number) {
  const key = `${skin}_${hair}`;
  let g = faceCache.get(key);
  if (g) return g;
  const col = (geo: THREE.BufferGeometry, c: number) => {
    const color = new THREE.Color(c);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) color.toArray(arr, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geo.deleteAttribute('uv');
    return geo.index ? geo.toNonIndexed() : geo;
  };
  const nose = new THREE.Color(skin).multiplyScalar(0.9).getHex();
  const lips = new THREE.Color(skin).lerp(new THREE.Color(0x9b4a3c), 0.45).getHex();
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(col(new THREE.SphereGeometry(0.019, 8, 6).scale(1.2, 0.85, 0.6).translate(sx * 0.04, 0.022, 0.1), 0xf4f1ec));
    parts.push(col(new THREE.SphereGeometry(0.011, 6, 5).translate(sx * 0.04, 0.022, 0.111), 0x2a1d14));
    parts.push(col(new THREE.BoxGeometry(0.036, 0.008, 0.01).rotateZ(sx * -0.12).translate(sx * 0.04, 0.05, 0.106), hair));
  }
  parts.push(col(new THREE.ConeGeometry(0.014, 0.04, 6).rotateX(-Math.PI / 2 + 0.25).translate(0, -0.005, 0.12), nose));
  parts.push(col(new THREE.BoxGeometry(0.036, 0.008, 0.01).translate(0, -0.045, 0.106), lips));
  g = mergeGeometries(parts)!;
  faceCache.set(key, g);
  return g;
}

export interface Outfit {
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  hair: number;
  hairStyle: 'short' | 'cap' | 'bald' | 'long' | 'bun' | 'buzz' | 'ponytail';
  capColor?: number;
  jacket?: number;
  vest?: boolean;
  bandana?: number;
  /** Body & clothing variety (all optional). */
  fem?: boolean;
  build?: number;
  height?: number;
  sleeves?: 'short' | 'long';
  legwear?: 'pants' | 'shorts' | 'skirt';
  print?: number;
  eyes?: number;
  beard?: boolean;
  glasses?: boolean;
  watch?: boolean;
  chain?: boolean;
  backpack?: number;
  badge?: boolean;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, rough = 0.8, metal = 0) {
  const k = `${color}_${rough}_${metal}`;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    matCache.set(k, m);
  }
  return m;
}

const G = {
  torso: new THREE.CapsuleGeometry(0.16, 0.3, 4, 10),
  pelvis: new THREE.CapsuleGeometry(0.14, 0.08, 4, 10),
  head: new THREE.SphereGeometry(0.115, 14, 12),
  neck: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8),
  upperArm: new THREE.CapsuleGeometry(0.052, 0.2, 3, 8).translate(0, -0.13, 0),
  foreArm: new THREE.CapsuleGeometry(0.046, 0.19, 3, 8).translate(0, -0.12, 0),
  hand: new THREE.SphereGeometry(0.05, 8, 6).scale(1, 1.25, 0.7),
  thigh: new THREE.CapsuleGeometry(0.078, 0.3, 3, 8).translate(0, -0.2, 0),
  shin: new THREE.CapsuleGeometry(0.062, 0.3, 3, 8).translate(0, -0.2, 0),
  foot: new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.035, 0.05),
  hairShort: new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hairLong: new THREE.SphereGeometry(0.128, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.75).scale(1, 1.15, 1.05),
  capTop: new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
  capBrim: new THREE.CylinderGeometry(0.11, 0.11, 0.015, 12, 1, false, -Math.PI / 2, Math.PI).translate(0, 0, 0.06),
  bun: new THREE.SphereGeometry(0.06, 8, 6),
  vest: new THREE.BoxGeometry(0.38, 0.38, 0.26),
  collar: new THREE.TorusGeometry(0.1, 0.03, 6, 12),
  eye: new THREE.SphereGeometry(0.014, 6, 4),
  bandana: new THREE.CylinderGeometry(0.12, 0.125, 0.06, 12),
  front: new THREE.PlaneGeometry(0.12, 0.38),
};

// weapon geometries
const W = {
  pistol: mergeParts([
    [0.04, 0.09, 0.2, 0, 0.0, 0.06],
    [0.035, 0.12, 0.05, 0, -0.07, 0],
  ]),
  smg: mergeParts([
    [0.05, 0.1, 0.34, 0, 0, 0.1],
    [0.035, 0.16, 0.05, 0, -0.1, 0.06],
    [0.03, 0.08, 0.04, 0, -0.08, -0.02],
  ]),
  shotgun: mergeParts([
    [0.05, 0.08, 0.85, 0, 0, 0.25],
    [0.06, 0.12, 0.25, 0, -0.04, -0.14],
    [0.055, 0.055, 0.28, 0, -0.06, 0.3],
  ]),
  rifle: mergeParts([
    [0.05, 0.11, 0.75, 0, 0, 0.22],
    [0.04, 0.18, 0.06, 0, -0.12, 0.12],
    [0.05, 0.12, 0.22, 0, -0.02, -0.18],
    [0.03, 0.06, 0.12, 0, 0.09, 0.15],
  ]),
  sniper: mergeParts([
    [0.045, 0.1, 1.05, 0, 0, 0.32],
    [0.05, 0.12, 0.28, 0, -0.03, -0.16],
    [0.05, 0.05, 0.3, 0, 0.1, 0.12],
  ]),
  rpg: mergeParts([
    [0.13, 0.13, 1.1, 0, 0.05, 0.1],
    [0.04, 0.14, 0.05, 0, -0.08, 0.05],
    [0.18, 0.18, 0.2, 0, 0.05, 0.62],
  ]),
  grenade: new THREE.SphereGeometry(0.05, 8, 6),
};
function mergeParts(parts: [number, number, number, number, number, number][]) {
  const geos = parts.map(([w, h, d, x, y, z]) => new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const merged = new THREE.BufferGeometry();
  // manual merge (all BoxGeometry share layout)
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, off * 3);
    nor.set(g.attributes.normal.array as Float32Array, off * 3);
    const gi = g.index!;
    for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + off);
    off += g.attributes.position.count;
    g.dispose();
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setIndex(idx);
  return merged;
}
const gunMat = new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.7, roughness: 0.4 });
const rpgMat = new THREE.MeshStandardMaterial({ color: 0x4b5d3a, metalness: 0.3, roughness: 0.6 });
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3e4a2f, roughness: 0.7 });

export const SKIN_TONES = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423, 0xd9a066];
export const HAIR_COLORS = [0x1b1b1b, 0x3b2a1a, 0x6a4e2a, 0xb08850, 0x2a2a2a, 0x8c8c8c, 0xa0522d];
const SHIRTS = [0xe74c3c, 0x3498db, 0xecf0f1, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x34495e, 0x16a085, 0xd35400, 0xf5cba7, 0x1c2833, 0xc0392b, 0x85c1e9];
const PANTS = [0x2c3e50, 0x1b2631, 0x5d6d7e, 0x7e5109, 0x212f3d, 0x4a235a, 0xb3b6b7, 0x283747];
const SHOES = [0x111111, 0x5d4037, 0xeeeeee, 0x1b2631, 0x7b241c];

export function randomOutfit(): Outfit {
  const fem = Math.random() < 0.45;
  const warm = Math.random() < 0.55;
  return {
    fem,
    skin: pick(SKIN_TONES),
    shirt: pick(SHIRTS),
    pants: pick(fem ? [...PANTS, 0x8e2c48, 0x1f4e79, 0xd9c7a7] : PANTS),
    shoes: pick(SHOES),
    hair: pick(HAIR_COLORS),
    hairStyle: fem ? pick(['long', 'long', 'bun', 'ponytail', 'short'] as const) : pick(['short', 'short', 'buzz', 'cap', 'bald', 'short'] as const),
    capColor: pick(SHIRTS),
    jacket: Math.random() < 0.28 ? pick([0x1c1c1c, 0x5b3a29, 0x2e4053, 0x7d6608, 0x4a5a3a]) : undefined,
    build: 0.88 + Math.random() * 0.3,
    height: (fem ? 0.93 : 0.98) + Math.random() * 0.08,
    sleeves: warm ? 'short' : 'long',
    legwear: fem ? pick(['pants', 'skirt', 'shorts', 'pants'] as const) : warm && Math.random() < 0.3 ? 'shorts' : 'pants',
    print: Math.random() < 0.4 ? pick(SHIRTS) : undefined,
    eyes: pick([0x3b2a1d, 0x2a4a6a, 0x3d5a2a, 0x1b1b1b]),
    beard: !fem && Math.random() < 0.22,
    glasses: Math.random() < 0.18,
    watch: Math.random() < 0.4,
    backpack: Math.random() < 0.12 ? pick([0x1d4ed8, 0x111111, 0xc0392b, 0x2a9d8f]) : undefined,
  };
}
export function policeOutfit(swat = false): Outfit {
  return {
    skin: pick(SKIN_TONES),
    shirt: swat ? 0x22272e : 0x1f3a5f,
    pants: swat ? 0x22272e : 0x14213d,
    shoes: 0x111111,
    hair: 0x1b1b1b,
    hairStyle: 'cap',
    capColor: swat ? 0x111111 : 0x14213d,
    vest: swat,
    badge: true,
    sleeves: swat ? 'long' : 'short',
    watch: true,
    build: 1.02 + Math.random() * 0.12,
  };
}
export function gangOutfit(): Outfit {
  return {
    skin: pick(SKIN_TONES),
    shirt: pick([0x6c3483, 0x512e5f, 0x1c1c1c]),
    pants: pick([0x1b2631, 0x111111]),
    shoes: 0xeeeeee,
    hair: 0x111111,
    hairStyle: pick(['bald', 'short', 'cap'] as const),
    capColor: 0x6c3483,
    bandana: 0x8e44ad,
    jacket: Math.random() < 0.5 ? 0x111111 : undefined,
    chain: Math.random() < 0.6,
    beard: Math.random() < 0.3,
    glasses: Math.random() < 0.25,
    build: 0.95 + Math.random() * 0.25,
    sleeves: 'short',
  };
}
export function playerOutfit(): Outfit {
  return { skin: 0xd9a066, shirt: 0xf2f2f2, pants: 0x2b3a4a, shoes: 0x3a2a1e, hair: 0x1b1b1b, hairStyle: 'short', jacket: 0x23303d, watch: true, build: 1.04, beard: true, eyes: 0x2a1d14 };
}

export type Pose = 'idle' | 'move' | 'aim' | 'dead' | 'handsUp' | 'cower' | 'fall';
/** Arm overlay for ambient life: talking on the phone or gesturing in a conversation. */
export type Gesture = 'none' | 'phone' | 'talk';

export class CharacterRig {
  readonly root = new THREE.Group();
  private pose = new THREE.Group(); // pivot for falls
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private elL = new THREE.Group();
  private elR = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private knL = new THREE.Group();
  private knR = new THREE.Group();
  private handR = new THREE.Group();
  private weaponMesh: THREE.Mesh | null = null;
  private weapon: WeaponId = 'fist';
  phase = Math.random() * 10;
  private deadT = 0;
  private punchT = 0;
  private recoilT = 0;
  private flinchT = 0;
  private flinchDir = 1;
  private lean = 0;
  private aimBlend = 0;
  private fallDir = 1;
  /** Ambient arm gesture (pedestrians). */
  gesture: Gesture = 'none';
  /** Far LOD: one merged mesh instead of ~12 bone meshes, no bone animation. */
  private lodMesh: THREE.Mesh | null = null;
  private lodOn = false;
  private idleT = Math.random() * 20;

  private body: BodyGeometry;

  constructor(public outfit: Outfit) {
    const o = outfit;
    const body = buildBody(o);
    this.body = body;
    this.root.scale.setScalar(o.height ?? 1);

    this.root.add(this.pose);
    this.pose.add(this.hips);
    this.hips.position.y = 0.98;
    this.hips.add(this.m(body.pelvis, bodyMat));
    this.hips.add(this.spine);
    this.spine.add(this.m(body.torso, bodyMat));
    this.spine.add(this.neck);
    this.neck.position.y = 0.55;
    this.neck.add(this.m(body.neck, bodyMat));
    this.neck.add(this.head);
    this.head.position.y = 0.16;
    this.head.add(this.m(body.head, bodyMat));

    const arm = (sh: THREE.Group, el: THREE.Group, side: number) => {
      sh.position.set(side * body.shoulderX, 0.475, 0);
      this.spine.add(sh);
      sh.add(this.m(side > 0 ? body.upperArmL : body.upperArmR, bodyMat));
      el.position.y = -0.28;
      sh.add(el);
      el.add(this.m(side > 0 ? body.foreArmL : body.foreArmR, bodyMat));
    };
    arm(this.shL, this.elL, 1);
    arm(this.shR, this.elR, -1);
    this.handR.position.set(0, -0.3, 0.02);
    this.elR.add(this.handR);

    const leg = (hp: THREE.Group, kn: THREE.Group, side: number) => {
      hp.position.set(side * body.hipX, -0.03, 0);
      this.hips.add(hp);
      hp.add(this.m(body.thigh, bodyMat));
      kn.position.y = -0.44;
      hp.add(kn);
      kn.add(this.m(body.shin, bodyMat));
    };
    leg(this.hipL, this.knL, 1);
    leg(this.hipR, this.knR, -1);
  }

  private m(g: THREE.BufferGeometry, m: THREE.Material, shadow = true) {
    const me = new THREE.Mesh(g, m);
    me.castShadow = shadow;
    return me;
  }

  /** Switch between the full rig and the single-mesh far LOD. */
  setLod(on: boolean) {
    if (on === this.lodOn) return;
    this.lodOn = on;
    if (on && !this.lodMesh) this.lodMesh = this.buildLod();
    this.pose.visible = !on;
    if (this.lodMesh) this.lodMesh.visible = on;
  }

  /** Merge every body part in a neutral standing pose into one vertex-coloured mesh. */
  private buildLod() {
    const groups = [this.pose, this.hips, this.spine, this.neck, this.head, this.shL, this.shR, this.elL, this.elR, this.hipL, this.hipR, this.knL, this.knR];
    const saved = groups.map((g) => [g.rotation.clone(), g.position.clone()] as const);
    for (const g of groups) g.rotation.set(0, 0, 0);
    this.pose.position.set(0, 0, 0);
    this.hips.position.y = 0.98;
    this.shL.rotation.z = 0.1;
    this.shR.rotation.z = -0.1;
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    // far away a coarse body is plenty: same parts, about a third of the triangles
    const low = buildBody(this.outfit, 0.5);
    const full = this.body;
    const swap = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
    for (const k of ['pelvis', 'torso', 'neck', 'head', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thigh', 'shin'] as const) swap.set(full[k], low[k]);
    const parts: THREE.BufferGeometry[] = [];
    this.pose.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m === this.weaponMesh || !m.geometry.attributes.color) return;
      const src = swap.get(m.geometry) ?? m.geometry;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', src.attributes.position.clone());
      g.setAttribute('normal', src.attributes.normal.clone());
      g.setAttribute('color', src.attributes.color.clone());
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      parts.push(g);
    });
    groups.forEach((g, i) => {
      g.rotation.copy(saved[i][0]);
      g.position.copy(saved[i][1]);
    });
    const merged = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    for (const g of new Set(swap.values())) g.dispose();
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, bodyMat);
    mesh.castShadow = false;
    this.root.add(mesh);
    return mesh;
  }

  setWeapon(w: WeaponId) {
    if (w === this.weapon) return;
    this.weapon = w;
    if (this.weaponMesh) {
      this.handR.remove(this.weaponMesh);
      this.weaponMesh = null;
    }
    if (w === 'fist') return;
    const geo = W[w];
    const me = new THREE.Mesh(geo, w === 'rpg' ? rpgMat : w === 'grenade' ? grenadeMat : gunMat);
    me.castShadow = true;
    // hand points down (-Y) when the arm hangs; barrel along arm's forward when raised
    me.rotation.x = Math.PI / 2;
    me.position.set(0, -0.03, 0.02);
    this.handR.add(me);
    this.weaponMesh = me;
  }

  /** World-space position of the muzzle (approximate). */
  muzzleWorld(out: THREE.Vector3) {
    const len = { fist: 0.1, pistol: 0.18, smg: 0.3, shotgun: 0.7, rifle: 0.62, sniper: 0.9, rpg: 0.7, grenade: 0.05 }[this.weapon];
    out.set(0, -len - 0.05, 0.02);
    this.handR.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.handR.matrixWorld);
  }

  /** Short hit reaction; dir 1 = hit from the front. */
  flinch(dir = 1) {
    this.flinchT = 0.28;
    this.flinchDir = dir;
  }

  punch() {
    this.punchT = 0.3;
  }
  kick() {
    this.recoilT = 0.12;
  }

  get isTwoHanded() {
    return this.weapon !== 'pistol' && this.weapon !== 'fist' && this.weapon !== 'grenade';
  }

  /**
   * @param speed horizontal speed m/s
   * @param aimPitch radians (positive = up)
   */
  animate(dt: number, pose: Pose, speed: number, aimPitch = 0, sprint = false) {
    const k = damp(14, dt);
    const aiming = pose === 'aim';
    this.aimBlend = lerp(this.aimBlend, aiming ? 1 : 0, damp(16, dt));
    const ab = this.aimBlend;

    if (pose === 'dead' || pose === 'fall') {
      this.deadT = Math.min(1, this.deadT + dt * 2.6);
      const t = this.deadT;
      const e = 1 - Math.pow(1 - t, 3);
      this.pose.rotation.x = -this.fallDir * e * (Math.PI / 2 - 0.08);
      this.pose.position.y = e * 0.12;
      this.pose.position.z = -this.fallDir * e * 0.2;
      this.shL.rotation.set(-e * 2.2, 0, e * 0.6);
      this.shR.rotation.set(-e * 2.0, 0, -e * 0.7);
      this.elL.rotation.x = -e * 0.4;
      this.elR.rotation.x = -e * 0.6;
      this.hipL.rotation.x = e * 0.25;
      this.hipR.rotation.x = -e * 0.1;
      this.knL.rotation.x = e * 0.5;
      this.knR.rotation.x = e * 0.2;
      this.neck.rotation.x = e * 0.4;
      return;
    }
    this.deadT = 0;
    if (this.lodOn) {
      // far away: just bob along, no bones
      const mv = speed > 0.25;
      this.phase += dt * (mv ? 3.2 + speed * 1.15 : 0);
      if (this.lodMesh) this.lodMesh.position.y = mv ? -Math.abs(Math.cos(this.phase)) * 0.035 : 0;
      return;
    }
    this.pose.rotation.x = lerp(this.pose.rotation.x, 0, k);
    this.pose.position.set(0, 0, 0);

    const moving = speed > 0.25;
    this.idleT += dt;
    // breathing and a slow weight shift while standing
    const idle = !moving && pose === 'idle';
    const breath = Math.sin(this.idleT * 1.7);
    const sway = Math.sin(this.idleT * 0.45);
    const run = clamp(speed / 6, 0, 1.4);
    const stride = sprint ? 1.25 : 1;
    this.phase += dt * (moving ? 3.2 + speed * 1.15 : 0);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const amp = moving ? lerp(0.35, 0.85, Math.min(1, run)) * stride : 0;

    // legs
    const legSwing = s * amp;
    this.hipL.rotation.x = lerp(this.hipL.rotation.x, legSwing, k);
    this.hipR.rotation.x = lerp(this.hipR.rotation.x, -legSwing, k);
    this.knL.rotation.x = lerp(this.knL.rotation.x, moving ? Math.max(0, -c) * amp * 1.4 + 0.08 : 0.04, k);
    this.knR.rotation.x = lerp(this.knR.rotation.x, moving ? Math.max(0, c) * amp * 1.4 + 0.08 : 0.04, k);
    this.hips.position.y = 0.98 - (moving ? Math.abs(c) * 0.035 * (0.5 + run) : 0) - (pose === 'cower' ? 0.35 : 0) + (idle ? breath * 0.004 : 0);
    this.hips.position.x = idle ? sway * 0.025 : 0;
    this.hips.rotation.z = idle ? -sway * 0.03 : 0;
    if (idle) {
      // weight on one leg: the other knee relaxes
      this.knL.rotation.x = lerp(this.knL.rotation.x, 0.04 + Math.max(0, sway) * 0.12, k);
      this.knR.rotation.x = lerp(this.knR.rotation.x, 0.04 + Math.max(0, -sway) * 0.12, k);
    }
    // torso lean
    this.lean = lerp(this.lean, moving && !aiming ? run * 0.2 : 0, k);
    this.spine.rotation.x = this.lean - ab * aimPitch * 0.35 + (idle ? breath * 0.012 : 0);
    this.spine.rotation.y = moving ? s * 0.08 * (1 - ab) : 0;
    this.hips.rotation.y = moving ? -s * 0.06 * (1 - ab) : 0;
    this.neck.rotation.x = -ab * aimPitch * 0.3 + (moving ? c * 0.025 : 0);
    // idle: glance around now and then
    const look = idle ? Math.sin(this.idleT * 0.31) * Math.max(0, Math.sin(this.idleT * 0.13)) * 0.5 : 0;
    this.neck.rotation.y = lerp(this.neck.rotation.y, look, damp(3, dt));

    // arms
    let lx = moving ? -s * amp * 0.9 : 0.05 + breath * 0.015;
    let rx = moving ? s * amp * 0.9 : 0.05 + breath * 0.015;
    let lz = moving ? 0.08 : 0.13;
    let rz = moving ? -0.08 : -0.13;
    let lel = moving ? -0.3 - run * 0.6 : -0.22;
    let rel = moving ? -0.3 - run * 0.6 : -0.22;
    let ly = 0;
    let ry = 0;
    if (ab < 0.01 && (pose === 'idle' || pose === 'move')) {
      if (this.gesture === 'phone') {
        // right hand held at the ear
        rx = -0.55;
        rz = -0.35;
        ry = 0.45;
        rel = -2.35;
      } else if (this.gesture === 'talk' && !moving) {
        // hands animate the conversation
        const g1 = Math.sin(this.idleT * 2.3);
        const g2 = Math.sin(this.idleT * 1.7 + 1.3);
        rx = -0.35 - Math.max(0, g1) * 0.5;
        rel = -1.1 - g2 * 0.35;
        rz = -0.2;
        lx = -0.2 - Math.max(0, g2) * 0.35;
        lel = -0.9 + g1 * 0.25;
        lz = 0.18;
      }
    }

    if (pose === 'handsUp') {
      lx = -2.9;
      rx = -2.9;
      lz = 0.3;
      rz = -0.3;
      lel = -0.6;
      rel = -0.6;
    } else if (pose === 'cower') {
      lx = -2.4;
      rx = -2.4;
      lel = -2;
      rel = -2;
    }
    if (ab > 0.01) {
      const recoil = this.recoilT > 0 ? this.recoilT * 2.5 : 0;
      const pitch = aimPitch * 0.65;
      if (this.isTwoHanded) {
        rx = lerp(rx, -Math.PI / 2 - pitch + recoil * 0.4, ab);
        rel = lerp(rel, -0.25, ab);
        ry = lerp(ry, 0.25, ab);
        lx = lerp(lx, -Math.PI / 2 - pitch + 0.2, ab);
        lz = lerp(lz, -0.5, ab);
        lel = lerp(lel, -0.9, ab);
      } else if (this.weapon === 'grenade') {
        rx = lerp(rx, -2.6, ab);
        rel = lerp(rel, -1.1, ab);
      } else {
        rx = lerp(rx, -Math.PI / 2 - pitch + recoil * 0.6, ab);
        rel = lerp(rel, -0.05, ab);
        ry = lerp(ry, 0.05, ab);
        lx = lerp(lx, -Math.PI / 2 - pitch + 0.15, ab);
        lz = lerp(lz, -0.6, ab);
        lel = lerp(lel, -0.5, ab);
      }
    }
    if (this.punchT > 0) {
      const t = 1 - this.punchT / 0.3;
      const p = Math.sin(t * Math.PI);
      rx = -1.6 * p + rx * (1 - p);
      rel = -0.1 * p + rel * (1 - p);
      this.spine.rotation.y += -0.35 * p;
      this.punchT -= dt;
    }
    this.recoilT = Math.max(0, this.recoilT - dt);
    if (this.flinchT > 0) {
      const f = Math.sin((this.flinchT / 0.28) * Math.PI);
      this.spine.rotation.x -= f * 0.35 * this.flinchDir;
      this.neck.rotation.x -= f * 0.3 * this.flinchDir;
      this.spine.rotation.z = f * 0.12;
      this.flinchT -= dt;
    } else this.spine.rotation.z = 0;
    const ak = damp(pose === 'aim' ? 30 : 12, dt);
    this.shL.rotation.x = lerp(this.shL.rotation.x, lx, ak);
    this.shR.rotation.x = lerp(this.shR.rotation.x, rx, ak);
    this.shL.rotation.z = lerp(this.shL.rotation.z, lz, ak);
    this.shR.rotation.z = lerp(this.shR.rotation.z, rz, ak);
    this.shL.rotation.y = lerp(this.shL.rotation.y, ly, ak);
    this.shR.rotation.y = lerp(this.shR.rotation.y, ry, ak);
    this.elL.rotation.x = lerp(this.elL.rotation.x, lel, ak);
    this.elR.rotation.x = lerp(this.elR.rotation.x, rel, ak);
    // hold weapon level: compensate hand pitch so barrel follows aim
    if (this.weaponMesh) this.weaponMesh.rotation.x = Math.PI / 2 + (ab > 0.5 ? 0 : 0.6);
  }

  /** Begin death fall; dir = 1 falls backwards, -1 forwards. */
  die(dir = 1) {
    this.fallDir = dir;
    this.deadT = 0;
  }
  revive() {
    this.deadT = 0;
    this.pose.rotation.set(0, 0, 0);
    this.pose.position.set(0, 0, 0);
  }

  dispose() {
    this.root.removeFromParent();
    this.lodMesh?.geometry.dispose();
    const b = this.body;
    for (const g of [b.pelvis, b.torso, b.neck, b.head, b.upperArmL, b.upperArmR, b.foreArmL, b.foreArmR, b.thigh, b.shin]) g.dispose();
  }
}
