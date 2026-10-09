import { create } from 'zustand';
import { createDefaultSave, defaultSettings, type GameSettings, type RewardReceipt, type SaveData } from '../storage/schema';
import { persistence, type SaveStatus } from '../storage/persistence';
import { strings, type Lang, type Strings } from '../i18n/strings';
import { defaultQuality } from '../game/render/quality';
import { utcDayKey } from '../game/progression/progression';

export type AppState = 'BOOT' | 'LOADING' | 'MAIN_MENU' | 'PLAYING' | 'RECOVERABLE_ERROR';
export type Overlay = 'pause' | 'settings' | 'garage' | 'daily' | 'stats' | 'map' | 'controls' | 'credits' | 'bus' | 'cancel' | 'conflict';

export type RideStage = 'IDLE' | 'OFFERED' | 'TO_PICKUP' | 'BOARDING' | 'TO_DROPOFF' | 'ALIGHTING' | 'COMPLETED' | 'BUS';

export interface OfferView {
  id: string;
  passengerName: string;
  avatar: number;
  partySize: number;
  rideType: string;
  pickupName: string;
  dropName: string;
  routeMeters: number;
  pickupMeters: number;
  estSeconds: number;
  baseFare: number;
  tutorial: boolean;
  rain: boolean;
  deadlineSeconds: number | null;
  expiresAt: number;
}

export interface RideView {
  stage: RideStage;
  offer: OfferView | null;
  passengerName: string;
  avatar: number;
  partySize: number;
  rideType: string;
  pickupName: string;
  dropName: string;
  baseFare: number;
  tutorial: boolean;
  deadline: number | null;
  bus: { routeName: string; stopNames: string[]; nextStop: number; onboard: number; capacity: number; delivered: number } | null;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'warn' | 'bad';
}

export interface TrafficNotice {
  id: string;
  offense: string;
  fine: number;
  warning: boolean;
  heat: number;
  capture: boolean;
  impound: number;
}

const IDLE_VIEW: RideView = {
  stage: 'IDLE',
  offer: null,
  passengerName: '',
  avatar: 0,
  partySize: 1,
  rideType: 'standard',
  pickupName: '',
  dropName: '',
  baseFare: 0,
  tutorial: false,
  deadline: null,
  bus: null,
};

function initialSave(): SaveData {
  const lang: Lang = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  return createDefaultSave(Date.now(), utcDayKey(Date.now()), defaultSettings(defaultQuality(), lang));
}

interface GameStore {
  appState: AppState;
  bootStage: number;
  bootError: string | null;
  overlay: Overlay | null;
  /** Overlay to return to when closing a sub-overlay (e.g. settings opened from pause). */
  overlayParent: Overlay | null;
  save: SaveData;
  saveStatus: SaveStatus;
  saveNotice: string | null;
  ride: RideView;
  notice: TrafficNotice | null;
  toasts: Toast[];
  weather: 'sunny' | 'rain';
  portrait: boolean;
  t: Strings;
  /** Bumped when the vehicle must be (re)spawned, e.g. equip, capture, load. */
  spawnNonce: number;
  setApp: (s: AppState) => void;
  setBoot: (stage: number, error?: string | null) => void;
  openOverlay: (o: Overlay | null, parent?: Overlay | null) => void;
  closeOverlay: () => void;
  /** Commit a new save snapshot and persist it (immediately for reward/purchase transactions). */
  commit: (next: SaveData, immediate?: boolean) => void;
  updateSettings: (patch: Partial<GameSettings>) => void;
  setRide: (r: Partial<RideView>) => void;
  resetRide: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dropToast: (id: number) => void;
  setNotice: (n: TrafficNotice | null) => void;
  setWeather: (w: 'sunny' | 'rain') => void;
  setPortrait: (p: boolean) => void;
  respawn: () => void;
  activeReceipt: () => RewardReceipt | null;
  replaceSave: (s: SaveData) => void;
}

let toastId = 1;

export const useGame = create<GameStore>((set, get) => ({
  appState: 'BOOT',
  bootStage: 0,
  bootError: null,
  overlay: null,
  overlayParent: null,
  save: initialSave(),
  saveStatus: persistence.status,
  saveNotice: null,
  ride: IDLE_VIEW,
  notice: null,
  toasts: [],
  weather: 'sunny',
  portrait: false,
  t: strings('en'),
  spawnNonce: 0,
  setApp: (appState) => set({ appState }),
  setBoot: (bootStage, bootError = null) => set({ bootStage, bootError }),
  openOverlay: (overlay, parent = null) => set({ overlay, overlayParent: parent }),
  closeOverlay: () => {
    const p = get().overlayParent;
    set({ overlay: p, overlayParent: null });
  },
  commit: (next, immediate = true) => {
    set({ save: next, t: strings(next.settings.language) });
    persistence.save(next, immediate);
  },
  updateSettings: (patch) => {
    const s = get().save;
    const next = { ...s, settings: { ...s.settings, ...patch }, revision: s.revision + 1, updatedAt: Date.now() };
    get().commit(next, false);
  },
  setRide: (r) => set({ ride: { ...get().ride, ...r } }),
  resetRide: () => set({ ride: IDLE_VIEW }),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-2), { id, text, kind }] });
    setTimeout(() => get().dropToast(id), 3200);
  },
  dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setNotice: (notice) => set({ notice }),
  setWeather: (weather) => set({ weather }),
  setPortrait: (portrait) => set({ portrait }),
  respawn: () => set({ spawnNonce: get().spawnNonce + 1 }),
  activeReceipt: () => get().save.pendingReceipts[0] ?? null,
  replaceSave: (s) => set({ save: s, t: strings(s.settings.language) }),
}));

persistence.onStatus((s) => useGame.setState({ saveStatus: s }));
