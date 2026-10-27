export type CharacterId = 'michael' | 'franklin' | 'trevor';

export type WeaponId =
  | 'unarmed'
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'rifle'
  | 'sniper'
  | 'rpg'
  | 'minigun';

export interface CharacterProfile {
  id: CharacterId;
  name: string;
  enName: string;
  title: string;
  color: string;
  accentHex: number;
  suitColor: number;
  shirtColor: number;
  hairColor: number;
  skinColor: number;
  specialName: string;
  specialDesc: string;
  spawnPos: [number, number];
  defaultWeapon: WeaponId;
  stats: {
    shooting: number;
    driving: number;
    stamina: number;
    special: number;
  };
}

export interface WeaponSpec {
  id: WeaponId;
  slot: number; // 0..7 in weapon wheel
  name: string;
  enName: string;
  category: string;
  damage: number;
  fireRate: number; // shots per second
  pellets: number;
  spread: number;
  range: number;
  magSize: number;
  maxReserve: number;
  reloadTime: number; // seconds
  automatic: boolean;
  driveBy: boolean; // usable inside vehicle
  explosive?: boolean;
  scopeZoom?: number; // FOV when zoomed
  price: number;
  color: string;
}

export interface WeaponAmmoState {
  unlocked: boolean;
  inMag: number;
  reserve: number;
}

export type MissionId = 'pacific_heist' | 'pier_arms' | 'simeon_repo';

export interface MissionStep {
  id: string;
  instruction: string;
  targetPos: [number, number];
  radius: number;
  type: 'goto' | 'kill_targets' | 'pickup' | 'enter_car' | 'escape_wanted' | 'deliver_car';
}

export interface MissionDef {
  id: MissionId;
  title: string;
  enTitle: string;
  giver: string;
  recommendedChar: CharacterId;
  reward: number;
  description: string;
  startPos: [number, number];
  steps: MissionStep[];
}

export interface Landmark {
  id: string;
  name: string;
  type: 'bank' | 'ammu' | 'customs' | 'hospital' | 'pier' | 'tower' | 'villa' | 'police';
  x: number;
  z: number;
  color: string;
  icon: string;
  interactPrompt?: string;
}

export interface RadarBlip {
  id: string;
  x: number;
  z: number;
  type:
    | 'player'
    | 'protagonist'
    | 'cop'
    | 'heli'
    | 'enemy'
    | 'mission'
    | 'ammu'
    | 'customs'
    | 'bank'
    | 'vehicle';
  color: string;
  label?: string;
  rotation?: number;
}
