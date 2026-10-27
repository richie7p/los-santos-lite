import {
  CharacterId,
  CharacterProfile,
  Landmark,
  MissionDef,
  MissionId,
  NpcDialogueProfile,
  StuntRamp,
  WeaponId,
  WeaponSpec,
} from './types';

// === SAN ANDREAS ISLAND OPEN-WORLD DIMENSIONS ===
export const WORLD_SIZE = 560;
export const HALF = 265;
export const CITY = WORLD_SIZE;

// Legacy compatibility helper for road coordinates
export function roadCoord(idx: number): number {
  const coords = [-125, -75, -10, 45, 100, 165];
  return coords[Math.max(0, Math.min(coords.length - 1, idx))];
}

// === STUNT JUMP RAMPS ACROSS THE ISLAND ===
export const STUNT_RAMPS: StuntRamp[] = [
  {
    id: 'ramp_pier',
    name: '德爾佩羅跨海碼頭飛車跳台',
    x: -205,
    z: 20,
    yaw: Math.PI / 2, // facing West (-X) over the ocean/beach
    width: 9,
    length: 16,
    height: 4.8,
  },
  {
    id: 'ramp_vinewood_cliff',
    name: '好麥塢天文台懸崖極限跳台',
    x: 18,
    z: -136,
    yaw: Math.PI, // facing South (+Z) launching off the 24m mountain cliff over Downtown!
    width: 10,
    length: 16,
    height: 4.5,
  },
  {
    id: 'ramp_downtown_plaza',
    name: '花園銀行廣場飛躍跳台',
    x: -10,
    z: 28,
    yaw: 0, // facing North (-Z)
    width: 8.5,
    length: 14,
    height: 4.0,
  },
  {
    id: 'ramp_lsia_runway_east',
    name: '洛聖都國際機場跑道飛越客機跳台',
    x: 85,
    z: 155,
    yaw: -Math.PI / 2, // facing East (+X)
    width: 10,
    length: 18,
    height: 5.0,
  },
  {
    id: 'ramp_lsia_runway_west',
    name: '國際機場西側航廈特技跳台',
    x: 15,
    z: 155,
    yaw: Math.PI / 2, // facing West (-X)
    width: 10,
    length: 18,
    height: 4.8,
  },
  {
    id: 'ramp_sandy_dunes',
    name: '桑迪沙漠風車峽谷飛車跳台',
    x: 142,
    z: -25,
    yaw: 0, // facing North (-Z)
    width: 9.5,
    length: 16,
    height: 4.6,
  },
];

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Continuous 3D Terrain Elevation for San Andreas Island:
 * - Vinewood Hills & Observatory Plateau in the North (up to y = 24m)
 * - Del Perro Wooden Pier on the West Coast (y = 2.2m)
 * - Golden Gate Suspension Bridge on the North-West Bay
 * - Sandy Shores Desert Mesa & Airfield in the East (y = 2.4m)
 * - Vespucci Golden Beach & Ocean Slope on the West/South-West Coast
 * - Optional Stunt Ramp elevation
 */
export function getTerrainHeight(x: number, z: number, includeRamps = true): number {
  let h = 0;

  // 1. Del Perro Pleasure Pier (x in [-232, -106], z in [6, 34])
  if (z >= 6 && z <= 34 && x >= -232 && x <= -106) {
    if (x <= -122) {
      h = 2.2;
    } else {
      h = 2.2 * smoothstep(-106, -122, x);
    }
    if (includeRamps) {
      h = Math.max(h, getRampHeightAt(x, z, h));
    }
    return h;
  }

  // 2. North-West Crimson Suspension Bridge (x in [-136, -114], z in [-145, -35])
  if (x >= -136 && x <= -114 && z >= -145 && z <= -35) {
    const bridgeT = smoothstep(-35, -145, z);
    const arch = Math.sin(bridgeT * Math.PI) * 4.5;
    h = bridgeT * 14.0 + arch;
    return h;
  }

  // 3. Vinewood Hills & Galileo Observatory Summit (North: z < -72, x in [-135, 110])
  if (z < -72 && x >= -135 && x <= 110) {
    const northFactor = smoothstep(-72, -140, z);
    const eastWestFalloff =
      1 -
      smoothstep(68, 110, x) -
      smoothstep(-85, -135, x);
    const clampedEW = Math.max(0, Math.min(1, eastWestFalloff));
    h = Math.max(h, 24.0 * northFactor * clampedEW);
  }

  // 4. Sandy Shores Desert Mesa & Airfield (East: x > 98, z in [-190, 88])
  if (x > 98 && z >= -190 && z <= 88) {
    const eastFactor = smoothstep(98, 132, x);
    const zFactor = 1 - smoothstep(65, 88, z);
    let desertH = 2.4 * eastFactor * zFactor;

    // Scenic desert hills outside the flat runway strip (runway is x in [158, 192], z in [-135, 25])
    const onRunway = x >= 150 && x <= 202 && z >= -145 && z <= 35;
    const onRoute68 = z >= -52 && z <= -32;
    if (!onRunway && !onRoute68 && x > 135) {
      const dune =
        (Math.sin(x * 0.055) * Math.cos(z * 0.055) + 1) *
        1.8 *
        smoothstep(135, 160, x);
      desertH += dune;
    }
    h = Math.max(h, desertH);
  }

  // 5. West Coast Vespucci Beach & Ocean Slope (x < -105)
  if (x < -105) {
    const beachSlope = smoothstep(-105, -168, x);
    const oceanDrop = smoothstep(-168, -195, x);
    const westH = -1.0 * beachSlope - 1.4 * oceanDrop;
    if (h === 0) {
      h = westH;
    }
  }

  // 6. South Ocean Coastline beyond LSIA (z > 205)
  if (z > 205) {
    const southSlope = smoothstep(205, 235, z);
    h = Math.min(h, -2.2 * southSlope);
  }

  if (includeRamps) {
    h = Math.max(h, getRampHeightAt(x, z, h));
  }

  return h;
}

export function getRampHeightAt(x: number, z: number, baseH: number): number {
  for (const r of STUNT_RAMPS) {
    const dx = x - r.x;
    const dz = z - r.z;
    // Transform into ramp local space where -Z is forward (launch direction)
    const cos = Math.cos(-r.yaw);
    const sin = Math.sin(-r.yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    const halfW = r.width / 2;
    const halfL = r.length / 2;
    if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfL) {
      // lz goes from +halfL (entrance, height 0) to -halfL (launch lip, height r.height)
      const t = (halfL - lz) / r.length;
      const rampBase = getTerrainHeight(r.x, r.z, false);
      return rampBase + Math.max(0, Math.min(1, t)) * r.height;
    }
  }
  return baseH;
}

export const PROTAGONISTS: Record<CharacterId, CharacterProfile> = {
  michael: {
    id: 'michael',
    name: '麥可 · 德聖塔',
    enName: 'Michael De Santa',
    title: '傳奇銀行劫匪 · 精準神射手',
    color: '#38bdf8',
    accentHex: 0x38bdf8,
    suitColor: 0x1e293b,
    shirtColor: 0xe2e8f0,
    hairColor: 0x3f2e21,
    skinColor: 0xf1c27d,
    specialName: '子彈時間 (Bullet Time)',
    specialDesc: '減緩全場時間流逝 65%，射擊零後座力且爆頭傷害提升至 2.5 倍。',
    spawnPos: [-18, -12], // Downtown Plaza near Maze Bank & Pacific Standard
    spawnYaw: 0,
    defaultWeapon: 'rifle',
    stats: { shooting: 96, driving: 78, stamina: 75, special: 92 },
  },
  franklin: {
    id: 'franklin',
    name: '富蘭克林 · 克林頓',
    enName: 'Franklin Clinton',
    title: '街頭王牌車手 · 極限甩尾專家',
    color: '#22c55e',
    accentHex: 0x22c55e,
    suitColor: 0x14532d,
    shirtColor: 0xf8fafc,
    hairColor: 0x18181b,
    skinColor: 0x8d5524,
    specialName: '極限駕馭 (Driving Focus)',
    specialDesc: '提升移動與駕車抓地力、減緩時間流逝，並強化車窗單手射擊精準度。',
    spawnPos: [-115, 18], // Vespucci Beach & Del Perro Ferris Wheel Pier entrance!
    spawnYaw: -Math.PI / 2,
    defaultWeapon: 'smg',
    stats: { shooting: 80, driving: 99, stamina: 94, special: 88 },
  },
  trevor: {
    id: 'trevor',
    name: '崔佛 · 菲利普',
    enName: 'Trevor Philips',
    title: '桑迪海岸軍火狂人 · 重裝爆破手',
    color: '#f97316',
    accentHex: 0xf97316,
    suitColor: 0x7c2d12,
    shirtColor: 0xd6d3d1,
    hairColor: 0x27272a,
    skinColor: 0xe0ac69,
    specialName: '狂暴模式 (Red Mist)',
    specialDesc: '輸出雙倍槍械與爆破傷害、僅承受 15% 傷害，且射擊不消耗彈匣。',
    spawnPos: [162, -68], // Sandy Shores Desert Airfield next to the Buzzard Attack Helicopter!
    spawnYaw: Math.PI / 2,
    defaultWeapon: 'shotgun',
    stats: { shooting: 89, driving: 86, stamina: 90, special: 99 },
  },
};

export const WEAPON_WHEEL_ORDER: WeaponId[] = [
  'unarmed',
  'pistol',
  'smg',
  'shotgun',
  'rifle',
  'sniper',
  'rpg',
  'minigun',
];

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  unarmed: {
    id: 'unarmed',
    slot: 0,
    name: '徒手重拳',
    enName: 'Unarmed Melee',
    category: '近身格鬥',
    damage: 38,
    fireRate: 2.6,
    pellets: 1,
    spread: 0.02,
    recoilKick: 0.01,
    range: 3.8,
    magSize: 1,
    maxReserve: 1,
    reloadTime: 0,
    automatic: false,
    driveBy: false,
    price: 0,
    color: '#94a3b8',
  },
  pistol: {
    id: 'pistol',
    slot: 1,
    name: '9mm 戰術手槍',
    enName: 'Combat Pistol',
    category: '隨身手槍',
    damage: 34,
    fireRate: 5.5,
    pellets: 1,
    spread: 0.012,
    recoilKick: 0.018,
    range: 95,
    magSize: 16,
    maxReserve: 160,
    reloadTime: 1.0,
    automatic: false,
    driveBy: true,
    price: 0,
    color: '#60a5fa',
  },
  smg: {
    id: 'smg',
    slot: 2,
    name: '微型衝鋒槍',
    enName: 'Micro SMG',
    category: '車用衝鋒槍',
    damage: 24,
    fireRate: 13.5,
    pellets: 1,
    spread: 0.032,
    recoilKick: 0.014,
    range: 85,
    magSize: 35,
    maxReserve: 350,
    reloadTime: 1.25,
    automatic: true,
    driveBy: true,
    price: 600,
    color: '#34d399',
  },
  shotgun: {
    id: 'shotgun',
    slot: 3,
    name: '泵動式戰術霰彈槍',
    enName: 'Pump Shotgun',
    category: '近戰重火器',
    damage: 22,
    fireRate: 1.45,
    pellets: 8,
    spread: 0.075,
    recoilKick: 0.055,
    range: 48,
    magSize: 8,
    maxReserve: 80,
    reloadTime: 1.65,
    automatic: false,
    driveBy: false,
    price: 1200,
    color: '#fbbf24',
  },
  rifle: {
    id: 'rifle',
    slot: 4,
    name: 'M4 特戰卡賓步槍',
    enName: 'Special Carbine',
    category: '突擊步槍',
    damage: 38,
    fireRate: 10.5,
    pellets: 1,
    spread: 0.018,
    recoilKick: 0.02,
    range: 145,
    magSize: 30,
    maxReserve: 300,
    reloadTime: 1.4,
    automatic: true,
    driveBy: false,
    price: 1800,
    color: '#38bdf8',
  },
  sniper: {
    id: 'sniper',
    slot: 5,
    name: '巴雷特重型狙擊步槍',
    enName: 'Heavy Sniper',
    category: '遠程精準狙擊',
    damage: 210,
    fireRate: 0.95,
    pellets: 1,
    spread: 0.001,
    recoilKick: 0.075,
    range: 280,
    magSize: 6,
    maxReserve: 60,
    reloadTime: 1.9,
    automatic: false,
    driveBy: false,
    scopeZoom: 22,
    price: 3200,
    color: '#a78bfa',
  },
  rpg: {
    id: 'rpg',
    slot: 6,
    name: 'RPG-7 反裝甲火箭筒',
    enName: 'RPG Launcher',
    category: '重型爆破武器',
    damage: 450,
    fireRate: 0.65,
    pellets: 1,
    spread: 0.004,
    recoilKick: 0.09,
    range: 220,
    magSize: 2,
    maxReserve: 20,
    reloadTime: 2.1,
    automatic: false,
    driveBy: false,
    explosive: true,
    price: 4500,
    color: '#f87171',
  },
  minigun: {
    id: 'minigun',
    slot: 7,
    name: '火神六管加特林機槍',
    enName: 'Vulcan Minigun',
    category: '毀滅重機槍',
    damage: 32,
    fireRate: 24.0,
    pellets: 1,
    spread: 0.038,
    recoilKick: 0.012,
    range: 135,
    magSize: 200,
    maxReserve: 1000,
    reloadTime: 2.2,
    automatic: true,
    driveBy: false,
    price: 6000,
    color: '#fb923c',
  },
};

export interface VehicleSpec {
  id: string;
  name: string;
  maxSpeed: number;
  accel: number;
  handling: number;
  maxHp: number;
  width: number;
  length: number;
  height: number;
  color: number;
  isPolice?: boolean;
  isSport?: boolean;
  isCashTruck?: boolean;
  isAircraft?: boolean;
  isOffroad?: boolean;
}

export const VEHICLE_SPECS: Record<string, VehicleSpec> = {
  zentorno: {
    id: 'zentorno',
    name: '佩嘉西 · 桑托勞超跑 (Zentorno)',
    maxSpeed: 56,
    accel: 44,
    handling: 3.7,
    maxHp: 560,
    width: 2.2,
    length: 4.6,
    height: 1.22,
    color: 0xdc2626,
    isSport: true,
  },
  banshee: {
    id: 'banshee',
    name: '布拉瓦多 · 女妖 GT (Banshee)',
    maxSpeed: 54,
    accel: 42,
    handling: 3.6,
    maxHp: 540,
    width: 2.15,
    length: 4.5,
    height: 1.24,
    color: 0x0ea5e9,
    isSport: true,
  },
  comet: {
    id: 'comet',
    name: '菲斯特 · 陸上彗星 (Comet SR)',
    maxSpeed: 52,
    accel: 40,
    handling: 3.8,
    maxHp: 520,
    width: 2.1,
    length: 4.4,
    height: 1.24,
    color: 0xfacc15,
    isSport: true,
  },
  sandking: {
    id: 'sandking',
    name: '威皮 · 沙王 XL 越野巨獸 (Sandking)',
    maxSpeed: 46,
    accel: 38,
    handling: 3.2,
    maxHp: 900,
    width: 2.45,
    length: 5.2,
    height: 1.85,
    color: 0xf97316,
    isOffroad: true,
  },
  buzzard: {
    id: 'buzzard',
    name: '長崎 · 禿鷹武裝直升機 (Buzzard Chopper)',
    maxSpeed: 68,
    accel: 50,
    handling: 3.4,
    maxHp: 1100,
    width: 2.8,
    length: 6.4,
    height: 2.4,
    color: 0x18181b,
    isAircraft: true,
  },
  sedan: {
    id: 'sedan',
    name: '奧北 · 密探房車 (Tailgater)',
    maxSpeed: 38,
    accel: 28,
    handling: 2.9,
    maxHp: 500,
    width: 2.1,
    length: 4.5,
    height: 1.42,
    color: 0x475569,
  },
  suv: {
    id: 'suv',
    name: '貝飛特 · 奔馳休旅 (Dubsta V8)',
    maxSpeed: 36,
    accel: 26,
    handling: 2.6,
    maxHp: 780,
    width: 2.3,
    length: 4.8,
    height: 1.68,
    color: 0x1e293b,
  },
  police: {
    id: 'police',
    name: 'LSPD 攔截者警車 (Interceptor)',
    maxSpeed: 47,
    accel: 37,
    handling: 3.3,
    maxHp: 680,
    width: 2.15,
    length: 4.65,
    height: 1.45,
    color: 0x0f172a,
    isPolice: true,
  },
  cash_truck: {
    id: 'cash_truck',
    name: 'Gruppe Sechs 黃金裝甲運鈔車',
    maxSpeed: 31,
    accel: 22,
    handling: 2.3,
    maxHp: 950,
    width: 2.45,
    length: 5.4,
    height: 2.1,
    color: 0x065f46,
    isCashTruck: true,
  },
};

export const LANDMARKS: Landmark[] = [
  {
    id: 'del_perro_pier',
    name: '德爾佩羅海濱摩天輪碼頭 (Del Perro Pier)',
    region: '威斯普奇陽光海岸',
    description: '擁有巨型發光摩天輪、棕櫚樹陽光沙灘與跨海飛車特技跳台。',
    type: 'pier',
    x: -165,
    z: 20,
    color: '#f472b6',
    icon: '🎡',
  },
  {
    id: 'vinewood_observatory',
    name: '好麥塢伽利略山頂天文台 (Galileo Observatory)',
    region: '好麥塢山脈',
    description: '海拔 24 公尺山頂觀景台，緊鄰 VINEWOOD 巨型地標與懸崖飛車跳台。',
    type: 'observatory',
    x: -10,
    z: -165,
    color: '#c084fc',
    icon: '🔭',
  },
  {
    id: 'maze_tower',
    name: '花園銀行摩天大樓 (Maze Bank Tower)',
    region: '洛聖都金融中心',
    description: '聖安地列斯最高圓柱摩天大樓與噴泉廣場。',
    type: 'tower',
    x: 0,
    z: 0,
    color: '#38bdf8',
    icon: '🏙️',
  },
  {
    id: 'pacific_bank',
    name: '太平洋標準銀行 (Pacific Standard Bank)',
    region: '洛聖都金融中心',
    description: '存放巨額不記名債券的古典石柱金庫大樓。',
    type: 'bank',
    x: -52,
    z: -32,
    color: '#facc15',
    icon: '🏦',
    interactPrompt: '按 [E] 啟動【第四章：太平洋標準銀行驚天大劫案】',
  },
  {
    id: 'ammu_nation',
    name: '武裝國度軍火總店 (Ammu-Nation)',
    region: '洛聖都金融中心',
    description: '提供八格武器彈藥補給、重型防彈護甲與 RPG 火箭筒。',
    type: 'ammu',
    x: 52,
    z: 28,
    color: '#ef4444',
    icon: '🔫',
    interactPrompt: '按 [E] 進入【武裝國度】補給全武器彈藥與重裝護甲',
  },
  {
    id: 'ls_customs',
    name: '洛聖都改車王旗艦廠 (LS Customs)',
    region: '洛聖都金融中心',
    description: '提供偽造車牌消星、引擎板金修復與賽博霓虹烤漆。',
    type: 'customs',
    x: -52,
    z: 52,
    color: '#a855f7',
    icon: '🔧',
    interactPrompt: '按 [E] 進入【洛聖都改車王】修復座駕／消除警方通緝',
  },
  {
    id: 'sandy_airfield',
    name: '桑迪海岸沙漠機場 (Sandy Shores Airfield)',
    region: '桑迪海岸紅岩沙漠',
    description: '崔佛的私人沙漠機場，停放可親自駕駛的【禿鷹武裝直升機】與越野大腳車。',
    type: 'airfield',
    x: 172,
    z: -65,
    color: '#fb923c',
    icon: '🚁',
  },
  {
    id: 'lsia_airport',
    name: '洛聖都國際機場 (LSIA International Airport)',
    region: '南灣航空港',
    description: '超長噴射機起降跑道、停機坪巨型客機、塔台與武裝直升機停機坪。',
    type: 'airport',
    x: 50,
    z: 155,
    color: '#2dd4bf',
    icon: '✈️',
  },
  {
    id: 'central_hospital',
    name: '圓柱山醫療中心 (Pillbox Medical)',
    region: '洛聖都金融中心',
    description: '重傷倒地後的緊急醫療重生中心。',
    type: 'hospital',
    x: 52,
    z: -38,
    color: '#22c55e',
    icon: '➕',
  },
];

export const MISSION_ORDER: MissionId[] = [
  'street_warmup',
  'simeon_repo',
  'pier_arms',
  'pacific_heist',
  'federal_lockdown',
];

export const MISSIONS: Record<MissionId, MissionDef> = {
  street_warmup: {
    id: 'street_warmup',
    chapter: 1,
    title: '第一章：威斯普奇陽光海灘極速試駕',
    enTitle: 'Ch.1: Vespucci Beach & Pier Drive',
    giver: '拉瑪 · 戴維斯 (Lamar)',
    recommendedChar: 'franklin',
    reward: 35000,
    description:
      '在威斯普奇海灘與德爾佩羅摩天輪碼頭奪取限量超跑，衝過海濱大道前往市中心武裝國度領取重裝彈藥庫。',
    startPos: [-112, 18],
    steps: [
      {
        id: 'enter_pier_supercar',
        instruction: '前往【威斯普奇海濱大道】按 [E] 坐上停放的敞篷超跑',
        targetPos: [-112, 18],
        radius: 12,
        type: 'enter_car',
      },
      {
        id: 'drive_to_ammu',
        instruction: '駕車從海濱大道疾馳至市中心【武裝國度軍火店】領取全套重裝軍火',
        targetPos: [52, 18],
        radius: 15,
        type: 'goto',
      },
    ],
  },
  simeon_repo: {
    id: 'simeon_repo',
    chapter: 2,
    title: '第二章：好麥塢山頂天文台超跑劫持',
    enTitle: 'Ch.2: Vinewood Observatory Heist',
    giver: '西門 · 葉特理恩 (Simeon)',
    recommendedChar: 'franklin',
    reward: 75000,
    description:
      '沿著蜿蜒山路攻上海拔 24 公尺的【好麥塢伽利略山頂天文台】，擊潰富豪保鑣並奪取黃金超跑，從山頂懸崖跳台飛躍回洛聖都改車王！',
    startPos: [-10, -148],
    steps: [
      {
        id: 'go_observatory',
        instruction: '沿北側蜿蜒山路登上【好麥塢山頂天文台廣場】',
        targetPos: [-10, -148],
        radius: 16,
        type: 'goto',
      },
      {
        id: 'kill_bodyguards',
        instruction: '殲滅天文台廣場上的 4 名武裝富豪保鑣',
        targetPos: [-10, -160],
        radius: 28,
        type: 'kill_targets',
      },
      {
        id: 'steal_supercar',
        instruction: '按 [E] 坐上停放在天文台前的【黃金女妖超跑】',
        targetPos: [10, -152],
        radius: 10,
        type: 'enter_car',
      },
      {
        id: 'deliver_customs',
        instruction: '衝下山道（或飛越山頂懸崖跳台！）將超跑送達【洛聖都改車王】',
        targetPos: [-52, 42],
        radius: 15,
        type: 'deliver_car',
      },
    ],
  },
  pier_arms: {
    id: 'pier_arms',
    chapter: 3,
    title: '第三章：桑迪沙漠機場 · 禿鷹直升機軍火戰',
    enTitle: 'Ch.3: Sandy Shores Airfield Assault',
    giver: '崔佛 · 菲利普企業 (TPI)',
    recommendedChar: 'trevor',
    reward: 110000,
    description:
      '殺入東側紅岩沙漠的【桑迪海岸機場】，引爆黑幫油罐、奪取重型實驗軍火箱，並可親自駕駛停機坪上的【禿鷹武裝直升機】升空作戰！',
    startPos: [165, -45],
    steps: [
      {
        id: 'go_airfield',
        instruction: '經由 68 號沙漠公路前往東側【桑迪海岸沙漠機場】',
        targetPos: [165, -45],
        radius: 18,
        type: 'goto',
      },
      {
        id: 'clear_cartel',
        instruction: '清剿沙漠機場跑道上的 6 名重裝軍火販子（可善用紅油桶與武裝直升機）',
        targetPos: [172, -75],
        radius: 36,
        type: 'kill_targets',
      },
      {
        id: 'take_crate',
        instruction: '奪取機棚前的【重型軍火空投箱】（解鎖滿彈 RPG 與火神機槍）',
        targetPos: [172, -88],
        radius: 9,
        type: 'pickup',
      },
      {
        id: 'survive_backup',
        instruction: '使用重火器或駕駛【禿鷹武裝直升機】殲滅沙漠增援小隊',
        targetPos: [172, -65],
        radius: 42,
        type: 'kill_targets',
      },
    ],
  },
  pacific_heist: {
    id: 'pacific_heist',
    chapter: 4,
    title: '第四章：太平洋標準銀行驚天大劫案',
    enTitle: 'Ch.4: The Pacific Standard Job',
    giver: '萊斯特 · 克瑞斯特 (Lester)',
    recommendedChar: 'michael',
    reward: 180000,
    description:
      '突襲市中心【太平洋標準銀行】，擊潰重裝保全、奪取金庫巨額債券，並在四星特警與警用武裝直升機圍捕下逃出生天！',
    startPos: [-52, -18],
    steps: [
      {
        id: 'go_bank',
        instruction: '前往市中心【太平洋標準銀行】正門光柱集合',
        targetPos: [-52, -18],
        radius: 12,
        type: 'goto',
      },
      {
        id: 'kill_guards',
        instruction: '殲滅銀行門口的 5 名重裝特勤保全',
        targetPos: [-52, -26],
        radius: 24,
        type: 'kill_targets',
      },
      {
        id: 'grab_cash',
        instruction: '衝入銀行大廳奪取【黃金債券袋】（觸發四星特警與直升機追捕）',
        targetPos: [-52, -30],
        radius: 9,
        type: 'pickup',
      },
      {
        id: 'escape_cops',
        instruction: '駕車前往【洛聖都改車王】消星或脫離警方視線完成分紅',
        targetPos: [-52, 42],
        radius: 15,
        type: 'escape_wanted',
      },
    ],
  },
  federal_lockdown: {
    id: 'federal_lockdown',
    chapter: 5,
    title: '終章：洛聖都國際機場 · 五星陸空決戰',
    enTitle: 'Ch.5: LSIA Airport 5-Star Showdown',
    giver: '萊斯特 · 終極行動 (Finale)',
    recommendedChar: 'trevor',
    reward: 300000,
    description:
      '在南灣【洛聖都國際機場跑道】迎戰 FIB 與 NOOSE 五星聯邦特警小隊，使用 RPG 火箭筒或駕駛武裝直升機擊落空中警用武裝直升機，制霸聖安地列斯！',
    startPos: [35, 155],
    steps: [
      {
        id: 'rally_lsia',
        instruction: '前往南灣【洛聖都國際機場主跑道】啟動終極決戰（自動補給滿彈 RPG 與加特林）',
        targetPos: [35, 155],
        radius: 16,
        type: 'goto',
      },
      {
        id: 'defeat_swat_and_heli',
        instruction: '殲滅 8 名 NOOSE 聯邦特警，並用 RPG 或禿鷹直升機擊落【警用武裝直升機】！',
        targetPos: [55, 155],
        radius: 55,
        type: 'destroy_heli',
      },
    ],
  },
};

export const NPC_DIALOGUES: NpcDialogueProfile[] = [
  {
    name: '戴夫 · 諾頓',
    job: '威斯普奇海灘衝浪客',
    personality: '陽光悠閒',
    linesNormal: [
      '兄弟，德爾佩羅碼頭的巨型摩天輪在夕陽下超美！而且碼頭盡頭還有個飛車跳台可以直接飛越海面！',
      '沿著西岸的赤紅跨海大橋一路往北開，就能直接衝上好麥塢山頂天文台俯瞰整座島嶼！',
    ],
    linesWanted: [
      '天啊！海灘上怎麼會有重型軍火交火？！快往海裡躲！',
      '警用武裝直升機飛過摩天輪了！別開槍啊！',
    ],
  },
  {
    name: '崔西 · 德聖塔',
    job: '好麥塢山脈網紅主播',
    personality: '浮誇熱情',
    linesNormal: [
      '我正在拍北山巨型 VINEWOOD 標誌與伽利略天文台的直播，千萬別把我的跑車刮花了！',
      '聽說從天文台懸崖邊的特技跳台衝出去，可以直接飛越半個洛聖都金融區！',
    ],
    linesWanted: [
      '救命啊！直播間觀眾快看，有人在跟特警隊正面火拼！',
      '別拿槍指著我！我老爸是麥可·德聖塔！',
    ],
  },
  {
    name: '韋德 · 赫伯特',
    job: '桑迪海岸機場地勤',
    personality: '神經質',
    linesNormal: [
      '崔佛老大在東邊的桑迪沙漠機場停了一架黑色【禿鷹武裝直升機】，按 [E] 坐進去就能按空白鍵直接飛上高空！',
      '68 號沙漠公路旁邊的大風車陣超壯觀，開沙王 XL 大腳車在紅岩峽谷越野最爽了！',
    ],
    linesWanted: [
      'LSPD 跟 NOOSE 特警殺進沙漠啦！快開武裝直升機升空反擊！',
      '轟隆隆！連紅油桶跟裝甲車都炸飛天了！',
    ],
  },
  {
    name: '富蘭克林的車友 · 傑拉德',
    job: '洛聖都國際機場機師',
    personality: '冷靜專業',
    linesNormal: [
      '南邊的洛聖都國際機場（LSIA）不僅有超長噴射機跑道與兩個飛越客機的特技跳台，VIP 停機坪也有武裝直升機可以開！',
      '按 [M] 可以隨時打開【聖安地列斯全島衛星大地圖】，點擊任何地標就能透過衛星視角一鍵空降傳送！',
    ],
    linesWanted: [
      '五星通緝的警用武裝直升機出動了，用 RPG 火箭筒或開禿鷹直升機跟它空戰吧！',
      '快衝進洛聖都改車王換車牌，或者飛到高空甩開警察視線！',
    ],
  },
];

export function getDistrictName(x: number, z: number): string {
  if (x < -105) {
    if (z >= -5 && z <= 45 && x < -120) return '德爾佩羅摩天輪碼頭 (Del Perro Pier)';
    if (z < -35) return '聖安地列斯跨海大橋 (Golden Bay Bridge)';
    return '威斯普奇陽光沙灘 (Vespucci Beach)';
  }
  if (z < -75) {
    if (x > 35) return '好麥塢山脈 · VINEWOOD 地標嶺';
    return '好麥塢山頂 · 伽利略天文台 (Vinewood Hills)';
  }
  if (x > 98 && z < 90) {
    if (x > 145 && z < 30 && z > -140) return '桑迪海岸沙漠機場 (Sandy Shores Airfield)';
    return '桑迪海岸紅岩沙漠 · 風車陣 (Sandy Shores)';
  }
  if (z > 100) {
    return '洛聖都國際機場 (LSIA International Airport)';
  }
  if (Math.abs(x) < 42 && Math.abs(z) < 42) {
    return '花園銀行摩天核心區 (Downtown Pillbox Hill)';
  }
  return '洛聖都商業大道 (Los Santos Central)';
}
