import { vehicleEntry } from '../game/vehicles/entry';
import { runtime } from '../game/core/runtime';
import { input } from '../game/input/input';
import { pauseManager } from '../game/core/pause';

/** True for dev server and dedicated e2e builds only. Release builds never expose test hooks. */
export const TEST_HOOKS = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';

export interface DebugCam {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
}

export const debug: { cam: DebugCam | null; extra: Record<string, unknown> } = { cam: null, extra: {} };

/**
 * Test-only autopilot: follows the active GPS route with simple pure-pursuit steering through the
 * normal input path (pedal channel), and stops at the route end. Used by e2e flows.
 */
type Obstacles = { gap: () => number; redAhead: () => number };

function makeAutopilot(getRoute: () => { points: [number, number][]; cumulative: number[]; length: number } | null, getAlong: () => number, obstacles: Obstacles) {
  let on = false;
  let maxSpeed = 9;
  let blockedFor = 0;
  const step = () => {
    if (!on) return;
    const r = getRoute();
    if (!r) {
      input.pedals.gas = 0;
      input.pedals.brake = 1;
      input.pedals.steer = 0;
      return;
    }
    const p = runtime.pose;
    const along = getAlong();
    const remaining = r.length - along;
    const look = Math.min(r.length, along + 5 + Math.abs(runtime.telemetry.speed) * 0.6);
    let i = 0;
    while (i < r.cumulative.length - 2 && r.cumulative[i + 1] < look) i++;
    const a = r.points[i];
    const b = r.points[i + 1] ?? a;
    const seg = r.cumulative[i + 1] - r.cumulative[i] || 1;
    const t = Math.min(1, Math.max(0, (look - r.cumulative[i]) / seg));
    const tx = a[0] + (b[0] - a[0]) * t;
    const tz = a[1] + (b[1] - a[1]) * t;
    const want = Math.atan2(tx - p.x, tz - p.z);
    let diff = want - p.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    input.pedals.steer = Math.max(-1, Math.min(1, -diff * 2.4));
    let target = Math.min(maxSpeed, Math.abs(diff) > 0.35 ? 4.5 : maxSpeed);
    target = Math.min(target, Math.max(0, (remaining - 1.2) * 0.45));
    // drive like a careful player: keep a gap and stop for red/amber lights
    const gap = obstacles.gap();
    // a careful driver waits, but resolves a standoff by creeping after 5 s
    blockedFor = gap < 6 && Math.abs(runtime.telemetry.speed) < 0.3 ? blockedFor + 1 / 60 : 0;
    if (gap < Infinity && blockedFor < 5) target = Math.min(target, Math.max(0, (gap - 4) * 0.5));
    else if (blockedFor >= 5) target = Math.min(target, 2);
    const red = obstacles.redAhead();
    if (red < Infinity) target = Math.min(target, Math.max(0, (red - 1.5) * 0.5));
    const v = runtime.telemetry.speed;
    if (remaining < 1.5 || target < 0.3) {
      input.pedals.gas = 0;
      input.pedals.brake = v > 0.15 ? 1 : 0;
      input.pedals.steer = 0;
    } else if (v < target - 0.3) {
      input.pedals.gas = Math.min(1, (target - v) * 0.6 + 0.2);
      input.pedals.brake = 0;
    } else if (v > target + 0.5) {
      input.pedals.gas = 0;
      input.pedals.brake = Math.min(1, (v - target) * 0.5);
    } else {
      input.pedals.gas = 0.15;
      input.pedals.brake = 0;
    }
  };
  return {
    start(speed = 9) {
      maxSpeed = speed;
      on = true;
    },
    stop() {
      on = false;
      input.pedals.gas = 0;
      input.pedals.brake = 0;
      input.pedals.steer = 0;
    },
    step,
    get on() {
      return on;
    },
  };
}

export async function installDevHooks() {
  if (!TEST_HOOKS) return;
  const [{ rides, nav }, { useGame }, { recoverVehicle, playerRoad }, platformMod, { traffic }, { pedestrians }, { lightFor }, { INTERSECTION_BY_ID }, { VEHICLES }] = await Promise.all([
    import('../game/missions/rides'),
    import('./store'),
    import('../game/rules/recovery'),
    import('../platform'),
    import('../game/traffic/traffic'),
    import('../game/pedestrians/pedestrians'),
    import('../game/traffic/signals'),
    import('../game/navigation/roadGraph'),
    import('../game/data/vehicles'),
  ]);
  const [{ enforcement }, { police }, { violations }, { fuel }, { rideVisual }, cityMap, { audio }] = await Promise.all([import('../game/rules/enforcementState'), import('../game/rules/police'), import('../game/rules/violations'), import('../game/vehicles/fuel'), import('../game/missions/rides'), import('../game/data/cityMap'), import('../game/audio/audio')]);
  const { loadImportedModel } = await import('../game/render/importedVehicles');
  const { events } = await import('../game/core/events');
  const { quoteRide } = await import('../game/progression/progression');
  const autopilot = makeAutopilot(
    () => (nav.active ? nav.route : null),
    () => nav.along,
    {
      gap: () => {
        const p = runtime.pose;
        const v = VEHICLES[runtime.vehicleId];
        return traffic.gapFrom(p.x, p.z, p.heading, v.width / 2, v.length / 2, 10 + Math.abs(runtime.telemetry.speed) * 3, true);
      },
      redAhead: () => {
        const pr = playerRoad.proj;
        if (pr.kind !== 'segment' || !pr.segment) return Infinity;
        const dist = pr.segment.length - pr.s - VEHICLES[runtime.vehicleId].length / 2;
        if (dist > 35 || dist < -0.5) return Infinity;
        const j = INTERSECTION_BY_ID.get(pr.segment.to)!;
        const light = lightFor(j, pr.segment.dir, runtime.simTime);
        if (light === 'R') return dist;
        if (light === 'A' && dist > Math.abs(runtime.telemetry.speed) * 1.2) return dist;
        return Infinity;
      },
    },
  );
  runtime.register('zz-autopilot', () => autopilot.step());
  const audioLab = {
    /**
     * Offline render of a vehicle's engine voice through a scripted ride (throttle/brake keyframes, simple
     * longitudinal model). Returns a 16-bit mono WAV (base64), a 100 ms log and the one-shot counts.
     */
    async renderEngine(id: string, seconds: number, keys: { t: number; throttle: number; brake: number }[]) {
      const { RecordedEngine } = await import('../game/audio/recordedEngine');
      const spec = VEHICLES[id as keyof typeof VEHICLES], rate = 44100, step = 1 / 60;
      const ctx = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate), out = ctx.createGain(); out.connect(ctx.destination);
      const engine = new RecordedEngine(ctx, out), drive = { steer: 0, throttle: 0, brake: 0, handbrake: false };
      engine.update(spec, 0, true, { drive, seated: true });
      for (let i = 0; i < 600 && engine.status === 'loading'; i++) await new Promise((r) => setTimeout(r, 50));
      const at = (t: number) => keys.reduce((k, key) => key.t <= t ? key : k, keys[0]);
      const log: { t: number; rpm: number; gear: number; stage: string; speed: number }[] = [];
      let speed = 0;
      const top = spec.topSpeedKmh / 3.6;
      for (let i = 1; i * step < seconds - step; i++) {
        const t = i * step;
        void ctx.suspend(t).then(() => {
          const k = at(t); drive.throttle = k.throttle; drive.brake = k.brake;
          speed = Math.max(0, speed + (k.throttle * 9 * (1 - (speed / top) ** 2) - k.brake * 9 - .25) * step);
          engine.update(spec, speed, true, { drive, seated: true });
          if (i % 6 === 0) log.push({ t: +t.toFixed(2), rpm: Math.round(engine.rpm), gear: engine.gear, stage: engine.stage, speed: +(speed * 3.6).toFixed(1) });
          void ctx.resume();
        });
      }
      const data = (await ctx.startRendering()).getChannelData(0), effects = { ...engine.effects };
      engine.dispose();
      const view = new DataView(new ArrayBuffer(44 + data.length * 2)), text = (o: number, v: string) => [...v].forEach((c, j) => view.setUint8(o + j, c.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, 36 + data.length * 2, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, data.length * 2, true);
      data.forEach((v, j) => view.setInt16(44 + j * 2, Math.max(-1, Math.min(1, v)) * 32767, true));
      let binary = ''; const bytes = new Uint8Array(view.buffer);
      for (let j = 0; j < bytes.length; j += 32768) binary += String.fromCharCode(...bytes.subarray(j, j + 32768));
      return { wav: btoa(binary), log, effects };
    },
  };
  (window as unknown as { __cr: unknown }).__cr = { runtime, vehicleEntry, vehicles: VEHICLES, loadImportedModel, quoteRide, input, debug, rides, nav, rideVisual, fuel, cityMap, audio, store: useGame, pauseManager, autopilot, recoverVehicle, platform: platformMod.platform, traffic, pedestrians, enforcement, police, violations, setWeather: (w: 'sunny' | 'rain') => useGame.getState().setWeather(w), audioLab, events };
}
