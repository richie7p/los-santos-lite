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

function shareMat(color: number, extra?: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
}

/**
 * Creates a detailed 3D character rig facing -Z at rotation.y = 0.
 */
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

  const skinM = shareMat(opts.skinColor, { roughness: 0.52 });
  const suitM = shareMat(opts.isSwat ? 0x18181b : opts.isCop ? 0x1e3a8a : opts.suitColor, {
    roughness: 0.58,
  });
  const shirtM = shareMat(opts.isSwat ? 0x334155 : opts.isCop ? 0x2563eb : opts.shirtColor, {
    roughness: 0.62,
  });
  const pantsM = shareMat(opts.isSwat ? 0x09090b : opts.isCop ? 0x0f172a : 0x1c2430, {
    roughness: 0.72,
  });
  const hairM = shareMat(opts.isSwat ? 0x111827 : opts.isCop ? 0x172554 : opts.hairColor, {
    roughness: 0.78,
  });
  const shoeM = shareMat(0x18181b, { roughness: 0.55 });
  const visorM = shareMat(opts.isSwat ? 0x38bdf8 : 0x09090b, {
    metalness: 0.8,
    roughness: 0.2,
  });

  // Hips
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.26), pantsM);
  hips.position.y = 0.76;
  root.add(hips);

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.56, 0.29), suitM);
  torso.position.y = 1.14;
  root.add(torso);

  // Tactical Vest / Inner Shirt Accent
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.31), shirtM);
  vest.position.set(0, 1.14, -0.01);
  root.add(vest);

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8), skinM);
  neck.position.y = 1.45;
  root.add(neck);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.33, 0.29), skinM);
  head.position.y = 1.64;
  root.add(head);

  // Hair / Helmet
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.33, opts.isSwat || opts.isCop ? 0.16 : 0.12, 0.31),
    hairM
  );
  hair.position.y = 1.8;
  root.add(hair);

  // Sunglasses / Tactical Visor on -Z face
  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.075, 0.05), visorM);
  glasses.position.set(0, 1.65, -0.14);
  root.add(glasses);

  // Left Arm (pivoted at shoulder)
  const leftArm = new THREE.Group();
  leftArm.position.set(-0.32, 1.36, 0);
  const leftSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.14), suitM);
  leftSleeve.position.y = -0.22;
  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), skinM);
  leftHand.position.y = -0.5;
  leftArm.add(leftSleeve, leftHand);
  root.add(leftArm);

  // Right Arm (pivoted at shoulder, holds 3D Weapon)
  const rightArm = new THREE.Group();
  rightArm.position.set(0.32, 1.36, 0);
  const rightSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.14), suitM);
  rightSleeve.position.y = -0.22;
  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), skinM);
  rightHand.position.y = -0.5;
  rightArm.add(rightSleeve, rightHand);

  // 3D Weapon Group attached to Right Hand (points -Z when arm is raised)
  const gunGroup = new THREE.Group();
  gunGroup.position.set(0, -0.5, -0.16);

  const gunMetal = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.78,
    roughness: 0.25,
  });
  const gunAccent = new THREE.MeshStandardMaterial({
    color: 0x475569,
    metalness: 0.65,
    roughness: 0.35,
  });

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.48), gunMetal);
  receiver.position.set(0, 0.03, -0.18);
  receiver.name = 'gunReceiver';
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.38, 8), gunAccent);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.05, -0.42);
  barrel.name = 'gunBarrel';
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), gunAccent);
  mag.position.set(0, -0.08, -0.16);
  mag.rotation.x = 0.2;
  gunGroup.add(receiver, barrel, mag);

  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.95,
  });
  const muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), flashMat);
  muzzleFlash.position.set(0, 0.05, -0.66);
  muzzleFlash.visible = false;
  gunGroup.add(muzzleFlash);

  rightArm.add(gunGroup);
  root.add(rightArm);

  // Left Leg (pivoted at hip)
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.13, 0.7, 0);
  const leftThigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.56, 0.17), pantsM);
  leftThigh.position.y = -0.28;
  const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.25), shoeM);
  leftShoe.position.set(0, -0.6, -0.03);
  leftLeg.add(leftThigh, leftShoe);
  root.add(leftLeg);

  // Right Leg (pivoted at hip)
  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.13, 0.7, 0);
  const rightThigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.56, 0.17), pantsM);
  rightThigh.position.y = -0.28;
  const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.25), shoeM);
  rightShoe.position.set(0, -0.6, -0.03);
  rightLeg.add(rightThigh, rightShoe);
  root.add(rightLeg);

  let hpBarBg: THREE.Mesh | undefined;
  let hpBarFill: THREE.Mesh | undefined;

  if (opts.showHpBar) {
    hpBarBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x09090b, side: THREE.DoubleSide })
    );
    hpBarBg.position.set(0, 2.15, 0);
    root.add(hpBarBg);

    hpBarFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.84, 0.068),
      new THREE.MeshBasicMaterial({
        color: opts.isCop || opts.isSwat ? 0x38bdf8 : 0xef4444,
        side: THREE.DoubleSide,
      })
    );
    hpBarFill.position.set(0, 2.15, 0.01);
    root.add(hpBarFill);
  }

  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o !== muzzleFlash && o !== hpBarBg && o !== hpBarFill) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

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
  if (weapon === 'pistol') {
    rig.gunGroup.scale.set(0.75, 0.75, 0.55);
  } else if (weapon === 'smg') {
    rig.gunGroup.scale.set(0.9, 0.95, 0.8);
  } else if (weapon === 'shotgun' || weapon === 'rifle') {
    rig.gunGroup.scale.set(1.05, 1.05, 1.25);
  } else if (weapon === 'sniper') {
    rig.gunGroup.scale.set(1.0, 1.15, 1.65);
  } else if (weapon === 'rpg') {
    rig.gunGroup.scale.set(1.75, 1.75, 1.8);
  } else if (weapon === 'minigun') {
    rig.gunGroup.scale.set(2.0, 1.9, 1.5);
  }
}

export interface VehicleRig {
  root: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  wheels: THREE.Group[];
  copRed?: THREE.Mesh;
  copBlue?: THREE.Mesh;
  smokeGroup: THREE.Group;
}

/**
 * Creates a detailed 3D car facing -Z at rotation.y = 0.
 */
export function createVehicleMesh(opts: {
  color: number;
  kind: 'sport' | 'sedan' | 'suv' | 'police' | 'swat' | 'taxi' | 'cash_truck';
}): VehicleRig {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';

  const baseColor =
    opts.kind === 'police'
      ? 0xe8eaee
      : opts.kind === 'swat'
        ? 0x18181b
        : opts.kind === 'taxi'
          ? 0xfacc15
          : opts.kind === 'cash_truck'
            ? 0xd97706
            : opts.color;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.32,
    metalness: 0.36,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x141418,
    roughness: 0.48,
    metalness: 0.22,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.24,
    metalness: 0.78,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x6a90a4,
    roughness: 0.12,
    metalness: 0.45,
    transparent: true,
    opacity: 0.52,
  });
  const headLightMat = new THREE.MeshStandardMaterial({
    color: 0xfff2c8,
    emissive: 0xffe08a,
    emissiveIntensity: 1.1,
  });
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0x991b1b,
    emissiveIntensity: 0.65,
  });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 });

  const isHeavy = opts.kind === 'swat' || opts.kind === 'cash_truck';
  const bodyH = isHeavy ? 0.96 : opts.kind === 'sport' ? 0.42 : 0.52;
  const bodyL = isHeavy ? 4.85 : opts.kind === 'sport' ? 4.25 : 4.35;
  const bodyW = isHeavy ? 2.08 : opts.kind === 'sport' ? 1.96 : 1.88;
  const cabinH = isHeavy ? 0.82 : 0.52;
  const cabinL = opts.kind === 'sport' ? 1.48 : isHeavy ? 2.45 : 1.82;

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW - 0.16, 0.16, bodyL * 0.9),
    darkMat
  );
  chassis.position.y = 0.26;
  g.add(chassis);

  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyL), bodyMat);
  body.position.y = 0.52;
  g.add(body);

  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW + 0.06, 0.12, bodyL * 0.74),
    darkMat
  );
  skirt.position.y = 0.34;
  g.add(skirt);

  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW - 0.18, 0.07, bodyL * 0.28),
    bodyMat
  );
  hood.position.set(0, 0.52 + bodyH * 0.5 + 0.02, -bodyL * 0.28);
  g.add(hood);

  // Front (-Z) and Rear (+Z) Bumpers
  const fBumper = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.05, 0.22, 0.2), darkMat);
  fBumper.position.set(0, 0.36, -bodyL / 2 + 0.02);
  g.add(fBumper);

  const rBumper = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.05, 0.22, 0.2), darkMat);
  rBumper.position.set(0, 0.36, bodyL / 2 - 0.02);
  g.add(rBumper);

  // Glass Cabin & Roof
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.22, cabinH, cabinL), glassMat);
  cabin.position.set(0, 0.52 + bodyH * 0.55 + cabinH / 2, opts.kind === 'sport' ? 0.18 : 0.12);
  g.add(cabin);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW - 0.32, 0.06, cabinL * 0.82),
    bodyMat
  );
  roof.position.set(0, cabin.position.y + cabinH / 2, cabin.position.z);
  g.add(roof);

  // Sloped Windshields
  const wind = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.3, 0.4, 0.05), glassMat);
  wind.position.set(0, 0.94, cabin.position.z - cabinL * 0.42);
  wind.rotation.x = -0.48;
  g.add(wind);

  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.34, 0.34, 0.04), glassMat);
  rearGlass.position.set(0, 0.94, cabin.position.z + cabinL * 0.42);
  rearGlass.rotation.x = 0.4;
  g.add(rearGlass);

  // Side Mirrors
  for (const x of [-bodyW * 0.52, bodyW * 0.52]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.2), darkMat);
    mirror.position.set(x, 0.92, -0.14);
    g.add(mirror);
  }

  // Sport Spoiler
  if (opts.kind === 'sport') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(bodyW - 0.26, 0.07, 0.32), bodyMat);
    spoiler.position.set(0, 1.1, bodyL * 0.38);
    g.add(spoiler);
    for (const sx of [-0.5, 0.5]) {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), darkMat);
      stem.position.set(sx, 0.98, bodyL * 0.36);
      g.add(stem);
    }
  }

  // Police / SWAT Lightbar & Stripes
  let copRed: THREE.Mesh | undefined;
  let copBlue: THREE.Mesh | undefined;
  if (opts.kind === 'police' || opts.kind === 'swat') {
    const topY = cabin.position.y + cabinH / 2 + 0.08;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.12, 0.28), darkMat);
    bar.position.set(0, topY, 0.08);
    g.add(bar);

    copRed = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.12, 0.24),
      new THREE.MeshStandardMaterial({
        color: 0xff2a2a,
        emissive: 0xff2222,
        emissiveIntensity: 1.5,
      })
    );
    copRed.position.set(-0.22, topY + 0.08, 0.08);
    g.add(copRed);

    copBlue = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.12, 0.24),
      new THREE.MeshStandardMaterial({
        color: 0x2266ff,
        emissive: 0x2266ff,
        emissiveIntensity: 1.5,
      })
    );
    copBlue.position.set(0.22, topY + 0.08, 0.08);
    g.add(copBlue);

    if (opts.kind === 'police') {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW + 0.04, 0.14, 2.3),
        new THREE.MeshStandardMaterial({ color: 0x1d4ed8 })
      );
      stripe.position.set(0, 0.62, 0);
      g.add(stripe);
    }
  }

  // Headlights (-Z) & Taillights (+Z)
  for (const sx of [-0.56, 0.56]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.13, 0.08), headLightMat);
    hl.position.set(sx, 0.52, -bodyL / 2 + 0.02);
    g.add(hl);

    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.11, 0.06), tailLightMat);
    tl.position.set(sx, 0.54, bodyL / 2 - 0.02);
    g.add(tl);
  }

  // 4 Wheels with Tires + Metallic Rims
  const wheels: THREE.Group[] = [];
  const wheelY = isHeavy ? 0.36 : 0.32;
  for (const wz of [-bodyL * 0.33, bodyL * 0.33]) {
    for (const wx of [-bodyW * 0.43, bodyW * 0.43]) {
      const wh = new THREE.Group();
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14),
        rubberMat
      );
      tire.rotation.z = Math.PI / 2;
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10),
        chromeMat
      );
      rim.rotation.z = Math.PI / 2;
      wh.add(tire, rim);
      wh.position.set(wx, wheelY, wz);
      g.add(wh);
      wheels.push(wh);
    }
  }

  // Smoke Group for vehicle damage
  const smokeGroup = new THREE.Group();
  smokeGroup.position.set(0, 0.95, -bodyL * 0.35);
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x27272a, transparent: true, opacity: 0.68 })
  );
  smokeGroup.add(puff);
  smokeGroup.visible = false;
  g.add(smokeGroup);

  g.traverse((o) => {
    if (o instanceof THREE.Mesh && o !== puff) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return { root: g, bodyMat, wheels, copRed, copBlue, smokeGroup };
}

export interface HelicopterRig {
  root: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Mesh;
  searchlight: THREE.Mesh;
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
    metalness: 0.85,
    roughness: 0.15,
    transparent: true,
    opacity: 0.72,
  });

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.85, 4.3), bodyMat);
  root.add(cabin);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.42, 3.7), whiteMat);
  stripe.position.set(0, -0.1, 0);
  root.add(stripe);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.25, 1.65), glassMat);
  cockpit.position.set(0, 0.1, -1.85);
  root.add(cockpit);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.65, 5.0), bodyMat);
  tail.position.set(0, 0.25, 4.3);
  root.add(tail);

  [-1.05, 1.05].forEach((sx) => {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 4.1), whiteMat);
    skid.position.set(sx, -1.3, -0.2);
    root.add(skid);
  });

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.15, 0);
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0x18181b });
  mainRotor.add(
    new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.06, 0.34), bladeMat),
    new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 9.6), bladeMat)
  );
  root.add(mainRotor);

  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.85, 0.22), bladeMat);
  tailRotor.position.set(0.38, 0.35, 6.6);
  root.add(tailRotor);

  const coneGeo = new THREE.ConeGeometry(8.0, 26, 16, 1, true);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const searchlight = new THREE.Mesh(coneGeo, coneMat);
  searchlight.position.set(0, -13.8, -1.8);
  root.add(searchlight);

  return { root, mainRotor, tailRotor, searchlight };
}

export function createTreeMesh(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.24, 1.6, 7),
    new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.9 })
  );
  trunk.position.y = 0.8;
  g.add(trunk);

  const leafM = new THREE.MeshStandardMaterial({ color: 0x2f7a48, roughness: 0.76 });
  const leaf1 = new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.1, 8), leafM);
  leaf1.position.y = 2.2;
  const leaf2 = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.5, 8), leafM);
  leaf2.position.y = 2.95;
  g.add(leaf1, leaf2);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export function createLampMesh(): THREE.Group {
  const g = new THREE.Group();
  const poleM = new THREE.MeshStandardMaterial({
    color: 0x2a3038,
    roughness: 0.45,
    metalness: 0.4,
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6), poleM);
  pole.position.y = 2.6;
  g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.1), poleM);
  arm.position.set(0, 5.1, -0.4);
  g.add(arm);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffe6a8,
      emissive: 0xffc86a,
      emissiveIntensity: 1.5,
    })
  );
  bulb.position.set(0, 5.0, -0.9);
  g.add(bulb);
  return g;
}

export function createTrafficLightMesh(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.09, 4.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.5, metalness: 0.35 })
  );
  pole.position.y = 2.1;
  g.add(pole);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.82, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x16181c })
  );
  box.position.y = 4.15;
  g.add(box);
  const mk = (y: number, color: number) => {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 10),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85 })
    );
    m.position.set(0, y, 0.12);
    g.add(m);
  };
  mk(4.4, 0xff3333);
  mk(4.15, 0xffcc33);
  mk(3.9, 0x33dd66);
  return g;
}

export function createExplosiveBarrelMesh(): THREE.Group {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 1.25, 12),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.38, metalness: 0.3 })
  );
  barrel.position.y = 0.63;
  barrel.castShadow = true;
  g.add(barrel);

  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.47, 0.47, 0.22, 12),
    new THREE.MeshBasicMaterial({ color: 0xfacc15 })
  );
  stripe.position.y = 0.65;
  g.add(stripe);
  return g;
}

export function createMissionBeaconMesh(color = 0xfacc15): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.1, 0.11, 8, 28),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.92,
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.16;
  g.add(ring);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 12, 12),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.65,
      transparent: true,
      opacity: 0.35,
    })
  );
  beam.position.y = 6;
  g.add(beam);
  return g;
}
