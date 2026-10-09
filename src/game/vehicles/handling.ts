import type { VehicleSpec } from '../data/vehicles';

export interface UpgradeLevels {
  engine: number;
  brakes: number;
  tires: number;
  comfort: number;
}

export const NO_UPGRADES: UpgradeLevels = { engine: 0, brakes: 0, tires: 0, comfort: 0 };

/** Effective physics parameters derived from base spec + upgrade tiers + weather (never stored). */
export interface Handling {
  mass: number;
  topSpeed: number; // m/s
  /** Initial acceleration a0 (m/s²) of the exponential approach to top speed. */
  accel0: number;
  brakeDecel: number;
  maxSteer: number; // radians
  highSpeedSteer: number;
  steerResponse: number;
  grip: number; // friction slip
  comfortPenaltyScale: number;
}

export const RAIN_GRIP_FACTOR = 0.87;

export function deriveHandling(spec: VehicleSpec, up: UpgradeLevels = NO_UPGRADES, rain = false): Handling {
  const topSpeed = (spec.topSpeedKmh / 3.6) * (1 + 0.03 * up.engine);
  const v40 = 40 / 3.6;
  // Solve v(t) = vmax(1 - e^{-a0 t / vmax}) for v(T) = 40 km/h, then +6% force per engine tier.
  const baseA0 = (-spec.topSpeedKmh / 3.6) * Math.log(1 - v40 / (spec.topSpeedKmh / 3.6)) / spec.accel0to40;
  const accel0 = baseA0 * (1 + 0.06 * up.engine);
  const brakeDecel = Math.min(spec.brakeDecel * (1 + 0.06 * up.brakes), 8.5);
  const gripBase = (spec.kind === 'car' ? 3.2 : 2.2) * (1 + 0.05 * up.tires);
  return {
    mass: spec.mass,
    topSpeed,
    accel0,
    brakeDecel,
    maxSteer: (spec.maxSteerDeg * Math.PI) / 180,
    highSpeedSteer: Math.min(0.6, spec.highSpeedSteer * (1 + 0.04 * up.tires)),
    steerResponse: spec.steerResponse * (1 - 0.05 * up.tires),
    grip: rain ? gripBase * RAIN_GRIP_FACTOR : gripBase,
    comfortPenaltyScale: 1 - 0.1 * up.comfort,
  };
}
