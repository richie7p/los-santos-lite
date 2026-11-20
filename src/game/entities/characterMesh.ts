/**
 * Sculpted character body parts. Each bone gets ONE merged, vertex-coloured
 * geometry (shared material), so a detailed person costs ~12 draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Outfit } from './character';

export const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });

type Part = [THREE.BufferGeometry, number];

function paint(g: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}
function merge(parts: Part[]) {
  const g = mergeGeometries(parts.map(([geo, c]) => paint(geo, c)))!;
  g.computeBoundingSphere();
  return g;
}

/** Lathe from (radius, y) pairs, optionally squashed into an ellipse. */
function lathe(profile: [number, number][], sx: number, sz: number, seg = 16) {
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
  g.scale(sx, 1, sz);
  return g;
}

/** Tapered limb with rounded ends, hanging from y = 0 down to y = -len. */
function limb(r0: number, r1: number, len: number, seg = 12) {
  const parts = [
    new THREE.CylinderGeometry(r0, r1, len, seg, 3, true).translate(0, -len / 2, 0),
    new THREE.SphereGeometry(r0, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.SphereGeometry(r1, seg, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -len, 0),
  ];
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

const sphere = (r: number, w = 12, h = 10) => new THREE.SphereGeometry(r, w, h);
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export interface BodyGeometry {
  pelvis: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  neck: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  upperArmL: THREE.BufferGeometry;
  upperArmR: THREE.BufferGeometry;
  foreArmL: THREE.BufferGeometry;
  foreArmR: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
  /** Joint offsets for this body type. */
  shoulderX: number;
  hipX: number;
}

/** Builds every body part for an outfit. Caller owns (and disposes) the geometries. */
export function buildBody(o: Outfit): BodyGeometry {
  const fem = !!o.fem;
  const b = o.build ?? 1;
  const top = o.jacket ?? o.shirt;
  const long = !!o.jacket || o.sleeves === 'long';
  const legs = o.legwear ?? 'pants';
  const darker = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

  // ---------------------------------------------------------------- pelvis
  const pelvisParts: Part[] = [
    [lathe(fem ? [[0.12, -0.14], [0.158, -0.07], [0.152, 0.0], [0.122, 0.07]] : [[0.12, -0.13], [0.15, -0.06], [0.147, 0.02], [0.125, 0.07]], (fem ? 1.42 : 1.3) * b, 0.82 * b), legs === 'skirt' ? o.pants : o.pants],
    // belt with buckle
    [new THREE.TorusGeometry(0.155, 0.014, 6, 24).rotateX(Math.PI / 2).scale((fem ? 1.4 : 1.29) * b, 1, 0.83 * b).translate(0, 0.045, 0), 0x2a1d14],
    [box(0.04, 0.03, 0.012, 0, 0.045, 0.13 * b), 0xc9a227],
  ];
  if (legs === 'skirt') pelvisParts.push([new THREE.CylinderGeometry(0.15, 0.24, 0.36, 18, 1, true).scale(1.32 * b, 1, 0.95 * b).translate(0, -0.15, 0), o.pants]);

  // ---------------------------------------------------------------- torso
  const prof: [number, number][] = fem
    ? [[0.11, 0.0], [0.102, 0.08], [0.112, 0.17], [0.138, 0.28], [0.134, 0.38], [0.126, 0.46], [0.095, 0.52], [0.05, 0.56]]
    : [[0.118, 0.0], [0.126, 0.08], [0.14, 0.2], [0.155, 0.32], [0.16, 0.4], [0.152, 0.47], [0.112, 0.53], [0.055, 0.565]];
  const sx = (fem ? 1.22 : 1.32) * b;
  const sz = 0.74 * b;
  const torsoParts: Part[] = [[lathe(prof, sx, sz, 18), top]];
  const chestZ = 0.155 * sz; // front surface at chest height
  if (o.jacket) {
    // open front showing the shirt, lapels and a collar
    torsoParts.push([box(0.1, 0.36, 0.02, 0, 0.3, chestZ + 0.002), o.shirt]);
    for (const s of [-1, 1]) {
      torsoParts.push([box(0.045, 0.2, 0.015).rotateZ(s * 0.35).translate(s * 0.07, 0.42, chestZ + 0.006), darker(o.jacket, 0.8)]);
      torsoParts.push([box(0.06, 0.05, 0.02, s * 0.12, 0.17, chestZ - 0.005), darker(o.jacket, 0.85)]);
    }
    torsoParts.push([new THREE.TorusGeometry(0.075, 0.018, 6, 18, Math.PI * 1.4).rotateX(Math.PI / 2).rotateY(-Math.PI * 0.2).translate(0, 0.54, -0.005), o.jacket]);
  } else {
    // t-shirt collar and a small chest print
    torsoParts.push([new THREE.TorusGeometry(0.062, 0.012, 6, 18).rotateX(Math.PI / 2).translate(0, 0.545, 0.005), darker(o.shirt, 0.85)]);
    if (!o.badge && !o.vest && (o.print ?? 0) > 0) torsoParts.push([box(0.08, 0.06, 0.01, fem ? 0 : 0.05, 0.36, chestZ + 0.004), o.print!]);
  }
  if (o.vest) {
    torsoParts.push([lathe([[0.135, 0.1], [0.165, 0.2], [0.17, 0.32], [0.165, 0.44], [0.13, 0.49]], sx * 1.02, sz * 1.08, 16), 0x2b2f33]);
    for (const s of [-1, 1]) torsoParts.push([box(0.06, 0.07, 0.03, s * 0.08, 0.22, chestZ + 0.03), 0x23272b]);
  }
  if (o.badge) torsoParts.push([box(0.035, 0.04, 0.008, 0.075, 0.4, chestZ + (o.vest ? 0.03 : 0.004)), 0xd4ac0d]);
  if (o.badge && !o.vest) torsoParts.push([box(0.04, 0.06, 0.03, -0.12, 0.47, 0.02), 0x111111]); // shoulder radio
  if (o.chain) torsoParts.push([new THREE.TorusGeometry(0.07, 0.006, 4, 20).rotateX(Math.PI / 2 - 0.5).translate(0, 0.5, 0.05), 0xd4ac0d]);
  if (o.backpack) {
    torsoParts.push([box(0.24, 0.3, 0.1, 0, 0.3, -0.15 * sz - 0.04), o.backpack]);
    for (const s of [-1, 1]) torsoParts.push([box(0.03, 0.34, 0.02, s * 0.09, 0.32, chestZ - 0.01).rotateX(0.05), darker(o.backpack, 0.7)]);
  }

  // ---------------------------------------------------------------- neck & head
  const neck = merge([[limb(0.05, 0.055, 0.1, 10).translate(0, 0.1, 0), o.skin]]);
  const skull = new THREE.SphereGeometry(0.112, 20, 16);
  {
    const p = skull.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i) * 1.1;
      let z = p.getZ(i);
      if (y < 0) {
        // narrower jaw and chin
        const k = Math.min(1, -y / 0.12);
        x *= 1 - k * (fem ? 0.28 : 0.2);
        z *= 1 - k * 0.06;
        if (z > 0.03) z += k * 0.012;
      }
      if (z < -0.02 && y > -0.02) z *= 1.06; // fuller back of the head
      if (z > 0.06 && Math.abs(y - 0.0) < 0.03) z += 0.004; // cheekbones
      p.setXYZ(i, x, y, z);
    }
    skull.computeVertexNormals();
  }
  const headParts: Part[] = [[skull, o.skin]];
  for (const s of [-1, 1]) {
    headParts.push([sphere(0.026, 8, 6).scale(0.35, 1, 0.65).translate(s * 0.108, 0.0, -0.005), darker(o.skin, 0.95)]);
    // eyes
    headParts.push([sphere(0.018, 10, 8).scale(1.15, 0.8, 0.55).translate(s * 0.039, 0.022, 0.097), 0xf4f1ec]);
    headParts.push([sphere(0.0105, 8, 6).translate(s * 0.039, 0.022, 0.106), o.eyes ?? 0x3b2a1d]);
    headParts.push([box(0.034, 0.007, 0.01).rotateZ(s * -0.12).translate(s * 0.04, 0.048, 0.102), o.hair]);
  }
  headParts.push([new THREE.ConeGeometry(0.015, 0.042, 6).rotateX(-Math.PI / 2 + 0.3).translate(0, -0.004, 0.118), darker(o.skin, 0.93)]);
  headParts.push([box(0.04, 0.009, 0.012, 0, -0.048, 0.1), new THREE.Color(o.skin).lerp(new THREE.Color(0x9b4a3c), fem ? 0.6 : 0.4).getHex()]);
  if (o.beard) headParts.push([new THREE.SphereGeometry(0.106, 14, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.55, Math.PI * 0.32).scale(0.82, 1.1, 1.02).translate(0, -0.008, 0.008), o.hair]);
  if (o.glasses) {
    for (const s of [-1, 1]) headParts.push([box(0.036, 0.022, 0.006, s * 0.04, 0.022, 0.113), 0x111418]);
    headParts.push([box(0.02, 0.006, 0.006, 0, 0.028, 0.114), 0x111418]);
  }
  // hair
  const hairCap = (r: number, front: number) => {
    const g = new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) * 1.08;
      const z = p.getZ(i);
      p.setY(i, z > 0.02 && y < front ? front + (y - front) * 0.15 : y);
    }
    g.computeVertexNormals();
    return g;
  };
  switch (o.hairStyle) {
    case 'short':
      headParts.push([hairCap(0.119, 0.05), o.hair]);
      break;
    case 'buzz':
      headParts.push([hairCap(0.1145, 0.055), o.hair]);
      break;
    case 'bun':
      headParts.push([hairCap(0.119, 0.06), o.hair], [sphere(0.05, 10, 8).translate(0, 0.09, -0.085), o.hair]);
      break;
    case 'ponytail':
      headParts.push([hairCap(0.119, 0.06), o.hair], [limb(0.03, 0.018, 0.2, 8).rotateX(0.35).translate(0, 0.04, -0.115), o.hair]);
      break;
    case 'long':
      headParts.push([hairCap(0.121, 0.065), o.hair]);
      // hangs down the back and sides; open at the front (theta 0 = +Z) for the face
      headParts.push([new THREE.CylinderGeometry(0.116, 0.135, 0.27, 18, 1, true, Math.PI * 0.36, Math.PI * 1.28).scale(1, 1, 0.95).translate(0, -0.085, -0.01), o.hair]);
      break;
    case 'cap': {
      const cc = o.capColor ?? 0x222222;
      headParts.push([new THREE.SphereGeometry(0.123, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.95, 1).translate(0, 0.02, 0), cc]);
      headParts.push([new THREE.CylinderGeometry(0.11, 0.11, 0.012, 16, 1, false, -Math.PI * 0.42, Math.PI * 0.84).scale(1, 1, 1.25).translate(0, 0.03, 0.06), darker(cc, 0.85)]);
      headParts.push([sphere(0.012, 6, 4).translate(0, 0.14, 0), darker(cc, 0.8)]);
      break;
    }
  }
  if (o.bandana) headParts.push([new THREE.CylinderGeometry(0.118, 0.12, 0.045, 18, 1, true).translate(0, 0.06, 0), o.bandana]);

  // ---------------------------------------------------------------- arms
  const armR = (fem ? 0.046 : 0.054) * b;
  const upperArm = (side: number) => {
    // the shoulder ball is always covered by the shirt
    const parts: Part[] = [[sphere(armR * 1.15, 12, 10).scale(1, 0.92, 1).translate(0, -0.005, 0), top]];
    if (long) parts.push([limb(armR * 1.03, armR * 0.86, 0.27), top]);
    else {
      parts.push([limb(armR * 1.08, armR * 1.0, 0.12).translate(0, 0, 0), top]);
      parts.push([limb(armR * 0.96, armR * 0.84, 0.27), o.skin]);
    }
    void side;
    return merge(parts);
  };
  const foreArm = (side: number) => {
    const fr = armR * 0.86;
    const parts: Part[] = [[limb(fr, fr * 0.78, 0.24), long ? top : o.skin]];
    if (long) parts.push([new THREE.TorusGeometry(fr * 0.85, 0.008, 5, 14).rotateX(Math.PI / 2).translate(0, -0.235, 0), darker(top, 0.8)]);
    // hand: palm, four fingers, thumb
    parts.push([box(0.072, 0.082, 0.032, 0, -0.3, 0), o.skin]);
    for (let f = 0; f < 4; f++) parts.push([limb(0.0095, 0.0085, 0.05 - Math.abs(f - 1.5) * 0.006, 6).translate(-0.027 + f * 0.018, -0.338, 0.002), o.skin]);
    parts.push([limb(0.011, 0.01, 0.045, 6).rotateZ(side * 0.7).translate(side * 0.04, -0.285, 0.012), o.skin]);
    if (o.watch && side > 0) parts.push([new THREE.TorusGeometry(fr * 0.82, 0.012, 5, 14).rotateX(Math.PI / 2).translate(0, -0.225, 0), 0x1b1b1b], [box(0.025, 0.006, 0.025, 0, -0.225, fr * 0.8), 0xc0c4c8]);
    return merge(parts);
  };

  // ---------------------------------------------------------------- legs
  const legR = (fem ? 0.08 : 0.085) * b;
  const thighParts: Part[] = [];
  if (legs === 'pants') thighParts.push([limb(legR, legR * 0.72, 0.44), o.pants]);
  else if (legs === 'shorts') {
    thighParts.push([limb(legR * 1.08, legR * 0.95, 0.24), o.pants]);
    thighParts.push([limb(legR * 0.95, legR * 0.7, 0.44), o.skin]);
  } else thighParts.push([limb(legR * 0.95, legR * 0.68, 0.44), o.skin]);
  const shinColor = legs === 'pants' ? o.pants : o.skin;
  const shinParts: Part[] = [
    [limb(legR * 0.72, legR * 0.55, 0.4), shinColor],
    // shoe: sole, upper, toe cap and heel
    [box(0.1, 0.028, 0.27, 0, -0.462, 0.04), 0x1a1a1a],
    [box(0.09, 0.065, 0.19, 0, -0.415, 0.02), o.shoes],
    [new THREE.SphereGeometry(0.048, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1.2).translate(0, -0.448, 0.12), o.shoes],
    [box(0.085, 0.03, 0.02, 0, -0.43, -0.085), darker(o.shoes, 0.75)],
  ];
  if (legs === 'pants') shinParts.push([new THREE.TorusGeometry(legR * 0.6, 0.01, 5, 14).rotateX(Math.PI / 2).translate(0, -0.37, 0), darker(o.pants, 0.85)]);

  return {
    pelvis: merge(pelvisParts),
    torso: merge(torsoParts),
    neck,
    head: merge(headParts),
    upperArmL: upperArm(1),
    upperArmR: upperArm(-1),
    foreArmL: foreArm(1),
    foreArmR: foreArm(-1),
    thigh: merge(thighParts),
    shin: merge(shinParts),
    shoulderX: (fem ? 0.205 : 0.235) * b,
    hipX: (fem ? 0.1 : 0.095) * b,
  };
}
