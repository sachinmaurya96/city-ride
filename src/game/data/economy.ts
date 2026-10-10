// Economy, XP, satisfaction and enforcement parameters (plan §9.5, §10.4, §11, §12.3, §13).
// All values are initial design parameters — tune here, not in systems.

/** Flat price (₹) of a full tank for any vehicle. */
export const FUEL_TANK_PRICE = 60;

export const ECONOMY = {
  fareBase: 80,
  farePerMeter: 0.45,
  maxCombinedMultiplier: 1.5,
  tutorialFare: 120,
  cleanBonusRate: 0.1,
  rideTypeMultiplier: { standard: 1.0, office: 1.1, family: 1.15, airport: 1.15, vip: 1.35, rain: 1.0 } as Record<string, number>,
  rainModifier: 1.12,
  rewardedBonusRate: 0.5,
  bus: { base: 200, perMeter: 0.6, perPassenger: 35, cleanRate: 0.1, maxTipRate: 0.1 },
  paintPrices: [150, 250, 350, 500],
};

export const XP = {
  rideBase: 100,
  perHundredMeters: 5,
  maxDistanceBonus: 50,
  clean: 25,
  busBase: 120,
  busPerStop: 40,
};

export const SATISFACTION = {
  scrape: 5,
  crash: 20,
  redLight: 10,
  wrongWay: 10,
  harshBraking: 3,
  harshBrakeThreshold: 6.5, // m/s² filtered deceleration
  harshBrakeEventsBeforePenalty: 3,
};

/** Rating bands: [minScore, stars, tipRate]. */
export const RATING_BANDS: [number, number, number][] = [
  [90, 5, 0.15],
  [75, 4, 0.1],
  [55, 3, 0.05],
  [30, 2, 0],
  [0, 1, 0],
];

export const RIDE_TIMING = {
  offerDelayMin: 3,
  offerDelayMax: 6,
  offerExpiry: 30,
  declineCooldown: 4,
  cancelCooldown: 6,
  stopHold: 1.2,
  boardTime: 3.2,
  alightTime: 3.6,
  maxStopSpeed: 1 / 3.6,
  maxHeadingDeg: 35,
};

export const OFFICE_DEADLINE = { factor: 1.6, extraSeconds: 45, bonusRate: 0.15 };
