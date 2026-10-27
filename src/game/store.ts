import { create } from 'zustand';
import {
  CharacterId,
  CombatPopup,
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
  special: number;
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

  wantedStars: number;
  wantedSearching: boolean;

  weapons: Record<WeaponId, WeaponAmmoState>;
  reloading: boolean;
  reloadProgress: number;
  aiming: boolean;
  reticleBloom: number; // 0..1
  weaponWheelOpen: boolean;
  charWheelOpen: boolean;
  worldMapOpen: boolean;
  shopModalOpen: 'ammu' | 'customs' | null;

  dialogue: {
    name: string;
    job: string;
    personality: string;
    line: string;
  } | null;

  inVehicle: boolean;
  isFlyingVehicle: boolean;
  vehicleAltitude: number;
  vehicleName: string;
  vehicleSpeedKmh: number;
  vehicleHpPercent: number;

  district: string;
  interactPrompt: string | null;
  talkPrompt: string | null;

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
  popups: CombatPopup[];
  kills: number;
  blips: RadarBlip[];
  playerRotation: number;

  setStarted: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  addCash: (delta: number) => void;
  pushPopup: (text: string, color?: string) => void;
  setShopModalOpen: (shop: 'ammu' | 'customs' | null) => void;
  setWorldMapOpen: (open: boolean) => void;
  closeDialogue: () => void;
  updateHUD: (partial: Partial<GameHUDState>) => void;
}

function createInitialWeapons(): Record<WeaponId, WeaponAmmoState> {
  return {
    unarmed: { unlocked: true, inMag: 1, reserve: 999 },
    pistol: { unlocked: true, inMag: WEAPONS.pistol.magSize, reserve: 120 },
    smg: { unlocked: true, inMag: WEAPONS.smg.magSize, reserve: 240 },
    shotgun: { unlocked: true, inMag: WEAPONS.shotgun.magSize, reserve: 64 },
    rifle: { unlocked: true, inMag: WEAPONS.rifle.magSize, reserve: 270 },
    sniper: { unlocked: true, inMag: WEAPONS.sniper.magSize, reserve: 36 },
    rpg: { unlocked: true, inMag: 1, reserve: 10 },
    minigun: { unlocked: true, inMag: 200, reserve: 600 },
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
      armor: 100,
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

  cash: 35000,
  cashDelta: null,

  wantedStars: 0,
  wantedSearching: false,

  weapons: createInitialWeapons(),
  reloading: false,
  reloadProgress: 0,
  aiming: false,
  reticleBloom: 0,
  weaponWheelOpen: false,
  charWheelOpen: false,
  worldMapOpen: false,
  shopModalOpen: null,

  dialogue: null,

  inVehicle: false,
  isFlyingVehicle: false,
  vehicleAltitude: 0,
  vehicleName: '',
  vehicleSpeedKmh: 0,
  vehicleHpPercent: 100,

  district: '花園銀行摩天核心區 (Downtown Pillbox Hill)',
  interactPrompt: null,
  talkPrompt: null,

  activeMissionId: 'street_warmup',
  missionStepIdx: 0,
  missionObjectiveText: MISSIONS.street_warmup.steps[0].instruction,
  missionProgressText: null,
  completedMissions: [],

  banner: {
    type: null,
    title: '',
    subtitle: '',
  },

  hitmarker: { active: false, headshot: false, ts: 0 },
  popups: [],
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
  pushPopup: (text, color = '#facc15') =>
    set((s) => ({
      popups: [...s.popups.slice(-4), { id: Date.now() + Math.random(), text, color }],
    })),
  setShopModalOpen: (shopModalOpen) => set({ shopModalOpen }),
  setWorldMapOpen: (worldMapOpen) => set({ worldMapOpen }),
  closeDialogue: () => set({ dialogue: null }),
  updateHUD: (partial) => set((state) => ({ ...state, ...partial })),
}));
