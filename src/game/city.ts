import * as THREE from 'three';
import {
  LANDMARKS,
  STUNT_RAMPS,
  getTerrainHeight,
} from './data';
import {
  createCactusMesh,
  createExplosiveBarrelMesh,
  createFerrisWheelMesh,
  createLampMesh,
  createPalmTreeMesh,
  createStuntRampMesh,
  createTreeMesh,
  createWindTurbineMesh,
} from './meshes';
import {
  WorldTextures,
  createSignTexture,
  scaleFacadeUVs,
  tileBoxUVs,
  tilePlaneUVs,
} from './textures';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
  label?: string;
}

export interface BarrelEntity {
  id: string;
  mesh: THREE.Group;
  x: number;
  z: number;
  exploded: boolean;
}

export interface RoadNode {
  id: string;
  x: number;
  z: number;
  neighbors: string[];
}

export interface AnimatedWorldProp {
  kind: 'ferris_wheel' | 'wind_turbine' | 'radar' | 'ocean';
  object: THREE.Object3D;
  speed: number;
  baseY?: number;
}

export interface CityBuildResult {
  colliders: BoxCollider[];
  barrels: BarrelEntity[];
  shootableMeshes: THREE.Object3D[];
  roadNodes: Map<string, RoadNode>;
  animatedProps: AnimatedWorldProp[];
  applyTextures: (tex: WorldTextures) => void;
}

export function buildLosSantosCity(scene: THREE.Scene): CityBuildResult {
  const colliders: BoxCollider[] = [];
  const barrels: BarrelEntity[] = [];
  const shootableMeshes: THREE.Object3D[] = [];
  const roadNodes = new Map<string, RoadNode>();
  const animatedProps: AnimatedWorldProp[] = [];

  const roadMeshes: Array<{ mesh: THREE.Mesh; w: number; d: number }> = [];
  const sidewalkMeshes: Array<{ mesh: THREE.Mesh; w: number; d: number }> = [];
  const roofMeshes: Array<{ mesh: THREE.Mesh; w: number; d: number }> = [];
  const facadeMeshes: Array<{
    mesh: THREE.Mesh;
    kind: 'glass' | 'apt' | 'street' | 'civic' | 'ind';
    w: number;
    h: number;
    d: number;
  }> = [];

  let skyMesh: THREE.Mesh | null = null;

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.9 });
  const desertRoadMat = new THREE.MeshStandardMaterial({ color: 0x3f3a34, roughness: 0.92 });
  const runwayMat = new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.85 });
  const swMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 });
  const yellowLineMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.25,
    roughness: 0.6,
  });
  const whiteLineMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 });

  const addBuildingBox = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    color: number,
    kind: 'glass' | 'apt' | 'street' | 'civic' | 'ind' = 'glass',
    hasCollider = true
  ) => {
    const baseY = getTerrainHeight(x, z, false);
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleFacadeUVs(geo, w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: kind === 'glass' ? 0.28 : 0.68,
      metalness: kind === 'glass' ? 0.42 : 0.12,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, baseY + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    shootableMeshes.push(mesh);
    facadeMeshes.push({ mesh, kind, w, h, d });

    // Roof cap
    const roofGeo = new THREE.BoxGeometry(w - 0.3, 0.25, d - 0.3);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.82 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, baseY + h + 0.12, z);
    roof.receiveShadow = true;
    scene.add(roof);
    roofMeshes.push({ mesh: roof, w: w - 0.3, d: d - 0.3 });

    if (hasCollider) {
      colliders.push({
        minX: x - w / 2 - 0.3,
        maxX: x + w / 2 + 0.3,
        minZ: z - d / 2 - 0.3,
        maxZ: z + d / 2 + 0.3,
        maxY: baseY + h,
      });
    }
    return mesh;
  };

  let barrelSeq = 0;
  const addBarrel = (x: number, z: number) => {
    const id = `barrel_${barrelSeq++}`;
    const mesh = createExplosiveBarrelMesh();
    const y = getTerrainHeight(x, z, false);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    shootableMeshes.push(mesh);
    barrels.push({ id, mesh, x, z, exploded: false });
  };

  // ============================================================================
  // 1. SKY DOME & GOLDEN HOUR CALIFORNIA SUN
  // ============================================================================
  const skyGeo = new THREE.SphereGeometry(520, 32, 20);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xffd2a6,
    side: THREE.BackSide,
     fog: false,
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.position.y = 20;
  scene.add(skyMesh);

  // Glowing sunset sun disc over the western Pacific Ocean
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(26, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffedd5, fog: false })
  );
  sunDisc.position.set(-380, 145, -80);
  scene.add(sunDisc);

  // ============================================================================
  // 2. 3D DISPLACED MULTI-BIOME ISLAND TERRAIN MESH
  // ============================================================================
  const terrainSize = 640;
  const terrainSegs = 140;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegs, terrainSegs);
  terrainGeo.rotateX(-Math.PI / 2);

  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const vy = getTerrainHeight(vx, vz, false);
    posAttr.setY(i, vy);

    // Biome Vertex Coloring
    if (vy < -1.15) {
      // Shallow ocean sandbed
      c.setHex(0x0e7490);
    } else if (vx < -104 && vz > -45 && vz < 195) {
      // Vespucci Golden Sandy Beach
      c.setHex(vy < -0.2 ? 0xeab308 : 0xfde047);
    } else if (vz < -72 && vx >= -135 && vx <= 110) {
      // Vinewood Hills & Observatory Mountain Slopes
      if (vy > 21) {
        c.setHex(0x4d7c0f); // Summit plateau lawn
      } else if (vy > 8) {
        c.setHex(0x65a30d); // Lush chaparral hillside
      } else {
        c.setHex(0x3f6212);
      }
    } else if (vx > 96 && vz < 92) {
      // Sandy Shores Red Rock Mojave Desert
      const isRunway = vx >= 156 && vx <= 190 && vz >= -138 && vz <= 28;
      if (isRunway) {
        c.setHex(0x57534e); // Desert airfield packed dirt/tarmac
      } else if (vy > 3.5) {
        c.setHex(0xb45309); // Elevated desert red rock
      } else {
        c.setHex(0xd97706); // Golden-red desert sand
      }
    } else if (vz > 98 && vx > -95) {
      // LSIA International Airport Concrete Peninsula
      c.setHex(0x334155);
    } else {
      // Downtown & Central Los Santos Urban Turf
      c.setHex(0x166534);
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }

  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.04,
  });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
  shootableMeshes.push(terrainMesh);

  // ============================================================================
  // 3. PACIFIC OCEAN WATER & SURF FOAM (WEST & SOUTH COASTS)
  // ============================================================================
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.18,
    metalness: 0.55,
    transparent: true,
    opacity: 0.86,
  });
  const westOcean = new THREE.Mesh(new THREE.PlaneGeometry(260, 680), oceanMat);
  westOcean.rotation.x = -Math.PI / 2;
  westOcean.position.set(-290, -1.32, 0);
  scene.add(westOcean);
  animatedProps.push({ kind: 'ocean', object: westOcean, speed: 1.2, baseY: -1.32 });

  const southOcean = new THREE.Mesh(new THREE.PlaneGeometry(680, 180), oceanMat);
  southOcean.rotation.x = -Math.PI / 2;
  southOcean.position.set(20, -1.32, 295);
  scene.add(southOcean);

  // White surf foam strip along Vespucci Beach shoreline
  const surfFoam = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 340),
    new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.65 })
  );
  surfFoam.rotation.x = -Math.PI / 2;
  surfFoam.position.set(-164, -1.18, 25);
  scene.add(surfFoam);

  // ============================================================================
  // 4. ORGANIC ROAD NETWORK (HIGHWAYS, DOWNTOWN AVENUES, MOUNTAIN ROAD, ROUTE 68)
  // ============================================================================
  const addFlatRoadSegment = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width = 12,
    mat: THREE.MeshStandardMaterial = roadMat,
    centerLine = true
  ) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 14));
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const tm = (t0 + t1) / 2;
      const sx = x1 + (x2 - x1) * t0;
      const sz = z1 + (z2 - z1) * t0;
      const ex = x1 + (x2 - x1) * t1;
      const ez = z1 + (z2 - z1) * t1;
      const mx = (sx + ex) / 2;
      const mz = (sz + ez) / 2;

      const y0 = getTerrainHeight(sx, sz, false);
      const y1 = getTerrainHeight(ex, ez, false);
      const ym = (y0 + y1) / 2 + 0.08;

      const segLen = Math.hypot(ex - sx, ez - sz) + 0.35;
      const yaw = Math.atan2(ex - sx, ez - sz);
      const pitch = Math.atan2(y1 - y0, segLen);

      const segGroup = new THREE.Group();
      segGroup.position.set(mx, ym, mz);
      segGroup.rotation.order = 'YXZ';
      segGroup.rotation.y = yaw;
      segGroup.rotation.x = -pitch;

      const rMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, segLen), mat);
      rMesh.rotation.x = -Math.PI / 2;
      rMesh.receiveShadow = true;
      segGroup.add(rMesh);
      roadMeshes.push({ mesh: rMesh, w: width, d: segLen });

      if (centerLine) {
        const lineMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(0.28, segLen * 0.65),
          yellowLineMat
        );
        lineMesh.rotation.x = -Math.PI / 2;
        lineMesh.position.y = 0.02;
        segGroup.add(lineMesh);
      }

      scene.add(segGroup);
    }
  };

  // Downtown Avenues (North-South)
  const nsRoads = [-100, -32, 32, 95];
  for (const rx of nsRoads) {
    addFlatRoadSegment(rx, -70, rx, 115, 13);
  }
  // Downtown Boulevards (East-West)
  const ewRoads = [-70, -5, 65, 115];
  for (const rz of ewRoads) {
    addFlatRoadSegment(-100, rz, 95, rz, 13);
  }

  // Vinewood Hills Mountain Highway (climbing from z=-70 up to the Observatory at z=-145, y=24m!)
  addFlatRoadSegment(-32, -70, -10, -145, 12);
  addFlatRoadSegment(32, -70, 10, -145, 12);
  // Observatory Summit Loop Plaza
  addFlatRoadSegment(-42, -145, 42, -145, 12);

  // West Coastal Highway & Golden Gate Suspension Bridge Deck
  addFlatRoadSegment(-100, 115, -125, -35, 12);
  addFlatRoadSegment(-125, -35, -125, -145, 13); // Across the Crimson Suspension Bridge
  addFlatRoadSegment(-125, -145, -42, -145, 11); // Bridge North Exit into Vinewood Summit!

  // Route 68 Desert Highway (connecting Downtown to Sandy Shores Airfield)
  addFlatRoadSegment(95, -5, 172, -5, 12, desertRoadMat);
  addFlatRoadSegment(95, -70, 172, -70, 12, desertRoadMat);
  addFlatRoadSegment(95, 65, 172, 20, 12, desertRoadMat);

  // Sandy Shores Desert Airstrip Runway (x = 172, z from -135 to 25)
  addFlatRoadSegment(172, -135, 172, 25, 22, desertRoadMat, true);

  // LSIA International Airport Jet Runway (z = 155, x from -65 to 195)
  addFlatRoadSegment(-32, 115, -32, 155, 14, runwayMat);
  addFlatRoadSegment(32, 115, 32, 155, 14, runwayMat);
  addFlatRoadSegment(95, 115, 95, 155, 14, runwayMat);
  addFlatRoadSegment(-70, 155, 195, 155, 28, runwayMat, false);

  // Runway White Centerline Dashes & Threshold Markings at LSIA
  for (let rx = -58; rx <= 185; rx += 14) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 0.7), whiteLineMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(rx, 0.12, 155);
    scene.add(dash);
  }

  // ============================================================================
  // 5. ZONE 1: VESPUCCI BEACH & DEL PERRO PLEASURE PIER (WEST COAST)
  // ============================================================================
  // Wooden Pleasure Pier Deck (x in [-230, -106], z in [6, 34], y = 2.2)
  const pierDeckMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.85 });
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(110, 0.6, 28), pierDeckMat);
  pierDeck.position.set(-176, 1.95, 20);
  pierDeck.receiveShadow = true;
  pierDeck.castShadow = true;
  scene.add(pierDeck);

  // Sloped Entrance Ramp from Beach Road (-106, y=0) to Pier Deck (-122, y=2.2)
  const pierRamp = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 28), pierDeckMat);
  pierRamp.position.set(-114, 1.05, 20);
  pierRamp.rotation.z = -Math.atan2(2.2, 16);
  scene.add(pierRamp);

  // Wooden Pilings supporting the Pier in the Ocean
  const pilingMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });
  for (let px = -128; px >= -224; px -= 16) {
    for (const pz of [8, 20, 32]) {
      const piling = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 5.5, 8), pilingMat);
      piling.position.set(px, -0.5, pz);
      scene.add(piling);
    }
  }

  // Giant Animated Neon Ferris Wheel on Del Perro Pier!
  const ferris = createFerrisWheelMesh();
  ferris.root.position.set(-170, 2.2, 10);
  scene.add(ferris.root);
  animatedProps.push({ kind: 'ferris_wheel', object: ferris.wheel, speed: 0.45 });

  // Pier Neon Entrance Sign ("DEL PERRO PIER")
  const pierArch = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 8.5, 24),
    new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.4 })
  );
  pierArch.position.set(-124, 6.2, 20);
  scene.add(pierArch);
  const pierSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.6),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('DEL PERRO PLEASURE PIER', '#831843', '#fde047'),
      side: THREE.DoubleSide,
    })
  );
  pierSign.rotation.y = Math.PI / 2;
  pierSign.position.set(-123.3, 8.2, 20);
  scene.add(pierSign);

  // Lifeguard Towers & Palm Trees along Vespucci Beach
  const lifeguardColors = [0xef4444, 0x38bdf8, 0xfacc15];
  [-25, 55, 115].forEach((bz, idx) => {
    const by = getTerrainHeight(-142, bz, false);
    const tower = new THREE.Group();
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 2.4, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 })
    );
    cabin.position.y = 2.6;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(2.8, 1.2, 4),
      new THREE.MeshStandardMaterial({ color: lifeguardColors[idx % 3] })
    );
    roof.position.y = 4.4;
    roof.rotation.y = Math.PI / 4;
    const stilts = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.6, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8 })
    );
    stilts.position.y = 0.8;
    tower.add(stilts, cabin, roof);
    tower.position.set(-142, by, bz);
    scene.add(tower);
  });

  // 28 Swaying Palm Trees along Vespucci Beach Promenade & Pier Entrance
  for (let pz = -40; pz <= 160; pz += 14) {
    for (const px of [-106, -130]) {
      if (pz >= 4 && pz <= 36 && px < -110) continue; // skip pier footprint
      const palm = createPalmTreeMesh();
      palm.position.set(px, getTerrainHeight(px, pz, false), pz);
      palm.rotation.y = (pz * 0.7) % (Math.PI * 2);
      scene.add(palm);
    }
  }

  // ============================================================================
  // 6. ZONE 2: GOLDEN GATE CRIMSON SUSPENSION BRIDGE (NORTH-WEST BAY)
  // ============================================================================
  const bridgeRedMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.4,
    metalness: 0.45,
  });
  for (const bz of [-58, -118]) {
    const by = getTerrainHeight(-125, bz, false);
    for (const bx of [-132, -118]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, 38, 2.2), bridgeRedMat);
      leg.position.set(bx, by + 14, bz);
      leg.castShadow = true;
      scene.add(leg);
    }
    // Crossbeams on bridge tower
    for (const cy of [12, 24, 32]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(16, 1.8, 1.8), bridgeRedMat);
      beam.position.set(-125, by + cy, bz);
      scene.add(beam);
    }
  }

  // ============================================================================
  // 7. ZONE 3: VINEWOOD HILLS, OBSERVATORY & GIANT VINEWOOD SIGN (NORTH)
  // ============================================================================
  // Galileo Summit Observatory (at x = -10, z = -175, y = 24m)
  const obsY = getTerrainHeight(-10, -175, false);
  addBuildingBox(-10, -175, 42, 16, 10, 0xf8fafc, 'civic');

  const copperDomeMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    metalness: 0.72,
    roughness: 0.25,
  });
  // Main Central Telescope Dome & 2 Wing Domes
  const mainDome = new THREE.Mesh(
    new THREE.SphereGeometry(7.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    copperDomeMat
  );
  mainDome.position.set(-10, obsY + 10, -175);
  scene.add(mainDome);

  for (const dx of [-26, 6]) {
    const sideDome = new THREE.Mesh(
      new THREE.SphereGeometry(4.8, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      copperDomeMat
    );
    sideDome.position.set(dx, obsY + 10, -175);
    scene.add(sideDome);
  }

  // Observatory Sign & Obelisk Monument in Summit Plaza
  const obelisk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 1.2, 14, 4),
    new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.4 })
  );
  obelisk.position.set(-10, obsY + 7, -154);
  scene.add(obelisk);

  const obsSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.5),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('GALILEO OBSERVATORY · VINEWOOD HILLS', '#1e1b4b', '#fde047'),
      side: THREE.DoubleSide,
    })
  );
  obsSign.position.set(-10, obsY + 11.5, -166.8);
  scene.add(obsSign);

  // Giant 3D "VINEWOOD" Sign on the North-East Mountain Ridge!
  const vinewoodWord = 'VINEWOOD';
  const letterMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe2e8f0,
    emissiveIntensity: 0.35,
    roughness: 0.3,
  });
  for (let i = 0; i < vinewoodWord.length; i++) {
    const lx = 26 + i * 6.8;
    const lz = -168;
    const ly = getTerrainHeight(lx, lz, false);
    const letterCanvas = createSignTexture(vinewoodWord[i], '#ffffff', '#0f172a');
    const letterBoard = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 9.5, 0.8),
      new THREE.MeshStandardMaterial({ map: letterCanvas, roughness: 0.3 })
    );
    letterBoard.position.set(lx, ly + 5.2, lz);
    letterBoard.castShadow = true;
    scene.add(letterBoard);
  }

  // Vinewood Hills Luxury Cliffside Villas
  addBuildingBox(-58, -162, 18, 14, 9, 0xfef3c7, 'apt');
  addBuildingBox(52, -142, 16, 14, 8, 0xe0f2fe, 'glass');

  // ============================================================================
  // 8. ZONE 4: DOWNTOWN LOS SANTOS SKYSCRAPERS & ICONIC SHOPS (CENTER)
  // ============================================================================
  // 1) Maze Bank Tower (Centerpiece Skyscraper at x = 0, z = -38)
  addBuildingBox(0, -38, 24, 24, 62, 0xcbd5e1, 'glass');
  const mazeCrown = new THREE.Mesh(
    new THREE.CylinderGeometry(11, 13, 14, 16),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.55, roughness: 0.25 })
  );
  mazeCrown.position.set(0, 69, -38);
  scene.add(mazeCrown);
  const mazeSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 3.2),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('MAZE BANK TOWER', '#7f1d1d', '#ffffff'),
      side: THREE.DoubleSide,
    })
  );
  mazeSign.position.set(0, 56, -25.8);
  scene.add(mazeSign);

  // 2) Pacific Standard Bank (at x = -56, z = -34)
  addBuildingBox(-56, -34, 24, 20, 22, 0xd6d3d1, 'civic');
  for (let px = -65; px <= -47; px += 4.5) {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.75, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.45 })
    );
    pillar.position.set(px, 7, -23.2);
    scene.add(pillar);
  }
  const bankSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.8),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('PACIFIC STANDARD BANK', '#14532d', '#fde047'),
      side: THREE.DoubleSide,
    })
  );
  bankSign.position.set(-56, 16.5, -23.8);
  scene.add(bankSign);
  addBarrel(-44, -22);
  addBarrel(-68, -22);

  // 3) Pillbox Hill Medical Center (x = 56, z = -38)
  addBuildingBox(56, -38, 22, 20, 28, 0xe0f2fe, 'civic');
  const hospSign = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 2.5),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('+ PILLBOX MEDICAL +', '#064e3b', '#4ade80'),
      side: THREE.DoubleSide,
    })
  );
  hospSign.position.set(56, 18, -27.8);
  scene.add(hospSign);

  // 4) Ammu-Nation Flagship Store (x = 56, z = 28)
  addBuildingBox(56, 28, 22, 18, 12, 0x7f1d1d, 'street');
  const ammuSign = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 2.8),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('AMMU-NATION GUNS & RPG', '#991b1b', '#fef08a'),
      side: THREE.DoubleSide,
    })
  );
  ammuSign.position.set(56, 10.5, 18.8);
  scene.add(ammuSign);
  addBarrel(43, 20);

  // 5) Los Santos Customs Flagship Garage (x = -56, z = 48)
  addBuildingBox(-56, 48, 24, 18, 12, 0x3b0764, 'ind');
  const customsSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.8),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('LOS SANTOS CUSTOMS', '#4c1d95', '#e9d5ff'),
      side: THREE.DoubleSide,
    })
  );
  customsSign.position.set(-56, 10.5, 38.8);
  scene.add(customsSign);

  // 6) LSPD Police HQ & Additional Downtown High-Rises
  addBuildingBox(56, 86, 24, 18, 20, 0x1e3a8a, 'civic');
  addBuildingBox(-62, 86, 22, 20, 38, 0x334155, 'glass');
  addBuildingBox(0, 86, 22, 18, 34, 0x475569, 'apt');
  addBuildingBox(-75, -8, 16, 20, 30, 0x38bdf8, 'glass');
  addBuildingBox(72, -8, 16, 20, 26, 0x64748b, 'apt');

  // ============================================================================
  // 9. ZONE 5: SANDY SHORES RED ROCK DESERT, WIND FARM & TREVOR'S AIRFIELD (EAST)
  // ============================================================================
  // 5 Giant Animated Wind Turbines along the Senora Desert Ridge!
  const turbineCoords: Array<[number, number]> = [
    [122, -115],
    [126, -78],
    [122, -32],
    [126, 12],
    [122, 48],
  ];
  turbineCoords.forEach(([tx, tz], idx) => {
    const wt = createWindTurbineMesh();
    wt.root.position.set(tx, getTerrainHeight(tx, tz, false), tz);
    wt.root.rotation.y = -Math.PI / 3;
    wt.rotor.rotation.z = idx * 1.1;
    scene.add(wt.root);
    animatedProps.push({ kind: 'wind_turbine', object: wt.rotor, speed: 1.4 + (idx % 2) * 0.3 });
  });

  // Sandy Shores Airfield Hangar, Control Tower & Fuel Depot (around x = 172, z = -75)
  addBuildingBox(194, -85, 18, 26, 11, 0x78350f, 'ind'); // Rusty Desert Hangar
  addBuildingBox(194, -52, 9, 9, 22, 0x9a3412, 'ind'); // Airfield Control Tower
  const airfieldSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.6),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('SANDY SHORES AIRFIELD · TPI', '#7c2d12', '#fed7aa'),
      side: THREE.DoubleSide,
    })
  );
  airfieldSign.rotation.y = -Math.PI / 2;
  airfieldSign.position.set(184.8, 12.5, -85);
  scene.add(airfieldSign);

  // Helipad 'H' Circle at Sandy Shores Airfield (x = 172, z = -55)
  const createHelipad = (hx: number, hz: number) => {
    const hy = getTerrainHeight(hx, hz, false) + 0.12;
    const pad = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 6.0, 28),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(hx, hy, hz);
    scene.add(pad);
  };
  createHelipad(172, -55);

  // Red Rock Desert Buttes & Explosive Barrels at Sandy Shores
  for (const [bx, bz] of [
    [156, -92],
    [184, -95],
    [184, -68],
    [156, -42],
  ]) {
    addBarrel(bx, bz);
  }

  // 32 Saguaro Cacti & Red Rock Boulders across Sandy Shores Desert
  for (let cz = -155; cz <= 65; cz += 18) {
    for (const cx of [112, 145, 208]) {
      const cactus = createCactusMesh();
      cactus.position.set(cx, getTerrainHeight(cx, cz, false), cz);
      cactus.rotation.y = cz * 0.5;
      scene.add(cactus);
    }
  }

  // ============================================================================
  // 10. ZONE 6: LSIA INTERNATIONAL AIRPORT & COMMERCIAL JETS (SOUTH)
  // ============================================================================
  // LSIA Curved Terminal & Iconic Control Tower
  addBuildingBox(-15, 130, 44, 16, 14, 0x1e293b, 'glass');
  addBuildingBox(28, 128, 10, 10, 38, 0xe2e8f0, 'civic'); // LSIA Air Traffic Control Tower
  const lsiaSign = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 3.0),
    new THREE.MeshBasicMaterial({
      map: createSignTexture('LOS SANTOS INTL AIRPORT (LSIA)', '#0f172a', '#38bdf8'),
      side: THREE.DoubleSide,
    })
  );
  lsiaSign.position.set(-15, 14, 121.8);
  scene.add(lsiaSign);

  // LSIA VIP Helipad (x = -55, z = 145)
  createHelipad(-55, 145);

  // 2 Giant Commercial Passenger Jet Airliners parked on the LSIA Tarmac!
  const addCommercialJet = (jx: number, jz: number, yaw: number) => {
    const jet = new THREE.Group();
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.25,
      metalness: 0.35,
    });
    const blueTailMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.4,
    });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 32, 16), whiteMat);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.y = 3.6;
    jet.add(fuselage);

    const wings = new THREE.Mesh(new THREE.BoxGeometry(34, 0.35, 5.2), whiteMat);
    wings.position.set(0, 3.2, -1);
    jet.add(wings);

    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 7.5, 4.5), blueTailMat);
    tailFin.position.set(0, 7.2, 13.5);
    jet.add(tailFin);

    for (const ex of [-7.5, 7.5]) {
      const engine = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.0, 3.6, 12),
        blueTailMat
      );
      engine.rotation.x = Math.PI / 2;
      engine.position.set(ex, 2.1, -1.5);
      jet.add(engine);
    }

    jet.position.set(jx, getTerrainHeight(jx, jz, false), jz);
    jet.rotation.y = yaw;
    scene.add(jet);
    colliders.push({
      minX: jx - 12,
      maxX: jx + 12,
      minZ: jz - 12,
      maxZ: jz + 12,
      maxY: 10,
    });
  };

  addCommercialJet(52, 182, Math.PI / 2);
  addCommercialJet(125, 182, -Math.PI / 2);

  // ============================================================================
  // 11. STUNT JUMP RAMPS ACROSS ALL REGIONS
  // ============================================================================
  for (const r of STUNT_RAMPS) {
    const rampMesh = createStuntRampMesh(r.width, r.length, r.height);
    rampMesh.position.set(r.x, getTerrainHeight(r.x, r.z, false), r.z);
    rampMesh.rotation.y = r.yaw;
    scene.add(rampMesh);
  }

  // ============================================================================
  // 12. STREET LAMPS & TREES IN DOWNTOWN
  // ============================================================================
  for (const rx of nsRoads) {
    for (let z = -60; z <= 100; z += 32) {
      const lamp = createLampMesh();
      lamp.position.set(rx + 7.2, getTerrainHeight(rx + 7.2, z, false), z);
      scene.add(lamp);
    }
  }
  for (let tx = -85; tx <= 85; tx += 36) {
    const tree = createTreeMesh();
    tree.position.set(tx, getTerrainHeight(tx, 10, false), 10);
    scene.add(tree);
  }

  // ============================================================================
  // 13. AI TRAFFIC ROAD GRAPH
  // ============================================================================
  for (let r = 0; r < ewRoads.length; r++) {
    for (let c = 0; c < nsRoads.length; c++) {
      const id = `${r}_${c}`;
      const x = nsRoads[c];
      const z = ewRoads[r];
      const neighbors: string[] = [];
      if (r > 0) neighbors.push(`${r - 1}_${c}`);
      if (r < ewRoads.length - 1) neighbors.push(`${r + 1}_${c}`);
      if (c > 0) neighbors.push(`${r}_${c - 1}`);
      if (c < nsRoads.length - 1) neighbors.push(`${r}_${c + 1}`);
      roadNodes.set(id, { id, x, z, neighbors });
    }
  }

  // ============================================================================
  // 14. TEXTURE UPGRADE CALLBACK
  // ============================================================================
  const applyTextures = (tex: WorldTextures) => {
    if (skyMesh) {
      const sm = skyMesh.material as THREE.MeshBasicMaterial;
      sm.map = tex.sky;
      sm.color.setHex(0xffffff);
      sm.needsUpdate = true;
    }

    for (const r of roadMeshes) {
      const mat = (r.mesh.material as THREE.MeshStandardMaterial).clone();
      const map = tex.asphalt.clone();
      map.needsUpdate = true;
      tilePlaneUVs(r.mesh.geometry as THREE.PlaneGeometry, r.w, r.d, 8);
      mat.map = map;
      mat.color.setHex(0x8a8f98);
      mat.needsUpdate = true;
      r.mesh.material = mat;
    }

    for (const sw of sidewalkMeshes) {
      const mat = (sw.mesh.material as THREE.MeshStandardMaterial).clone();
      const map = tex.sidewalk.clone();
      map.needsUpdate = true;
      tileBoxUVs(sw.mesh.geometry as THREE.BoxGeometry, sw.w, 0.22, sw.d, 6);
      mat.map = map;
      mat.color.setHex(0xcbd5e1);
      mat.needsUpdate = true;
      sw.mesh.material = mat;
    }

    for (const rf of roofMeshes) {
      const mat = (rf.mesh.material as THREE.MeshStandardMaterial).clone();
      const map = tex.roof.clone();
      map.needsUpdate = true;
      tileBoxUVs(rf.mesh.geometry as THREE.BoxGeometry, rf.w, 0.25, rf.d, 6);
      mat.map = map;
      mat.color.setHex(0x94a3b8);
      mat.needsUpdate = true;
      rf.mesh.material = mat;
    }

    for (const f of facadeMeshes) {
      const mat = f.mesh.material as THREE.MeshStandardMaterial;
      const src =
        f.kind === 'glass'
          ? tex.glass
          : f.kind === 'apt'
            ? tex.apt
            : f.kind === 'civic'
              ? tex.civic
              : f.kind === 'ind'
                ? tex.industrial
                : tex.street;
      mat.map = src;
      mat.needsUpdate = true;
    }
  };

  return {
    colliders,
    barrels,
    shootableMeshes,
    roadNodes,
    animatedProps,
    applyTextures,
  };
}
