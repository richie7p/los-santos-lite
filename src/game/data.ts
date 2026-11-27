/** Static game data: weapons and vehicles. */

export type WeaponId = 'fist' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'rpg' | 'grenade';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  short: string;
  damage: number;
  /** shots per second */
  rate: number;
  pellets: number;
  /** base spread in degrees */
  spread: number;
  /** spread added per shot (degrees) */
  bloom: number;
  /** camera kick in degrees */
  recoil: number;
  range: number;
  mag: number;
  maxAmmo: number;
  reload: number;
  auto: boolean;
  zoom: number;
  price: number;
  ammoPrice: number;
  ammoPack: number;
  sound: 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'rpg' | 'fist' | 'throw';
  tracer: number;
  headshot: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  fist: { id: 'fist', name: '徒手格鬥', short: '拳頭', damage: 22, rate: 2.4, pellets: 1, spread: 0, bloom: 0, recoil: 0, range: 1.9, mag: 0, maxAmmo: 0, reload: 0, auto: false, zoom: 1, price: 0, ammoPrice: 0, ammoPack: 0, sound: 'fist', tracer: 0, headshot: 1.5 },
  pistol: { id: 'pistol', name: 'P9 半自動手槍', short: '手槍', damage: 30, rate: 5, pellets: 1, spread: 0.5, bloom: 1.1, recoil: 1.6, range: 90, mag: 15, maxAmmo: 180, reload: 1.3, auto: false, zoom: 1.25, price: 0, ammoPrice: 120, ammoPack: 45, sound: 'pistol', tracer: 0xffd28a, headshot: 3 },
  smg: { id: 'smg', name: 'V-10 衝鋒槍', short: '衝鋒槍', damage: 19, rate: 13, pellets: 1, spread: 1.6, bloom: 0.45, recoil: 0.65, range: 70, mag: 32, maxAmmo: 384, reload: 1.6, auto: true, zoom: 1.2, price: 2200, ammoPrice: 180, ammoPack: 96, sound: 'smg', tracer: 0xffd28a, headshot: 2 },
  shotgun: { id: 'shotgun', name: '獵鷹泵動霰彈槍', short: '霰彈槍', damage: 15, rate: 1.25, pellets: 9, spread: 4.5, bloom: 0, recoil: 5.5, range: 38, mag: 7, maxAmmo: 84, reload: 2.4, auto: false, zoom: 1.15, price: 3200, ammoPrice: 200, ammoPack: 21, sound: 'shotgun', tracer: 0xffc070, headshot: 1.5 },
  rifle: { id: 'rifle', name: 'AR-7 突擊步槍', short: '步槍', damage: 32, rate: 9.5, pellets: 1, spread: 0.7, bloom: 0.38, recoil: 1.15, range: 160, mag: 30, maxAmmo: 360, reload: 1.9, auto: true, zoom: 1.45, price: 5200, ammoPrice: 260, ammoPack: 90, sound: 'rifle', tracer: 0xffe0a0, headshot: 2.5 },
  sniper: { id: 'sniper', name: '長弓狙擊步槍', short: '狙擊槍', damage: 160, rate: 0.85, pellets: 1, spread: 0.02, bloom: 0, recoil: 6, range: 450, mag: 5, maxAmmo: 40, reload: 2.8, auto: false, zoom: 5, price: 9000, ammoPrice: 400, ammoPack: 10, sound: 'sniper', tracer: 0xfff0c0, headshot: 4 },
  rpg: { id: 'rpg', name: 'RL-3 火箭發射器', short: '火箭筒', damage: 400, rate: 0.7, pellets: 1, spread: 0.2, bloom: 0, recoil: 7, range: 300, mag: 1, maxAmmo: 8, reload: 2.6, auto: false, zoom: 1.3, price: 15000, ammoPrice: 1500, ammoPack: 2, sound: 'rpg', tracer: 0, headshot: 1 },
  grenade: { id: 'grenade', name: '破片手榴彈', short: '手榴彈', damage: 260, rate: 1.2, pellets: 1, spread: 0, bloom: 0, recoil: 0, range: 30, mag: 1, maxAmmo: 10, reload: 0.6, auto: false, zoom: 1, price: 1200, ammoPrice: 600, ammoPack: 3, sound: 'throw', tracer: 0, headshot: 1 },
};

export const WEAPON_ORDER: WeaponId[] = ['fist', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'rpg', 'grenade'];

export type VehicleType = 'compact' | 'sedan' | 'sports' | 'muscle' | 'suv' | 'van' | 'pickup' | 'taxi' | 'police' | 'armored' | 'heli' | 'bike';

export interface VehicleSpec {
  type: VehicleType;
  name: string;
  length: number;
  width: number;
  height: number;
  hood: number; // beltline height
  hoodLen: number;
  trunkLen: number;
  roofLen: number;
  wheelR: number;
  wheelbase: number;
  maxSpeed: number; // m/s
  accel: number;
  brake: number;
  grip: number;
  steer: number;
  hp: number;
  mass: number;
  colors: number[];
  boxy?: boolean;
  price?: number;
  /** Helicopter: uses flight physics instead of wheels. */
  flying?: boolean;
  /** Two-wheeler: leans into turns, rider sits on top. */
  bike?: boolean;
}

export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  compact: { type: 'compact', name: '小丸子 Pico', length: 3.8, width: 1.72, height: 1.5, hood: 0.92, hoodLen: 0.7, trunkLen: 0.35, roofLen: 1.5, wheelR: 0.31, wheelbase: 2.45, maxSpeed: 40, accel: 10, brake: 22, grip: 7.5, steer: 0.62, hp: 650, mass: 950, colors: [0xe8e2d0, 0x7fb3d5, 0xf4d03f, 0xec7063, 0x58d68d, 0xaab7b8] },
  sedan: { type: 'sedan', name: '星途 Stella', length: 4.7, width: 1.86, height: 1.46, hood: 0.92, hoodLen: 1.15, trunkLen: 0.85, roofLen: 1.55, wheelR: 0.33, wheelbase: 2.8, maxSpeed: 46, accel: 10, brake: 24, grip: 7.6, steer: 0.58, hp: 900, mass: 1400, colors: [0x1b2631, 0xf2f3f4, 0x7b241c, 0x5d6d7e, 0x1a5276, 0x99a3a4, 0x0e6251] },
  sports: { type: 'sports', name: '閃電 Volt GT', length: 4.5, width: 1.98, height: 1.22, hood: 0.78, hoodLen: 1.45, trunkLen: 0.7, roofLen: 1.0, wheelR: 0.35, wheelbase: 2.7, maxSpeed: 66, accel: 17, brake: 30, grip: 9.6, steer: 0.55, hp: 750, mass: 1300, colors: [0xe60000, 0xffcc00, 0x0047ab, 0x111111, 0xf2f2f2, 0xff6a00, 0x16a085] },
  muscle: { type: 'muscle', name: '野牛 Bison', length: 4.9, width: 1.96, height: 1.34, hood: 0.9, hoodLen: 1.6, trunkLen: 0.95, roofLen: 1.2, wheelR: 0.36, wheelbase: 2.9, maxSpeed: 58, accel: 15, brake: 24, grip: 6.4, steer: 0.55, hp: 1000, mass: 1600, colors: [0x111111, 0x922b21, 0x1f618d, 0xd4ac0d, 0x6c3483, 0xd35400] },
  suv: { type: 'suv', name: '山貓 Lynx', length: 4.85, width: 2.0, height: 1.85, hood: 1.15, hoodLen: 1.05, trunkLen: 0.15, roofLen: 2.2, wheelR: 0.4, wheelbase: 2.9, maxSpeed: 44, accel: 10, brake: 22, grip: 7.2, steer: 0.55, hp: 1300, mass: 2100, colors: [0x17202a, 0xf8f9f9, 0x4d5656, 0x7e5109, 0x1b4f72] },
  van: { type: 'van', name: '快鴿廂型車', length: 5.0, width: 2.02, height: 2.3, hood: 1.15, hoodLen: 0.6, trunkLen: 0.0, roofLen: 3.6, wheelR: 0.36, wheelbase: 3.1, maxSpeed: 35, accel: 7, brake: 18, grip: 6.5, steer: 0.55, hp: 1400, mass: 2400, colors: [0xf8f9f9, 0xd5d8dc, 0x2e86c1, 0xa04000], boxy: true },
  pickup: { type: 'pickup', name: '牧馬人皮卡', length: 5.3, width: 2.02, height: 1.85, hood: 1.15, hoodLen: 1.3, trunkLen: 1.9, roofLen: 1.4, wheelR: 0.42, wheelbase: 3.25, maxSpeed: 42, accel: 10, brake: 22, grip: 7, steer: 0.52, hp: 1300, mass: 2200, colors: [0x7b241c, 0x1b2631, 0xf0f3f4, 0x196f3d, 0x9c640c] },
  taxi: { type: 'taxi', name: '索拉計程車', length: 4.7, width: 1.86, height: 1.46, hood: 0.92, hoodLen: 1.15, trunkLen: 0.85, roofLen: 1.55, wheelR: 0.33, wheelbase: 2.8, maxSpeed: 44, accel: 10, brake: 24, grip: 7.6, steer: 0.58, hp: 900, mass: 1400, colors: [0xf7c600] },
  police: { type: 'police', name: '巡邏警車', length: 4.9, width: 1.92, height: 1.5, hood: 0.94, hoodLen: 1.3, trunkLen: 0.9, roofLen: 1.55, wheelR: 0.34, wheelbase: 2.9, maxSpeed: 56, accel: 14, brake: 28, grip: 8.4, steer: 0.58, hp: 1300, mass: 1700, colors: [0xf4f6f7] },
  bike: { type: 'bike', name: '雷鳥 R6 機車', length: 2.15, width: 0.82, height: 1.15, hood: 0.85, hoodLen: 0, trunkLen: 0, roofLen: 0, wheelR: 0.32, wheelbase: 1.42, maxSpeed: 62, accel: 17, brake: 26, grip: 8.2, steer: 0.75, hp: 420, mass: 260, colors: [0xd62828, 0x111111, 0xf4f6f7, 0xf59e0b, 0x1d4ed8, 0x16a34a], bike: true },
  heli: { type: 'heli', name: '蜂鳥直升機', length: 11.5, width: 2.6, height: 3.1, hood: 1.4, hoodLen: 0, trunkLen: 0, roofLen: 0, wheelR: 0.3, wheelbase: 3, maxSpeed: 52, accel: 9, brake: 0, grip: 0, steer: 1.35, hp: 1500, mass: 2400, colors: [0xf4f6f7, 0x1d4ed8, 0xd62828, 0x111111, 0xf59e0b], flying: true },
  armored: { type: 'armored', name: '運鈔裝甲車', length: 6.2, width: 2.35, height: 2.7, hood: 1.3, hoodLen: 1.0, trunkLen: 0, roofLen: 4.4, wheelR: 0.48, wheelbase: 3.6, maxSpeed: 30, accel: 6, brake: 16, grip: 6.5, steer: 0.48, hp: 4200, mass: 5000, colors: [0x5d6d5b], boxy: true },
};

export const CIVILIAN_TYPES: VehicleType[] = ['compact', 'compact', 'sedan', 'sedan', 'sedan', 'suv', 'suv', 'van', 'pickup', 'taxi', 'sports', 'muscle', 'bike', 'bike'];

export const kmh = (ms: number) => Math.round(Math.abs(ms) * 3.6);
