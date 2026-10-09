export type AdResult = 'rewarded' | 'closedWithoutReward' | 'unavailable' | 'error';

/** Normalized platform operations. Gameplay never imports a platform SDK directly. */
export interface PlatformAdapter {
  readonly id: string;
  readonly isMock: boolean;
  initialize(): Promise<void>;
  getLanguage(): string | null;
  getServerTimeIfSupported(): Promise<number | null>;
  loadProgress(): Promise<string | null>;
  saveProgress(json: string): Promise<void>;
  supportsStorage(): boolean;
  /** Called exactly once when the scene and controls are usable. */
  gameReady(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  showInterstitial(): Promise<AdResult>;
  showRewarded(): Promise<AdResult>;
  /** Platform-driven pause/audio changes (e.g. visibility, ads). */
  onPause(fn: (paused: boolean) => void): () => void;
  onAudio(fn: (enabled: boolean) => void): () => void;
}
