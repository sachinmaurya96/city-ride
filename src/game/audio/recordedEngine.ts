import type { VehicleSpec } from '../data/vehicles';
import { EXTRA_BY_ID } from '../data/importedCatalog';
import { input } from '../input/input';
import { NEUTRAL_INPUT, type DriveInput } from '../vehicles/vehicleController';
import { vehicleEntry } from '../vehicles/entry';
import { BIKE2, bike2PitchAt, bikeMix, cutEngineSample, supercarMix, SUPERCAR_LAYERS, SUPERCAR_START, type EngineLayer, type EngineStage } from './engineSamples';
import { newBikeEngine, stepBikeEngine } from './bikeEngine';

const urls = {
  petrol: new URL('../../../assets/audio/petrol-loop.wav', import.meta.url).href,
  supercar: new URL('../../../assets/audio/supercarsound.mp3', import.meta.url).href,
  flat6: new URL('../../../assets/audio/flat6-recording.mp3', import.meta.url).href,
  diesel: new URL('../../../assets/audio/truck-recording.mp3', import.meta.url).href,
  bike: new URL('../../../assets/audio/bike-recording.mp3', import.meta.url).href,
  bikeSound2: new URL('../../../assets/audio/bike-sound-2.mp3', import.meta.url).href,
  start: new URL('../../../assets/audio/engine-start.wav', import.meta.url).href,
  open: new URL('../../../assets/audio/door-open.wav', import.meta.url).href,
  close: new URL('../../../assets/audio/door-close.wav', import.meta.url).href,
};
type Recording = keyof typeof urls;
type Tone = { type: BiquadFilterType; frequency: number; gain: number; Q: number };
const FLAT: Tone = { type: 'peaking', frequency: 1000, gain: 0, Q: 1 };
/** Both superbikes play bike-sound-2.mp3; tuning, gearing and EQ give each its own voice. */
const BIKE_VOICES = {
  // Inline-four: revs high and screams, with a presence lift around 3 kHz.
  ninja: { idle: 1300, redline: 14000, pitch: 1, gain: .46, tone: { type: 'peaking', frequency: 3000, gain: 3, Q: .8 } as Tone },
  // V4: deeper, heavier firing pulses: pitched down with a low-shelf boost.
  ducati: { idle: 1150, redline: 15500, pitch: .88, gain: .5, tone: { type: 'lowshelf', frequency: 180, gain: 4.5, Q: .7 } as Tone },
};
export interface EngineProfile { type: string; recording: Recording; idle: number; redline: number; pitch: number; gain: number; layers?: readonly EngineLayer[]; bike?: boolean; tone?: Tone }
export function engineProfile(spec: VehicleSpec): EngineProfile {
  const bike = spec.id === 'bike_basic' ? 'ninja' : spec.id === 'ducati_v4r' ? 'ducati' : null;
  if (bike) return { type: bike, recording: 'bikeSound2', bike: true, ...BIKE_VOICES[bike] };
  const type = spec.id === 'bmw_i8' ? 'hybrid' : spec.id === 'bmw_m4_gt3' ? 'race6' : EXTRA_BY_ID.get(spec.id)?.engine ?? (spec.kind === 'bus' ? 'diesel' : spec.kind === 'bike' || spec.kind === 'auto' ? 'bike' : 'petrol');
  const recording = type === 'diesel' ? 'diesel' : type === 'bike' ? 'bike' : spec.kind === 'car' ? 'supercar' : 'petrol';
  // v10: high-revving and bright; v12: smooth supercar; v12lux: hushed, low-revving limousine.
  return { type, recording: recording as Recording, idle: type === 'diesel' ? 650 : type === 'race6' ? 1100 : type === 'v12lux' ? 600 : 850,
    redline: type === 'diesel' ? 2500 : type === 'race6' ? 8000 : type === 'flat6' ? 7800 : type === 'v10' ? 8700 : type === 'v12' ? 7500 : type === 'v12lux' ? 5250 : 6500,
    pitch: type === 'hybrid' ? .82 : type === 'v8' ? .68 : type === 'inline6' ? 1.04 : type === 'race6' ? 1.28 : type === 'v10' ? .92 : type === 'v12' ? .8 : type === 'v12lux' ? .6 : 1,
    gain: type === 'hybrid' ? .40 : type === 'diesel' ? .55 : type === 'race6' ? .62 : type === 'v12lux' ? .36 : spec.kind === 'car' ? .52 : .27,
    layers: recording === 'supercar' ? SUPERCAR_LAYERS : undefined };
}

const THREE_CLAMP = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Engine frequency (Hz, in recording terms) at idle and at the redline. */
const BIKE_HZ = { idle: 37.5, redline: 300 };
const START_FIRE = BIKE2.start.fire - BIKE2.start.from;
/** The start-up flare has settled onto the idle pitch here; the idle loop takes over. */
const START_SETTLE = 4.45 - BIKE2.start.from;
/** Closed-throttle share of full-load loudness, and the resulting idle level (r = 0, load = 0). */
const BIKE_LEVEL = { base: .62, idle: .62 * .85 };

export interface EngineUpdateOptions { drive?: DriveInput; seated?: boolean }

/** Recorded engine layers, RPM/gear changes and one-shots. Fetch/decode only the selected sound. */
export class RecordedEngine {
  status: 'loading' | 'ready' | 'error' = 'loading';
  profile = '';
  recording = '';
  rpm = 0;
  gear = 1;
  stage: EngineStage | 'start' | 'off' = 'off';
  layerLevels: number[] = [];
  startCount = 0;
  /** Bike one-shots heard so far (gear clunks, exhaust pops), for tests. */
  effects = { engage: 0, pops: 0, shifts: 0 };
  private buffers = new Map<Recording, Promise<AudioBuffer>>();
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private filter: BiquadFilterNode;
  private tone: BiquadFilterNode;
  private selected = '';
  private generation = 0;
  private starting = false;
  private startBuffer: AudioBuffer | null = null;
  private starter: AudioBufferSourceNode | null = null;
  private starterGain: GainNode | null = null;
  private oneShots = new Set<AudioBufferSourceNode>();
  private disposed = false;
  private drive = { ...NEUTRAL_INPUT };
  private lastUpdate = 0;
  // Bikes: the gearbox model, the start-up sequence and one-shot effects.
  private bike = newBikeEngine(1300);
  private startAt = -1;
  private fired = false;
  private ignition = 0;
  private gearBuffer: AudioBuffer | null = null;
  private popBuffer: AudioBuffer | null = null;
  private crackle = 0;
  private nextPop = 0;
  private wasLoaded = 0;
  private running = false;
  constructor(private ctx: BaseAudioContext, private destination: AudioNode) {
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.connect(destination);
    this.tone = ctx.createBiquadFilter(); this.setTone(FLAT); this.tone.connect(this.filter);
    void this.buffer('open').catch(() => {}); void this.buffer('close').catch(() => {}); void this.buffer('start').catch(() => {});
  }
  private setTone(tone: Tone) {
    this.tone.type = tone.type; this.tone.frequency.value = tone.frequency; this.tone.gain.value = tone.gain; this.tone.Q.value = tone.Q;
  }
  private buffer(key: Recording) {
    let task = this.buffers.get(key);
    if (!task) {
      task = fetch(urls[key]).then((r) => { if (!r.ok) throw new Error('Audio unavailable'); return r.arrayBuffer(); }).then((bytes) => this.ctx.decodeAudioData(bytes));
      this.buffers.set(key, task);
    }
    return task;
  }
  private loopBuffer(source: AudioBuffer, key: Recording) {
    const start = key === 'flat6' ? 3.0 : key === 'diesel' ? 6 : key === 'bike' ? 5 : 0;
    const seconds = key === 'petrol' ? source.duration : key === 'flat6' ? 1.4 : 2;
    const count = Math.min(Math.floor(seconds * source.sampleRate), source.length - Math.floor(start * source.sampleRate));
    if (count < 100) return source;
    const out = this.ctx.createBuffer(source.numberOfChannels, count, source.sampleRate);
    const seam = Math.min(2048, Math.floor(count / 8));
    for (let channel = 0; channel < source.numberOfChannels; channel++) {
      const data = out.getChannelData(channel); data.set(source.getChannelData(channel).subarray(Math.floor(start * source.sampleRate), Math.floor(start * source.sampleRate) + count));
      for (let i = 0; i < seam; i++) {
        const a = i / seam; const tail = data[count - seam + i], head = data[i];
        // Crossfade the seam instead of jumping between arbitrary recording endpoints.
        data[count - seam + i] = tail * (1 - a) + head * a;
      }
    }
    return out;
  }
  /** Short exhaust pop for the overrun crackle: a decaying noise crack over a low thump. */
  private makePop() {
    const rate = this.ctx.sampleRate, length = Math.floor(rate * .06), out = this.ctx.createBuffer(1, length, rate), data = out.getChannelData(0);
    let seed = 7;
    const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 1073741823.5 - 1; };
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      data[i] = noise() * Math.exp(-t / .007) * .8 + Math.sin(2 * Math.PI * 85 * t) * Math.exp(-t / .016) * .9;
    }
    return out;
  }
  update(spec: VehicleSpec, speed: number, running: boolean, options: EngineUpdateOptions = {}) {
    const p = engineProfile(spec);
    if (this.selected !== spec.id) this.select(spec, p);
    if (options.drive) Object.assign(this.drive, options.drive); else input.getDrive(this.drive);
    const fraction = Math.min(1, Math.abs(speed) / (spec.topSpeedKmh / 3.6));
    this.gear = Math.min(6, 1 + Math.floor(fraction * 5.7));
    const gearFraction = Math.min(1, (fraction * 5.7) % 1);
    const revs = Math.min(1, .16 + gearFraction * .64 + this.drive.throttle * .18);
    this.rpm = p.idle + (p.redline - p.idle) * revs;
    const now = this.ctx.currentTime;
    const enabled = running && (options.seated ?? vehicleEntry.mode === 'seated');
    const braking = this.drive.brake > 0 || (!!this.drive.powerBrake && this.drive.throttle <= .05);
    if (p.bike) return this.updateBike(spec, p, speed, enabled, braking, now);
    if (p.layers) {
      const layers = p.layers, mix = supercarMix(fraction, this.drive.throttle, braking, layers);
      this.stage = enabled ? mix.stage : 'off';
      this.layerLevels = mix.weights.map(weight => enabled ? weight * p.gain * mix.load : 0);
      this.sources.forEach((source, i) => {
        const base = layers[i].speed;
        const pitch = i === 0 ? .98 + this.drive.throttle * .06 : .92 + Math.min(.28, Math.max(0, fraction - base) * .7) + revs * .08;
        source.playbackRate.setTargetAtTime(p.pitch * pitch, now, .12);
      });
      this.gains.forEach((gain, i) => gain.gain.setTargetAtTime(this.layerLevels[i], now, .12));
      this.filter.frequency.setTargetAtTime(braking ? 1400 : 1800 + fraction * 4200 + this.drive.throttle * 1000, now, .12);
    } else {
      this.stage = enabled ? fraction > .7 ? 'peak' : fraction > .2 ? 'acceleration' : fraction > .04 ? 'pickup' : 'idle' : 'off';
      this.sources.forEach((source, i) => source.playbackRate.setTargetAtTime(p.pitch * (.75 + revs * (i ? 1.3 : .55)), now, .1));
      this.filter.frequency.setTargetAtTime(900 + revs * 3500, now, .12);
      this.layerLevels = this.gains.map((_, i) => enabled ? p.gain * (i ? .15 + this.drive.throttle * .5 + fraction * .15 : .65 - fraction * .25) : 0);
      this.gains.forEach((gain, i) => gain.gain.setTargetAtTime(this.layerLevels[i], now, .1));
    }
    if (enabled && !this.starting && this.status === 'ready') {
      this.starting = true; this.startCount++;
      if (this.startBuffer) this.starter = this.playOneShot(this.startBuffer, p.gain * .85, p.pitch).source;
      else this.oneShot('start', p.gain * .7, p.pitch);
    }
    if (enabled && this.starter) this.stage = 'start';
    if (!running) { this.starting = false; this.starter?.stop(); this.starter = null; }
    return this.status === 'ready';
  }
  private select(spec: VehicleSpec, p: EngineProfile) {
    this.selected = spec.id; this.profile = p.type; this.recording = p.recording; this.status = 'loading'; this.starting = false;
    const generation = ++this.generation; this.stopSources();
    this.setTone(p.tone ?? FLAT);
    this.bike = newBikeEngine(p.idle); this.startAt = -1; this.fired = false; this.ignition = 0; this.running = false;
    void this.buffer(p.recording).then((buffer) => {
      if (generation !== this.generation || this.ctx.state === 'closed') return;
      let loops: AudioBuffer[];
      if (p.bike) {
        // Every loop is flattened to one steady engine speed, so pitch can follow the revs exactly.
        loops = BIKE2.layers.map(layer => cutEngineSample(this.ctx, buffer, layer.from, layer.to, true, { at: bike2PitchAt, ref: layer.ref }));
        this.startBuffer = cutEngineSample(this.ctx, buffer, BIKE2.start.from, BIKE2.start.to, false);
        this.gearBuffer = cutEngineSample(this.ctx, buffer, BIKE2.gear.from, BIKE2.gear.to, false);
        this.popBuffer = this.makePop();
      } else {
        loops = p.layers ? p.layers.map(layer => cutEngineSample(this.ctx, buffer, layer.from, layer.to, true)) : [this.loopBuffer(buffer, p.recording), this.loopBuffer(buffer, p.recording)];
        this.startBuffer = p.recording === 'supercar' ? cutEngineSample(this.ctx, buffer, SUPERCAR_START.from, SUPERCAR_START.to, false) : null;
      }
      for (let i = 0; i < loops.length; i++) {
        const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(); source.buffer = loops[i]; source.loop = true; gain.gain.value = 0;
        source.connect(gain).connect(this.tone); source.start(0, p.layers || p.bike ? 0 : i * loops[i].duration * .4); this.sources.push(source); this.gains.push(gain);
      }
      this.status = 'ready';
    }).catch(() => { if (generation === this.generation) this.status = 'error'; });
  }
  /**
   * Superbike voice: starter → fires → cold-start flare → idle; then a gearbox model drives the revs, the
   * flattened loops are crossfaded and pitched to the engine frequency, upshifts cut, downshifts blip,
   * first gear clunks in when pulling away, the exhaust crackles on the overrun and the engine winds down
   * when switched off.
   */
  private updateBike(spec: VehicleSpec, p: EngineProfile, speed: number, enabled: boolean, braking: boolean, now: number) {
    const dt = Math.min(.1, Math.max(0, now - this.lastUpdate)); this.lastUpdate = now;
    const gas = braking ? 0 : this.drive.throttle;
    const ready = this.status === 'ready';
    if (enabled && ready && !this.running) {
      // Ignition: the recorded starter and the engine catching.
      this.running = true; this.starting = true; this.startCount++; this.fired = false; this.ignition = 0;
      this.bike = newBikeEngine(p.idle);
      // Level-matched to the idle loop (loops are normalised to RMS .22; the recorded idle sits at ~.32).
      const shot = this.startBuffer ? this.playOneShot(this.startBuffer, BIKE_LEVEL.idle * p.gain * .7, p.pitch) : null;
      this.starter = shot?.source ?? null; this.starterGain = shot?.gain ?? null; this.startAt = now;
    }
    if (!enabled && this.running) {
      this.running = false; this.starting = false;
      this.starterGain?.gain.setTargetAtTime(0, now, .05); this.starter?.stop(now + .3); this.starter = null;
    }
    const elapsed = this.startAt >= 0 ? (now - this.startAt) * p.pitch : Infinity;
    // Cranking until the recorded engine fires; opening the throttle fires it at once.
    if (this.running && !this.fired && (elapsed >= START_FIRE || gas > .2 || !this.starter)) {
      this.fired = true;
      if (elapsed < START_FIRE) { this.starterGain?.gain.setTargetAtTime(0, now, .03); this.starter?.stop(now + .2); this.starter = null; }
    }
    // The flare plays from the recording; the loops take over once it settles, or at once on the throttle.
    const loopsOn = this.fired && (!this.starter || elapsed >= START_SETTLE || gas > .1);
    if (loopsOn && this.starter && (gas > .1 || elapsed >= START_SETTLE)) {
      this.starterGain?.gain.setTargetAtTime(0, now, gas > .1 ? .05 : .09);
      this.starter.stop(now + .6); this.starter = null;
    }
    this.ignition += ((this.running && loopsOn ? 1 : 0) - this.ignition) * (1 - Math.exp(-dt / (this.running ? .08 : .25)));
    const st = stepBikeEngine(this.bike, dt, { speed, top: spec.topSpeedKmh / 3.6, throttle: gas, braking, idle: p.idle, redline: p.redline });
    const r = THREE_CLAMP((st.rpm - p.idle) / (p.redline - p.idle), 0, 1.05);
    const hz = (BIKE_HZ.idle + (BIKE_HZ.redline - BIKE_HZ.idle) * r) * p.pitch;
    const mix = bikeMix(hz);
    this.gear = st.gear;
    if (this.running && !this.fired) this.rpm = 280;
    else if (this.running && this.starter) this.rpm = p.idle * bike2PitchAt(BIKE2.start.from + elapsed) / BIKE_HZ.idle;
    else this.rpm = st.rpm;
    this.stage = !enabled ? 'off' : this.starter ? 'start' : mix.stage;
    const level = (BIKE_LEVEL.base + (1 - BIKE_LEVEL.base) * st.load) * (.85 + .3 * r) * p.gain * this.ignition;
    this.layerLevels = mix.weights.map(weight => weight * level);
    // Switched off, the engine winds down instead of stopping dead.
    const windDown = this.running ? 1 : .62;
    this.sources.forEach((source, i) => source.playbackRate.setTargetAtTime(mix.rates[i] * windDown, now, this.running ? .03 : .3));
    this.gains.forEach((gain, i) => gain.gain.setTargetAtTime(this.layerLevels[i], now, this.running ? .03 : .2));
    this.filter.frequency.setTargetAtTime(1100 + 5200 * (.35 + .65 * st.load) * (.25 + .75 * Math.min(1, r)), now, .05);
    if (this.running && this.fired && !this.starter && ready) {
      for (const event of st.events) {
        if (event === 'engage' && this.gearBuffer) { this.effects.engage++; this.playOneShot(this.gearBuffer, p.gain * 1.1, 1, { type: 'highpass', frequency: 1400 }); }
        if (event === 'up') this.effects.shifts++;
      }
      // Overrun crackle: snapping the throttle shut from high revs pops the exhaust for a moment.
      if (this.wasLoaded > .55 && gas < .05 && r > .45 && Math.abs(speed) > 4) this.crackle = .5 + r * .6;
      this.wasLoaded = Math.max(gas, this.wasLoaded - dt * 2);
      this.crackle = Math.max(0, this.crackle - dt);
      if (gas > .2) this.crackle = 0;
      if (this.crackle > 0 && now >= this.nextPop && this.popBuffer) {
        this.effects.pops++;
        this.playOneShot(this.popBuffer, p.gain * (.18 + Math.random() * .22), .75 + Math.random() * .6, { type: 'lowpass', frequency: 1800 + Math.random() * 1800 });
        this.nextPop = now + .045 + Math.random() * .16;
      }
    }
    return ready;
  }
  oneShot(key: 'open' | 'close' | 'start', volume = .45, rate = 1) {
    if (this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const generation = this.generation;
    void this.buffer(key).then((buffer) => {
      if (this.disposed || ctx.state !== 'running' || (key === 'start' && generation !== this.generation)) return;
      this.playOneShot(buffer, volume, rate);
    }).catch(() => {});
  }
  /** An optional filter isolates a click from the recording (highpass) or softens a pop (lowpass). */
  private playOneShot(buffer: AudioBuffer, volume: number, rate: number, shape?: { type: BiquadFilterType; frequency: number }) {
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(); source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = volume;
    const filter = shape ? this.ctx.createBiquadFilter() : null;
    if (filter && shape) { filter.type = shape.type; filter.frequency.value = shape.frequency; filter.Q.value = .7; source.connect(filter).connect(gain); }
    else source.connect(gain);
    gain.connect(this.destination); this.oneShots.add(source);
    source.onended = () => { source.disconnect(); filter?.disconnect(); gain.disconnect(); this.oneShots.delete(source); if (this.starter === source) this.starter = null; }; source.start(); return { source, gain };
  }
  private stopSources() { this.sources.forEach((source) => { source.stop(); source.disconnect(); }); this.oneShots.forEach(source => source.stop()); this.gains.forEach((gain) => gain.disconnect()); this.sources = []; this.gains = []; this.starter = null; this.startBuffer = null; this.layerLevels = []; this.stage = 'off'; }
  dispose() { this.disposed = true; ++this.generation; this.stopSources(); this.filter.disconnect(); this.tone.disconnect(); }
}
