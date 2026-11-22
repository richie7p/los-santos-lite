/** UI-facing state (zustand). The engine pushes snapshots ~15x/sec; React reads with selectors. */
import { create } from 'zustand';
import type { WeaponId } from './data';
import { isTouchDevice } from './core/input';

export type Phase = 'title' | 'playing' | 'paused' | 'map' | 'shop' | 'dead' | 'loading';
export type Quality = 'low' | 'medium' | 'high';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'money' | 'heat';
}

export interface Settings {
  quality: Quality;
  sensitivity: number;
  volume: number;
  invertY: boolean;
  fov: number;
  showFps: boolean;
  /** Lower the render scale automatically when the frame rate drops. */
  autoQuality: boolean;
}

export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  price: number;
  owned?: boolean;
  disabled?: boolean;
}

export interface HudState {
  phase: Phase;
  loadingText: string;
  hasSave: boolean;
  hp: number;
  armor: number;
  cash: number;
  cashDelta: number;
  heat: number;
  heatSearching: boolean;
  weapon: WeaponId;
  mag: number;
  reserve: number;
  reloading: boolean;
  owned: WeaponId[];
  focus: number;
  focusActive: boolean;
  inVehicle: boolean;
  speedKmh: number;
  altitude: number | null;
  vehicleName: string;
  vehicleHp: number;
  radio: string;
  missionTitle: string | null;
  objective: string | null;
  timer: number | null;
  subtitle: string | null;
  prompt: string | null;
  toasts: Toast[];
  big: { title: string; sub?: string; color?: string; id: number } | null;
  hit: number;
  kill: number;
  spread: number;
  aiming: boolean;
  scoped: boolean;
  wheelOpen: boolean;
  wheelSel: WeaponId | null;
  clock: string;
  district: string;
  damage: number;
  stuntText: string | null;
  shop: { title: string; kind: 'ammu' | 'garage' | 'safehouse'; items: ShopItem[] } | null;
  fps: number;
  settings: Settings;
  stats: { missions: number; totalMissions: number; tapes: number; totalTapes: number; stunts: number; totalStunts: number; races: number; totalRaces: number; kills: number; completion: number };
  deathReason: string;
  set: (p: Partial<HudState>) => void;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  sensitivity: 1,
  volume: 0.7,
  invertY: false,
  fov: 70,
  showFps: false,
  autoQuality: true,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('solara.settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  // phones and tablets start on the light preset
  return { ...DEFAULT_SETTINGS, quality: isTouchDevice() ? 'low' : DEFAULT_SETTINGS.quality };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('solara.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const useHud = create<HudState>((set) => ({
  phase: 'loading',
  loadingText: '正在建構索拉港…',
  hasSave: false,
  hp: 100,
  armor: 0,
  cash: 0,
  cashDelta: 0,
  heat: 0,
  heatSearching: false,
  weapon: 'fist',
  mag: 0,
  reserve: 0,
  reloading: false,
  owned: ['fist'],
  focus: 100,
  focusActive: false,
  inVehicle: false,
  speedKmh: 0,
  altitude: null,
  vehicleName: '',
  vehicleHp: 1,
  radio: '',
  missionTitle: null,
  objective: null,
  timer: null,
  subtitle: null,
  prompt: null,
  toasts: [],
  big: null,
  hit: 0,
  kill: 0,
  spread: 0,
  aiming: false,
  scoped: false,
  wheelOpen: false,
  wheelSel: null,
  clock: '09:30',
  district: '',
  damage: 0,
  stuntText: null,
  shop: null,
  fps: 0,
  settings: loadSettings(),
  stats: { missions: 0, totalMissions: 0, tapes: 0, totalTapes: 0, stunts: 0, totalStunts: 0, races: 0, totalRaces: 0, kills: 0, completion: 0 },
  deathReason: '',
  set: (p) => set(p),
}));
