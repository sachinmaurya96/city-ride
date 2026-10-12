import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/game/audio/audio';
import { pauseManager } from '../src/game/core/pause';
import { defaultSettings } from '../src/storage/schema';

class Param {
  value = 1;
  cancelScheduledValues() {}
  setTargetAtTime(value: number) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
}
class Node {
  gain = new Param(); frequency = new Param(); playbackRate = new Param(); Q = new Param();
  type = ''; loop = false; buffer: unknown; onended: (() => void) | null = null;
  connect() { return this; }
  disconnect() {}
  start() {}
  stop() {}
}
class Context {
  static latest: Context;
  state = 'suspended'; currentTime = 0; sampleRate = 1000;
  destination = new Node(); onstatechange: (() => void) | null = null;
  constructor() { Context.latest = this; }
  createGain() { return new Node(); }
  createOscillator() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createBufferSource() { return new Node(); }
  createBuffer(channels: number, count: number, rate: number) { return { sampleRate: rate, length: count, numberOfChannels: channels, duration: count / rate, getChannelData: () => new Float32Array(count) }; }
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}
let detach: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  for (const reason of pauseManager.list) pauseManager.remove(reason);
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { AudioContext: Context }));
  vi.stubGlobal('navigator', { userAgent: 'test', platform: 'test', maxTouchPoints: 0, audioSession: { type: 'auto' } });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline fixture'))));
});
afterEach(() => {
  detach?.(); detach = undefined;
  for (const reason of pauseManager.list) pauseManager.remove(reason);
  vi.useRealTimers(); vi.unstubAllGlobals();
});
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('mobile audio lifecycle', () => {
  it('captures button gestures and unlocks the context while the Play/menu action is still paused', async () => {
    const engine = new AudioEngine();
    engine.applySettings(defaultSettings('low', 'en'));
    pauseManager.add('NOT_PLAYING');
    const listener = vi.spyOn(document, 'addEventListener');
    detach = engine.attach();
    expect(listener).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(listener).toHaveBeenCalledWith('touchend', expect.any(Function), true);
    document.dispatchEvent(new Event('pointerdown'));
    await flush();
    expect(Context.latest.resume).toHaveBeenCalled();
    expect(engine.status.master).toBe(0);
    expect((navigator as Navigator & { audioSession: { type: string } }).audioSession.type).toBe('playback');
    pauseManager.remove('NOT_PLAYING');
    await flush();
    expect(engine.status).toMatchObject({ state: 'running', allowed: true });
    expect(engine.status.master).toBeGreaterThan(0);
  });
  it('resumes Safari interrupted audio on focus/foreground without overriding user mute', async () => {
    const engine = new AudioEngine();
    const settings = defaultSettings('low', 'en');
    engine.applySettings(settings); detach = engine.attach(); engine.unlock();
    await flush();
    Context.latest.state = 'interrupted';
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(engine.status.state).toBe('running');
    engine.applySettings({ ...settings, muted: true });
    document.dispatchEvent(new Event('touchend'));
    await flush();
    expect(engine.status).toMatchObject({ muted: true, master: 0, allowed: false, state: 'suspended' });
    engine.applySettings(settings);
    await flush();
    expect(engine.status.state).toBe('running');
    engine.setPlatformAudio(false);
    await flush();
    expect(engine.status).toMatchObject({ master: 0, allowed: false });
  });
  it('does not repeatedly retry a rejected resume or start audio without a gesture', async () => {
    const engine = new AudioEngine(); engine.applySettings(defaultSettings('low', 'en'));
    expect(engine.status.state).toBe('locked');
    detach = engine.attach(); engine.unlock(); await flush();
    Context.latest.state = 'interrupted';
    Context.latest.resume.mockRejectedValue(new Error('gesture required'));
    Context.latest.resume.mockClear();
    engine.applyVolumes(); await flush();
    expect(Context.latest.resume).toHaveBeenCalledTimes(1);
  });
  it('a tap still resumes audio while an earlier resume is stuck pending', async () => {
    const engine = new AudioEngine(); engine.applySettings(defaultSettings('low', 'en'));
    detach = engine.attach(); engine.unlock(); await flush();
    Context.latest.state = 'interrupted';
    Context.latest.resume.mockImplementationOnce(() => new Promise(() => {}));
    window.dispatchEvent(new Event('focus')); await flush();
    expect(engine.status.state).toBe('interrupted');
    document.dispatchEvent(new Event('pointerdown')); await flush();
    expect(engine.status).toMatchObject({ state: 'running', allowed: true });
    expect(engine.status.master).toBeGreaterThan(0);
  });
  it('resumes when the browser suspends audio mid-game, but not while paused', async () => {
    const engine = new AudioEngine(); engine.applySettings(defaultSettings('low', 'en'));
    detach = engine.attach(); engine.unlock(); await flush();
    Context.latest.resume.mockClear();
    Context.latest.state = 'suspended'; Context.latest.onstatechange?.(); await flush();
    expect(Context.latest.resume).toHaveBeenCalledTimes(1);
    expect(engine.status.state).toBe('running');
    pauseManager.add('USER_MENU'); await flush();
    Context.latest.resume.mockClear();
    Context.latest.onstatechange?.(); await flush();
    expect(Context.latest.resume).not.toHaveBeenCalled();
    expect(engine.status.state).toBe('suspended');
  });
});
