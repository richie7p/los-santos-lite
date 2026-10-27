import * as THREE from 'three';
import {
  createAsphaltTexture,
  createBuildingFacadeTexture,
  createGrassTexture,
  createSignTexture,
  createSkyDomeTexture,
} from './textures';
import { createExplosiveBarrelMesh, createPalmTreeMesh } from './meshes';
import { LANDMARKS } from './data';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface BarrelEntity {
  id: string;
  mesh: THREE.Group;
  x: number;
  z: number;
  exploded: boolean;
}

export interface CityBuildResult {
  colliders: BoxCollider[];
  barrels: BarrelEntity[];
  shootableMeshes: THREE.Object3D[];
}

function createStreetLamp(): THREE.Group {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x3f3f46,
    metalness: 0.6,
    roughness: 0.4,
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5.2, 8), poleMat);
  pole.position.y = 2.6;
  pole.castShadow = true;
  g.add(pole);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.3), poleMat);
  arm.position.set(0, 5.15, 0.55);
  g.add(arm);

  const bulb = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.12, 0.45),
    new THREE.MeshBasicMaterial({ color: 0xfef08a })
  );
  bulb.position.set(0, 5.08, 1.05);
  g.add(bulb);
  return g;
}

export function buildLosSantosCity(scene: THREE.Scene): CityBuildResult {
  const colliders: BoxCollider[] = [];
  const barrels: BarrelEntity[] = [];
  const shootableMeshes: THREE.Object3D[] = [];

  // 1. Sunset Sky Dome (prevents flat dark background)
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(340, 32, 20),
    new THREE.MeshBasicMaterial({
      map: createSkyDomeTexture(),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  skyDome.renderOrder = -10;
  skyDome.frustumCulled = false;
  scene.add(skyDome);

  // 2. Ground Park / Urban Base Plane
  const grassMat = new THREE.MeshStandardMaterial({
    map: createGrassTexture(),
    color: 0x9ab08e,
    roughness: 0.92,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);
  shootableMeshes.push(ground);

  // 3. Vespucci Beach Sand & Ocean
  const sand = new THREE.Mesh(
    new THREE.BoxGeometry(520, 0.06, 85),
    new THREE.MeshStandardMaterial({ color: 0xd8be8b, roughness: 0.88 })
  );
  sand.position.set(0, 0.01, 162);
  sand.receiveShadow = true;
  scene.add(sand);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(680, 240),
    new THREE.MeshStandardMaterial({
      color: 0x0369a1,
      metalness: 0.48,
      roughness: 0.22,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.05, 265);
  scene.add(ocean);

  // 4. 3D Box Roads + Raised Concrete Sidewalks + Center Dashes + Crosswalks
  const asphaltTex = createAsphaltTexture();
  asphaltTex.repeat.set(4, 48);
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    color: 0xb8bcc2,
    roughness: 0.9,
    metalness: 0.04,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: 0xb8bac0,
    roughness: 0.86,
  });
  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xeab308 });
  const whiteStripeMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });

  const gridCoords = [-120, -60, 0, 60, 120];
  const roadWidth = 14;
  const sidewalkWidth = 2.4;
  const roadLen = 330;

  for (const coord of gridCoords) {
    // North-South 3D Road Slab
    const nsRoad = new THREE.Mesh(
      new THREE.BoxGeometry(roadWidth, 0.05, roadLen),
      asphaltMat
    );
    nsRoad.position.set(coord, 0.02, -5);
    nsRoad.receiveShadow = true;
    scene.add(nsRoad);
    shootableMeshes.push(nsRoad);

    // North-South Sidewalks
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(
        new THREE.BoxGeometry(sidewalkWidth, 0.12, roadLen),
        sidewalkMat
      );
      sw.position.set(coord + side * (roadWidth * 0.5 + sidewalkWidth * 0.5), 0.06, -5);
      sw.receiveShadow = true;
      scene.add(sw);
    }

    // East-West 3D Road Slab
    const ewRoad = new THREE.Mesh(
      new THREE.BoxGeometry(roadLen, 0.055, roadWidth),
      asphaltMat
    );
    ewRoad.position.set(0, 0.025, coord);
    ewRoad.receiveShadow = true;
    scene.add(ewRoad);
    shootableMeshes.push(ewRoad);

    // East-West Sidewalks
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(
        new THREE.BoxGeometry(roadLen, 0.12, sidewalkWidth),
        sidewalkMat
      );
      sw.position.set(0, 0.06, coord + side * (roadWidth * 0.5 + sidewalkWidth * 0.5));
      sw.receiveShadow = true;
      scene.add(sw);
    }

    // Yellow Center Dashes along both axes
    for (let s = -150; s <= 140; s += 11) {
      const dashNS = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 4.2), yellowLineMat);
      dashNS.position.set(coord, 0.055, s);
      scene.add(dashNS);

      const dashEW = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 0.18), yellowLineMat);
      dashEW.position.set(s, 0.058, coord);
      scene.add(dashEW);
    }
  }

  // Zebra Crosswalks & Street Lamps at Intersections
  for (const rx of gridCoords) {
    for (const rz of gridCoords) {
      for (let k = -2; k <= 2; k++) {
        const zStripe = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.065, 2.6),
          whiteStripeMat
        );
        zStripe.position.set(rx + k * 1.15, 0.058, rz + roadWidth * 0.5 + 1.2);
        scene.add(zStripe);
      }

      const lamp = createStreetLamp();
      lamp.position.set(rx + roadWidth * 0.5 + 1.4, 0, rz - roadWidth * 0.5 - 1.4);
      scene.add(lamp);
    }
  }

  // 5. Architectural Building Builder (with plinth, roof ledge, rooftop AC units)
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.75 });
  const acMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.35,
    roughness: 0.45,
  });

  const addBuilding = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    baseColor: string,
    litColor: string,
    style: 'glass' | 'office' | 'residential' = 'office',
    seed = 1
  ) => {
    const tex = createBuildingFacadeTexture(baseColor, litColor, style, seed);
    const faceMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: style === 'glass' ? 0.35 : 0.58,
      metalness: style === 'glass' ? 0.28 : 0.1,
    });

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
      faceMat,
      faceMat,
      roofMat,
      plinthMat,
      faceMat,
      faceMat,
    ]);
    mesh.position.set(x, h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootableMeshes.push(mesh);

    // Concrete ground plinth
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.4, 0.9, d + 0.4),
      plinthMat
    );
    plinth.position.set(x, 0.45, z);
    plinth.castShadow = true;
    scene.add(plinth);

    // Roof cornice ledge
    const ledge = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.5, 0.35, d + 0.5),
      roofMat
    );
    ledge.position.set(x, h + 0.15, z);
    scene.add(ledge);

    // Rooftop HVAC units
    for (let i = 0; i < 2; i++) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.6), acMat);
      ac.position.set(x + (i === 0 ? -w * 0.22 : w * 0.22), h + 0.85, z);
      scene.add(ac);
    }

    colliders.push({
      minX: x - w * 0.5 - 0.5,
      maxX: x + w * 0.5 + 0.5,
      minZ: z - d * 0.5 - 0.5,
      maxZ: z + d * 0.5 + 0.5,
      height: h,
    });
    return mesh;
  };

  // === Iconic Landmarks ===
  // 1. Pacific Standard Bank (-25, -95)
  addBuilding(-25, -98, 28, 18, 22, '#6b7280', '#fde047', 'office', 10);
  const bankSign = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 4.8),
    new THREE.MeshBasicMaterial({
      map: createSignTexture(
        '太平洋標準銀行',
        'PACIFIC STANDARD BANK · HEIST TARGET',
        '#18181b',
        '#facc15'
      ),
    })
  );
  bankSign.position.set(-25, 13.5, -88.7);
  scene.add(bankSign);

  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0xeab308,
    metalness: 0.55,
    roughness: 0.3,
  });
  [-34, -28, -22, -16].forEach((px) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 10, 12), pillarMat);
    p.position.set(px, 5, -88.1);
    scene.add(p);
  });

  // 2. Maze Bank Tower (35, -95)
  addBuilding(35, -95, 24, 24, 62, '#475569', '#bae6fd', 'glass', 20);
  const towerCrown = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 11, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d })
  );
  towerCrown.position.set(35, 65.5, -95);
  scene.add(towerCrown);

  // 3. Ammu-Nation Gun Shop (-25, 25)
  addBuilding(-25, 32, 22, 16, 12, '#78716c', '#fca5a5', 'office', 30);
  const ammuSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 4.2),
    new THREE.MeshBasicMaterial({
      map: createSignTexture(
        '武裝國度軍火店',
        'AMMU-NATION · WEAPONS & ARMOR',
        '#450a0a',
        '#f87171'
      ),
      side: THREE.DoubleSide,
    })
  );
  ammuSign.position.set(-25, 9.2, 23.7);
  ammuSign.rotation.y = Math.PI;
  scene.add(ammuSign);

  // 4. Los Santos Customs (95, 25)
  addBuilding(95, 32, 26, 18, 12, '#52525b', '#e9d5ff', 'residential', 40);
  const customsSign = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 4.5),
    new THREE.MeshBasicMaterial({
      map: createSignTexture(
        '洛聖都改車王',
        'LOS SANTOS CUSTOMS · REPAIR & CLEAR WANTED',
        '#2e1065',
        '#c084fc'
      ),
      side: THREE.DoubleSide,
    })
  );
  customsSign.position.set(95, 9.8, 22.7);
  customsSign.rotation.y = Math.PI;
  scene.add(customsSign);

  // 5. Pillbox Hill Medical Center (35, -35)
  addBuilding(35, -35, 24, 20, 28, '#64748b', '#a7f3d0', 'glass', 50);
  const medSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 4.2),
    new THREE.MeshBasicMaterial({
      map: createSignTexture(
        '藥盒山醫療中心',
        'PILLBOX HILL MEDICAL CENTER',
        '#064e3b',
        '#34d399'
      ),
    })
  );
  medSign.position.set(35, 12, -24.7);
  scene.add(medSign);

  // 6. LSPD HQ (95, -35)
  addBuilding(95, -35, 24, 20, 20, '#475569', '#93c5fd', 'glass', 60);
  const lspdSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 4.2),
    new THREE.MeshBasicMaterial({
      map: createSignTexture(
        '洛聖都警察總局',
        'LSPD HEADQUARTERS · MISSION ROW',
        '#172554',
        '#60a5fa'
      ),
    })
  );
  lspdSign.position.set(95, 11, -24.7);
  scene.add(lspdSign);

  // 7. Rockford Hills Villa (-95, -95)
  addBuilding(-95, -96, 26, 16, 12, '#8a817c', '#fef08a', 'residential', 70);

  // 8. Elysian Island Container Pier (-135, 115)
  const containerColors = [0xdc2626, 0x2563eb, 0xd97706, 0x16a34a];
  for (let i = 0; i < 8; i++) {
    const cx = -152 + (i % 4) * 11;
    const cz = 98 + Math.floor(i / 4) * 28;
    const cMat = new THREE.MeshStandardMaterial({
      color: containerColors[i % containerColors.length],
      roughness: 0.55,
      metalness: 0.3,
    });
    const cMesh = new THREE.Mesh(new THREE.BoxGeometry(7.5, 4.2, 14), cMat);
    cMesh.position.set(cx, 2.1, cz);
    cMesh.castShadow = true;
    cMesh.receiveShadow = true;
    scene.add(cMesh);
    shootableMeshes.push(cMesh);
    colliders.push({
      minX: cx - 4,
      maxX: cx + 4,
      minZ: cz - 7.2,
      maxZ: cz + 7.2,
      height: 4.2,
    });
  }

  // City Skyline Blocks with warm architectural palettes
  const cityBlocks: [
    number,
    number,
    number,
    number,
    number,
    string,
    string,
    'glass' | 'office' | 'residential',
    number
  ][] = [
    [-88, -32, 22, 22, 32, '#5c6a72', '#b7d6e4', 'glass', 101],
    [-32, -32, 20, 20, 36, '#6e7884', '#efe4c8', 'office', 102],
    [-88, 32, 22, 20, 24, '#8a9098', '#eadcc0', 'residential', 103],
    [32, 32, 22, 20, 28, '#4f5d68', '#9fd0d4', 'glass', 104],
    [92, -92, 24, 22, 34, '#7a7068', '#efe4c8', 'office', 105],
    [-88, 90, 24, 18, 18, '#9a8f84', '#fde047', 'residential', 106],
    [-28, 90, 26, 18, 22, '#5c6a72', '#bae6fd', 'glass', 107],
    [32, 90, 24, 18, 20, '#7a7068', '#fed7aa', 'office', 108],
    [92, 90, 24, 18, 24, '#6e7884', '#fef08a', 'residential', 109],
  ];

  for (const [bx, bz, bw, bd, bh, baseCol, litCol, st, seed] of cityBlocks) {
    addBuilding(bx, bz, bw, bd, bh, baseCol, litCol, st, seed);
  }

  // Interactive glowing landmark rings on the ground
  for (const lm of LANDMARKS) {
    if (!lm.interactPrompt) continue;
    const ringGeo = new THREE.RingGeometry(2.6, 3.3, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: lm.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(lm.x, 0.14, lm.z + 8);
    scene.add(ring);
  }

  // Palm trees along boulevards and beach
  for (let x = -140; x <= 140; x += 28) {
    const p1 = createPalmTreeMesh();
    p1.position.set(x, 0, 128);
    scene.add(p1);

    const p2 = createPalmTreeMesh();
    p2.position.set(x, 0, -50);
    scene.add(p2);
  }

  // Explosive red barrels placed around key combat zones
  const barrelSpots: [number, number][] = [
    [-18, -85],
    [-32, -85],
    [-130, 110],
    [-142, 118],
    [-125, 122],
    [-90, -84],
    [-15, 22],
    [20, -15],
    [-45, 10],
    [78, 18],
  ];

  barrelSpots.forEach(([bx, bz], idx) => {
    const mesh = createExplosiveBarrelMesh();
    mesh.position.set(bx, 0, bz);
    scene.add(mesh);
    shootableMeshes.push(mesh);
    barrels.push({
      id: `barrel_${idx}`,
      mesh,
      x: bx,
      z: bz,
      exploded: false,
    });
  });

  return { colliders, barrels, shootableMeshes };
}
