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
  spawnYaw: number;
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
  slot: number;
  name: string;
  enName: string;
  category: string;
  damage: number;
  fireRate: number;
  pellets: number;
  spread: number;
  recoilKick: number;
  range: number;
  magSize: number;
  maxReserve: number;
  reloadTime: number;
  automatic: boolean;
  driveBy: boolean;
  explosive?: boolean;
  scopeZoom?: number;
  price: number;
  color: string;
}

export interface WeaponAmmoState {
  unlocked: boolean;
  inMag: number;
  reserve: number;
}

export type MissionId =
  | 'street_warmup'
  | 'simeon_repo'
  | 'pier_arms'
  | 'pacific_heist'
  | 'federal_lockdown';

export interface MissionStep {
  id: string;
  instruction: string;
  targetPos: [number, number];
  radius: number;
  type:
    | 'goto'
    | 'kill_targets'
    | 'pickup'
    | 'enter_car'
    | 'escape_wanted'
    | 'deliver_car'
    | 'destroy_heli';
}

export interface MissionDef {
  id: MissionId;
  chapter: number;
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
  region: string;
  description: string;
  type:
    | 'bank'
    | 'ammu'
    | 'customs'
    | 'hospital'
    | 'pier'
    | 'tower'
    | 'villa'
    | 'police'
    | 'observatory'
    | 'airfield'
    | 'airport';
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
    | 'cash_truck'
    | 'helipad'
    | 'stunt';
  color: string;
  label?: string;
}

export interface StuntRamp {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
  height: number;
}

export interface NpcDialogueProfile {
  name: string;
  job: string;
  personality: string;
  linesNormal: string[];
  linesWanted: string[];
}

export interface CombatPopup {
  id: number;
  text: string;
  color: string;
}
