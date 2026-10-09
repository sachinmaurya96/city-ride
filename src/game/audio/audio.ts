import { events } from '../core/events';
import { runtime } from '../core/runtime';
import { pauseManager } from '../core/pause';
import { VEHICLES } from '../data/vehicles';
import { enforcement } from '../rules/enforcementState';
import type { GameSettings } from '../../storage/schema';
import { fuel } from '../vehicles/fuel';

// Procedural Web Audio (plan §15.1): no audio files are downloaded. Separate master / sfx / ambience /
// music buses; unlocked on the first user gesture; suspended with the pause manager; mute always wins.

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private ambNoise: AudioBufferSourceNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain!: GainNode;
  private rainGain!: GainNode;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private settings: GameSettings | null = null;
  private platformAudio = true;
  private lastChime = new Map<string, number>();
  private raf = 0;
  rain = false;

  /** Create the context on the first user gesture (browser autoplay rules). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.allowed()) void this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfx = c.createGain();
    this.amb = c.createGain();
    this.music = c.createGain();
    for (const g of [this.sfx, this.amb, this.music]) g.connect(this.master);
    // engine: two detuned oscillators through a low-pass filter
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfx);
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = c.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineOsc.start();
    this.engineOsc2.start();
    // city ambience: soft filtered noise
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
      d[i] = last * 3;
    }
    this.ambNoise = c.createBufferSource();
    this.ambNoise.buffer = buf;
    this.ambNoise.loop = true;
    const ambF = c.createBiquadFilter();
    ambF.type = 'lowpass';
    ambF.frequency.value = 700;
    const ambG = c.createGain();
    ambG.gain.value = 0.35;
    this.ambNoise.connect(ambF).connect(ambG).connect(this.amb);
    this.ambNoise.start();
    // rain: brighter noise, gated by weather
    const rainSrc = c.createBufferSource();
    const rb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const rd = rb.getChannelData(0);
    for (let i = 0; i < rd.length; i++) rd[i] = (Math.random() * 2 - 1) * 0.5;
    rainSrc.buffer = rb;
    rainSrc.loop = true;
    const rf = c.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 2500;
    this.rainGain = c.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rf).connect(this.rainGain).connect(this.amb);
    rainSrc.start();
    // siren (police pursuit)
    this.sirenGain = c.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenGain.connect(this.sfx);
    this.sirenOsc = c.createOscillator();
    this.sirenOsc.type = 'square';
    const sf = c.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 1800;
    this.sirenOsc.connect(sf).connect(this.sirenGain);
    this.sirenOsc.start();
    this.startMusic();
    this.applyVolumes();
    this.loop();
  }

  private allowed() {
    return !!this.settings && !this.settings.muted && this.platformAudio && !pauseManager.paused;
  }

  setPlatformAudio(on: boolean) {
    this.platformAudio = on;
    this.applyVolumes();
  }

  applySettings(s: GameSettings) {
    this.settings = s;
    this.applyVolumes();
  }

  /** Mute/suspend with pause & platform; the stored user mute always wins over auto-unmute. */
  applyVolumes() {
    if (!this.ctx || !this.settings) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.amb.gain.setTargetAtTime(s.ambienceVolume * 0.6, t, 0.05);
    this.music.gain.setTargetAtTime(s.musicVolume * 0.35, t, 0.05);
    if (this.allowed()) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } else if (this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const spec = VEHICLES[runtime.vehicleId];
    const speed = Math.abs(runtime.telemetry.speed);
    const frac = Math.min(1, speed / (spec.topSpeedKmh / 3.6));
    const base = spec.kind === 'bike' ? 70 : spec.kind === 'auto' ? 55 : spec.kind === 'bus' ? 38 : 48;
    const pitch = base * (1 + frac * 1.8);
    this.engineOsc?.frequency.setTargetAtTime(pitch, t, 0.08);
    this.engineOsc2?.frequency.setTargetAtTime(pitch * 1.505, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(380 + frac * 1200, t, 0.1);
    this.engineGain.gain.setTargetAtTime(runtime.vehicle && fuel.percent > 0 ? 0.05 + frac * 0.07 : 0, t, 0.1);
    this.rainGain.gain.setTargetAtTime(this.rain ? 0.22 : 0, t, 0.5);
    if (enforcement.pursuit && this.sirenOsc) {
      const wob = Math.sin(t * Math.PI * 1.4) > 0 ? 960 : 720;
      this.sirenOsc.frequency.setTargetAtTime(wob, t, 0.03);
      this.sirenGain.gain.setTargetAtTime(0.05, t, 0.1);
    } else this.sirenGain.gain.setTargetAtTime(0, t, 0.2);
  };

  /** Short synthesized one-shot. De-duplicated so a twice-run effect never doubles a jingle. */
  private tone(key: string, notes: [number, number, number][], type: OscillatorType = 'sine', gain = 0.18) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastChime.get(key) ?? -Infinity) < 250) return;
    this.lastChime.set(key, now);
    const c = this.ctx;
    for (const [freq, start, dur] of notes) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      const t0 = c.currentTime + start;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.sfx);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }

  async horn() {
    // Keyboard actions can arrive before the global gesture listener unlocks audio.
    this.unlock();
    const c = this.ctx;
    if (!c || !this.allowed()) return;
    if (c.state === 'suspended') await c.resume().catch(() => {});
    if (c !== this.ctx || c.state !== 'running' || !this.allowed()) return;
    const now = performance.now();
    if (now - (this.lastChime.get('horn') ?? -Infinity) < 250) return;
    this.lastChime.set('horn', now);
    runtime.hornUntil = runtime.simTime + 0.4;
    const kind = VEHICLES[runtime.vehicleId].kind;
    const pitch = kind === 'bike' ? 520 : kind === 'auto' ? 430 : kind === 'bus' ? 220 : 350;
    for (const freq of [pitch, pitch * 1.25]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const filter = c.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 1900;
      const start = c.currentTime;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.14, start + 0.015);
      gain.gain.setValueAtTime(0.14, start + 0.24);
      gain.gain.linearRampToValueAtTime(0, start + 0.36);
      osc.connect(filter).connect(gain).connect(this.sfx);
      osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); };
      osc.start(start);
      osc.stop(start + 0.4);
    }
  }

  private startMusic() {
    // gentle, sparse pentatonic plucks; independently mutable
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3];
    let step = 0;
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || !this.settings || this.settings.musicVolume <= 0) return;
      step++;
      if (step % 2 && Math.random() < 0.5) return;
      const f = scale[Math.floor(Math.random() * scale.length)];
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t0 = this.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.08, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      o.connect(g).connect(this.music);
      o.start(t0);
      o.stop(t0 + 1.5);
    }, 650);
  }

  attach() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const offPause = pauseManager.subscribe(() => this.applyVolumes());
    const offEvents = events.on((e) => {
      switch (e.type) {
        case 'HORN':
          void this.horn();
          break;
        case 'PASSENGER_BOARDED':
          this.tone('board', [
            [660, 0, 0.18],
            [880, 0.12, 0.25],
          ]);
          break;
        case 'RIDE_COMPLETED':
          this.tone('done', [
            [523, 0, 0.2],
            [659, 0.12, 0.2],
            [784, 0.24, 0.35],
          ]);
          break;
        case 'VEHICLE_PURCHASED':
        case 'UPGRADE_PURCHASED':
        case 'DAILY_CLAIMED':
          this.tone('buy', [
            [784, 0, 0.12],
            [1046, 0.08, 0.3],
          ], 'triangle');
          break;
        case 'VIOLATION_RECORDED':
          this.tone('warn', [
            [330, 0, 0.18],
            [262, 0.16, 0.25],
          ], 'square', 0.06);
          break;
        case 'COLLISION':
          if (e.impulse > 0) this.tone('bump', [[90, 0, 0.18]], 'sine', 0.3);
          break;
        case 'BUS_STOP_SERVED':
          this.tone('door', [[520, 0, 0.15]], 'triangle', 0.1);
          break;
        case 'LEVEL_UP':
          this.tone('lvl', [
            [523, 0, 0.15],
            [659, 0.1, 0.15],
            [784, 0.2, 0.15],
            [1046, 0.3, 0.4],
          ], 'triangle');
          break;
      }
    });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      offPause();
      offEvents();
      cancelAnimationFrame(this.raf);
      if (this.musicTimer) clearInterval(this.musicTimer);
      void this.ctx?.close().catch(() => {});
      this.ctx = null;
    };
  }
}

export const audio = new AudioEngine();
