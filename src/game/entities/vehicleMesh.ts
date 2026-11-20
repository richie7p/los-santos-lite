/** Procedural vehicle models built from extruded side profiles. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type VehicleSpec, type VehicleType, VEHICLES } from '../data';
import { signTexture } from '../world/textures';

export interface VehicleRig {
  root: THREE.Group;
  body: THREE.Group; // pitch / roll applied here
  wheels: { pivot: THREE.Group; spin: THREE.Group; front: boolean; x: number; z: number }[];
  paint: THREE.MeshPhysicalMaterial;
  brake: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  sirenR?: THREE.MeshStandardMaterial;
  sirenB?: THREE.MeshStandardMaterial;
  driverSeat: THREE.Vector3;
  /** Seated figures shown through the glass. */
  driver: THREE.Mesh;
  driverPlayer: THREE.Mesh;
  passenger: THREE.Mesh;
  rotor?: THREE.Object3D;
  tailRotor?: THREE.Object3D;
}

interface Cached {
  paint: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
}
const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const cache = new Map<VehicleType, Cached>();

const glassMat = new THREE.MeshStandardMaterial({ color: 0x22303d, metalness: 0.35, roughness: 0.06, transparent: true, opacity: 0.74, depthWrite: false });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.55, metalness: 0.2 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.15 });
/** Tyre + rim merged into one vertex-coloured mesh (one draw call per wheel). */
const wheelGeo = (() => {
  const colorize = (g: THREE.BufferGeometry, c: number) => {
    const col = new THREE.Color(c);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return ni(g);
  };
  return mergeGeometries([
    colorize(new THREE.CylinderGeometry(1, 1, 1, 20).rotateZ(Math.PI / 2), 0x141414),
    colorize(new THREE.CylinderGeometry(0.62, 0.62, 1.04, 10).rotateZ(Math.PI / 2), 0xc9ced3),
  ])!;
})();
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.45 });
let taxiSign: THREE.MeshStandardMaterial | null = null;
const policeStripeMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1a33, metalness: 0.5, roughness: 0.3, clearcoat: 1 });
const checkerMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4ac0d });
const geoCache = new Map<string, THREE.BufferGeometry>();
function cg(key: string, fn: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = fn()));
  return g;
}

// ---- seated figures (one merged, vertex-coloured mesh each)
const DRIVER_LOOKS: [number, number, number][] = [
  // skin, shirt, hair
  [0xe0ac69, 0x2e86c1, 0x1b1b1b],
  [0x8d5524, 0xc0392b, 0x111111],
  [0xf1c27d, 0x27ae60, 0x6a4e2a],
  [0xc68642, 0x34495e, 0x2a2a2a],
  [0xffdbac, 0x8e44ad, 0xb08850],
  [0xd9a066, 0xecf0f1, 0x3b2a1a],
];
const POLICE_LOOK: [number, number, number] = [0xc68642, 0x1f3a5f, 0x14213d];
const PLAYER_LOOK: [number, number, number] = [0xd9a066, 0x23303d, 0x1b1b1b];
const figureMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
function figureGeometry(look: [number, number, number]) {
  return cg(`fig${look.join('_')}`, () => {
    const paint = (g: THREE.BufferGeometry, c: number) => {
      const col = new THREE.Color(c);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return ni(g);
    };
    const [skin, shirt, hair] = look;
    return mergeGeometries([
      paint(new THREE.CapsuleGeometry(0.17, 0.26, 3, 8).scale(1.25, 1, 0.8).translate(0, 0.36, -0.05), shirt),
      paint(new THREE.SphereGeometry(0.115, 10, 8).scale(0.95, 1.08, 1).translate(0, 0.78, 0), skin),
      paint(new THREE.SphereGeometry(0.122, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.8, -0.01), hair),
      paint(new THREE.CapsuleGeometry(0.05, 0.36, 3, 6).rotateX(-1.2).translate(0.2, 0.42, 0.2), shirt),
      paint(new THREE.CapsuleGeometry(0.05, 0.36, 3, 6).rotateX(-1.2).translate(-0.2, 0.42, 0.2), shirt),
      paint(new THREE.TorusGeometry(0.16, 0.02, 4, 14).rotateX(-0.9).translate(0, 0.5, 0.42), 0x151515),
    ])!;
  });
}
function figure(look: [number, number, number], x: number, y: number, z: number) {
  const m = new THREE.Mesh(figureGeometry(look), figureMat);
  m.position.set(x, y, z);
  m.visible = false;
  return m;
}

// ---- helicopter
function createHeliRig(color: number): VehicleRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.5, roughness: 0.5 });
  const cabin = new THREE.Mesh(cg('heliBody', () => new THREE.SphereGeometry(1.35, 18, 14).scale(1, 0.95, 1.75).translate(0, 1.5, 0.6)), paint);
  const glass = new THREE.Mesh(
    cg('heliGlass', () => new THREE.SphereGeometry(1.15, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.9, 1.25).rotateX(0.55).translate(0, 1.75, 1.6)),
    glassMat,
  );
  const boom = new THREE.Mesh(cg('heliBoom', () => new THREE.CylinderGeometry(0.16, 0.38, 5.6, 10).rotateX(Math.PI / 2).translate(0, 1.85, -3.6)), paint);
  const fin = new THREE.Mesh(cg('heliFin', () => new THREE.BoxGeometry(0.1, 1.4, 0.9).translate(0, 2.4, -6.2)), paint);
  const stab = new THREE.Mesh(cg('heliStab', () => new THREE.BoxGeometry(1.8, 0.08, 0.5).translate(0, 1.95, -5.6)), paint);
  const skids = new THREE.Mesh(
    cg('heliSkids', () =>
      mergeGeometries([
        ni(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6).rotateX(Math.PI / 2).translate(0.95, 0.06, 0.5)),
        ni(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6).rotateX(Math.PI / 2).translate(-0.95, 0.06, 0.5)),
        ni(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5).rotateZ(0.35).translate(0.8, 0.45, 1.3)),
        ni(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5).rotateZ(-0.35).translate(-0.8, 0.45, 1.3)),
        ni(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5).rotateZ(0.35).translate(0.8, 0.45, -0.3)),
        ni(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5).rotateZ(-0.35).translate(-0.8, 0.45, -0.3)),
      ])!,
    ),
    dark,
  );
  const mast = new THREE.Mesh(cg('heliMast', () => new THREE.CylinderGeometry(0.12, 0.16, 0.6, 8).translate(0, 2.95, 0.4)), dark);
  for (const m of [cabin, glass, boom, fin, stab, skids, mast]) {
    m.castShadow = true;
    body.add(m);
  }
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.25, 0.4);
  const bladeGeo = cg('heliBlade', () => new THREE.BoxGeometry(0.28, 0.04, 5.4).translate(0, 0, 2.7));
  for (let k = 0; k < 4; k++) {
    const b = new THREE.Mesh(bladeGeo, dark);
    b.rotation.y = (k * Math.PI) / 2;
    b.castShadow = true;
    rotor.add(b);
  }
  body.add(rotor);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.18, 2.4, -6.2);
  for (let k = 0; k < 2; k++) {
    const b = new THREE.Mesh(cg('heliTailBlade', () => new THREE.BoxGeometry(0.04, 1.4, 0.14)), dark);
    b.rotation.x = (k * Math.PI) / 2;
    tailRotor.add(b);
  }
  body.add(tailRotor);
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
  const brake = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.6 });
  const nav = new THREE.Mesh(cg('heliNav', () => new THREE.SphereGeometry(0.08, 6, 4).translate(0, 2.2, -6.65)), brake);
  const land = new THREE.Mesh(cg('heliLand', () => new THREE.SphereGeometry(0.12, 6, 4).translate(0, 0.7, 2.6)), head);
  body.add(nav, land);
  const seat = new THREE.Vector3(-0.35, 0.95, 1.3);
  const driver = figure(DRIVER_LOOKS[0], seat.x, seat.y, seat.z);
  const driverPlayer = figure(PLAYER_LOOK, seat.x, seat.y, seat.z);
  const passenger = figure(DRIVER_LOOKS[1], -seat.x, seat.y, seat.z);
  body.add(driver, driverPlayer, passenger);
  return { root, body, wheels: [], paint, brake, head, driverSeat: seat, driver, driverPlayer, passenger, rotor, tailRotor };
}

function profileLower(s: VehicleSpec) {
  const L = s.length;
  const hl = L / 2;
  const clr = s.wheelR * 0.75;
  const R = s.wheelR + 0.06;
  const wy = s.wheelR;
  const fx = s.wheelbase / 2;
  const rx = -s.wheelbase / 2;
  const sh = new THREE.Shape();
  sh.moveTo(-hl + 0.12, clr + 0.05);
  sh.lineTo(rx - R, clr);
  sh.absarc(rx, wy, R, Math.PI, 0, true);
  sh.lineTo(fx - R, clr);
  sh.absarc(fx, wy, R, Math.PI, 0, true);
  sh.lineTo(hl - 0.12, clr + 0.05);
  sh.quadraticCurveTo(hl + 0.02, clr + 0.1, hl, clr + 0.35);
  const noseTop = s.boxy ? s.hood - 0.05 : s.hood - 0.16;
  sh.quadraticCurveTo(hl + 0.02, noseTop, hl - 0.15, noseTop + 0.02);
  // hood up to windshield base
  sh.lineTo(hl - s.hoodLen, s.hood);
  // beltline to trunk
  sh.lineTo(-hl + Math.max(0.15, s.trunkLen), s.hood + 0.02);
  sh.lineTo(-hl + 0.08, s.hood - (s.boxy ? 0.02 : 0.08));
  sh.quadraticCurveTo(-hl - 0.02, s.hood - 0.2, -hl, clr + 0.3);
  sh.quadraticCurveTo(-hl - 0.02, clr + 0.08, -hl + 0.12, clr + 0.05);
  return sh;
}

function profileCabin(s: VehicleSpec) {
  const hl = s.length / 2;
  const front = hl - s.hoodLen;
  const roofFront = front - (s.boxy ? 0.25 : 0.75);
  const roofRear = roofFront - s.roofLen;
  const rear = s.trunkLen <= 0.2 ? -hl + 0.05 : Math.max(-hl + s.trunkLen, roofRear - 0.55);
  const sh = new THREE.Shape();
  sh.moveTo(front, s.hood);
  sh.lineTo(roofFront, s.height - 0.04);
  sh.lineTo(roofRear, s.height - 0.04);
  sh.lineTo(rear, s.hood + 0.02);
  sh.lineTo(front, s.hood);
  return { sh, roofFront, roofRear };
}

function extrude(shape: THREE.Shape, width: number, bevel: number) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.1, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  // profile X -> car Z (forward), extrusion Z -> car X (sideways)
  g.rotateY(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function buildCached(t: VehicleType): Cached {
  const s = VEHICLES[t];
  const lower = extrude(profileLower(s), s.width, 0.08);
  const { sh, roofFront, roofRear } = profileCabin(s);
  const cabin = extrude(sh, s.width * 0.86, 0.05);
  const roofW = s.width * 0.82;
  const roof = new THREE.BoxGeometry(roofW, 0.07, roofFront - roofRear + 0.05).translate(0, s.height - 0.02, (roofFront + roofRear) / 2);
  const hl = s.length / 2;
  const trimParts = [
    // front grille & bumpers
    new THREE.BoxGeometry(s.width * 0.6, 0.18, 0.06).translate(0, s.wheelR * 0.75 + 0.3, hl + 0.01),
    new THREE.BoxGeometry(s.width * 0.96, 0.12, 0.12).translate(0, s.wheelR * 0.75 + 0.12, hl - 0.02),
    new THREE.BoxGeometry(s.width * 0.96, 0.12, 0.12).translate(0, s.wheelR * 0.75 + 0.12, -hl + 0.02),
    // side skirts
    new THREE.BoxGeometry(0.06, 0.1, s.wheelbase - s.wheelR * 2.4).translate(s.width / 2 - 0.02, s.wheelR * 0.8, 0),
    new THREE.BoxGeometry(0.06, 0.1, s.wheelbase - s.wheelR * 2.4).translate(-s.width / 2 + 0.02, s.wheelR * 0.8, 0),
    // mirrors
    new THREE.BoxGeometry(0.22, 0.12, 0.1).translate(s.width / 2 + 0.06, s.hood + 0.12, hl - s.hoodLen - 0.15),
    new THREE.BoxGeometry(0.22, 0.12, 0.1).translate(-s.width / 2 - 0.06, s.hood + 0.12, hl - s.hoodLen - 0.15),
  ];
  if (t === 'pickup') {
    // bed walls
    const bedLen = s.trunkLen - 0.1;
    trimParts.push(new THREE.BoxGeometry(s.width * 0.9, 0.05, bedLen).translate(0, s.hood - 0.05, -hl + bedLen / 2 + 0.05));
  }
  const trim = mergeGeometries(trimParts.map(ni))!;
  const paintParts = [ni(lower), ni(roof)];
  if (s.boxy) {
    const front = hl - s.hoodLen - 0.9;
    const len = front + hl - 0.05;
    paintParts.push(ni(new THREE.BoxGeometry(s.width * 0.98, s.height - s.hood + 0.02, len).translate(0, (s.height + s.hood) / 2, front - len / 2)));
  }
  const paint = mergeGeometries(paintParts)!;
  const lightY = s.hood - (s.boxy ? 0.2 : 0.22);
  const head = mergeGeometries([-1, 1].map((sx) => ni(new THREE.BoxGeometry(0.34, 0.12, 0.08).translate(sx * (s.width / 2 - 0.3), lightY, hl - 0.02))))!;
  const tail = mergeGeometries([-1, 1].map((sx) => ni(new THREE.BoxGeometry(0.36, 0.13, 0.06).translate(sx * (s.width / 2 - 0.28), lightY + 0.04, -hl + 0.02))))!;
  const c = { paint, cabin, trim, head, tail };
  cache.set(t, c);
  return c;
}

export function createVehicleRig(t: VehicleType, color: number): VehicleRig {
  if (t === 'heli') return createHeliRig(color);
  const s = VEHICLES[t];
  const geo = cache.get(t) ?? buildCached(t);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: t === 'armored' ? 0.3 : 0.55,
    roughness: t === 'armored' ? 0.6 : 0.32,
    clearcoat: t === 'armored' ? 0 : 1,
    clearcoatRoughness: 0.08,
  });
  const lower = new THREE.Mesh(geo.paint, paint);
  const cabin = new THREE.Mesh(geo.cabin, glassMat);
  const trim = new THREE.Mesh(geo.trim, trimMat);
  for (const m of [lower, cabin, trim]) {
    m.castShadow = true;
    m.receiveShadow = true;
    body.add(m);
  }

  // police two-tone: black lower doors stripe
  if (t === 'police') {
    const stripe = new THREE.Mesh(
      cg('pstripe', () => new THREE.BoxGeometry(s.width + 0.02, 0.32, s.length * 0.5)),
      policeStripeMat,
    );
    stripe.position.set(0, s.hood - 0.3, -0.1);
    body.add(stripe);
  }

  const hl = s.length / 2;
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.4 });
  const brake = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.4 });
  body.add(new THREE.Mesh(geo.head, head), new THREE.Mesh(geo.tail, brake));

  let sirenR: THREE.MeshStandardMaterial | undefined;
  let sirenB: THREE.MeshStandardMaterial | undefined;
  const { roofFront, roofRear } = profileCabin(s);
  if (t === 'police') {
    sirenR = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0022, emissiveIntensity: 0 });
    sirenB = new THREE.MeshStandardMaterial({ color: 0x000055, emissive: 0x0044ff, emissiveIntensity: 0 });
    const bar = new THREE.Group();
    const base = new THREE.Mesh(cg('barbase', () => new THREE.BoxGeometry(1.2, 0.08, 0.3)), chromeMat);
    const r = new THREE.Mesh(cg('siren', () => new THREE.BoxGeometry(0.55, 0.12, 0.26)), sirenR);
    const b = new THREE.Mesh(cg('siren', () => new THREE.BoxGeometry(0.55, 0.12, 0.26)), sirenB);
    r.position.set(-0.3, 0.09, 0);
    b.position.set(0.3, 0.09, 0);
    bar.add(base, r, b);
    bar.position.set(0, s.height + 0.04, (roofFront + roofRear) / 2);
    body.add(bar);
  }
  if (t === 'taxi') {
    taxiSign ??= (() => {
      const tex = signTexture('TAXI', '#111', '#ffd400', 256, 96);
      return new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 });
    })();
    const sign = new THREE.Mesh(cg('taxisign', () => new THREE.BoxGeometry(0.7, 0.24, 0.3)), taxiSign);
    sign.position.set(0, s.height + 0.12, (roofFront + roofRear) / 2);
    body.add(sign);
    // checker stripe
    const ch = new THREE.Mesh(cg('checker', () => new THREE.BoxGeometry(s.width + 0.02, 0.12, s.length * 0.62)), checkerMat);
    ch.position.set(0, s.hood - 0.12, 0);
    body.add(ch);
  }
  if (t === 'armored') {
    const front = hl - s.hoodLen - 0.9;
    const len = front + hl - 0.05;
    const stripe = new THREE.Mesh(cg('gold' + t, () => new THREE.BoxGeometry(s.width + 0.02, 0.25, len * 0.8)), goldMat);
    stripe.position.set(0, s.hood + 0.55, front - len / 2);
    body.add(stripe);
  }

  const wheels: VehicleRig['wheels'] = [];
  const wz = s.wheelbase / 2;
  const wx = s.width / 2 - 0.16;
  const tw = s.type === 'armored' ? 0.38 : 0.28;
  for (const [x, z, front] of [
    [-wx, wz, true],
    [wx, wz, true],
    [-wx, -wz, false],
    [wx, -wz, false],
  ] as [number, number, boolean][]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, s.wheelR, z);
    const spin = new THREE.Group();
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.scale.set(tw, s.wheelR, s.wheelR);
    wheel.castShadow = true;
    spin.add(wheel);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, front, x, z });
  }

  const seat = new THREE.Vector3(-s.width * 0.22, s.hood - 0.5, hl - s.hoodLen - 0.95);
  const look = t === 'police' ? POLICE_LOOK : DRIVER_LOOKS[Math.floor(Math.random() * DRIVER_LOOKS.length)];
  const driver = figure(look, seat.x, seat.y, seat.z);
  const driverPlayer = figure(PLAYER_LOOK, seat.x, seat.y, seat.z);
  const passenger = figure(t === 'police' ? POLICE_LOOK : DRIVER_LOOKS[Math.floor(Math.random() * DRIVER_LOOKS.length)], -seat.x, seat.y, seat.z);
  body.add(driver, driverPlayer, passenger);
  return { root, body, wheels, paint, brake, head, sirenR, sirenB, driverSeat: seat, driver, driverPlayer, passenger };
}

export function disposeVehicleRig(r: VehicleRig) {
  r.paint.dispose();
  r.brake.dispose();
  r.head.dispose();
  r.sirenR?.dispose();
  r.sirenB?.dispose();
  r.root.removeFromParent();
}
