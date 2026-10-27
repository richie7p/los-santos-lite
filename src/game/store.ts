import { create } from 'zustand';
import {
  CharacterId,
  MissionId,
  RadarBlip,
  WeaponAmmoState,
  WeaponId,
} from './types';
import { MISSIONS, PROTAGONISTS, WEAPONS } from './data';

export interface PerCharState {
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  special: number; // 0..100
  weapon: WeaponId;
  x: number;
  z: number;
}

export interface GameHUDState {
  started: boolean;
  paused: boolean;
  muted: boolean;

  activeChar: CharacterId;
  charStates: Record<CharacterId, PerCharState>;
  specialActive: boolean;
  skyCamSwitching: boolean;
  skyCamTarget: CharacterId | null;

  cash: number;
  cashDelta: { amount: number; id: number } | null;

  wantedStars: number; // 0..5
  wantedCooldown: number; // 0..1

  weapons: Record<WeaponId, WeaponAmmoState>;
  reloading: boolean;
  reloadProgress: number;
  aiming: boolean;
  weaponWheelOpen: boolean;
  charWheelOpen: boolean;
  shopModalOpen: 'ammu' | 'customs' | null;

  inVehicle: boolean;
  vehicleName: string;
  vehicleSpeedKmh: number;
  vehicleHpPercent: number;

  district: string;
  interactPrompt: string | null;

  activeMissionId: MissionId | null;
  missionStepIdx: number;
  missionObjectiveText: string | null;
  missionProgressText: string | null;
  completedMissions: MissionId[];

  banner: {
    type: 'wasted' | 'busted' | 'mission_passed' | 'heist_start' | null;
    title: string;
    subtitle: string;
    reward?: number;
  };

  hitmarker: { active: boolean; headshot: boolean; ts: number };
  kills: number;
  blips: RadarBlip[];
  playerRotation: number;

  // Actions
  setStarted: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  addCash: (delta: number) => void;
  setShopModalOpen: (shop: 'ammu' | 'customs' | null) => void;
  updateHUD: (partial: Partial<GameHUDState>) => void;
}

function createInitialWeapons(): Record<WeaponId, WeaponAmmoState> {
  return {
    unarmed: { unlocked: true, inMag: 1, reserve: 999 },
    pistol: { unlocked: true, inMag: WEAPONS.pistol.magSize, reserve: 96 },
    smg: { unlocked: true, inMag: WEAPONS.smg.magSize, reserve: 180 },
    shotgun: { unlocked: true, inMag: WEAPONS.shotgun.magSize, reserve: 48 },
    rifle: { unlocked: true, inMag: WEAPONS.rifle.magSize, reserve: 210 },
    sniper: { unlocked: true, inMag: WEAPONS.sniper.magSize, reserve: 24 },
    rpg: { unlocked: true, inMag: 1, reserve: 6 },
    minigun: { unlocked: true, inMag: 200, reserve: 400 },
  };
}

export const useGameStore = create<GameHUDState>((set) => ({
  started: false,
  paused: false,
  muted: false,

  activeChar: 'michael',
  charStates: {
    michael: {
      hp: 100,
      maxHp: 100,
      armor: 100,
      maxArmor: 100,
      special: 100,
      weapon: PROTAGONISTS.michael.defaultWeapon,
      x: PROTAGONISTS.michael.spawnPos[0],
      z: PROTAGONISTS.michael.spawnPos[1],
    },
    franklin: {
      hp: 100,
      maxHp: 100,
      armor: 80,
      maxArmor: 100,
      special: 100,
      weapon: PROTAGONISTS.franklin.defaultWeapon,
      x: PROTAGONISTS.franklin.spawnPos[0],
      z: PROTAGONISTS.franklin.spawnPos[1],
    },
    trevor: {
      hp: 100,
      maxHp: 100,
      armor: 100,
      maxArmor: 100,
      special: 100,
      weapon: PROTAGONISTS.trevor.defaultWeapon,
      x: PROTAGONISTS.trevor.spawnPos[0],
      z: PROTAGONISTS.trevor.spawnPos[1],
    },
  },
  specialActive: false,
  skyCamSwitching: false,
  skyCamTarget: null,

  cash: 28500,
  cashDelta: null,

  wantedStars: 0,
  wantedCooldown: 0,

  weapons: createInitialWeapons(),
  reloading: false,
  reloadProgress: 0,
  aiming: false,
  weaponWheelOpen: false,
  charWheelOpen: false,
  shopModalOpen: null,

  inVehicle: false,
  vehicleName: '',
  vehicleSpeedKmh: 0,
  vehicleHpPercent: 100,

  district: '市中心金融特區 (Downtown Pillbox)',
  interactPrompt: null,

  activeMissionId: null,
  missionStepIdx: 0,
  missionObjectiveText: null,
  missionProgressText: null,
  completedMissions: [],

  banner: {
    type: null,
    title: '',
    subtitle: '',
  },

  hitmarker: { active: false, headshot: false, ts: 0 },
  kills: 0,
  blips: [],
  playerRotation: 0,

  setStarted: (started) => set({ started }),
  setPaused: (paused) => set({ paused }),
  setMuted: (muted) => set({ muted }),
  addCash: (delta) =>
    set((s) => ({
      cash: Math.max(0, s.cash + delta),
      cashDelta: { amount: delta, id: Date.now() + Math.random() },
    })),
  setShopModalOpen: (shopModalOpen) => set({ shopModalOpen }),
  updateHUD: (partial) => set((state) => ({ ...state, ...partial })),
}));
