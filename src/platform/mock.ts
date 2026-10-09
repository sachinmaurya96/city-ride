import type { AdResult, PlatformAdapter } from './types';

/**
 * Offline development adapter. Not a production integration: it simulates ads with a short
 * delay and stores nothing remotely (local mirror only).
 */
export class MockPlatform implements PlatformAdapter {
  readonly id = 'mock';
  readonly isMock = true;
  private readySent = false;
  /** Test control: next ad outcome. */
  nextAd: AdResult = 'rewarded';
  private pauseFns = new Set<(p: boolean) => void>();
  async initialize() {}
  getLanguage() {
    return typeof navigator !== 'undefined' ? navigator.language : null;
  }
  async getServerTimeIfSupported() {
    return null;
  }
  async loadProgress() {
    return null;
  }
  async saveProgress() {}
  supportsStorage() {
    return false;
  }
  gameReady() {
    if (this.readySent) return;
    this.readySent = true;
  }
  gameplayStart() {}
  gameplayStop() {}
  private async fakeAd(): Promise<AdResult> {
    for (const fn of this.pauseFns) fn(true);
    await new Promise((r) => setTimeout(r, 600));
    for (const fn of this.pauseFns) fn(false);
    return this.nextAd;
  }
  showInterstitial() {
    return this.fakeAd();
  }
  showRewarded() {
    return this.fakeAd();
  }
  onPause(fn: (p: boolean) => void) {
    this.pauseFns.add(fn);
    return () => void this.pauseFns.delete(fn);
  }
  onAudio() {
    return () => {};
  }
}
