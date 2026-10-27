import * as THREE from 'three';
import {
  createBuildingFacadeTexture,
  createRoadTexture,
  createSignTexture,
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

export function buildLosSantosCity(scene: THREE.Scene): CityBuildResult {
  const colliders: BoxCollider[] = [];
  const barrels: BarrelEntity[] = [];
  const shootableMeshes: THREE.Object3D[] = [];

  // Ground plane
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x27272a,
    roughness: 0.92,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(540, 540), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  shootableMeshes.push(ground);

  // Vespucci Beach sand & Pacific Ocean (South z > 130)
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(540, 90),
    new THREE.MeshStandardMaterial({ color: 0xd6b87c, roughness: 0.9 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, 165);
  sand.receiveShadow = true;
  scene.add(sand);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 260),
    new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.55,
      roughness: 0.25,
    })
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.04, 270);
  scene.add(ocean);

  // Road network grid
  const roadTexH = createRoadTexture();
  roadTexH.repeat.set(1, 22);
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTexH,
    roughness: 0.85,
  });

  const gridCoords = [-120, -60, 0, 60, 120];
  for (const coord of gridCoords) {
    // North-South Avenue
    const nsRoad = new THREE.Mesh(new THREE.PlaneGeometry(16, 320), roadMat);
    nsRoad.rotation.x = -Math.PI / 2;
    nsRoad.position.set(coord, 0.03, -10);
    nsRoad.receiveShadow = true;
    scene.add(nsRoad);

    // East-West Boulevard
    const ewRoad = new THREE.Mesh(new THREE.PlaneGeometry(320, 16), roadMat);
    ewRoad.rotation.x = -Math.PI / 2;
    ewRoad.rotation.z = Math.PI / 2;
    ewRoad.position.set(0, 0.035, coord);
    ewRoad.receiveShadow = true;
    scene.add(ewRoad);
  }

  // Facade texture palette
  const glassTex = createBuildingFacadeTexture('#0f172a', '#38bdf8', 'glass');
  const goldOfficeTex = createBuildingFacadeTexture('#1e1b4b', '#facc15', 'office');
  const warmOfficeTex = createBuildingFacadeTexture('#18181b', '#fb923c', 'office');
  const aptTex = createBuildingFacadeTexture('#27272a', '#fde047', 'residential');

  const addBuilding = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    tex: THREE.Texture,
    roofColor = 0x18181b
  ) => {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.45,
      metalness: 0.25,
    });
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
      mat,
      mat,
      roofMat,
      roofMat,
      mat,
      mat,
    ]);
    mesh.position.set(x, h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootableMeshes.push(mesh);

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
  addBuilding(-25, -98, 28, 18, 22, goldOfficeTex, 0xca8a04);
  const bankSign = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 4.8),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('太平洋標準銀行', 'PACIFIC STANDARD BANK · HEIST TARGET', '#18181b', '#facc15'),
    })
  );
  bankSign.position.set(-25, 13.5, -88.8);
  scene.add(bankSign);

  // Golden bank pillars
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.6, roughness: 0.3 });
  [-34, -28, -22, -16].forEach((px) => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 10, 12), pillarMat);
    p.position.set(px, 5, -88.2);
    scene.add(p);
  });

  // 2. Maze Bank Tower (35, -95) - Tallest iconic cylindrical-crowned skyscraper
  addBuilding(35, -95, 24, 24, 64, glassTex, 0x0284c7);
  const towerCrown = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 11, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x7f1d1d })
  );
  towerCrown.position.set(35, 68, -95);
  scene.add(towerCrown);

  // 3. Ammu-Nation Gun Shop (-25, 25)
  addBuilding(-25, 32, 22, 16, 11, warmOfficeTex, 0x991b1b);
  const ammuSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 4.2),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('武裝國度軍火店', 'AMMU-NATION · WEAPONS & ARMOR', '#450a0a', '#f87171'),
      side: THREE.DoubleSide,
    })
  );
  ammuSign.position.set(-25, 9.2, 23.8);
  ammuSign.rotation.y = Math.PI;
  scene.add(ammuSign);

  // 4. Los Santos Customs (95, 25)
  addBuilding(95, 32, 26, 18, 12, aptTex, 0x581c87);
  const customsSign = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 4.5),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('洛聖都改車王', 'LOS SANTOS CUSTOMS · REPAIR & CLEAR WANTED', '#2e1065', '#c084fc'),
      side: THREE.DoubleSide,
    })
  );
  customsSign.position.set(95, 9.8, 22.8);
  customsSign.rotation.y = Math.PI;
  scene.add(customsSign);

  // 5. Pillbox Hill Medical Center (35, -35)
  addBuilding(35, -35, 24, 20, 28, glassTex, 0x059669);
  const medSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 4.2),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('藥盒山醫療中心', 'PILLBOX HILL MEDICAL CENTER', '#064e3b', '#34d399'),
    })
  );
  medSign.position.set(35, 12, -24.8);
  scene.add(medSign);

  // 6. LSPD HQ (95, -35)
  addBuilding(95, -35, 24, 20, 20, glassTex, 0x1d4ed8);
  const lspdSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 4.2),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('洛聖都警察總局', 'LSPD HEADQUARTERS · MISSION ROW', '#172554', '#60a5fa'),
    })
  );
  lspdSign.position.set(95, 11, -24.8);
  scene.add(lspdSign);

  // 7. Rockford Hills Villa (-95, -95)
  addBuilding(-95, -96, 26, 16, 12, aptTex, 0xbe185d);

  // 8. Elysian Island Container Pier (-135, 115)
  const containerColors = [0xdc2626, 0x2563eb, 0xd97706, 0x16a34a];
  for (let i = 0; i < 8; i++) {
    const cx = -152 + (i % 4) * 11;
    const cz = 98 + Math.floor(i / 4) * 28;
    const cMat = new THREE.MeshStandardMaterial({
      color: containerColors[i % containerColors.length],
      roughness: 0.6,
      metalness: 0.35,
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

  // Additional city blocks around the avenues
  const cityBlocks: [number, number, number, number, number, THREE.Texture][] = [
    [-88, -32, 22, 22, 34, glassTex],
    [-32, -32, 20, 20, 38, goldOfficeTex],
    [-88, 32, 22, 20, 24, warmOfficeTex],
    [32, 32, 22, 20, 30, glassTex],
    [92, -92, 24, 22, 36, goldOfficeTex],
    [-88, 90, 24, 18, 18, aptTex],
    [-28, 90, 26, 18, 22, glassTex],
    [32, 90, 24, 18, 20, warmOfficeTex],
    [92, 90, 24, 18, 24, aptTex],
  ];

  for (const [bx, bz, bw, bd, bh, btex] of cityBlocks) {
    addBuilding(bx, bz, bw, bd, bh, btex);
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
      opacity: 0.85,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(lm.x, 0.08, lm.z + 8);
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
