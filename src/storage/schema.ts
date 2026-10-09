import { z } from 'zod';
import { VEHICLE_ORDER, isVehicleId, isPlayableVehicleId, type VehicleId } from '../game/data/vehicles';
import type { QualityLevel } from '../game/render/quality';

export const SCHEMA_VERSION = 1;

/** Non-negative integer counter: clamps impossible values instead of rejecting the whole save. */
const counter = z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : v), z.number().int().nonnegative());
const unit = z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : v), z.number());
const tier = z.preprocess((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0, Math.floor(v))) : v), z.number().int());

export const UpgradeLevelsSchema = z.object({ engine: tier, brakes: tier, tires: tier, comfort: tier });

export const LifetimeSchema = z.object({
  jobs: counter,
  busRoutes: counter,
  passengers: counter,
  distanceM: counter,
  fareCredits: counter,
  finesPaid: counter,
  cleanRides: counter,
  highestLevel: counter,
  captures: counter,
});

export const TutorialSchema = z.object({
  controlsSeen: z.boolean(),
  firstRideDone: z.boolean(),
  skipped: z.boolean(),
});

export const SettingsSchema = z.object({
  masterVolume: unit,
  sfxVolume: unit,
  ambienceVolume: unit,
  musicVolume: unit,
  muted: z.boolean(),
  quality: z.enum(['low', 'medium', 'high', 'ultra']),
  /** Defaulted fields keep older saves and their chosen preset intact. */
  renderResolution: z.enum(['auto', 'standard', 'sharp', 'native']).default('auto'),
  shadows: z.enum(['auto', 'off', 'on']).default('auto'),
  viewDistance: z.enum(['auto', 'near', 'far', 'max']).default('auto'),
  steerSensitivity: z.preprocess((v) => (typeof v === 'number' ? Math.min(1.6, Math.max(0.5, v)) : v), z.number()),
  controls: z.enum(['joystick', 'pedals']),
  autoRecenter: z.boolean(),
  language: z.enum(['en', 'ru']),
  uiScale: z.preprocess((v) => (typeof v === 'number' ? Math.min(1.3, Math.max(0.9, v)) : v), z.number()),
  reducedMotion: z.boolean(),
  // Accept older saves, but the player no longer has a road speed limiter.
  speedLimiter: z.boolean().optional().transform(() => false),
  cameraMode: z.enum(['chase', 'high', 'eye']),
  /** Player character: older saves without it default to the male driver. */
  driver: z.enum(['male', 'female', 'lynae', 'cartethyia']).default('male'),
  passengerCharacter: z.enum(['original', 'mixed', 'lynae', 'cartethyia']).default('mixed'),
});

export const DailyTaskSchema = z.object({
  id: z.string(),
  template: z.string(),
  target: counter,
  progress: counter,
  rewardCash: counter,
  rewardXP: counter,
  claimed: z.boolean(),
});

export const DailySchema = z.object({
  dayKey: z.string(),
  tasks: z.array(DailyTaskSchema).max(5),
  jobs: counter,
  cleanJobs: counter,
  earned: counter,
  destinations: z.array(z.string()).max(30),
  family: counter,
  airport: counter,
  busRoutes: counter,
  claimedIds: z.array(z.string()).max(50),
});

export const ClockSchema = z.object({ lastDayKey: z.string(), lastTime: z.number() });

export const PoseSchema = z.object({ x: z.number(), z: z.number(), heading: z.number() });

export const QuoteSchema = z.object({
  baseFare: counter,
  routeMeters: counter,
  typeMultiplier: z.number(),
  serviceMultiplier: z.number(),
  rain: z.boolean(),
  estSeconds: counter,
  deadlineSeconds: z.number().nullable(),
  timeBonus: counter,
  tutorial: z.boolean(),
});

export const BusStopSchema = z.object({ bayId: z.string(), landmark: z.string() });
export const BusGroupSchema = z.object({ from: counter, to: counter, size: counter });

export const MissionSchema = z.object({
  id: z.string(),
  kind: z.enum(['ride', 'bus']),
  seed: z.number(),
  state: z.enum(['TO_PICKUP', 'TO_DROPOFF', 'BUS_ROUTE', 'COMPLETED']),
  vehicleId: z.string().refine(isVehicleId),
  passengerName: z.string(),
  avatar: z.number(),
  partySize: counter,
  rideType: z.string(),
  pickupBayId: z.string(),
  dropBayId: z.string(),
  quote: QuoteSchema,
  elapsed: z.number(),
  satisfaction: z.number(),
  finesPaid: counter,
  incidents: counter,
  recovered: z.boolean(),
  harshEvents: counter,
  safePose: PoseSchema.nullable(),
  bus: z
    .object({
      routeId: z.string(),
      stops: z.array(BusStopSchema),
      groups: z.array(BusGroupSchema),
      nextStop: counter,
      onboard: counter,
      delivered: counter,
      satisfactionSum: z.number(),
      satisfactionSamples: counter,
    })
    .nullable(),
});

export const TransactionSchema = z.object({ key: z.string(), kind: z.string(), cash: z.number(), xp: z.number(), at: z.number() });

export const ReceiptSchema = z.object({
  id: z.string(),
  kind: z.enum(['ride', 'bus', 'capture', 'daily_carryover', 'cancel']),
  title: z.string(),
  from: z.string(),
  to: z.string(),
  lines: z.array(z.object({ label: z.string(), amount: z.number() })),
  net: z.number(),
  xp: counter,
  stars: counter,
  passengers: counter,
  baseFare: counter,
  rewardedClaimed: z.boolean(),
  at: z.number(),
});

export const SaveSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  revision: counter,
  updatedAt: z.number(),
  profileId: z.string().min(4),
  wallet: counter,
  totalXP: counter,
  ownedVehicleIds: z.array(z.string()).transform((ids) => {
    const valid = [...new Set(ids.filter(isVehicleId))] as VehicleId[];
    return valid.includes('bike_basic') ? valid : (['bike_basic', ...valid] as VehicleId[]);
  }),
  equippedVehicleId: z.string(),
  upgradesByVehicle: z.record(z.string(), UpgradeLevelsSchema),
  paintByVehicle: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  fuelByVehicle: z.record(z.string(), z.number().min(0).max(100)).default({}),
  lifetime: LifetimeSchema,
  recentRatings: z.array(z.number().min(1).max(5)).max(20),
  tutorial: TutorialSchema,
  settings: SettingsSchema,
  daily: DailySchema,
  clock: ClockSchema,
  mission: MissionSchema.nullable(),
  transactionHistory: z.array(TransactionSchema).max(200),
  pendingReceipts: z.array(ReceiptSchema).max(10),
  adState: z.object({ jobsSinceInterstitial: counter, lastInterstitialAt: z.number() }),
});

export type SaveData = z.infer<typeof SaveSchema>;
export type GameSettings = z.infer<typeof SettingsSchema>;
export type MissionCheckpoint = z.infer<typeof MissionSchema>;
export type RewardReceipt = z.infer<typeof ReceiptSchema>;
export type DailyBoard = z.infer<typeof DailySchema>;
export type DailyTask = z.infer<typeof DailyTaskSchema>;
export type Quote = z.infer<typeof QuoteSchema>;

export function defaultSettings(quality: QualityLevel, language: 'en' | 'ru'): GameSettings {
  return {
    masterVolume: 0.8,
    sfxVolume: 0.8,
    ambienceVolume: 0.5,
    musicVolume: 0.4,
    muted: false,
    quality,
    renderResolution: 'auto',
    shadows: 'auto',
    viewDistance: 'auto',
    steerSensitivity: 1,
    controls: 'joystick',
    autoRecenter: true,
    language,
    uiScale: 1,
    reducedMotion: false,
    speedLimiter: false,
    cameraMode: 'chase',
    driver: 'male',
    passengerCharacter: 'mixed',
  };
}

export function emptyDaily(dayKey: string): DailyBoard {
  return { dayKey, tasks: [], jobs: 0, cleanJobs: 0, earned: 0, destinations: [], family: 0, airport: 0, busRoutes: 0, claimedIds: [] };
}

export function newProfileId() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `p${a[0].toString(36)}${a[1].toString(36)}`;
}

export function createDefaultSave(now: number, dayKey: string, settings: GameSettings): SaveData {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: now,
    profileId: newProfileId(),
    wallet: 0,
    totalXP: 0,
    ownedVehicleIds: ['bike_basic'],
    equippedVehicleId: 'bike_basic',
    upgradesByVehicle: {},
    paintByVehicle: {},
    fuelByVehicle: {},
    lifetime: { jobs: 0, busRoutes: 0, passengers: 0, distanceM: 0, fareCredits: 0, finesPaid: 0, cleanRides: 0, highestLevel: 1, captures: 0 },
    recentRatings: [],
    tutorial: { controlsSeen: false, firstRideDone: false, skipped: false },
    settings,
    daily: emptyDaily(dayKey),
    clock: { lastDayKey: dayKey, lastTime: now },
    mission: null,
    transactionHistory: [],
    pendingReceipts: [],
    adState: { jobsSinceInterstitial: 0, lastInterstitialAt: 0 },
  };
}

/** Explicit migrations from older schema versions (none yet; v1 is the first release schema). */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as { schemaVersion?: number };
  if (r.schemaVersion === SCHEMA_VERSION) return raw;
  return raw; // unknown future/older version → validation decides
}

export function validateSave(raw: unknown): { ok: true; data: SaveData } | { ok: false; error: string } {
  const res = SaveSchema.safeParse(migrate(raw));
  if (!res.success) return { ok: false, error: res.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const data = res.data;
  // Replace a formerly drivable NPC with a free car, preserving the ride and wallet.
  if (isVehicleId(data.equippedVehicleId) && !isPlayableVehicleId(data.equippedVehicleId)) {
    data.equippedVehicleId = 'bmw_i8';
    if (!data.ownedVehicleIds.includes('bmw_i8')) data.ownedVehicleIds.push('bmw_i8');
  }
  if (data.mission && !isPlayableVehicleId(data.mission.vehicleId)) data.mission.vehicleId = 'bmw_i8';
  data.ownedVehicleIds = data.ownedVehicleIds.filter(isPlayableVehicleId);
  if (!isVehicleId(data.equippedVehicleId) || !data.ownedVehicleIds.includes(data.equippedVehicleId)) data.equippedVehicleId = 'bike_basic';
  for (const id of Object.keys(data.upgradesByVehicle)) if (!isVehicleId(id)) delete data.upgradesByVehicle[id];
  return { ok: true, data };
}

export const ALL_VEHICLES = VEHICLE_ORDER;
