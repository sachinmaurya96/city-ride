import type { VehicleSpec } from '../data/vehicles';
import { EXTRA_BY_ID } from '../data/importedCatalog';
import { input } from '../input/input';
import { NEUTRAL_INPUT } from '../vehicles/vehicleController';
import { vehicleEntry } from '../vehicles/entry';
import { cutEngineSample, supercarMix, SUPERCAR_LAYERS, SUPERCAR_START, type EngineStage } from './engineSamples';

const urls = {
  petrol: new URL('../../../assets/audio/petrol-loop.wav', import.meta.url).href,
  supercar: new URL('../../../assets/audio/supercarsound.mp3', import.meta.url).href,
  flat6: new URL('../../../assets/audio/flat6-recording.mp3', import.meta.url).href,
  diesel: new URL('../../../assets/audio/truck-recording.mp3', import.meta.url).href,
  bike: new URL('../../../assets/audio/bike-recording.mp3', import.meta.url).href,
  start: new URL('../../../assets/audio/engine-start.wav', import.meta.url).href,
  open: new URL('../../../assets/audio/door-open.wav', import.meta.url).href,
  close: new URL('../../../assets/audio/door-close.wav', import.meta.url).href,
};
type Recording = keyof typeof urls;
export function engineProfile(spec: VehicleSpec) {
  const type = spec.id === 'bmw_i8' ? 'hybrid' : spec.id === 'bmw_m4_gt3' ? 'race6' : EXTRA_BY_ID.get(spec.id)?.engine ?? (spec.kind === 'bus' ? 'diesel' : spec.kind === 'bike' || spec.kind === 'auto' ? 'bike' : 'petrol');
  const recording = type === 'diesel' ? 'diesel' : type === 'bike' ? 'bike' : spec.kind === 'car' ? 'supercar' : 'petrol';
  return { type, recording: recording as Recording, idle: type === 'diesel' ? 650 : type === 'race6' ? 1100 : 850,
    redline: type === 'diesel' ? 2500 : type === 'race6' ? 8000 : type === 'flat6' ? 7800 : 6500,
    pitch: type === 'hybrid' ? .82 : type === 'v8' ? .68 : type === 'inline6' ? 1.04 : type === 'race6' ? 1.28 : 1,
    gain: type === 'hybrid' ? .40 : type === 'diesel' ? .55 : type === 'race6' ? .62 : spec.kind === 'car' ? .52 : .27 };
}

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
  private buffers = new Map<Recording, Promise<AudioBuffer>>();
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private filter: BiquadFilterNode;
  private selected = '';
  private generation = 0;
  private starting = false;
  private startBuffer: AudioBuffer | null = null;
  private starter: AudioBufferSourceNode | null = null;
  private oneShots = new Set<AudioBufferSourceNode>();
  private disposed = false;
  private drive = { ...NEUTRAL_INPUT };
  constructor(private ctx: AudioContext, private destination: GainNode) {
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.connect(destination);
    void this.buffer('open').catch(() => {}); void this.buffer('close').catch(() => {}); void this.buffer('start').catch(() => {});
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
  update(spec: VehicleSpec, speed: number, running: boolean) {
    const p = engineProfile(spec);
    if (this.selected !== spec.id) {
      this.selected = spec.id; this.profile = p.type; this.recording = p.recording; this.status = 'loading'; this.starting = false;
      const generation = ++this.generation; this.stopSources();
      void this.buffer(p.recording).then((buffer) => {
        if (generation !== this.generation || this.ctx.state === 'closed') return;
        const loops = p.recording === 'supercar' ? SUPERCAR_LAYERS.map(layer => cutEngineSample(this.ctx, buffer, layer.from, layer.to, true)) : [this.loopBuffer(buffer, p.recording), this.loopBuffer(buffer, p.recording)];
        this.startBuffer = p.recording === 'supercar' ? cutEngineSample(this.ctx, buffer, SUPERCAR_START.from, SUPERCAR_START.to, false) : null;
        for (let i = 0; i < loops.length; i++) {
          const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(); source.buffer = loops[i]; source.loop = true; gain.gain.value = 0;
          source.connect(gain).connect(this.filter); source.start(0, p.recording === 'supercar' ? 0 : i * loops[i].duration * .4); this.sources.push(source); this.gains.push(gain);
        }
        this.status = 'ready';
      }).catch(() => { if (generation === this.generation) this.status = 'error'; });
    }
    input.getDrive(this.drive);
    const fraction = Math.min(1, Math.abs(speed) / (spec.topSpeedKmh / 3.6));
    this.gear = Math.min(6, 1 + Math.floor(fraction * 5.7));
    const gearFraction = Math.min(1, (fraction * 5.7) % 1);
    const revs = Math.min(1, .16 + gearFraction * .64 + this.drive.throttle * .18);
    this.rpm = p.idle + (p.redline - p.idle) * revs;
    const now = this.ctx.currentTime;
    const enabled = running && vehicleEntry.mode === 'seated';
    const braking = this.drive.brake > 0 || (!!this.drive.powerBrake && this.drive.throttle <= .05);
    if (p.recording === 'supercar') {
      const mix = supercarMix(fraction, this.drive.throttle, braking);
      this.stage = enabled ? mix.stage : 'off';
      this.layerLevels = mix.weights.map(weight => enabled ? weight * p.gain * mix.load : 0);
      this.sources.forEach((source, i) => {
        const base = SUPERCAR_LAYERS[i].speed;
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
      if (this.startBuffer) this.starter = this.playOneShot(this.startBuffer, p.gain * .85, p.pitch);
      else this.oneShot('start', p.gain * .7, p.pitch);
    }
    if (enabled && this.starter) this.stage = 'start';
    if (!running) { this.starting = false; this.starter?.stop(); this.starter = null; }
    return this.status === 'ready';
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
  private playOneShot(buffer: AudioBuffer, volume: number, rate: number) {
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(); source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = volume;
    source.connect(gain).connect(this.destination); this.oneShots.add(source);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.oneShots.delete(source); if (this.starter === source) this.starter = null; }; source.start(); return source;
  }
  private stopSources() { this.sources.forEach((source) => { source.stop(); source.disconnect(); }); this.oneShots.forEach(source => source.stop()); this.gains.forEach((gain) => gain.disconnect()); this.sources = []; this.gains = []; this.starter = null; this.startBuffer = null; this.layerLevels = []; this.stage = 'off'; }
  dispose() { this.disposed = true; ++this.generation; this.stopSources(); this.filter.disconnect(); }
}
