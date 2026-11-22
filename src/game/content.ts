/** World content: points of interest, collectibles, races. All original. */
import type { WeaponId } from './data';

export interface POI {
  id: string;
  kind: 'safehouse' | 'garage' | 'ammu' | 'hospital' | 'police' | 'courier' | 'store';
  name: string;
  x: number;
  z: number;
  /** For drive-in locations: where the car should stop. */
  dx?: number;
  dz?: number;
  yaw?: number;
}

export const POIS: POI[] = [
  { id: 'safehouse', kind: 'safehouse', name: '安全屋 · 楓街公寓', x: -225, z: -81, yaw: Math.PI },
  { id: 'garage', kind: 'garage', name: '老韓修車廠', x: 261, z: -135, dx: 265, dz: -135, yaw: 0 },
  { id: 'ammu1', kind: 'ammu', name: '鐵砧槍械行 · 海濱店', x: 135, z: 279 },
  { id: 'ammu2', kind: 'ammu', name: '鐵砧槍械行 · 西區店', x: -279, z: 45 },
  { id: 'hospital', kind: 'hospital', name: '聖光綜合醫院', x: 135, z: -99 },
  { id: 'police', kind: 'police', name: '索拉港警察局', x: -135, z: 99 },
  { id: 'courier', kind: 'courier', name: '快鴿速遞 · 物流站', x: 279, z: 45, dx: 274, dz: 45, yaw: 0 },
  { id: 'store1', kind: 'store', name: '24H 便利店 · 海濱', x: -11, z: 225 },
  { id: 'store2', kind: 'store', name: '24H 便利店 · 鐵軌', x: 225, z: -191 },
  { id: 'store3', kind: 'store', name: '24H 便利店 · 綠蔭', x: -191, z: 135 },
  { id: 'store4', kind: 'store', name: '24H 便利店 · 中央', x: 45, z: -171 },
  // outside the city (yaw = facing direction of the shop front)
  { id: 'ammu3', kind: 'ammu', name: '鐵砧槍械行 · 沙漠店', x: -1160, z: -91, yaw: Math.PI },
  { id: 'store5', kind: 'store', name: '快加油 · 塵水站', x: -1200, z: -68, yaw: Math.PI },
  { id: 'store6', kind: 'store', name: '快加油 · 北線站', x: 990, z: -690, yaw: -Math.PI / 2 },
  { id: 'store7', kind: 'store', name: '快加油 · 西郊站', x: -640, z: -252, yaw: 0 },
  { id: 'hospital2', kind: 'hospital', name: '塵水鎮診所', x: -1170, z: -120, yaw: 0 },
  { id: 'police2', kind: 'police', name: '塵水鎮警長辦公室', x: -1215, z: -118, yaw: 0 },
  { id: 'safehouse2', kind: 'safehouse', name: '安全屋 · 鏡湖小屋', x: 600, z: -1057, yaw: 0 },
];

/** Vehicles that always wait at fixed spots (helipads, airport, showpieces). */
export const FIXED_VEHICLES: { type: 'heli' | 'sports' | 'muscle' | 'suv' | 'pickup' | 'bike'; x: number; z: number; yaw: number }[] = [
  { type: 'bike', x: -1310, z: -62, yaw: Math.PI / 2 },
  { type: 'bike', x: -140, z: 408, yaw: Math.PI / 2 },
  { type: 'bike', x: 548, z: -990, yaw: Math.PI / 2 },
  { type: 'bike', x: -219, z: -86.5, yaw: Math.PI / 2 },
  { type: 'heli', x: -760, z: 715, yaw: Math.PI / 2 },
  { type: 'heli', x: 150, z: -108, yaw: 0 },
  { type: 'sports', x: -1060, z: 684, yaw: 0 },
  { type: 'pickup', x: -1290, z: -60, yaw: Math.PI / 2 },
  { type: 'suv', x: 540, z: -1000, yaw: Math.PI / 2 },
  { type: 'muscle', x: -300, z: -1150, yaw: 0 },
];

export const poi = (id: string) => POIS.find((p) => p.id === id)!;

/** Hidden cassette tapes (collectibles). */
export const TAPES: [number, number][] = [
  [45, 30],
  [-225, -210],
  [-200, -245],
  [60, 540], // on the pier deck
  [-180, 425],
  [260, 425],
  [520, -200],
  [545, 120],
  [430, 230],
  [-30, -470],
  [90, -520],
  [-110, -640],
  [-480, -90],
  [-600, 40],
  [-520, 160],
  [-45, 30],
  [310, 300],
  [-330, -330],
  [330, -330],
  [-340, 330],
  // the wider island
  [-1250, -200],
  [-1555, -650],
  [-300, -1185],
  [560, -1040],
  [980, -820],
  [-1350, 812],
  [-1000, -400],
  [-1600, 300],
  [100, -1600],
  [950, -900],
];

export interface WeaponPickupDef {
  x: number;
  z: number;
  weapon?: WeaponId;
  kind: 'weapon' | 'health' | 'armor';
}
export const WEAPON_PICKUPS: WeaponPickupDef[] = [
  { x: 52, z: 52, weapon: 'smg', kind: 'weapon' },
  { x: 488, z: -40, weapon: 'shotgun', kind: 'weapon' },
  { x: 5, z: -655, weapon: 'sniper', kind: 'weapon' },
  { x: -112, z: 160, weapon: 'rifle', kind: 'weapon' },
  { x: -570, z: 60, weapon: 'rpg', kind: 'weapon' },
  { x: 300, z: -300, weapon: 'grenade', kind: 'weapon' },
  { x: 60, z: 585, kind: 'armor' },
  { x: -225, z: -40, kind: 'health' },
  { x: 150, z: -99, kind: 'health' },
  { x: 440, z: 250, kind: 'armor' },
  { x: -45, z: 60, kind: 'health' },
  { x: 250, z: 300, kind: 'armor' },
];

export interface RaceDef {
  id: string;
  name: string;
  start: [number, number, number]; // x, z, yaw
  cps: [number, number][];
  gold: number;
  silver: number;
  bronze: number;
  reward: number;
}

export const RACES: RaceDef[] = [
  {
    id: 'r_downtown',
    name: '市中心環線賽',
    start: [-60, -88, Math.PI / 2],
    cps: [
      [0, -90],
      [90, -90],
      [180, -90],
      [180, 0],
      [180, 90],
      [90, 90],
      [0, 90],
      [-90, 90],
      [-180, 90],
      [-180, 0],
      [-180, -90],
      [-90, -90],
    ],
    gold: 62,
    silver: 75,
    bronze: 90,
    reward: 3000,
  },
  {
    id: 'r_coast',
    name: '海岸衝刺賽',
    start: [-330, 360, Math.PI / 2],
    cps: [
      [-270, 360],
      [-200, 404],
      [-60, 405],
      [80, 405],
      [220, 405],
      [345, 383],
      [470, 270],
      [470, 100],
      [470, -100],
      [470, -258],
      [367, -270],
      [270, -270],
    ],
    gold: 50,
    silver: 60,
    bronze: 72,
    reward: 4000,
  },
  {
    id: 'r_hill',
    name: '雲杉山道爬坡賽',
    start: [0, -300, Math.PI],
    cps: [
      [0, -360],
      [0, -400],
      [30, -440],
      [70, -480],
      [40, -530],
      [-30, -560],
      [-60, -600],
      [-10, -630],
      [30, -640],
    ],
    gold: 32,
    silver: 40,
    bronze: 50,
    reward: 4000,
  },
  {
    id: 'r_ring',
    name: '環島公路大賽',
    start: [-470, -198, -Math.PI / 2 - 0.15],
    cps: [
      [-650, -220], [-900, -160], [-1100, -110], [-1250, -100], [-1400, -150], [-1520, -320], [-1560, -650], [-1420, -1000],
      [-1150, -1280], [-750, -1450], [-300, -1520], [150, -1480], [550, -1330], [850, -1100], [980, -800], [900, -520],
      [700, -400], [560, -330], [470, -270], [367, -270],
    ],
    gold: 150,
    silver: 175,
    bronze: 210,
    reward: 12000,
  },
  {
    id: 'r_runway',
    name: '機場跑道直線加速賽',
    start: [-1360, 862, Math.PI / 2],
    cps: [
      [-1150, 862],
      [-900, 862],
      [-640, 862],
    ],
    gold: 17,
    silver: 20,
    bronze: 25,
    reward: 5000,
  },
];

export const STORY = {
  intro: [
    '阿凱：「十年沒回來，索拉港還是一樣吵。」',
    '老韓（電話）：「小子，回來就好。先開那台星途轎車到我的修車廠，我們慢慢聊。」',
  ],
};
