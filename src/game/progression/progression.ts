// Pure progression rules. Every function takes a SaveData snapshot and returns a NEW snapshot
// (never mutates its input), so a whole reward commits atomically and replays are idempotent.

import { ECONOMY, OFFICE_DEADLINE, RATING_BANDS, XP } from '../data/economy';
import { VEHICLES, type VehicleId } from '../data/vehicles';
import type { DailyBoard, DailyTask, Quote, RewardReceipt, SaveData } from '../../storage/schema';
import { emptyDaily } from '../../storage/schema';
import { hashString, mulberry32 } from '../core/rng';
import type { UpgradeLevels } from '../vehicles/handling';

// ---------- levels & ratings ----------

export function xpForLevel(level: number) {
  const l = Math.max(1, level) - 1;
  return 150 * l + 10 * l * l;
}

export function levelForXP(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelForXP(xp);
  const a = xpForLevel(level);
  const b = xpForLevel(level + 1);
  return { level, into: xp - a, span: b - a, frac: (xp - a) / (b - a) };
}

export function ratingFor(score: number) {
  const s = Math.max(0, Math.min(100, score));
  for (const [min, stars, tip] of RATING_BANDS) if (s >= min) return { stars, tipRate: tip };
  return { stars: 1, tipRate: 0 };
}

// ---------- quotes ----------

export function quoteRide(opts: {
  routeMeters: number;
  vehicleId: VehicleId;
  rideType: string;
  rain: boolean;
  estSeconds: number;
  tutorial?: boolean;
}): Quote {
  const spec = VEHICLES[opts.vehicleId];
  const service = spec.serviceMultiplier ?? 1;
  const typeMult = ECONOMY.rideTypeMultiplier[opts.rideType] ?? 1;
  const combined = Math.min(ECONOMY.maxCombinedMultiplier, typeMult * (opts.rain ? ECONOMY.rainModifier : 1));
  const baseFare = opts.tutorial ? ECONOMY.tutorialFare : Math.round((ECONOMY.fareBase + ECONOMY.farePerMeter * opts.routeMeters) * service * combined);
  const deadline = opts.rideType === 'office' ? Math.round(opts.estSeconds * OFFICE_DEADLINE.factor + OFFICE_DEADLINE.extraSeconds) : null;
  return {
    baseFare,
    routeMeters: Math.round(opts.routeMeters),
    typeMultiplier: combined,
    serviceMultiplier: service,
    rain: opts.rain,
    estSeconds: Math.round(opts.estSeconds),
    deadlineSeconds: deadline,
    timeBonus: deadline ? Math.round(baseFare * OFFICE_DEADLINE.bonusRate) : 0,
    tutorial: !!opts.tutorial,
  };
}

export function quoteBus(routeMeters: number, plannedPassengers: number) {
  return Math.round(ECONOMY.bus.base + ECONOMY.bus.perMeter * routeMeters + ECONOMY.bus.perPassenger * plannedPassengers);
}

export function rideXP(routeMeters: number, clean: boolean) {
  return XP.rideBase + Math.min(XP.maxDistanceBonus, Math.floor(routeMeters / 100) * XP.perHundredMeters) + (clean ? XP.clean : 0);
}

export function busXP(stops: number, clean: boolean) {
  return XP.busBase + XP.busPerStop * stops + (clean ? XP.clean : 0);
}

// ---------- helpers ----------

function clone(save: SaveData): SaveData {
  return structuredClone(save);
}

function hasTx(save: SaveData, key: string) {
  return save.transactionHistory.some((t) => t.key === key) || save.pendingReceipts.some((r) => r.id === key);
}

function pushTx(save: SaveData, key: string, kind: string, cash: number, xp: number, now: number) {
  save.transactionHistory.push({ key, kind, cash, xp, at: now });
  // Bounded journal: drop the oldest entries that no pending receipt/mission can reference.
  while (save.transactionHistory.length > 150) {
    const old = save.transactionHistory[0];
    if (save.pendingReceipts.some((r) => r.id === old.key) || (save.mission && old.key.includes(save.mission.id))) break;
    save.transactionHistory.shift();
  }
}

function addXP(save: SaveData, xp: number) {
  save.totalXP += xp;
  save.lifetime.highestLevel = Math.max(save.lifetime.highestLevel, levelForXP(save.totalXP));
}

function touch(save: SaveData, now: number) {
  save.revision += 1;
  save.updatedAt = now;
}

// ---------- ride settlement ----------

export interface RideSummary {
  missionId: string;
  quote: Quote;
  satisfaction: number;
  finesPaid: number;
  clean: boolean;
  elapsed: number;
  partySize: number;
  rideType: string;
  fromName: string;
  toName: string;
  toLandmark: string;
}

export function settleRide(save: SaveData, sum: RideSummary, now: number): { save: SaveData; receipt: RewardReceipt; duplicate: boolean } {
  const key = `ride:${sum.missionId}`;
  const existing = save.pendingReceipts.find((r) => r.id === key);
  if (existing || hasTx(save, key)) {
    return { save, receipt: existing ?? save.pendingReceipts[save.pendingReceipts.length - 1], duplicate: true };
  }
  const s = clone(save);
  const { stars, tipRate } = ratingFor(sum.satisfaction);
  const base = sum.quote.baseFare;
  const cleanBonus = sum.clean ? Math.round(base * ECONOMY.cleanBonusRate) : 0;
  const tip = Math.round(base * tipRate);
  const timeBonus = sum.quote.deadlineSeconds !== null && sum.elapsed <= sum.quote.deadlineSeconds ? sum.quote.timeBonus : 0;
  const credit = base + cleanBonus + tip + timeBonus;
  const xp = rideXP(sum.quote.routeMeters, sum.clean);
  s.wallet += credit;
  addXP(s, xp);
  s.lifetime.jobs += 1;
  s.lifetime.passengers += sum.partySize;
  s.lifetime.fareCredits += credit;
  if (sum.clean) s.lifetime.cleanRides += 1;
  s.recentRatings = [...s.recentRatings, stars].slice(-20);
  // Daily counters (credits only from completed-job earnings)
  s.daily.jobs += 1;
  if (sum.clean) s.daily.cleanJobs += 1;
  s.daily.earned += credit;
  if (!s.daily.destinations.includes(sum.toLandmark)) s.daily.destinations = [...s.daily.destinations, sum.toLandmark].slice(-30);
  if (sum.rideType === 'family') s.daily.family += 1;
  if (sum.rideType === 'airport') s.daily.airport += 1;
  updateDailyProgress(s.daily);
  if (sum.quote.tutorial) s.tutorial.firstRideDone = true;
  s.mission = null;
  s.adState.jobsSinceInterstitial += 1;
  const lines = [{ label: 'baseFare', amount: base }];
  if (cleanBonus) lines.push({ label: 'cleanBonus', amount: cleanBonus });
  if (tip) lines.push({ label: 'tip', amount: tip });
  if (timeBonus) lines.push({ label: 'timeBonus', amount: timeBonus });
  if (sum.finesPaid) lines.push({ label: 'finesPaid', amount: -sum.finesPaid });
  const receipt: RewardReceipt = {
    id: key,
    kind: 'ride',
    title: 'rideCompleted',
    from: sum.fromName,
    to: sum.toName,
    lines,
    net: credit - sum.finesPaid,
    xp,
    stars,
    passengers: sum.partySize,
    baseFare: base,
    rewardedClaimed: false,
    at: now,
  };
  s.pendingReceipts = [...s.pendingReceipts, receipt].slice(-10);
  pushTx(s, key, 'ride', credit, xp, now);
  touch(s, now);
  return { save: s, receipt, duplicate: false };
}

export interface BusSummary {
  missionId: string;
  routeName: string;
  fromName: string;
  toName: string;
  quote: number;
  stops: number;
  delivered: number;
  avgSatisfaction: number;
  clean: boolean;
  finesPaid: number;
}

export function settleBus(save: SaveData, sum: BusSummary, now: number): { save: SaveData; receipt: RewardReceipt; duplicate: boolean } {
  const key = `bus:${sum.missionId}`;
  const existing = save.pendingReceipts.find((r) => r.id === key);
  if (existing || hasTx(save, key)) return { save, receipt: existing ?? save.pendingReceipts[save.pendingReceipts.length - 1], duplicate: true };
  const s = clone(save);
  const { stars } = ratingFor(sum.avgSatisfaction);
  const clean = sum.clean ? Math.round(sum.quote * ECONOMY.bus.cleanRate) : 0;
  const tip = Math.round(sum.quote * ECONOMY.bus.maxTipRate * Math.max(0, Math.min(1, (sum.avgSatisfaction - 50) / 50)));
  const credit = sum.quote + clean + tip;
  const xp = busXP(sum.stops, sum.clean);
  s.wallet += credit;
  addXP(s, xp);
  s.lifetime.jobs += 1;
  s.lifetime.busRoutes += 1;
  s.lifetime.passengers += sum.delivered;
  s.lifetime.fareCredits += credit;
  if (sum.clean) s.lifetime.cleanRides += 1;
  s.recentRatings = [...s.recentRatings, stars].slice(-20);
  s.daily.jobs += 1;
  if (sum.clean) s.daily.cleanJobs += 1;
  s.daily.earned += credit;
  s.daily.busRoutes += 1;
  updateDailyProgress(s.daily);
  s.mission = null;
  s.adState.jobsSinceInterstitial += 1;
  const lines = [{ label: 'routeFare', amount: sum.quote }];
  if (clean) lines.push({ label: 'cleanBonus', amount: clean });
  if (tip) lines.push({ label: 'tip', amount: tip });
  if (sum.finesPaid) lines.push({ label: 'finesPaid', amount: -sum.finesPaid });
  const receipt: RewardReceipt = {
    id: key,
    kind: 'bus',
    title: 'routeCompleted',
    from: sum.fromName,
    to: sum.toName,
    lines,
    net: credit - sum.finesPaid,
    xp,
    stars,
    passengers: sum.delivered,
    baseFare: sum.quote,
    rewardedClaimed: false,
    at: now,
  };
  s.pendingReceipts = [...s.pendingReceipts, receipt].slice(-10);
  pushTx(s, key, 'bus', credit, xp, now);
  touch(s, now);
  return { save: s, receipt, duplicate: false };
}

/** Debit a fine immediately, capped by the wallet (never negative). Idempotent by fine id. */
export function applyFine(save: SaveData, fineId: string, amount: number, now: number): { save: SaveData; paid: number } {
  const key = `fine:${fineId}`;
  if (hasTx(save, key)) return { save, paid: 0 };
  const s = clone(save);
  const paid = Math.min(Math.max(0, Math.round(amount)), s.wallet);
  s.wallet -= paid;
  s.lifetime.finesPaid += paid;
  if (s.mission) s.mission.finesPaid += paid;
  pushTx(s, key, 'fine', -paid, 0, now);
  touch(s, now);
  return { save: s, paid };
}

export function dismissReceipt(save: SaveData, id: string, now: number): SaveData {
  if (!save.pendingReceipts.some((r) => r.id === id)) return save;
  const s = clone(save);
  s.pendingReceipts = s.pendingReceipts.filter((r) => r.id !== id);
  touch(s, now);
  return s;
}

/** Optional rewarded-ad bonus: +50% of base fare, granted once per receipt after a confirmed reward. */
export function grantRewardedBonus(save: SaveData, receiptId: string, now: number): { save: SaveData; amount: number } {
  const key = `ad:${receiptId}`;
  const r = save.pendingReceipts.find((p) => p.id === receiptId);
  if (!r || r.rewardedClaimed || hasTx(save, key)) return { save, amount: 0 };
  const s = clone(save);
  const amount = Math.round(r.baseFare * ECONOMY.rewardedBonusRate);
  s.wallet += amount;
  s.pendingReceipts = s.pendingReceipts.map((p) => (p.id === receiptId ? { ...p, rewardedClaimed: true } : p));
  pushTx(s, key, 'ad', amount, 0, now);
  touch(s, now);
  return { save: s, amount };
}

// ---------- vehicles, upgrades, paint ----------

export type PurchaseError = 'owned' | 'level' | 'funds' | 'unknown' | 'maxed' | 'not_owned' | 'busy';

export function vehicleState(save: SaveData, id: VehicleId): 'equipped' | 'owned' | 'locked' | 'affordable' | 'unaffordable' {
  if (save.equippedVehicleId === id) return 'equipped';
  if (save.ownedVehicleIds.includes(id)) return 'owned';
  const spec = VEHICLES[id];
  if (levelForXP(save.totalXP) < spec.unlockLevel) return 'locked';
  return save.wallet >= spec.price ? 'affordable' : 'unaffordable';
}

export function purchaseVehicle(save: SaveData, id: VehicleId, now: number): { save: SaveData; error?: PurchaseError } {
  const spec = VEHICLES[id];
  if (!spec) return { save, error: 'unknown' };
  if (save.ownedVehicleIds.includes(id)) return { save, error: 'owned' };
  if (levelForXP(save.totalXP) < spec.unlockLevel) return { save, error: 'level' };
  if (save.wallet < spec.price) return { save, error: 'funds' };
  const s = clone(save);
  s.wallet -= spec.price;
  s.ownedVehicleIds = [...s.ownedVehicleIds, id];
  pushTx(s, `buy:${id}`, 'vehicle', -spec.price, 0, now);
  touch(s, now);
  return { save: s };
}

export function equipVehicle(save: SaveData, id: VehicleId, now: number): { save: SaveData; error?: PurchaseError } {
  if (!save.ownedVehicleIds.includes(id)) return { save, error: 'not_owned' };
  if (save.mission) return { save, error: 'busy' };
  if (save.equippedVehicleId === id) return { save };
  const s = clone(save);
  s.equippedVehicleId = id;
  touch(s, now);
  return { save: s };
}

export type UpgradeCategory = keyof UpgradeLevels;

export function upgradeLevels(save: SaveData, id: VehicleId): UpgradeLevels {
  return save.upgradesByVehicle[id] ?? { engine: 0, brakes: 0, tires: 0, comfort: 0 };
}

export function upgradeCost(id: VehicleId, tier: number) {
  return Math.round(Math.max(100, VEHICLES[id].upgradeReferencePrice * 0.06) * tier * tier);
}

export function buyUpgrade(save: SaveData, id: VehicleId, cat: UpgradeCategory, now: number): { save: SaveData; error?: PurchaseError } {
  if (!save.ownedVehicleIds.includes(id)) return { save, error: 'not_owned' };
  const cur = upgradeLevels(save, id);
  const next = cur[cat] + 1;
  if (next > 3) return { save, error: 'maxed' };
  const cost = upgradeCost(id, next);
  if (save.wallet < cost) return { save, error: 'funds' };
  const s = clone(save);
  s.wallet -= cost;
  s.upgradesByVehicle = { ...s.upgradesByVehicle, [id]: { ...cur, [cat]: next } };
  pushTx(s, `upg:${id}:${cat}:${next}`, 'upgrade', -cost, 0, now);
  touch(s, now);
  return { save: s };
}

export const PAINTS = [
  { color: '#2fc4a8', price: 150 },
  { color: '#ee5a52', price: 150 },
  { color: '#3f7fd8', price: 250 },
  { color: '#f4c430', price: 250 },
  { color: '#9b7fd6', price: 350 },
  { color: '#f39c5a', price: 350 },
  { color: '#f6efe2', price: 500 },
  { color: '#2b2f36', price: 500 },
];

export function buyPaint(save: SaveData, id: VehicleId, color: string, now: number): { save: SaveData; error?: PurchaseError } {
  if (!save.ownedVehicleIds.includes(id)) return { save, error: 'not_owned' };
  const p = PAINTS.find((x) => x.color === color);
  if (!p) return { save, error: 'unknown' };
  if (save.paintByVehicle[id] === color) return { save };
  if (save.wallet < p.price) return { save, error: 'funds' };
  const s = clone(save);
  s.wallet -= p.price;
  s.paintByVehicle = { ...s.paintByVehicle, [id]: color };
  pushTx(s, `paint:${id}:${color}:${now}`, 'paint', -p.price, 0, now);
  touch(s, now);
  return { save: s };
}

export function paintFor(save: SaveData, id: VehicleId) {
  return save.paintByVehicle[id] ?? VEHICLES[id].defaultColor;
}

// ---------- daily tasks ----------

export function utcDayKey(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function nextResetMs(ms: number) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

interface Template {
  id: string;
  target: number;
  cash: number;
  xp: number;
  eligible: (s: SaveData) => boolean;
}

const TEMPLATES: Template[] = [
  { id: 'jobs3', target: 3, cash: 200, xp: 50, eligible: () => true },
  { id: 'clean2', target: 2, cash: 150, xp: 50, eligible: () => true },
  { id: 'earn1000', target: 1000, cash: 250, xp: 75, eligible: () => true },
  { id: 'dest2', target: 2, cash: 150, xp: 40, eligible: () => true },
  { id: 'family1', target: 1, cash: 200, xp: 60, eligible: (s) => s.ownedVehicleIds.some((v) => VEHICLES[v as VehicleId].jobs.includes('family')) },
  { id: 'airport1', target: 1, cash: 220, xp: 60, eligible: (s) => s.ownedVehicleIds.some((v) => VEHICLES[v as VehicleId].jobs.includes('airport')) },
  { id: 'bus1', target: 1, cash: 400, xp: 100, eligible: (s) => s.ownedVehicleIds.some((v) => VEHICLES[v as VehicleId].kind === 'bus') },
];

/** Deterministic three-task board for a UTC day and the player's unlock snapshot. */
export function generateDailyTasks(dayKey: string, save: SaveData): DailyTask[] {
  const rng = mulberry32(hashString(`${save.profileId}:${dayKey}`));
  const first = rng() < 0.65 ? 'jobs3' : 'dest2';
  const second = 'clean2';
  const specials = TEMPLATES.filter((t) => ['family1', 'airport1', 'bus1'].includes(t.id) && t.eligible(save));
  const third = specials.length && rng() < 0.5 ? specials[Math.floor(rng() * specials.length)].id : 'earn1000';
  return [first, second, third].map((id) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    return { id: `${dayKey}:${t.id}`, template: t.id, target: t.target, progress: 0, rewardCash: t.cash, rewardXP: t.xp, claimed: false };
  });
}

export function updateDailyProgress(d: DailyBoard) {
  for (const t of d.tasks) {
    const v =
      t.template === 'jobs3'
        ? d.jobs
        : t.template === 'clean2'
          ? d.cleanJobs
          : t.template === 'earn1000'
            ? d.earned
            : t.template === 'dest2'
              ? d.destinations.length
              : t.template === 'family1'
                ? d.family
                : t.template === 'airport1'
                  ? d.airport
                  : t.template === 'bus1'
                    ? d.busRoutes
                    : 0;
    t.progress = Math.min(t.target, v);
  }
}

export function claimDaily(save: SaveData, taskId: string, now: number): { save: SaveData; error?: 'not_ready' | 'claimed' | 'unknown' } {
  const task = save.daily.tasks.find((t) => t.id === taskId);
  if (!task) return { save, error: 'unknown' };
  if (task.claimed || save.daily.claimedIds.includes(taskId) || hasTx(save, `daily:${taskId}`)) return { save, error: 'claimed' };
  if (task.progress < task.target) return { save, error: 'not_ready' };
  const s = clone(save);
  const t = s.daily.tasks.find((x) => x.id === taskId)!;
  t.claimed = true;
  s.daily.claimedIds = [...s.daily.claimedIds, taskId];
  s.wallet += t.rewardCash;
  addXP(s, t.rewardXP);
  pushTx(s, `daily:${taskId}`, 'daily', t.rewardCash, t.rewardXP, now);
  touch(s, now);
  return { save: s };
}

/**
 * Daily rollover (UTC). The clock never moves backward; on a forward day change, completed
 * unclaimed rewards are settled once into a carryover receipt, then today's board is created.
 */
export function ensureDailyBoard(save: SaveData, nowMs: number): { save: SaveData; rolled: boolean; carryover: number } {
  const today = utcDayKey(nowMs);
  const last = save.clock.lastDayKey;
  if (today < last) {
    // Device clock moved backward: keep the newer board, do not move the day backward.
    if (save.daily.tasks.length === 0) {
      const s = clone(save);
      s.daily.tasks = generateDailyTasks(s.daily.dayKey, s);
      return { save: s, rolled: false, carryover: 0 };
    }
    return { save, rolled: false, carryover: 0 };
  }
  if (today === save.daily.dayKey && save.daily.tasks.length > 0) {
    if (nowMs > save.clock.lastTime) {
      const s = clone(save);
      s.clock.lastTime = nowMs;
      return { save: s, rolled: false, carryover: 0 };
    }
    return { save, rolled: false, carryover: 0 };
  }
  const s = clone(save);
  let carry = 0;
  let carryXP = 0;
  if (save.daily.dayKey !== today) {
    for (const t of s.daily.tasks) {
      if (!t.claimed && t.progress >= t.target && !hasTx(s, `daily:${t.id}`)) {
        carry += t.rewardCash;
        carryXP += t.rewardXP;
        pushTx(s, `daily:${t.id}`, 'daily_carry', t.rewardCash, t.rewardXP, nowMs);
      }
    }
  }
  if (carry > 0) {
    s.wallet += carry;
    addXP(s, carryXP);
    s.pendingReceipts = [
      ...s.pendingReceipts,
      {
        id: `carry:${s.daily.dayKey}`,
        kind: 'daily_carryover' as const,
        title: 'dailyCarryover',
        from: s.daily.dayKey,
        to: today,
        lines: [{ label: 'dailyRewards', amount: carry }],
        net: carry,
        xp: carryXP,
        stars: 0,
        passengers: 0,
        baseFare: 0,
        rewardedClaimed: true,
        at: nowMs,
      },
    ].slice(-10);
  }
  s.daily = emptyDaily(today);
  s.daily.tasks = generateDailyTasks(today, s);
  s.clock = { lastDayKey: today, lastTime: nowMs };
  touch(s, nowMs);
  return { save: s, rolled: true, carryover: carry };
}

export function averageRating(save: SaveData) {
  if (!save.recentRatings.length) return 0;
  return save.recentRatings.reduce((a, b) => a + b, 0) / save.recentRatings.length;
}

/** Next vehicle the player is working toward (cheapest unowned). */
export function nextVehicleGoal(save: SaveData) {
  const order: VehicleId[] = ['auto_city', 'car_compact', 'car_coupe', 'mpv_seven', 'bus_small', 'bus_medium', 'bus_long', 'supercar'];
  const id = order.find((v) => !save.ownedVehicleIds.includes(v));
  if (!id) return null;
  return { id, price: VEHICLES[id].price, level: VEHICLES[id].unlockLevel };
}
