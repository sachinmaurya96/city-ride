import { describe, expect, it } from 'vitest';
import { cutEngineSample, supercarMix, SUPERCAR_LAYERS, SUPERCAR_START } from '../src/game/audio/engineSamples';

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
