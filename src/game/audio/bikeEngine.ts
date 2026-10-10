/**
 * A superbike engine as the rider hears it: a six-speed gearbox, clutch slip when pulling away, free revs
 * at a standstill, an ignition cut on full-power upshifts, blipped downshifts and kick-down for overtaking.
 * Pure state, so the audio graph only maps rpm/load to sound and tests can drive it without Web Audio.
 */

/** Share of top speed reached at the redline in each gear (close-ratio six-speed). */
export const BIKE_GEARS = [.26, .4, .53, .66, .82, 1] as const;

export type BikeEngineEvent = 'up' | 'down' | 'engage';
export interface BikeEngineState {
  rpm: number;
  gear: number;
  /** 0 = closed throttle / overrun, 1 = full load. */
  load: number;
  /** Seconds left of an upshift ignition cut / downshift blip. */
  cut: number;
  blip: number;
  /** Seconds spent stopped (first gear clunks in when pulling away after a stop). */
  stopped: number;
  events: BikeEngineEvent[];
}
export interface BikeEngineInput { speed: number; top: number; throttle: number; braking: boolean; idle: number; redline: number }

export function newBikeEngine(idle: number): BikeEngineState {
  return { rpm: idle, gear: 1, load: 0, cut: 0, blip: 0, stopped: 10, events: [] };
}

export function stepBikeEngine(st: BikeEngineState, dt: number, input: BikeEngineInput) {
  const { idle, redline } = input;
  const speed = Math.abs(input.speed), frac = Math.min(1.05, speed / Math.max(1, input.top));
  const gas = input.braking ? 0 : Math.max(0, Math.min(1, input.throttle));
  const moving = speed > .5;
  st.events.length = 0;
  st.cut = Math.max(0, st.cut - dt); st.blip = Math.max(0, st.blip - dt);
  if (moving && st.stopped > 1.2) st.events.push('engage');
  st.stopped = moving ? 0 : st.stopped + dt;
  const geared = (gear: number) => redline * frac / BIKE_GEARS[gear - 1];
  if (!moving) st.gear = 1;
  else {
    // The harder the throttle, the later the upshift (redline at full power, early when cruising); never on
    // a closed throttle unless over-revving. Downshift as the revs sag: earlier under braking, and kick
    // down for a hard overtake.
    const up = gas > .05 ? .55 + .38 * gas ** 1.5 : .97;
    while (st.gear < BIKE_GEARS.length && geared(st.gear) > redline * up) { st.gear++; st.events.push('up'); if (gas > .6) st.cut = .09; }
    const down = gas > .85 && st.cut <= 0 ? .55 : input.braking ? .5 : .34;
    while (st.gear > 1 && geared(st.gear) < redline * down && geared(st.gear - 1) < redline * .86) { st.gear--; st.events.push('down'); st.blip = .14; }
  }
  // Pulling away in first, the clutch slips: the revs hold at the launch rpm until the wheel catches up.
  const launch = idle + gas * (redline * .45 - idle);
  const wheel = Math.max(idle * 1.04, geared(st.gear));
  let target = !moving ? idle + gas * (redline * .72 - idle) : st.gear === 1 ? Math.max(wheel, launch) : wheel;
  if (st.blip > 0) target = Math.max(target, wheel * 1.1);
  // Free revs rise fast and fall slowly (flywheel); in gear the revs follow the wheel closely.
  const tau = !moving ? (target > st.rpm ? .07 : .32) : target > st.rpm ? .06 : .1;
  st.rpm += (target - st.rpm) * (1 - Math.exp(-dt / tau));
  const loadTarget = st.cut > 0 ? .12 : st.blip > 0 ? Math.max(gas, .6) : gas;
  st.load += (loadTarget - st.load) * (1 - Math.exp(-dt / (loadTarget > st.load ? .05 : .09)));
  return st;
}
