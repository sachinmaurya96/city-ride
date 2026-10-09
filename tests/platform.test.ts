import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- fake Bridge (only the documented members used by the adapter) ---
type Listener = (v: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const fakeBridge = {
  PLATFORM_MESSAGE: { GAME_READY: 'game_ready', GAMEPLAY_STARTED: 'gameplay_started', GAMEPLAY_STOPPED: 'gameplay_stopped' },
  EVENT_NAME: { INTERSTITIAL_STATE_CHANGED: 'interstitial_state_changed', REWARDED_STATE_CHANGED: 'rewarded_state_changed', PAUSE_STATE_CHANGED: 'pause_state_changed', VISIBILITY_STATE_CHANGED: 'visibility_state_changed', AUDIO_STATE_CHANGED: 'audio_state_changed' },
  advertisement: { isInterstitialSupported: true, isRewardedSupported: true, showInterstitial: vi.fn(), showRewarded: vi.fn() },
  platform: { language: 'en', isAudioEnabled: true, sendMessage: vi.fn(async () => undefined), getServerTime: vi.fn(async () => 123) },
  storage: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
  initialize: vi.fn(async () => undefined),
  on(name: string, fn: Listener) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(fn);
  },
  off(name: string, fn?: Listener) {
    if (fn) listeners.get(name)?.delete(fn);
    else listeners.delete(name);
  },
  emit(name: string, v: unknown) {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(v);
  },
};
vi.mock('@playgama/bridge', () => ({ default: fakeBridge }));

const { PlaygamaPlatform } = await import('../src/platform/playgama');
const { PauseManager } = await import('../src/game/core/pause');
const { PersistenceManager } = await import('../src/storage/persistence');
const { createDefaultSave, defaultSettings } = await import('../src/storage/schema');
const { grantRewardedBonus, settleRide, quoteRide, ensureDailyBoard, utcDayKey } = await import('../src/game/progression/progression');

beforeEach(() => listeners.clear());

describe('pause reasons', () => {
  it('compose: closing an ad cannot resume a game paused by the user menu', () => {
    const p = new PauseManager();
    p.add('USER_MENU');
    p.add('AD');
    p.remove('AD');
    expect(p.paused).toBe(true);
    p.remove('USER_MENU');
    expect(p.paused).toBe(false);
    p.add('HIDDEN_TAB');
    p.add('HIDDEN_TAB');
    p.remove('HIDDEN_TAB');
    expect(p.paused).toBe(false);
  });
});

describe('Bridge ads adapter', () => {
  it('rewarded → only after the reward state, resolved once despite duplicate/late callbacks', async () => {
    const plat = new PlaygamaPlatform();
    const r = plat.showRewarded();
    fakeBridge.emit('rewarded_state_changed', 'opened');
    fakeBridge.emit('rewarded_state_changed', 'rewarded');
    fakeBridge.emit('rewarded_state_changed', 'closed');
    fakeBridge.emit('rewarded_state_changed', 'closed');
    expect(await r).toBe('rewarded');
  });
  it('closing without the reward state is not a reward; failures are errors; unsupported is unavailable', async () => {
    const plat = new PlaygamaPlatform();
    const a = plat.showRewarded();
    fakeBridge.emit('rewarded_state_changed', 'opened');
    fakeBridge.emit('rewarded_state_changed', 'closed');
    expect(await a).toBe('closedWithoutReward');
    const b = plat.showInterstitial();
    fakeBridge.emit('interstitial_state_changed', 'failed');
    expect(await b).toBe('error');
    fakeBridge.advertisement.isRewardedSupported = false;
    expect(await plat.showRewarded()).toBe('unavailable');
    fakeBridge.advertisement.isRewardedSupported = true;
  });
  it('game_ready is sent exactly once', () => {
    const plat = new PlaygamaPlatform();
    fakeBridge.platform.sendMessage.mockClear();
    plat.gameReady();
    plat.gameReady();
    expect(fakeBridge.platform.sendMessage).toHaveBeenCalledTimes(1);
  });
  it('a repeated rewarded grant for the same receipt pays once', () => {
    const now = Date.UTC(2026, 9, 8);
    const s0 = ensureDailyBoard(createDefaultSave(now, utcDayKey(now), defaultSettings('low', 'en')), now).save;
    const quote = quoteRide({ routeMeters: 400, vehicleId: 'bike_basic', rideType: 'standard', rain: false, estSeconds: 60 });
    const r = settleRide(s0, { missionId: 'm1', quote, satisfaction: 100, finesPaid: 0, clean: true, elapsed: 50, partySize: 1, rideType: 'standard', fromName: 'a', toName: 'b', toLandmark: 'hotel' }, now);
    const g1 = grantRewardedBonus(r.save, r.receipt.id, now);
    const g2 = grantRewardedBonus(g1.save, r.receipt.id, now);
    expect(g1.amount).toBeGreaterThan(0);
    expect(g2.amount).toBe(0);
  });
});

describe('persistence', () => {
  function localStorageShim() {
    const m = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    return m;
  }

  it('a slow older remote write never overwrites a newer revision', async () => {
    localStorageShim();
    const written: number[] = [];
    const pm = new PersistenceManager();
    let release: () => void = () => {};
    pm.setRemote({
      name: 'fake',
      load: async () => null,
      save: async (json) => {
        const rev = JSON.parse(json).revision;
        if (rev === 1) await new Promise<void>((r) => (release = r));
        written.push(rev);
      },
    });
    const base = createDefaultSave(1, '2026-10-08', defaultSettings('low', 'en'));
    pm.save({ ...base, revision: 1 }, true);
    await new Promise((r) => setTimeout(r, 5));
    pm.save({ ...base, revision: 3 }, true);
    pm.save({ ...base, revision: 2 }, true); // older snapshot arrives late
    await new Promise((r) => setTimeout(r, 5));
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(written).toEqual([1, 3]);
  });

  it('a corrupt main save falls back to the backup and keeps the corrupt copy', async () => {
    const m = localStorageShim();
    const pm = new PersistenceManager();
    const good = createDefaultSave(1, '2026-10-08', defaultSettings('low', 'en'));
    pm.save({ ...good, wallet: 500, revision: 4 });
    pm.save({ ...good, wallet: 600, revision: 5 });
    m.set('cityride.save.v1', '{"truncated": tr');
    const res = await pm.load();
    expect(res.notice).toBe('corrupt_recovered');
    expect(res.save?.wallet).toBe(500);
    expect(m.get('cityride.save.quarantine')).toContain('truncated');
  });
});
