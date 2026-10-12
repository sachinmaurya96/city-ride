import { events } from '../core/events';
import { runtime } from '../core/runtime';
import { pauseManager } from '../core/pause';
import { VEHICLES } from '../data/vehicles';
import { enforcement } from '../rules/enforcementState';
import type { GameSettings } from '../../storage/schema';
import { RecordedEngine } from './recordedEngine';
import { fuel } from '../vehicles/fuel';
import { vehicleEntry } from '../vehicles/entry';

// Web Audio: recorded vehicle engines and doors with procedural horns, ambience and UI tones. Separate master / sfx / ambience /
// music buses; unlocked on the first user gesture; suspended with the pause manager; mute always wins.

export class AudioEngine {
  recorded: RecordedEngine | null = null;
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
  private resuming = false;
  private resumeAttempt = 0;
  private mobileBridge: HTMLAudioElement | null = null;
  rain = false;

  /** Create the context on the first user gesture (browser autoplay rules). */
  unlock() {
    if (this.ctx) {
      this.primeFromGesture();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      // Safari otherwise treats Web Audio as ambient audio, silenced by the ringer switch.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch { /* Older browsers do not expose AudioSession. */ }
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    const c = this.ctx;
    c.onstatechange = () => {
      if (c.state === 'running' && !this.allowed()) this.applyVolumes();
      // The browser/OS suspended audio mid-game (call, headphones, Bluetooth switch): bring it back.
      else if (c.state !== 'running' && c.state !== 'closed' && this.allowed()) this.resumeContext();
    };
    this.master = c.createGain();
    this.master.gain.value = 0;
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
    this.recorded = new RecordedEngine(c, this.sfx);
    this.startMusic();
    this.applyVolumes();
    this.primeFromGesture();
    this.loop();
  }

  private primeFromGesture() {
    const c = this.ctx;
    if (!c || c.state === 'closed') return;
    // Unlock inside the gesture even if the Play/menu click has not cleared its pause reason yet.
    // Capture listeners also see taps whose UI handler stops propagation.
    const source = c.createBufferSource();
    source.buffer = c.createBuffer(1, 1, c.sampleRate);
    source.connect(c.destination);
    source.onended = () => source.disconnect();
    source.start();
    this.resumeContext(true);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && !(navigator as Navigator & { audioSession?: unknown }).audioSession && this.settings && !this.settings.muted && this.platformAudio) {
      // Older iOS needs an unlocked media element to route Web Audio to the speaker.
      this.mobileBridge ??= new Audio(new URL('../../../assets/audio/silence.wav', import.meta.url).href);
      this.mobileBridge.loop = true;
      this.mobileBridge.setAttribute('playsinline', '');
      void this.mobileBridge.play().catch(() => {});
    }
  }

  private resumeContext(gesture = false) {
    const c = this.ctx;
    // A resume can stay pending through a Safari interruption; a gesture must still retry it,
    // or the game stays silent until reload.
    if (!c || c.state === 'closed' || (this.resuming && !gesture) || (!gesture && !this.allowed())) return;
    // Safari reports "interrupted" after phone calls, screen locks and tab switches.
    if ((c.state as string) === 'running' && !gesture) return;
    this.resuming = true;
    const attempt = ++this.resumeAttempt;
    void c.resume().catch(() => {}).finally(() => {
      if (attempt !== this.resumeAttempt) return;
      this.resuming = false;
      if (this.ctx === c && c.state === 'running' && !this.allowed()) this.applyVolumes();
    });
  }

  get status() {
    // AudioParam.value can retain its last rendered value while the context is suspended.
    // Report the effective output gain so the UI/debug state reflects the audible mixer.
    return { state: this.ctx?.state ?? 'locked', muted: !!this.settings?.muted, allowed: this.allowed(),
      master: this.allowed() && this.ctx?.state === 'running' ? this.master?.gain.value ?? 0 : 0 };
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
    if (this.allowed()) this.master.gain.setTargetAtTime(s.masterVolume, t, 0.05);
    else {
      // A suspended context freezes its automation clock. Mute must reach zero before
      // suspension, rather than leave a pending fade at the previous audible volume.
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.value = 0;
      this.master.gain.setValueAtTime(0, t);
    }
    this.sfx.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.amb.gain.setTargetAtTime(s.ambienceVolume * 0.6, t, 0.05);
    this.music.gain.setTargetAtTime(s.musicVolume * 0.35, t, 0.05);
    if (this.allowed()) {
      this.resumeContext();
      if (this.mobileBridge?.paused) void this.mobileBridge.play().catch(() => {});
    } else if (this.ctx.state === 'running') {
      this.mobileBridge?.pause();
      void this.ctx.suspend().catch(() => {});
    } else this.mobileBridge?.pause();
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
    const running = !!runtime.vehicle && fuel.percent > 0 && vehicleEntry.mode === 'seated';
    const recorded = this.recorded?.update(spec, speed, running);
    this.engineGain.gain.setTargetAtTime(!recorded && running ? 0.05 + frac * 0.07 : 0, t, 0.1);
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
    if ((c.state as string) !== 'running') await c.resume().catch(() => {});
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
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('touchend', unlock, true);
    document.addEventListener('keydown', unlock, true);
    const restore = () => { if (document.visibilityState === 'visible') this.applyVolumes(); };
    window.addEventListener('focus', restore);
    window.addEventListener('pageshow', restore);
    document.addEventListener('visibilitychange', restore);
    const offPause = pauseManager.subscribe(() => this.applyVolumes());
    const offEvents = events.on((e) => {
      switch (e.type) {
        case 'CAR_DOOR':
          if (this.allowed()) this.recorded?.oneShot(e.open ? 'open' : 'close');
          break;
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
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('touchend', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      window.removeEventListener('focus', restore);
      window.removeEventListener('pageshow', restore);
      document.removeEventListener('visibilitychange', restore);
      offPause();
      offEvents();
      cancelAnimationFrame(this.raf);
      if (this.musicTimer) clearInterval(this.musicTimer);
      this.recorded?.dispose(); this.recorded = null;
      this.mobileBridge?.pause(); this.mobileBridge = null;
      if (this.ctx) this.ctx.onstatechange = null;
      void this.ctx?.close().catch(() => {});
      this.ctx = null;
      this.resuming = false;
    };
  }
}

export const audio = new AudioEngine();
