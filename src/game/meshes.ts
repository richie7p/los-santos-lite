import * as THREE from 'three';
import { WeaponId } from './types';

export interface CharacterRig {
  root: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  gunGroup: THREE.Group;
  muzzleFlash: THREE.Mesh;
  hpBarBg?: THREE.Mesh;
  hpBarFill?: THREE.Mesh;
}

export function createCharacterRig(opts: {
  suitColor: number;
  shirtColor: number;
  skinColor: number;
  hairColor: number;
  isCop?: boolean;
  isSwat?: boolean;
  showHpBar?: boolean;
}): CharacterRig {
  const root = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: opts.skinColor, roughness: 0.65 });
  const suitMat = new THREE.MeshStandardMaterial({
    color: opts.isSwat ? 0x111827 : opts. isCop ? 0x1e3a8a : opts.suitColor,
    roughness: 0.55,
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: opts.isSwat ? 0x374151 : opts.isCop ? 0x1e40af : opts.shirtColor,
    roughness: 0.6,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: opts.isSwat ? 0x09090b : opts.isCop ? 0x0f172a : 0x18181b,
    roughness: 0.7,
  });

  // Legs
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.2, 0.85, 0);
  const leftLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, 0.3), pantsMat);
  leftLegMesh.position.y = -0.42;
  leftLegMesh.castShadow = true;
  leftLeg.add(leftLegMesh);
  root.add(leftLeg);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.2, 0.85, 0);
  const rightLegMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.85, 0.3), pantsMat);
  rightLegMesh.position.y = -0.42;
  rightLegMesh.castShadow = true;
  rightLeg.add(rightLegMesh);
  root.add(rightLeg);

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.92, 0.42), suitMat);
  torso.position.set(0, 1.31, 0);
  torso.castShadow = true;
  root.add(torso);

  // Chest accent / vest / tie
  const chestVest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.82, 0.45), shirtMat);
  chestVest.position.set(0, 1.31, 0.01);
  root.add(chestVest);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.48), skinMat);
  head.position.set(0, 2.06, 0);
  head.castShadow = true;
  root.add(head);

  // Sunglasses / Visor (faces +Z forward)
  const glassesMat = new THREE.MeshStandardMaterial({
    color: opts.isSwat ? 0x38bdf8 : 0x09090b,
    metalness: 0.8,
    roughness: 0.2,
  });
  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.1), glassesMat);
  glasses.position.set(0, 2.08, 0.22);
  root.add(glasses);

  // Hair or Tactical Helmet
  const hairMat = new THREE.MeshStandardMaterial({
    color: opts.isSwat ? 0x18181b : opts.isCop ? 0x1e3a8a : opts.hairColor,
    roughness: 0.6,
  });
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, opts.isSwat || opts.isCop ? 0.22 : 0.16, 0.54),
    hairMat
  );
  hair.position.set(0, 2.28, 0);
  root.add(hair);

  // Arms
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.52, 1.68, 0);
  const leftArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), suitMat);
  leftArmMesh.position.y = -0.34;
  leftArmMesh.castShadow = true;
  leftArm.add(leftArmMesh);
  root.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.52, 1.68, 0);
  const rightArmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), suitMat);
  rightArmMesh.position.y = -0.34;
  rightArmMesh.castShadow = true;
  rightArm.add(rightArmMesh);

  // Gun Group attached to right hand
  const gunGroup = new THREE.Group();
  gunGroup.position.set(0, -0.62, 0.26);

  const gunBodyMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.75,
    roughness: 0.3,
  });
  const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.68), gunBodyMat);
  gunBarrel.position.set(0, 0, 0.22);
  gunGroup.add(gunBarrel);

  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.95,
  });
  const muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), flashMat);
  muzzleFlash.position.set(0, 0.02, 0.64);
  muzzleFlash.visible = false;
  gunGroup.add(muzzleFlash);

  rightArm.add(gunGroup);
  root.add(rightArm);

  let hpBarBg: THREE.Mesh | undefined;
  let hpBarFill: THREE.Mesh | undefined;

  if (opts.showHpBar) {
    hpBarBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.11),
      new THREE.MeshBasicMaterial({ color: 0x09090b, side: THREE.DoubleSide })
    );
    hpBarBg.position.set(0, 2.65, 0);
    root.add(hpBarBg);

    hpBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.91, 0.075),
      new THREE.MeshBasicMaterial({
        color: opts.isCop || opts.isSwat ? 0x38bdf8 : 0xef4444,
        side: THREE.DoubleSide,
      })
    );
    hpBarFill.position.set(0, 2.65, 0.01);
    root.add(hpBarFill);
  }

  return {
    root,
    head,
    torso,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    gunGroup,
    muzzleFlash,
    hpBarBg,
    hpBarFill,
  };
}

export function updateRigWeaponVisual(rig: CharacterRig, weapon: WeaponId) {
  rig.gunGroup.visible = weapon !== 'unarmed';
  const barrel = rig.gunGroup.children[0] as THREE.Mesh | undefined;
  if (!barrel) return;
  if (weapon === 'pistol') {
    barrel.scale.set(0.85, 0.85, 0.55);
  } else if (weapon === 'smg') {
    barrel.scale.set(0.95, 1.0, 0.78);
  } else if (weapon === 'shotgun' || weapon === 'rifle') {
    barrel.scale.set(1.0, 1.0, 1.25);
  } else if (weapon === 'sniper') {
    barrel.scale.set(0.95, 1.05, 1.65);
  } else if (weapon === 'rpg') {
    barrel.scale.set(1.85, 1.85, 1.8);
  } else if (weapon === 'minigun') {
    barrel.scale.set(2.1, 2.0, 1.55);
  }
}

export interface VehicleRig {
  root: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  wheels: THREE.Mesh[];
  sirenLeft?: THREE.Mesh;
  sirenRight?: THREE.Mesh;
  smokeGroup: THREE.Group;
}

export function createVehicleMesh(opts: {
  color: number;
  kind: 'sport' | 'sedan' | 'suv' | 'police' | 'swat';
}): VehicleRig {
  const root = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: opts.kind === 'police' ? 0x0f172a : opts.kind === 'swat' ? 0x18181b : opts.color,
    metalness: 0.62,
    roughness: 0.28,
  });

  const width = opts.kind === 'swat' ? 2.55 : opts.kind === 'suv' ? 2.35 : 2.2;
  const length = opts.kind === 'swat' ? 5.6 : opts.kind === 'sport' ? 4.75 : 4.9;
  const chassisH = opts.kind === 'swat' ? 1.35 : opts.kind === 'sport' ? 0.72 : 0.86;

  // Lower chassis
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(width, chassisH, length),
    bodyMat
  );
  chassis.position.y = 0.42 + chassisH * 0.5;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  root.add(chassis);

  // White police doors or racing stripes
  if (opts.kind === 'police') {
    const whiteDoor = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.03, chassisH * 0.88, length * 0.44),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 })
    );
    whiteDoor.position.set(0, chassis.position.y, 0);
    root.add(whiteDoor);
  } else if (opts.kind === 'sport') {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.04, length * 0.96),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 })
    );
    stripe.position.set(0, chassis.position.y + chassisH * 0.5 + 0.01, 0);
    root.add(stripe);
  }

  // Cabin
  const cabinH = opts.kind === 'swat' ? 0.95 : opts.kind === 'sport' ? 0.56 : 0.72;
  const cabinL = opts.kind === 'swat' ? length * 0.78 : length * 0.52;
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0x09090b,
    metalness: 0.85,
    roughness: 0.15,
  });
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.86, cabinH, cabinL),
    cabinMat
  );
  cabin.position.set(0, chassis.position.y + chassisH * 0.5 + cabinH * 0.5 - 0.04, -0.2);
  cabin.castShadow = true;
  root.add(cabin);

  // Headlights (+Z front)
  const headLightMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
  [-width * 0.34, width * 0.34].forEach((lx) => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.08), headLightMat);
    hl.position.set(lx, 0.74, length * 0.5 + 0.01);
    root.add(hl);
  });

  // Taillights (-Z rear)
  const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  [-width * 0.34, width * 0.34].forEach((lx) => {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), tailLightMat);
    tl.position.set(lx, 0.76, -length * 0.5 - 0.01);
    root.add(tl);
  });

  // Police / SWAT Siren Lightbar
  let sirenLeft: THREE.Mesh | undefined;
  let sirenRight: THREE.Mesh | undefined;
  if (opts.kind === 'police' || opts.kind === 'swat') {
    const sirenY = cabin.position.y + cabinH * 0.5 + 0.1;
    sirenLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.16, 0.26),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    sirenLeft.position.set(-0.32, sirenY, 0.1);
    root.add(sirenLeft);

    sirenRight = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.16, 0.26),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6 })
    );
    sirenRight.position.set(0.32, sirenY, 0.1);
    root.add(sirenRight);
  }

  // Wheels
  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });

  const wheelPositions: [number, number, number][] = [
    [-width * 0.5, 0.42, length * 0.31],
    [width * 0.5, 0.42, length * 0.31],
    [-width * 0.5, 0.42, -length * 0.31],
    [width * 0.5, 0.42, -length * 0.31],
  ];

  for (const [wx, wy, wz] of wheelPositions) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, wy, wz);
    w.castShadow = true;
    root.add(w);
    wheels.push(w);
  }

  // Smoke emitter holder when damaged
  const smokeGroup = new THREE.Group();
  smokeGroup.position.set(0, 1.1, length * 0.35);
  const smokePuff = new THREE.Mesh(
    new THREE.SphereGeometry(0.65, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x27272a, transparent: true, opacity: 0.65 })
  );
  smokeGroup.add(smokePuff);
  smokeGroup.visible = false;
  root.add(smokeGroup);

  return { root, bodyMat, wheels, sirenLeft, sirenRight, smokeGroup };
}

export interface HelicopterRig {
  root: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Mesh;
  searchlight: THREE.Mesh;
  sirenMesh: THREE.Mesh;
}

export function createPoliceHelicopterMesh(): HelicopterRig {
  const root = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.65,
    roughness: 0.3,
  });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    metalness: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.72,
  });

  // Cabin fuselage
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 4.4), bodyMat);
  root.add(cabin);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.45, 3.8), whiteMat);
  stripe.position.set(0, -0.1, 0);
  root.add(stripe);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.3, 1.7), glassMat);
  cockpit.position.set(0, 0.1, 1.85);
  root.add(cockpit);

  // Tail boom
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.7, 5.2), bodyMat);
  tail.position.set(0, 0.25, -4.4);
  root.add(tail);

  // Landing skids
  [-1.1, 1.1].forEach((sx) => {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 4.2), whiteMat);
    skid.position.set(sx, -1.35, 0.2);
    root.add(skid);
  });

  // Main rotor
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.18, 0);
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0x18181b });
  const blade1 = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.06, 0.36), bladeMat);
  const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 9.8), bladeMat);
  mainRotor.add(blade1, blade2);
  root.add(mainRotor);

  // Tail rotor
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.9, 0.24), bladeMat);
  tailRotor.position.set(0.4, 0.35, -6.8);
  root.add(tailRotor);

  // Searchlight beam cone pointing down
  const coneGeo = new THREE.ConeGeometry(8.5, 28, 16, 1, true);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const searchlight = new THREE.Mesh(coneGeo, coneMat);
  searchlight.position.set(0, -14.8, 2.2);
  root.add(searchlight);

  const sirenMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xef4444 })
  );
  sirenMesh.position.set(0, -0.98, 1.4);
  root.add(sirenMesh);

  return { root, mainRotor, tailRotor, searchlight, sirenMesh };
}

export function createPalmTreeMesh(): THREE.Group {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 7.2, 7), trunkMat);
  trunk.position.y = 3.6;
  trunk.castShadow = true;
  g.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.65 });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.14, 2.8), leafMat);
    frond.position.set(Math.sin(angle) * 1.25, 7.1, Math.cos(angle) * 1.25);
    frond.rotation.y = angle;
    frond.rotation.x = 0.38;
    g.add(frond);
  }
  return g;
}

export function createExplosiveBarrelMesh(): THREE.Group {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.52, 1.35, 12),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4, metalness: 0.3 })
  );
  barrel.position.y = 0.68;
  barrel.castShadow = true;
  g.add(barrel);

  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.53, 0.53, 0.24, 12),
    new THREE.MeshBasicMaterial({ color: 0xfacc15 })
  );
  stripe.position.y = 0.72;
  g.add(stripe);
  return g;
}
