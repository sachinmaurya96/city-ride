/** Sections measured from the supplied 37.872-second supercarsound.mp3 recording. */
export const SUPERCAR_START = { from: .55, to: 2.25 };
export const SUPERCAR_LAYERS = [
  { name: 'idle', from: 3.0, to: 4.4, speed: 0 },
  { name: 'pickup', from: 11.9, to: 12.8, speed: .16 },
  { name: 'acceleration', from: 16.05, to: 16.95, speed: .48 },
  { name: 'peak', from: 30.45, to: 31.6, speed: .86 },
] as const;
export type EngineStage = typeof SUPERCAR_LAYERS[number]['name'];

/** Equal-power blends: accelerating raises revs; braking/coasting reduces load without restarting audio. */
export function supercarMix(speedFraction: number, throttle: number, braking = false) {
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

/** Cut at runtime, overlap the loop seam and level-match layers; the uploaded MP3 stays unchanged. */
export function cutEngineSample(ctx: Pick<AudioContext, 'createBuffer'>, source: AudioBuffer, from: number, to: number, loop: boolean) {
  const start = Math.max(0, Math.floor(from * source.sampleRate));
  const end = Math.min(source.length, Math.floor(to * source.sampleRate));
  const length = end - start;
  if (length < 100) throw new Error('Engine recording is shorter than the configured sample');
  const fade = Math.min(Math.floor(source.sampleRate * .035), Math.floor(length / 8));
  const count = loop ? length - fade : length;
  const out = ctx.createBuffer(source.numberOfChannels, count, source.sampleRate);
  let energy = 0, peak = 0;
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const raw = source.getChannelData(channel).subarray(start, end), data = out.getChannelData(channel);
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
