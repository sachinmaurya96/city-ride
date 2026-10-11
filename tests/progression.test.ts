import { describe, expect, it } from 'vitest';
import { createDefaultSave, defaultSettings, validateSave, type SaveData } from '../src/storage/schema';
import {
  applyFine,
  buyUpgrade,
  claimDaily,
  dismissReceipt,
  ensureDailyBoard,
  equipVehicle,
  grantRewardedBonus,
  levelForXP,
  purchaseVehicle,
  claimWelcomeBonus,
  nextVehicleGoal,
  quoteRide,
  ratingFor,
  settleRide,
  upgradeCost,
  utcDayKey,
  xpForLevel,
  type RideSummary,
} from '../src/game/progression/progression';
import { deriveHandling } from '../src/game/vehicles/handling';
import { VEHICLES, VEHICLE_ORDER, inGarage } from '../src/game/data/vehicles';

const DAY = Date.UTC(2026, 9, 8, 12, 0, 0);

function fresh(): SaveData {
  const s = createDefaultSave(DAY, utcDayKey(DAY), defaultSettings('medium', 'en'));
  return ensureDailyBoard(s, DAY).save;
}

function summary(id: string, over: Partial<RideSummary> = {}): RideSummary {
  return {
    missionId: id,
    quote: quoteRide({ routeMeters: 600, vehicleId: 'bike_basic', rideType: 'standard', rain: false, estSeconds: 90 }),
    satisfaction: 100,
    finesPaid: 0,
    clean: true,
    elapsed: 80,
    partySize: 1,
    rideType: 'standard',
    fromName: 'A',
    toName: 'B',
    toLandmark: 'city_mall',
    ...over,
  };
}

describe('fares, XP and ratings', () => {
  it('refuses purchasing/equipping NPC vehicles, even from an older owned list', () => {
    for (const spec of Object.values(VEHICLES).filter(spec => spec.npcOnly)) {
      const save = fresh();
      expect(purchaseVehicle(save, spec.id, DAY)).toMatchObject({ error: 'unknown', save });
      save.ownedVehicleIds.push(spec.id);
      expect(equipVehicle(save, spec.id, DAY)).toMatchObject({ error: 'unknown', save });
    }
  });
  it('migrates an equipped NPC and active ride to a free player car without changing wallet or ride progress', () => {
    const save = fresh();
    save.equippedVehicleId = 'pack_hummer';
    save.ownedVehicleIds.push('pack_hummer');
    save.settings.speedLimiter = true;
    save.mission = { id: 'legacy-npc-ride', kind: 'ride', seed: 2, state: 'TO_DROPOFF', vehicleId: 'pack_hummer',
      passengerName: 'Diya', avatar: 0, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
      quote: summary('legacy-npc-ride').quote, elapsed: 25, satisfaction: 90, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: null, bus: null };
    const loaded = validateSave(save);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.equippedVehicleId).toBe('bmw_i8');
    expect(loaded.data.ownedVehicleIds).toContain('bmw_i8');
    expect(loaded.data.ownedVehicleIds).not.toContain('pack_hummer');
    expect(loaded.data.wallet).toBe(save.wallet);
    expect(loaded.data.settings.speedLimiter).toBe(false);
    expect(loaded.data.mission).toMatchObject({ id: save.mission.id, vehicleId: 'bmw_i8', elapsed: 25, satisfaction: 90 });
  });
  it('swaps a retired Spectre for the Ghost and refunds the other retired cars, even mid-ride in one', () => {
    const save = fresh() as SaveData & { ownedVehicleIds: string[] };
    save.wallet = 100;
    save.ownedVehicleIds.push('rolls_spectre', 'western_star', 'fast_72', 'classic_sport');
    save.equippedVehicleId = 'fast_72' as never;
    save.transactionHistory.push({ key: 'buy:fast_72', kind: 'vehicle', cash: -2500, xp: 0, at: DAY });
    save.mission = { id: 'retired-ride', kind: 'ride', seed: 3, state: 'TO_PICKUP', vehicleId: 'fast_72' as never,
      passengerName: 'Diya', avatar: 0, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
      quote: summary('retired-ride').quote, elapsed: 5, satisfaction: 100, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: null, bus: null };
    const loaded = validateSave(JSON.parse(JSON.stringify(save)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.ownedVehicleIds).toEqual(['bike_basic', 'rolls_ghost']);
    // Fast 72: the ₹2,500 actually paid; Western Star and Classic Sport: their last listed prices.
    expect(loaded.data.wallet).toBe(100 + 2500 + 4000 + 2000);
    expect(loaded.data.transactionHistory.filter((t) => t.key.startsWith('refund:')).map((t) => t.cash)).toEqual([4000, 2500, 2000]);
    expect(loaded.data.equippedVehicleId).toBe('bike_basic');
    expect(loaded.data.mission).toMatchObject({ id: 'retired-ride', vehicleId: 'bike_basic', elapsed: 5 });
    // Loading again changes nothing; a Spectre owner who already has the Ghost is refunded instead.
    const again = validateSave(JSON.parse(JSON.stringify(loaded.data)));
    expect(again.ok && again.data.wallet).toBe(loaded.data.wallet);
    const both = fresh() as SaveData & { ownedVehicleIds: string[] };
    both.ownedVehicleIds.push('rolls_ghost', 'rolls_spectre'); both.equippedVehicleId = 'rolls_spectre' as never;
    const swapped = validateSave(JSON.parse(JSON.stringify(both)));
    expect(swapped.ok && swapped.data).toMatchObject({ ownedVehicleIds: ['bike_basic', 'rolls_ghost'], equippedVehicleId: 'rolls_ghost', wallet: both.wallet + 9900 });
  });
  it('quotes the plan formula and caps combined multipliers', () => {
    expect(quoteRide({ routeMeters: 600, vehicleId: 'bike_basic', rideType: 'standard', rain: false, estSeconds: 1 }).baseFare).toBe(350);
    expect(quoteRide({ routeMeters: 600, vehicleId: 'car_compact', rideType: 'standard', rain: false, estSeconds: 1 }).baseFare).toBe(700);
    const vipRain = quoteRide({ routeMeters: 600, vehicleId: 'car_coupe', rideType: 'vip', rain: true, estSeconds: 1 });
    expect(vipRain.typeMultiplier).toBeLessThanOrEqual(1.5);
    expect(quoteRide({ routeMeters: 999, vehicleId: 'bike_basic', rideType: 'standard', rain: false, estSeconds: 1, tutorial: true }).baseFare).toBe(120);
  });
  it('fare is fixed by the original quote: a detour (long elapsed) does not change base fare', () => {
    const s = fresh();
    const a = settleRide(s, summary('r1'), DAY).receipt;
    const b = settleRide(s, summary('r2', { elapsed: 5000 }), DAY).receipt;
    expect(a.lines[0].amount).toBe(b.lines[0].amount);
  });
  it('levels follow 150(L-1)+10(L-1)^2', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(160);
    expect(xpForLevel(3)).toBe(340);
    expect(levelForXP(0)).toBe(1);
    expect(levelForXP(159)).toBe(1);
    expect(levelForXP(160)).toBe(2);
  });
  it('rating bands and tips', () => {
    expect(ratingFor(95)).toEqual({ stars: 5, tipRate: 0.15 });
    expect(ratingFor(80)).toEqual({ stars: 4, tipRate: 0.1 });
    expect(ratingFor(60)).toEqual({ stars: 3, tipRate: 0.05 });
    expect(ratingFor(40)).toEqual({ stars: 2, tipRate: 0 });
    expect(ratingFor(-10)).toEqual({ stars: 1, tipRate: 0 });
  });
});

describe('settlement integrity', () => {
  it('one completion changes wallet, XP, stats and daily counters exactly once', () => {
    const s0 = fresh();
    const r1 = settleRide(s0, summary('ride-a'), DAY);
    expect(r1.duplicate).toBe(false);
    expect(r1.save.wallet).toBe(350 + 35 + 53);
    expect(r1.save.lifetime.jobs).toBe(1);
    expect(r1.save.daily.jobs).toBe(1);
    expect(r1.save.totalXP).toBe(100 + 30 + 25);
    const r2 = settleRide(r1.save, summary('ride-a'), DAY);
    expect(r2.duplicate).toBe(true);
    expect(r2.save.wallet).toBe(r1.save.wallet);
    // after the receipt is dismissed the transaction journal still blocks a replay
    const dismissed = dismissReceipt(r1.save, r1.receipt.id, DAY);
    const r3 = settleRide(dismissed, summary('ride-a'), DAY);
    expect(r3.duplicate).toBe(true);
    expect(r3.save.wallet).toBe(r1.save.wallet);
    expect(s0.wallet).toBe(0); // input never mutated
  });
  it('fines already paid are reported, not debited twice; wallet never negative', () => {
    let s = fresh();
    s = settleRide(s, summary('x'), DAY).save; // wallet 438
    const f = applyFine(s, 'f1', 60, DAY);
    expect(f.paid).toBe(60);
    expect(f.save.wallet).toBe(378);
    expect(applyFine(f.save, 'f1', 60, DAY).paid).toBe(0); // idempotent
    const broke = applyFine({ ...fresh(), wallet: 25 }, 'f2', 100, DAY);
    expect(broke.paid).toBe(25);
    expect(broke.save.wallet).toBe(0);
    const r = settleRide(f.save, summary('y', { finesPaid: 60, clean: false }), DAY);
    expect(r.save.wallet).toBe(f.save.wallet + 350 + 53);
    expect(r.receipt.net).toBe(350 + 53 - 60);
  });
  it('rewarded bonus is granted once per receipt', () => {
    const r = settleRide(fresh(), summary('z'), DAY);
    const g1 = grantRewardedBonus(r.save, r.receipt.id, DAY);
    expect(g1.amount).toBe(175);
    const g2 = grantRewardedBonus(g1.save, r.receipt.id, DAY);
    expect(g2.amount).toBe(0);
    expect(g2.save.wallet).toBe(g1.save.wallet);
  });
});

describe('purchases and upgrades', () => {
  it('insufficient money / level and double purchase are safe', () => {
    const s = fresh();
    expect(purchaseVehicle(s, 'auto_city', DAY).error).toBe('level');
    const rich = { ...s, wallet: 5000, totalXP: xpForLevel(3) };
    const a = purchaseVehicle(rich, 'auto_city', DAY);
    expect(a.error).toBeUndefined();
    expect(a.save.wallet).toBe(3500);
    const b = purchaseVehicle(a.save, 'auto_city', DAY);
    expect(b.error).toBe('owned');
    expect(b.save.wallet).toBe(3500);
    expect(purchaseVehicle({ ...rich, wallet: 100 }, 'auto_city', DAY).error).toBe('funds');
  });
  it('equip is blocked during an active job and bike always remains', () => {
    const s: SaveData = { ...fresh(), ownedVehicleIds: ['bike_basic', 'auto_city'] };
    expect(equipVehicle(s, 'auto_city', DAY).save.equippedVehicleId).toBe('auto_city');
    const busy = { ...s, mission: { id: 'm' } as unknown as SaveData['mission'] };
    expect(equipVehicle(busy, 'auto_city', DAY).error).toBe('busy');
  });
  it('upgrade cost formula, max tier and derived stats do not compound across reloads', () => {
    expect(upgradeCost('bike_basic', 1)).toBe(100);
    expect(upgradeCost('car_compact', 1)).toBe(390);
    expect(upgradeCost('car_compact', 2)).toBe(1560);
    let s: SaveData = { ...fresh(), wallet: 100000 };
    for (let i = 0; i < 3; i++) s = buyUpgrade(s, 'bike_basic', 'engine', DAY).save;
    expect(buyUpgrade(s, 'bike_basic', 'engine', DAY).error).toBe('maxed');
    const reloaded = validateSave(JSON.parse(JSON.stringify(s)));
    expect(reloaded.ok).toBe(true);
    const h1 = deriveHandling(VEHICLES.bike_basic, s.upgradesByVehicle.bike_basic);
    const h2 = deriveHandling(VEHICLES.bike_basic, (reloaded as { data: SaveData }).data.upgradesByVehicle.bike_basic);
    expect(h2.accel0).toBeCloseTo(h1.accel0);
    expect(h1.accel0 / deriveHandling(VEHICLES.bike_basic).accel0).toBeCloseTo(1.18);
  });
});

describe('daily tasks and clock', () => {
  it('board is deterministic for a day and stable across reload', () => {
    const a = fresh();
    const b = ensureDailyBoard(JSON.parse(JSON.stringify(a)), DAY + 3600_000).save;
    expect(b.daily.tasks.map((t) => t.id)).toEqual(a.daily.tasks.map((t) => t.id));
  });
  it('claims once; settles completed unclaimed rewards once at rollover; ignores clock moving backward', () => {
    let s = fresh();
    for (let i = 0; i < 3; i++) s = settleRide(s, summary(`d${i}`), DAY).save;
    const jobsTask = s.daily.tasks.find((t) => t.template === 'clean2')!;
    const c1 = claimDaily(s, jobsTask.id, DAY);
    expect(c1.error).toBeUndefined();
    expect(claimDaily(c1.save, jobsTask.id, DAY).error).toBe('claimed');
    const before = c1.save.wallet;
    const unclaimedReady = c1.save.daily.tasks.filter((t) => !t.claimed && t.progress >= t.target).reduce((a, t) => a + t.rewardCash, 0);
    const next = DAY + 86400_000;
    const rolled = ensureDailyBoard(c1.save, next);
    expect(rolled.rolled).toBe(true);
    expect(rolled.save.wallet).toBe(before + unclaimedReady);
    expect(rolled.save.daily.dayKey).toBe(utcDayKey(next));
    expect(rolled.save.daily.jobs).toBe(0);
    // multi-day absence: only the current day's board, no extra rewards
    const later = ensureDailyBoard(rolled.save, next + 5 * 86400_000);
    expect(later.save.wallet).toBe(rolled.save.wallet);
    // clock moves backward: day does not move backward
    const back = ensureDailyBoard(later.save, DAY);
    expect(back.save.daily.dayKey).toBe(later.save.daily.dayKey);
    expect(back.rolled).toBe(false);
  });
});

describe('save validation', () => {
  it('clamps impossible counters, drops unknown vehicles, rejects garbage without inventing money', () => {
    const s = fresh() as unknown as Record<string, unknown>;
    const bad = { ...s, wallet: -50.7, ownedVehicleIds: ['bike_basic', 'tank_9000', 'auto_city'], equippedVehicleId: 'tank_9000' };
    const v = validateSave(bad);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.data.wallet).toBe(0);
      expect(v.data.ownedVehicleIds).toEqual(['bike_basic', 'auto_city']);
      expect(v.data.equippedVehicleId).toBe('bike_basic');
    }
    expect(validateSave({ wallet: 'lots' }).ok).toBe(false);
    expect(validateSave(null).ok).toBe(false);
    expect(validateSave({ ...s, schemaVersion: 99 }).ok).toBe(false);
  });
});

describe('starter economy', () => {
  it('pays the ₹1000 welcome bonus exactly once and keeps it across save validation', () => {
    const s = claimWelcomeBonus(fresh(), DAY);
    expect(s.wallet).toBe(1000); expect(s.welcomeBonusClaimed).toBe(true);
    expect(claimWelcomeBonus(s, DAY + 1).wallet).toBe(1000);
    const loaded = validateSave(JSON.parse(JSON.stringify(s)));
    expect(loaded.ok && loaded.data.welcomeBonusClaimed).toBe(true);
  });
  it('older saves without the new fields load with no fuel due and an unclaimed bonus', () => {
    const raw = JSON.parse(JSON.stringify(fresh())); delete raw.fuelDebt; delete raw.welcomeBonusClaimed;
    const loaded = validateSave(raw);
    expect(loaded.ok && loaded.data).toMatchObject({ fuelDebt: 0, welcomeBonusClaimed: false });
  });
  it('imported cars now cost money and cannot be bought without enough cash', () => {
    const s = fresh();
    expect(s.ownedVehicleIds).toEqual(['bike_basic']);
    expect(purchaseVehicle({ ...s, wallet: 1000 }, 'bmw_i8', DAY).error).toBe('funds');
    const r = purchaseVehicle({ ...s, wallet: 7000 }, 'bmw_i8', DAY);
    expect(r.error).toBeUndefined(); expect(r.save.wallet).toBe(1000); expect(r.save.ownedVehicleIds).toContain('bmw_i8');
  });
  it('only the starter bike is free and every other vehicle costs under ₹10,000', () => {
    for (const id of VEHICLE_ORDER) {
      if (id === 'bike_basic') expect(VEHICLES[id].price).toBe(0);
      else { expect(VEHICLES[id].price, id).toBeGreaterThan(0); expect(VEHICLES[id].price, id).toBeLessThan(10000); }
    }
  });
});

describe('garage showroom', () => {
  it('lists real models and keeps older owned utility vehicles, excluding retired cars even when owned', () => {
    const listed = VEHICLE_ORDER.filter((id) => inGarage(id));
    expect(listed).toContain('bike_basic');
    for (const id of listed) if (id !== 'bike_basic') expect(VEHICLES[id].importedModel, id).toBeTruthy();
    for (const id of ['auto_city', 'bus_small', 'bus_medium', 'bus_long'] as const) {
      expect(inGarage(id), id).toBe(false);
      expect(inGarage(id, ['bike_basic', id]), id).toBe(true);
    }
    for (const id of ['car_compact', 'car_coupe', 'mpv_seven', 'supercar'] as const) {
      expect(inGarage(id, ['bike_basic', id]), id).toBe(false);
    }
  });
  it('suggests the cheapest showroom car not yet owned as the next goal', () => {
    expect(nextVehicleGoal(fresh())).toMatchObject({ id: 'bmw_m3_gtr', price: 4000 });
  });
});
