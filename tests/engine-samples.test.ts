import { describe, expect, it } from 'vitest';
import { BIKE2, bike2PitchAt, bikeMix, cutEngineSample, supercarMix, SUPERCAR_LAYERS, SUPERCAR_START } from '../src/game/audio/engineSamples';
import { newBikeEngine, stepBikeEngine } from '../src/game/audio/bikeEngine';

function buffer(channels: number, length: number, rate: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (channel: number) => data[channel] } as AudioBuffer;
}
const context = { createBuffer: buffer };

describe('uploaded engine recording playback', () => {
  it('moves from idle through pickup/acceleration to peak and keeps crossfades continuous at every boundary', () => {
    for (const layer of SUPERCAR_LAYERS) expect(supercarMix(layer.speed, 0).stage).toBe(layer.name);
    for (let i = 0; i <= 100; i++) {
      const { weights } = supercarMix(i / 100, .7);
      expect(weights.reduce((sum, value) => sum + value * value, 0)).toBeCloseTo(1, 8);
      expect(weights.filter(weight => weight > 0).length).toBeLessThanOrEqual(2);
    }
    for (const layer of SUPERCAR_LAYERS.slice(1)) {
      const a = supercarMix(layer.speed - .00001, 0).weights, b = supercarMix(layer.speed + .00001, 0).weights;
      expect(a.reduce((sum, weight, i) => sum + Math.abs(weight - b[i]), 0)).toBeLessThan(.001);
    }
    expect(supercarMix(2, 0).stage).toBe('peak');
    expect(supercarMix(0, 0).stage).toBe('idle');
    expect(supercarMix(.7, 0).load).toBeLessThan(supercarMix(.7, 1).load);
    expect(supercarMix(0, 1, true)).toEqual(supercarMix(0, 0));
  });

  it('cuts the actual requested time range, makes the loop seam continuous and bounds loudness', () => {
    const source = buffer(2, 38000, 1000);
    for (let ch = 0; ch < 2; ch++) {
      const data = source.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * .1 + ch * .3) * .7 + i / data.length * .1;
    }
    for (const layer of SUPERCAR_LAYERS) {
      const sample = cutEngineSample(context, source, layer.from, layer.to, true);
      expect(sample.duration).toBeCloseTo(layer.to - layer.from - .035, 2);
      for (let ch = 0; ch < 2; ch++) {
        const data = sample.getChannelData(ch);
        expect(Math.abs(data[0] - data[data.length - 1])).toBeLessThan(.1);
        expect(Math.max(...data.map(Math.abs))).toBeLessThanOrEqual(.951);
        const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
        expect(rms).toBeGreaterThan(.15); expect(rms).toBeLessThan(.3);
      }
    }
    const startup = cutEngineSample(context, source, SUPERCAR_START.from, SUPERCAR_START.to, false);
    expect(startup.duration).toBeCloseTo(1.7, 2);
    for (let ch = 0; ch < 2; ch++) { const data = startup.getChannelData(ch); expect(Math.abs(data[0])).toBe(0); expect(Math.abs(data[data.length - 1])).toBe(0); }
    expect(() => cutEngineSample(context, source, 40, 42, true)).toThrow('shorter');
  });
});

describe('bike-sound-2 voice', () => {
  it('measured pitch track: steady idle, the start-up flare above it and the pull-away sweep', () => {
    for (let t = 4.8; t < 7.8; t += .05) { expect(bike2PitchAt(t)).toBeGreaterThan(33); expect(bike2PitchAt(t)).toBeLessThan(42); }
    expect(bike2PitchAt(3.2)).toBeGreaterThan(75);
    expect(bike2PitchAt(9.45)).toBeLessThan(60); expect(bike2PitchAt(11.3)).toBeGreaterThan(195);
    // Every loop lies inside the recording and its reference pitch inside the pitch it was cut from.
    for (const layer of BIKE2.layers) {
      const pitches = Array.from({ length: 20 }, (_, i) => bike2PitchAt(layer.from + (layer.to - layer.from) * i / 19));
      expect(layer.ref).toBeGreaterThanOrEqual(Math.min(...pitches) - 1); expect(layer.ref).toBeLessThanOrEqual(Math.max(...pitches) + 1);
    }
  });

  it('flattens a rising sweep to one steady pitch and loops it over whole cycles', () => {
    const rate = 8000, source = buffer(1, rate * 2, rate), data = source.getChannelData(0);
    const pitchAt = (t: number) => 100 + 50 * t; // 100 → 200 Hz over two seconds
    let phase = 0;
    for (let i = 0; i < data.length; i++) { phase += 2 * Math.PI * pitchAt(i / rate) / rate; data[i] = Math.sin(phase) * .5; }
    const loop = cutEngineSample(context, source, .4, 1.4, true, { at: pitchAt, ref: 150 }).getChannelData(0);
    const crossings: number[] = [];
    for (let i = 1; i < loop.length; i++) if (loop[i - 1] < 0 && loop[i] >= 0) crossings.push(i - loop[i] / (loop[i] - loop[i - 1]));
    const periods = crossings.slice(1).map((c, i) => c - crossings[i]);
    for (const period of periods.slice(4, -4)) expect(period).toBeCloseTo(rate / 150, 0);
    // Whole cycles: the wrap-around joins without a jump.
    expect(Math.abs(loop[0] - loop[loop.length - 1])).toBeLessThan(.12);
  });

  it('crossfades the two layers bracketing the engine frequency with equal power and pitches both to it', () => {
    for (const layer of BIKE2.layers) expect(bikeMix(layer.ref).stage).toBe(layer.stage);
    let previous = bikeMix(30).weights;
    for (let hz = 30; hz < 330; hz += .5) {
      const { weights, rates } = bikeMix(hz);
      expect(weights.reduce((sum, w) => sum + w * w, 0)).toBeCloseTo(1, 8);
      expect(weights.reduce((sum, w, i) => sum + Math.abs(w - previous[i]), 0)).toBeLessThan(.05);
      weights.forEach((w, i) => { if (w > .01) expect(rates[i] * BIKE2.layers[i].ref).toBeCloseTo(hz, 3); });
      previous = weights;
    }
  });
});

describe('superbike gearbox model', () => {
  const idle = 1300, redline = 14000, top = 80;
  const run = (seconds: number, speedAt: (t: number) => number, throttleAt: (t: number) => number, brakeAt = (_t: number) => false, st = newBikeEngine(idle)) => {
    const log: { t: number; rpm: number; gear: number; events: string[] }[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      stepBikeEngine(st, 1 / 60, { speed: speedAt(t), top, throttle: throttleAt(t), braking: brakeAt(t), idle, redline });
      log.push({ t, rpm: st.rpm, gear: st.gear, events: [...st.events] });
    }
    return log;
  };
  it('pulls away on the clutch, climbs through the gears near the redline and dips at each upshift', () => {
    const log = run(14, (t) => Math.min(top, t * 6), () => 1);
    expect(log.find(e => e.events.includes('engage'))).toBeDefined();
    const launch = log.filter(e => e.t > .3 && e.t < .9);
    for (const e of launch) expect(e.rpm).toBeGreaterThan(5500);
    const ups = log.filter(e => e.events.includes('up'));
    expect(ups.length).toBe(5);
    for (const up of ups) {
      const before = log[log.indexOf(up) - 1].rpm, after = log[log.indexOf(up) + 12].rpm;
      expect(before).toBeGreaterThan(redline * .88); expect(after).toBeLessThan(before - 1500);
    }
    expect(Math.max(...log.map(e => e.rpm))).toBeLessThan(redline * 1.01);
  });
  it('holds a gear at a steady speed (no hunting) and short-shifts on a light throttle', () => {
    for (const speed of [8, 15, 22, 31, 40, 55]) for (const throttle of [.15, .35, .6, 1]) {
      const log = run(6, () => speed, () => throttle);
      const changes = log.slice(60).filter((e, i, all) => i > 0 && e.gear !== all[i - 1].gear).length;
      expect(changes, `${speed} m/s at ${throttle}`).toBe(0);
    }
    const gentle = run(10, (t) => Math.min(30, t * 3), () => .35);
    expect(Math.max(...gentle.map(e => e.rpm))).toBeLessThan(redline * .66);
  });
  it('blips each downshift while braking to a stop and settles at idle in first', () => {
    const st = newBikeEngine(idle); st.gear = 6; st.rpm = 11000;
    const log = run(10, (t) => Math.max(0, 70 - t * 9), () => 0, () => true, st);
    const downs = log.filter(e => e.events.includes('down'));
    expect(downs.length).toBe(5);
    for (const down of downs) expect(log[log.indexOf(down) + 4].rpm).toBeGreaterThan(log[log.indexOf(down) - 1].rpm);
    expect(log.at(-1)).toMatchObject({ gear: 1 });
    expect(log.at(-1)!.rpm).toBeLessThan(idle + 50);
  });
});
