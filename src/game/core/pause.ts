export type PauseReason = 'USER_MENU' | 'HIDDEN_TAB' | 'PLATFORM' | 'AD' | 'ROTATION' | 'CONTEXT_LOST' | 'NOT_PLAYING';

/** Composable pause reasons: the simulation runs only when the set is empty (plan §17). */
export class PauseManager {
  private reasons = new Set<PauseReason>();
  private listeners = new Set<(paused: boolean, reasons: ReadonlySet<PauseReason>) => void>();

  add(r: PauseReason) {
    if (this.reasons.has(r)) return;
    this.reasons.add(r);
    this.notify();
  }

  remove(r: PauseReason) {
    if (!this.reasons.delete(r)) return;
    this.notify();
  }

  set(r: PauseReason, on: boolean) {
    if (on) this.add(r);
    else this.remove(r);
  }

  has(r: PauseReason) {
    return this.reasons.has(r);
  }

  get paused() {
    return this.reasons.size > 0;
  }

  get list(): PauseReason[] {
    return [...this.reasons];
  }

  subscribe(fn: (paused: boolean, reasons: ReadonlySet<PauseReason>) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn(this.paused, this.reasons);
  }
}

export const pauseManager = new PauseManager();
