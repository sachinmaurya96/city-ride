import bridge from '@playgama/bridge';
import type { AdResult, PlatformAdapter } from './types';

const SAVE_KEY = 'cityride_save_v1';
const AD_TIMEOUT = 90_000;

/**
 * Playgama Bridge adapter (installed @playgama/bridge 2.3.1 API). Gameplay never touches the SDK
 * directly; everything goes through the normalized PlatformAdapter interface.
 */
export class PlaygamaPlatform implements PlatformAdapter {
  readonly id = 'playgama';
  readonly isMock = false;
  private readySent = false;
  private adBusy = false;

  async initialize() {
    // Throws on failure: the boot screen reports it honestly with a retry button.
    await bridge.initialize();
  }

  getLanguage() {
    try {
      return bridge.platform.language || null;
    } catch {
      return null;
    }
  }

  async getServerTimeIfSupported(): Promise<number | null> {
    try {
      const t = await bridge.platform.getServerTime();
      return typeof t === 'number' && Number.isFinite(t) ? t : null;
    } catch {
      return null;
    }
  }

  supportsStorage() {
    return true;
  }

  async loadProgress(): Promise<string | null> {
    const v = await bridge.storage.get(SAVE_KEY, false);
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  async saveProgress(json: string) {
    await bridge.storage.set(SAVE_KEY, json);
  }

  gameReady() {
    if (this.readySent) return;
    this.readySent = true;
    void bridge.platform.sendMessage(bridge.PLATFORM_MESSAGE.GAME_READY).catch(() => {});
  }

  gameplayStart() {
    void bridge.platform.sendMessage(bridge.PLATFORM_MESSAGE.GAMEPLAY_STARTED).catch(() => {});
  }

  gameplayStop() {
    void bridge.platform.sendMessage(bridge.PLATFORM_MESSAGE.GAMEPLAY_STOPPED).catch(() => {});
  }

  private runAd(kind: 'interstitial' | 'rewarded'): Promise<AdResult> {
    const adv = bridge.advertisement;
    const supported = kind === 'interstitial' ? adv.isInterstitialSupported : adv.isRewardedSupported;
    if (!supported || this.adBusy) return Promise.resolve('unavailable');
    this.adBusy = true;
    const eventName = kind === 'interstitial' ? bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED : bridge.EVENT_NAME.REWARDED_STATE_CHANGED;
    return new Promise<AdResult>((resolve) => {
      let rewarded = false;
      let done = false;
      const finish = (r: AdResult) => {
        if (done) return; // duplicate/late callbacks are ignored
        done = true;
        this.adBusy = false;
        clearTimeout(timer);
        bridge.off(eventName, onState);
        resolve(r);
      };
      const onState = (state: unknown) => {
        if (state === 'rewarded') rewarded = true; // the documented reward-success state
        else if (state === 'closed') finish(kind === 'rewarded' ? (rewarded ? 'rewarded' : 'closedWithoutReward') : 'closedWithoutReward');
        else if (state === 'failed') finish('error');
      };
      const timer = setTimeout(() => finish('error'), AD_TIMEOUT);
      bridge.on(eventName, onState);
      try {
        if (kind === 'interstitial') adv.showInterstitial();
        else adv.showRewarded();
      } catch {
        finish('error');
      }
    });
  }

  showInterstitial() {
    return this.runAd('interstitial');
  }

  showRewarded() {
    return this.runAd('rewarded');
  }

  onPause(fn: (paused: boolean) => void) {
    const onPauseState = (p: unknown) => fn(!!p);
    const onVis = (v: unknown) => fn(v === 'hidden');
    bridge.on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, onPauseState);
    bridge.on(bridge.EVENT_NAME.VISIBILITY_STATE_CHANGED, onVis);
    return () => {
      bridge.off(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, onPauseState);
      bridge.off(bridge.EVENT_NAME.VISIBILITY_STATE_CHANGED, onVis);
    };
  }

  onAudio(fn: (enabled: boolean) => void) {
    const on = (v: unknown) => fn(!!v);
    try {
      fn(bridge.platform.isAudioEnabled);
    } catch {
      /* default on */
    }
    bridge.on(bridge.EVENT_NAME.AUDIO_STATE_CHANGED, on);
    return () => bridge.off(bridge.EVENT_NAME.AUDIO_STATE_CHANGED, on);
  }
}
