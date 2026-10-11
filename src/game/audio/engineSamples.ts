/** Sections measured from the supplied 37.872-second supercarsound.mp3 recording. */
export const SUPERCAR_START = { from: .55, to: 2.25 };
export const SUPERCAR_LAYERS = [
  { name: 'idle', from: 3.0, to: 4.4, speed: 0 },
  { name: 'pickup', from: 11.9, to: 12.8, speed: .16 },
  { name: 'acceleration', from: 16.05, to: 16.95, speed: .48 },
  { name: 'peak', from: 30.45, to: 31.6, speed: .86 },
] as const;
export type EngineStage = typeof SUPERCAR_LAYERS[number]['name'];
export type EngineLayer = { name: EngineStage; from: number; to: number; speed: number };

/**
 * bike-sound-2.mp3 (15 s) is one motorcycle from key-on to riding away, measured with a harmonic pitch tracker:
 * fuel pump 0.6–1.9 s, starter 1.45 s, fires at 2.65 s, cold-start flare to 3.9 s, settles to a steady idle
 * 4.7–7.9 s (~37 Hz firing), first-gear clunk 7.93 s, pulls away from 9.4 s (54 → 203 Hz), shifts at 11.35,
 * 12.75 and 13.9 s and rides off up to 271 Hz.
 */
export const BIKE2 = {
  start: { from: 1.40, to: 4.75, fire: 2.65 },
  /** The clack of first gear going in; played high-passed, so only the mechanical click is heard. */
  gear: { from: 7.86, to: 8.06 },
  /** Firing frequency (Hz) every 50 ms from 2.5 s, median-smoothed. */
  pitch: { t0: 2.5, step: .05, hz: [
    89.1, 88.8, 89.1, 92.8, 86.1, 86.1, 86.1, 86.3, 86.1, 77.3, 77.6, 77.6, 81.9, 81.9, 82.2, 84.6, 88.3, 89.1, 91.4, 90.7,
    89.1, 88.8, 86.1, 86.1, 87.1, 87.3, 87.1, 86.8, 87.3, 86.1, 78.7, 69.1, 64.5, 63.4, 59.8, 59, 51.8, 48.4, 48.6, 48.6,
    48.4, 43.3, 38, 35.9, 34.5, 34, 34.1, 35.6, 35.7, 35.6, 34.6, 34.5, 34.1, 34.4, 34.6, 34.6, 33.8, 33.9, 34.5, 34.4,
    34, 34, 34, 34.5, 34.6, 35, 35, 35, 35, 35.9, 37.7, 38.2, 40, 40, 40, 39.9, 39, 39, 40.4, 41,
    40.7, 40.4, 40.4, 40.4, 40.3, 39.5, 39.2, 39.2, 39.8, 39.9, 39.7, 39.6, 39.6, 39.1, 38.8, 39, 39, 39.2, 39.3, 39.3,
    38.7, 37.7, 37.7, 38.9, 39, 39.1, 39.1, 39, 39, 35, 35, 35, 35, 35, 33.1, 30.5, 30.5, 34.8, 39.6, 42.3,
    43, 43.1, 46.1, 52.5, 56.1, 56.5, 55, 48.4, 44.9, 44.9, 45.2, 45.3, 45.3, 45.3, 43, 43, 45.7, 50.7, 53.7, 53.9,
    55.2, 59.3, 63.7, 68.5, 69.9, 71.5, 79.4, 81, 87.6, 88.8, 92.2, 99.4, 102, 102.3, 106.6, 107.5, 110.6, 112.9, 114.9, 117.5,
    117.9, 123.8, 129.3, 137, 137.8, 151.6, 157.4, 159.7, 170.6, 174.1, 177.2, 181.8, 187.2, 191.5, 196.6, 200.6, 202.9, 194.9, 177.7, 177.2,
    175.1, 166.7, 166.7, 166.7, 172.6, 176.6, 177.2, 176.6, 176.6, 182.9, 185.5, 188.2, 188.2, 192.6, 201.7, 204.7, 215.6, 218.1, 221.3, 229.7,
    236.5, 239.2, 244.8, 251.3, 250.5, 235.1, 223.2, 216.8, 221.3, 210.7, 220.6, 220.6, 221.3, 230.4, 230.4, 230.4, 238.5, 239.2, 239.2, 247.7,
    247.7, 249.8, 256.4, 257.9, 260.9, 262.4, 262.4, 260.9, 254.2, 233.1, 231.7, 231.7, 235.1, 235.1, 239.9, 240.6, 245.5, 246.2, 250.5, 252,
    253.4, 253.4, 258.6, 260.9, 261.6, 264.7, 263.9, 270.9, 270.9, 270.9, 270.9,
  ] },
  /**
   * Loops resampled to one steady pitch (`ref`, Hz), so each holds a constant rpm and every layer can be
   * pitched to the exact same engine frequency while crossfading. Idle is off-load; the rest pull under load.
   */
  layers: [
    { name: 'idle', stage: 'idle', from: 4.70, to: 7.85, ref: 37.5 },
    { name: 'low', stage: 'pickup', from: 9.45, to: 10.0, ref: 70 },
    { name: 'mid', stage: 'pickup', from: 10.0, to: 10.55, ref: 106 },
    { name: 'high', stage: 'acceleration', from: 10.55, to: 11.30, ref: 160 },
    { name: 'higher', stage: 'acceleration', from: 11.80, to: 12.65, ref: 210 },
    { name: 'top', stage: 'peak', from: 13.0, to: 13.85, ref: 245 },
  ],
} as const;

/** Recorded firing frequency of bike-sound-2.mp3 at time t (linear between the 50 ms measurements). */
export function bike2PitchAt(t: number) {
  const { t0, step, hz } = BIKE2.pitch;
  const p = Math.max(0, Math.min(hz.length - 1.001, (t - t0) / step)), i = Math.floor(p), f = p - i;
  return hz[i] * (1 - f) + hz[i + 1] * f;
}

/**
 * Resample [from, to] so its pitch stays at `ref` Hz: the input advances ref / f(t) per output sample,
 * stretching where the engine was faster and squeezing where it was slower. Returns the input time of
 * every output sample (shared by all channels).
 */
export function flattenTimeline(rate: number, from: number, to: number, pitchAt: (t: number) => number, ref: number) {
  const times: number[] = [];
  for (let t = from; t < to; t += ref / Math.max(1, pitchAt(t)) / rate) times.push(t);
  return Float64Array.from(times);
}
function readAt(data: Float32Array, rate: number, t: number) {
  // 4-point Hermite interpolation.
  const p = t * rate, i = Math.floor(p), f = p - i, at = (k: number) => data[Math.max(0, Math.min(data.length - 1, k))];
  const y0 = at(i - 1), y1 = at(i), y2 = at(i + 1), y3 = at(i + 2);
  const c1 = .5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - .5 * y3, c3 = .5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

/** Equal-power crossfade between the two layers whose steady pitches bracket `freq`; each is pitched to `freq`. */
export function bikeMix(freq: number, layers: readonly { ref: number; stage: EngineStage }[] = BIKE2.layers) {
  const weights = layers.map(() => 0);
  let index = layers.length - 1;
  for (let i = 0; i < layers.length - 1; i++) if (freq < layers[i + 1].ref) { index = i; break; }
  if (freq <= layers[0].ref) weights[0] = 1;
  else if (index === layers.length - 1) weights[index] = 1;
  else {
    const t = Math.log(freq / layers[index].ref) / Math.log(layers[index + 1].ref / layers[index].ref);
    weights[index] = Math.cos(t * Math.PI / 2); weights[index + 1] = Math.sin(t * Math.PI / 2);
  }
  const rates = layers.map((layer) => Math.max(.5, Math.min(2, freq / layer.ref)));
  return { weights, rates, stage: layers[weights.indexOf(Math.max(...weights))].stage };
}

/** Equal-power blends: accelerating raises revs; braking/coasting reduces load without restarting audio. */
export function supercarMix(speedFraction: number, throttle: number, braking = false, layers: readonly EngineLayer[] = SUPERCAR_LAYERS) {
  const SUPERCAR_LAYERS = layers;
  const speed = Math.max(0, Math.min(1, speedFraction));
  const gas = braking ? 0 : Math.max(0, Math.min(1, throttle));
  const position = Math.max(speed, gas * .07);
  const weights = [0, 0, 0, 0];
  let index = SUPERCAR_LAYERS.length - 1;
  for (let i = 0; i < SUPERCAR_LAYERS.length - 1; i++) {
    if (position < SUPERCAR_LAYERS[i + 1].speed) { index = i; break; }
  }
  if (index === SUPERCAR_LAYERS.length - 1) weights[index] = 1;
  else {
    const a = SUPERCAR_LAYERS[index].speed, b = SUPERCAR_LAYERS[index + 1].speed;
    const t = (position - a) / (b - a);
    weights[index] = Math.cos(t * Math.PI / 2); weights[index + 1] = Math.sin(t * Math.PI / 2);
  }
  return { weights, stage: SUPERCAR_LAYERS[weights.indexOf(Math.max(...weights))].name, load: .55 + gas * .45 };
}

/**
 * Cut at runtime, overlap the loop seam and level-match layers; the uploaded MP3 stays unchanged.
 * With `pitch`, the section is first flattened to `pitch.ref` Hz and looped over whole firing cycles.
 */
export function cutEngineSample(ctx: Pick<BaseAudioContext, 'createBuffer'>, source: AudioBuffer, from: number, to: number, loop: boolean, pitch?: { at: (t: number) => number; ref: number }) {
  const rate = source.sampleRate;
  const start = Math.max(0, Math.floor(from * rate));
  const end = Math.min(source.length, Math.floor(to * rate));
  const times = pitch && end > start ? flattenTimeline(rate, start / rate, end / rate, pitch.at, pitch.ref) : null;
  let length = times ? times.length : end - start;
  if (length < 100) throw new Error('Engine recording is shorter than the configured sample');
  let fade = Math.min(Math.floor(rate * .035), Math.floor(length / 8));
  if (loop && pitch) {
    // Whole numbers of firing cycles (multiples of four) keep the seam crossfade in phase.
    const period = rate / pitch.ref;
    fade = Math.min(Math.max(fade, Math.round(period * 2)), Math.floor(length / 6));
    const cycles = Math.floor((length - fade) / period / 4) * 4;
    if (cycles >= 4) length = Math.round(cycles * period) + fade;
  }
  const count = loop ? length - fade : length;
  const out = ctx.createBuffer(source.numberOfChannels, count, rate);
  let energy = 0, peak = 0;
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel), data = out.getChannelData(channel);
    const raw = times ? Float32Array.from({ length }, (_, j) => readAt(input, rate, times[j])) : input.subarray(start, start + length);
    data.set(raw.subarray(0, count));
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      if (loop) data[i] = raw[count + i] * (1 - t) + raw[i] * t;
      else { data[i] *= t; data[count - 1 - i] *= t; }
    }
    for (let i = 0; i < count; i++) { energy += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i])); }
  }
  if (loop) {
    const rms = Math.sqrt(energy / (count * source.numberOfChannels));
    const level = Math.min(3, .22 / Math.max(.001, rms), .95 / Math.max(.001, peak));
    for (let channel = 0; channel < out.numberOfChannels; channel++) {
      const data = out.getChannelData(channel); for (let i = 0; i < count; i++) data[i] *= level;
    }
  }
  return out;
}
