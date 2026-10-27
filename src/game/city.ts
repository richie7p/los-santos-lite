import * as THREE from 'three';
import { AABB } from './collision';
import {
  ASPHALT,
  blockBounds,
  CITY,
  GRID,
  HALF,
  LANDMARKS,
  ROAD,
  roadCoord,
  SIDEWALK,
} from './data';
import {
  createExplosiveBarrelMesh,
  createLampMesh,
  createTrafficLightMesh,
  createTreeMesh,
} from './meshes';
import {
  createSignTexture,
  scaleFacadeUVs,
  tileBoxUVs,
  tilePlaneUVs,
  WorldTextures,
} from './textures';

export interface RoadNode {
  i: number;
  j: number;
  x: number;
  z: number;
}

export interface BarrelEntity {
  id: string;
  mesh: THREE.Group;
  x: number;
  z: number;
  exploded: boolean;
}

export interface ParkedSpot {
  name: string;
  x: number;
  z: number;
  yaw: number;
  color: number;
  kind: 'sport' | 'sedan' | 'suv' | 'taxi' | 'swat';
}

export interface CityBuildResult {
  colliders: AABB[];
  treeColliders: { x: number; z: number; r: number }[];
  barrels: BarrelEntity[];
  shootableMeshes: THREE.Object3D[];
  nodes: RoadNode[];
  npcLoops: { x: number; z: number }[][];
  parkedSpots: ParkedSpot[];
  policeSpawns: { x: number; z: number; yaw: number }[];
}

type FacadeKind = 'glass' | 'apt' | 'street' | 'industrial' | 'civic';

function mulberry(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLosSantosCity(
  scene: THREE.Scene,
  tex: WorldTextures | null
): CityBuildResult {
  const group = new THREE.Group();
  const colliders: AABB[] = [];
  const treeColliders: { x: number; z: number; r: number }[] = [];
  const barrels: BarrelEntity[] = [];
  const shootableMeshes: THREE.Object3D[] = [];
  const npcLoops: { x: number; z: number }[][] = [];
  const parkedSpots: ParkedSpot[] = [];
  const policeSpawns: { x: number; z: number; yaw: number }[] = [];

  const photo = !!tex;
  const asphaltMat = new THREE.MeshStandardMaterial({
    map: tex?.asphalt ?? undefined,
    color: photo ? 0xffffff : 0x3f434a,
    roughness: 0.94,
    metalness: 0.02,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: tex?.sidewalk ?? undefined,
    color: photo ? 0xffffff : 0xb8bac0,
    roughness: 0.88,
  });
  const grassMat = new THREE.MeshStandardMaterial({
    map: tex?.grass ?? undefined,
    color: photo ? 0xffffff : 0x5c8058,
    roughness: 0.94,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    map: tex?.roof ?? undefined,
    color: photo ? 0xffffff : 0x3a4048,
    roughness: 0.68,
  });
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x4a4e54,
    roughness: 0.86,
  });
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0x8e9096,
    roughness: 0.85,
  });
  const acMat = new THREE.MeshStandardMaterial({
    color: 0x6a7278,
    roughness: 0.45,
    metalness: 0.35,
  });

  const facades: Record<FacadeKind, THREE.MeshStandardMaterial> = {
    glass: new THREE.MeshStandardMaterial({
      map: tex?.glass ?? undefined,
      color: photo ? 0xffffff : 0x8aa0b0,
      roughness: 0.36,
      metalness: 0.28,
    }),
    apt: new THREE.MeshStandardMaterial({
      map: tex?.apt ?? undefined,
      color: photo ? 0xffffff : 0x9a8f84,
      roughness: 0.62,
      metalness: 0.06,
    }),
    street: new THREE.MeshStandardMaterial({
      map: tex?.street ?? undefined,
      color: photo ? 0xffffff : 0x8a9098,
      roughness: 0.58,
      metalness: 0.08,
    }),
    industrial: new THREE.MeshStandardMaterial({
      map: tex?.industrial ?? undefined,
      color: photo ? 0xffffff : 0x7a7068,
      roughness: 0.7,
      metalness: 0.12,
    }),
    civic: new THREE.MeshStandardMaterial({
      map: tex?.civic ?? undefined,
      color: photo ? 0xffffff : 0xd8dce2,
      roughness: 0.48,
      metalness: 0.12,
    }),
  };

  // 1. Photorealistic Sky Dome
  if (tex?.sky) {
    const skyMat = new THREE.MeshBasicMaterial({
      map: tex.sky,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(235, 32, 18), skyMat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    group.add(sky);
  }

  // 2. Ground Grass Plane
  const groundGeo = new THREE.PlaneGeometry(CITY + 90, CITY + 90);
  tilePlaneUVs(groundGeo, CITY + 90, CITY + 90, 12);
  const ground = new THREE.Mesh(groundGeo, grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.02, -8);
  ground.receiveShadow = true;
  group.add(ground);
  shootableMeshes.push(ground);

  // 3. North Bay Water & Seawall
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY + 110, 56),
    new THREE.MeshStandardMaterial({
      color: 0x1a4a58,
      roughness: 0.22,
      metalness: 0.36,
      transparent: true,
      opacity: 0.94,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.08, -HALF - 26);
  group.add(water);

  const seawall = new THREE.Mesh(
    new THREE.BoxGeometry(CITY + 20, 1.4, 1.2),
    curbMat
  );
  seawall.position.set(0, 0.5, -HALF - 1.2);
  group.add(seawall);
  colliders.push({
    minX: -HALF - 10,
    maxX: HALF + 10,
    minZ: -HALF - 2.2,
    maxZ: -HALF - 0.2,
  });

  // 4. 5x5 Road Grid + Sidewalks + Lane Markings + Crosswalks
  const lineM = new THREE.MeshStandardMaterial({
    color: 0xd8c56a,
    emissive: 0x3a3410,
    roughness: 0.6,
  });
  const zebraM = new THREE.MeshStandardMaterial({
    color: 0xe8eaee,
    roughness: 0.7,
  });

  for (let i = 0; i <= GRID; i++) {
    const x = roadCoord(i);
    const roadGeo = new THREE.BoxGeometry(ASPHALT, 0.04, CITY);
    tileBoxUVs(roadGeo, ASPHALT, 0.04, CITY, 8);
    const road = new THREE.Mesh(roadGeo, asphaltMat);
    road.position.set(x, 0.01, 0);
    road.receiveShadow = true;
    group.add(road);
    shootableMeshes.push(road);

    for (const side of [-1, 1]) {
      const swGeo = new THREE.BoxGeometry(SIDEWALK, 0.08, CITY);
      tileBoxUVs(swGeo, SIDEWALK, 0.08, CITY, 4);
      const sw = new THREE.Mesh(swGeo, sidewalkMat);
      sw.position.set(x + side * (ASPHALT / 2 + SIDEWALK / 2), 0.04, 0);
      sw.receiveShadow = true;
      group.add(sw);
    }

    for (let s = -HALF + 6; s < HALF; s += 8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 3.2), lineM);
      dash.position.set(x, 0.04, s);
      group.add(dash);
    }
  }

  for (let j = 0; j <= GRID; j++) {
    const z = roadCoord(j);
    const roadGeo = new THREE.BoxGeometry(CITY, 0.05, ASPHALT);
    tileBoxUVs(roadGeo, CITY, 0.05, ASPHALT, 8);
    const road = new THREE.Mesh(roadGeo, asphaltMat);
    road.position.set(0, 0.015, z);
    road.receiveShadow = true;
    group.add(road);
    shootableMeshes.push(road);

    for (const side of [-1, 1]) {
      const swGeo = new THREE.BoxGeometry(CITY, 0.09, SIDEWALK);
      tileBoxUVs(swGeo, CITY, 0.09, SIDEWALK, 4);
      const sw = new THREE.Mesh(swGeo, sidewalkMat);
      sw.position.set(0, 0.045, z + side * (ASPHALT / 2 + SIDEWALK / 2));
      sw.receiveShadow = true;
      group.add(sw);
    }

    for (let s = -HALF + 6; s < HALF; s += 8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.03, 0.14), lineM);
      dash.position.set(s, 0.042, z);
      group.add(dash);
    }
  }

  // Building Constructor Helper
  const addBuilding = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    seed: number,
    kind: FacadeKind
  ) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleFacadeUVs(geo, w, h, d);
    const face = facades[kind];
    const mat: THREE.Material[] = [face, face, roofMat, plinthMat, face, face];

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    shootableMeshes.push(mesh);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.28, 0.82, d + 0.28),
      plinthMat
    );
    plinth.position.set(x, 0.4, z);
    plinth.castShadow = true;
    group.add(plinth);

    const ledge = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.38, 0.16, d + 0.38),
      plinthMat
    );
    ledge.position.set(x, h - 0.18, z);
    group.add(ledge);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.3, 0.25, d + 0.3),
      roofMat
    );
    roof.position.set(x, h + 0.1, z);
    group.add(roof);

    const rng = mulberry(seed + 91);
    const acCount = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < acCount; k++) {
      const aw = 1.1 + rng() * 0.6;
      const ad = 0.85 + rng() * 0.4;
      const ah = 0.55 + rng() * 0.25;
      const ac = new THREE.Mesh(new THREE.BoxGeometry(aw, ah, ad), acMat);
      ac.position.set(
        x + (rng() - 0.5) * (w * 0.55),
        h + 0.35 + ah / 2,
        z + (rng() - 0.5) * (d * 0.55)
      );
      ac.castShadow = true;
      group.add(ac);
    }

    if (h > 16) {
      const ant = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 2.8, 6),
        acMat
      );
      ant.position.set(x + w * 0.2, h + 1.5, z - d * 0.15);
      group.add(ant);
    }

    const pad = 0.18;
    colliders.push({
      minX: x - w / 2 - pad,
      maxX: x + w / 2 + pad,
      minZ: z - d / 2 - pad,
      maxZ: z + d / 2 + pad,
    });
  };

  const addBillboard = (
    x: number,
    y: number,
    z: number,
    title: string,
    sub: string,
    bg: string,
    accent: string,
    rotY = 0
  ) => {
    const signMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 2.5),
      new THREE.MeshBasicMaterial({
        map: createSignTexture(title, sub, bg, accent),
        side: THREE.DoubleSide,
      })
    );
    signMesh.position.set(x, y, z);
    signMesh.rotation.y = rotY;
    group.add(signMesh);
  };

  // 5. Populate 5x5 City Blocks
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const b = blockBounds(i, j);
      npcLoops.push([
        { x: b.minX - 1.1, z: b.minZ - 1.1 },
        { x: b.maxX + 1.1, z: b.minZ - 1.1 },
        { x: b.maxX + 1.1, z: b.maxZ + 1.1 },
        { x: b.minX - 1.1, z: b.maxZ + 1.1 },
      ]);

      // (1, 1) Vinewood Central Park
      if (i === 1 && j === 1) {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(b.maxX - b.minX - 1, 0.08, b.maxZ - b.minZ - 1),
          grassMat
        );
        pad.position.set(b.cx, 0.04, b.cz);
        pad.receiveShadow = true;
        group.add(pad);

        const path = new THREE.Mesh(
          new THREE.BoxGeometry(3.4, 0.1, b.maxZ - b.minZ - 2),
          new THREE.MeshStandardMaterial({ color: 0xc2b8a4, roughness: 0.9 })
        );
        path.position.set(b.cx, 0.06, b.cz);
        group.add(path);

        const treePts = [
          [b.cx - 8, b.cz - 8],
          [b.cx + 8, b.cz - 7],
          [b.cx - 9, b.cz + 6],
          [b.cx + 7, b.cz + 8],
          [b.cx - 4, b.cz + 10],
          [b.cx + 10, b.cz],
          [b.cx - 11, b.cz],
          [b.cx + 3, b.cz - 10],
        ];
        for (const [tx, tz] of treePts) {
          const t = createTreeMesh();
          t.position.set(tx!, 0, tz!);
          group.add(t);
          treeColliders.push({ x: tx!, z: tz!, r: 0.7 });
        }
        addBillboard(b.cx, 3.4, b.minZ - 1.4, '新生中央公園', 'VINEWOOD CENTRAL PARK', '#1e3a2a', '#4ade80');
        continue;
      }

      // (2, 1) Pacific Standard Bank & Maze Bank Skyscraper
      if (i === 2 && j === 1) {
        // Pacific Standard Bank (South side of block facing roadCoord(2))
        addBuilding(b.cx, b.cz + 6, 24, 14, 15, 201, 'civic');
        const pillarMat = new THREE.MeshStandardMaterial({
          color: 0xeab308,
          metalness: 0.65,
          roughness: 0.25,
        });
        for (const px of [b.cx - 8, b.cx - 3, b.cx + 3, b.cx + 8]) {
          const col = new THREE.Mesh(
            new THREE.CylinderGeometry(0.45, 0.45, 8.5, 10),
            pillarMat
          );
          col.position.set(px, 4.25, b.maxZ - 1.8);
          group.add(col);
        }
        addBillboard(
          b.cx,
          10.5,
          b.maxZ - 1.2,
          '太平洋標準銀行',
          'PACIFIC STANDARD BANK · HEIST TARGET',
          '#18181b',
          '#facc15'
        );

        // Maze Bank Skyscraper (North side of block)
        addBuilding(b.cx, b.cz - 9, 18, 12, 42, 202, 'glass');
        const crown = new THREE.Mesh(
          new THREE.CylinderGeometry(6.5, 7.5, 4.2, 16),
          new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0x7f1d1d })
        );
        crown.position.set(b.cx, 44.2, b.cz - 9);
        group.add(crown);
        continue;
      }

      // (2, 2) Central Grand Station
      if (i === 2 && j === 2) {
        addBuilding(b.cx, b.cz + 2, 26, 14, 11, 90, 'civic');
        const canopy = new THREE.Mesh(
          new THREE.BoxGeometry(20, 0.38, 8),
          new THREE.MeshStandardMaterial({
            color: 0xc5cdd8,
            metalness: 0.35,
            roughness: 0.4,
          })
        );
        canopy.position.set(b.cx, 5.2, b.minZ + 6);
        group.add(canopy);
        addBillboard(
          b.cx,
          7.6,
          b.minZ + 1.6,
          '洛聖都中央車站',
          'LOS SANTOS GRAND STATION',
          '#1a2838',
          '#38bdf8'
        );
        continue;
      }

      // (3, 2) Ammu-Nation Gun Shop & East Commercial
      if (i === 3 && j === 2) {
        addBuilding(b.cx - 6, b.cz + 5, 14, 16, 20, 301, 'glass');
        addBuilding(b.cx + 6, b.minZ + 7, 13, 10, 8, 302, 'street');
        addBillboard(
          b.cx + 6,
          9.4,
          b.minZ + 1.8,
          '武裝國度軍火店',
          'AMMU-NATION · WEAPONS & ARMOR',
          '#450a0a',
          '#f87171'
        );
        continue;
      }

      // (4, 2) Los Santos Customs Garage
      if (i === 4 && j === 2) {
        addBuilding(b.cx, b.minZ + 9, 22, 14, 9.5, 401, 'industrial');
        addBuilding(b.cx, b.cz + 9, 20, 11, 18, 402, 'glass');
        addBillboard(
          b.cx,
          11.0,
          b.minZ + 1.8,
          '洛聖都改車王',
          'LOS SANTOS CUSTOMS · CLEAR WANTED',
          '#2e1065',
          '#c084fc'
        );
        continue;
      }

      // (4, 3) Harbor Supercar Parking Lot
      if (i === 4 && j === 3) {
        const lotGeo = new THREE.BoxGeometry(
          b.maxX - b.minX - 1.2,
          0.06,
          b.maxZ - b.minZ - 1.2
        );
        tileBoxUVs(lotGeo, b.maxX - b.minX, 0.06, b.maxZ - b.minZ, 8);
        const lot = new THREE.Mesh(lotGeo, asphaltMat);
        lot.position.set(b.cx, 0.03, b.cz);
        lot.receiveShadow = true;
        group.add(lot);

        const stallMat = new THREE.MeshStandardMaterial({
          color: 0xd0d4da,
          roughness: 0.7,
        });
        const carColors = [0xc45c4a, 0x3a6ea8, 0x22c55e, 0xa855f7, 0xeab308, 0x38bdf8];
        let n = 0;
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const x = b.minX + 6 + col * 8;
            const z = b.minZ + 6 + row * 8;
            const line = new THREE.Mesh(
              new THREE.BoxGeometry(2.4, 0.04, 4.6),
              stallMat
            );
            line.position.set(x, 0.06, z);
            group.add(line);
            if (n < 5) {
              parkedSpots.push({
                name: n % 2 === 0 ? '佩嘉西 桑托勞超跑 (Zentorno)' : '威皮 霸王跑車 (Dominator)',
                x,
                z,
                yaw: 0,
                color: carColors[n % carColors.length]!,
                kind: n % 2 === 0 ? 'sport' : 'sedan',
              });
              n++;
            }
          }
        }
        addBillboard(
          b.cx,
          3.5,
          b.minZ - 1.4,
          '港灣超跑停車場',
          'HARBOR EXOTIC CAR LOT',
          '#172554',
          '#38bdf8'
        );
        continue;
      }

      // (2, 4) LSPD Police Headquarters
      if (i === 2 && j === 4) {
        addBuilding(b.cx, b.cz - 2, 22, 16, 13, 501, 'civic');
        addBillboard(
          b.cx,
          9.2,
          b.cz - 10.2,
          '城南警察總局',
          'LSPD HEADQUARTERS · MISSION ROW',
          '#102038',
          '#60a5fa'
        );
        policeSpawns.push(
          { x: b.cx - 6, z: b.maxZ - 4, yaw: Math.PI },
          { x: b.cx, z: b.maxZ - 4, yaw: Math.PI },
          { x: b.cx + 6, z: b.maxZ - 4, yaw: Math.PI },
          { x: b.minX + 4, z: b.cz + 9, yaw: Math.PI / 2 }
        );
        continue;
      }

      // (0, *) West Industrial Port & Oil Refinery
      if (i === 0) {
        addBuilding(b.cx - 7, b.cz, 14, 22, 9, i * 17 + j * 9, 'industrial');
        addBuilding(b.cx + 8, b.cz - 5, 11, 14, 7, i * 17 + j * 9 + 3, 'industrial');
        const tank = new THREE.Mesh(
          new THREE.CylinderGeometry(2.6, 2.6, 5.5, 12),
          new THREE.MeshStandardMaterial({
            color: 0x8a7a68,
            roughness: 0.5,
            metalness: 0.35,
          })
        );
        tank.position.set(b.cx + 8, 2.75, b.cz + 10);
        tank.castShadow = true;
        group.add(tank);
        shootableMeshes.push(tank);
        colliders.push({
          minX: tank.position.x - 2.8,
          maxX: tank.position.x + 2.8,
          minZ: tank.position.z - 2.8,
          maxZ: tank.position.z + 2.8,
        });
        if (j === 2) {
          addBillboard(
            b.maxX + 1.2,
            4.2,
            b.cz,
            '西港重工業與軍火區',
            'WEST INDUSTRIAL PORT',
            '#431407',
            '#fb923c',
            Math.PI / 2
          );
        }
        continue;
      }

      // (*, 0) Bayfront Commercial Blocks
      if (j === 0) {
        addBuilding(b.cx, b.cz + 4, 22, 15, 13, i * 13 + j, 'glass');
        addBuilding(b.cx - 8, b.cz - 8, 10, 10, 8, i * 13 + j + 2, 'street');
        continue;
      }

      // Generic Commercial & Residential Blocks
      const seed = i * 31 + j * 17;
      const rng = mulberry(seed);
      const inset = 2.2;
      const ox = b.minX + inset;
      const oz = b.minZ + inset;
      const w = b.maxX - b.minX - inset * 2;
      const d = b.maxZ - b.minZ - inset * 2;
      const gap = 2.4;
      const bw = (w - gap) / 2;
      const bd = (d - gap) / 2;
      const isComm = i >= 2;
      for (let c = 0; c < 2; c++) {
        for (let r = 0; r < 2; r++) {
          const h = isComm ? 14 + rng() * 16 : 9 + rng() * 11;
          const kind: FacadeKind = isComm
            ? rng() > 0.42
              ? 'glass'
              : 'street'
            : rng() > 0.45
              ? 'apt'
              : 'street';
          addBuilding(
            ox + bw * c + bw / 2 + (c === 1 ? gap : 0),
            oz + bd * r + bd / 2 + (r === 1 ? gap : 0),
            bw * (0.86 + rng() * 0.1),
            bd * (0.86 + rng() * 0.1),
            h,
            seed + c * 10 + r,
            kind
          );
        }
      }
    }
  }

  // 6. Street Lamps, Traffic Lights & Crosswalks
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      if (i < GRID) {
        const x = (roadCoord(i) + roadCoord(i + 1)) / 2;
        const z = roadCoord(j);
        const l1 = createLampMesh();
        l1.position.set(x, 0, z - ASPHALT / 2 - 0.6);
        l1.rotation.y = Math.PI;
        group.add(l1);

        const l2 = createLampMesh();
        l2.position.set(x, 0, z + ASPHALT / 2 + 0.6);
        group.add(l2);
      }

      if ((i + j) % 2 === 0) {
        const rx = roadCoord(i);
        const rz = roadCoord(j);
        const tl = createTrafficLightMesh();
        tl.position.set(rx + 3.4, 0, rz + 3.4);
        group.add(tl);

        // Zebra Crosswalks
        for (const dir of [0, 1] as const) {
          for (const sign of [-1, 1]) {
            for (let k = 0; k < 5; k++) {
              const stripe = new THREE.Mesh(
                dir === 0
                  ? new THREE.BoxGeometry(0.42, 0.035, 2.6)
                  : new THREE.BoxGeometry(2.6, 0.035, 0.42),
                zebraM
              );
              const off = (k - 2) * 0.7;
              if (dir === 0) {
                stripe.position.set(rx + sign * (ASPHALT / 2 + 0.2), 0.045, rz + off);
              } else {
                stripe.position.set(rx + off, 0.045, rz + sign * (ASPHALT / 2 + 0.2));
              }
              group.add(stripe);
            }
          }
        }
      }
    }
  }

  // 7. Hero Vehicles & Curbside Parked Vehicles
  parkedSpots.unshift(
    {
      name: '布拉瓦多 女妖 GT 雙門超跑 (Banshee GT)',
      x: roadCoord(3) + 3.6,
      z: 18,
      yaw: 0,
      color: 0x2ec4b6,
      kind: 'sport',
    },
    {
      name: '奧北 密探豪華轎車 (Obey Tailgater)',
      x: roadCoord(2) + 3.6,
      z: -18,
      yaw: 0,
      color: 0x1e293b,
      kind: 'sedan',
    },
    {
      name: '佩嘉西 烈焰超跑 (Pegassi Vacca)',
      x: roadCoord(4) - 3.6,
      z: 8,
      yaw: Math.PI,
      color: 0x22c55e,
      kind: 'sport',
    },
    {
      name: '卡尼斯 菩提軍用越野皮卡 (Canis Bodhi)',
      x: roadCoord(1) + 3.6,
      z: 14,
      yaw: 0,
      color: 0xd97706,
      kind: 'suv',
    },
    {
      name: 'NOOSE 戰術防暴裝甲車 (Riot Van)',
      x: blockBounds(2, 1).cx - 9,
      z: roadCoord(2) - 3.6,
      yaw: Math.PI / 2,
      color: 0x18181b,
      kind: 'swat',
    }
  );

  // 8. Explosive Red Barrels around Banks, Port & Intersections
  const barrelCoords: [number, number][] = [
    [blockBounds(2, 1).cx - 5, blockBounds(2, 1).maxZ - 0.8],
    [blockBounds(2, 1).cx + 5, blockBounds(2, 1).maxZ - 0.8],
    [blockBounds(0, 2).cx + 4, blockBounds(0, 2).cz - 5],
    [blockBounds(0, 2).cx + 6, blockBounds(0, 2).cz + 4],
    [blockBounds(0, 2).cx + 12, blockBounds(0, 2).cz],
    [blockBounds(4, 3).cx - 5, blockBounds(4, 3).cz - 4],
    [roadCoord(3) + 5, 8],
    [roadCoord(2) - 5, -12],
    [blockBounds(3, 2).cx + 2, blockBounds(3, 2).minZ - 1.5],
  ];

  barrelCoords.forEach(([bx, bz], idx) => {
    const mesh = createExplosiveBarrelMesh();
    mesh.position.set(bx, 0, bz);
    group.add(mesh);
    shootableMeshes.push(mesh);
    barrels.push({
      id: `barrel_${idx}`,
      mesh,
      x: bx,
      z: bz,
      exploded: false,
    });
  });

  // 9. Landmark Interaction Rings
  for (const lm of LANDMARKS) {
    if (!lm.interactPrompt) continue;
    const ringGeo = new THREE.RingGeometry(2.2, 2.8, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: lm.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(lm.x, 0.08, lm.z);
    group.add(ring);
  }

  // 10. Road Node Graph for AI Traffic
  const nodes: RoadNode[] = [];
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      nodes.push({ i, j, x: roadCoord(i), z: roadCoord(j) });
    }
  }

  // Outer World Boundary Colliders
  const worldWall = 8;
  colliders.push(
    { minX: -HALF - worldWall, maxX: HALF + worldWall, minZ: -HALF - 40, maxZ: -HALF - 2 },
    { minX: -HALF - worldWall, maxX: HALF + worldWall, minZ: HALF + 2, maxZ: HALF + worldWall },
    { minX: -HALF - worldWall, maxX: -HALF - 1, minZ: -HALF - 40, maxZ: HALF + worldWall },
    { minX: HALF + 1, maxX: HALF + worldWall, minZ: -HALF - 40, maxZ: HALF + worldWall }
  );

  scene.add(group);

  return {
    colliders,
    treeColliders,
    barrels,
    shootableMeshes,
    nodes,
    npcLoops,
    parkedSpots,
    policeSpawns,
  };
}
