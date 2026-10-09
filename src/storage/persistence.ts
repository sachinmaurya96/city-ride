import { validateSave, type SaveData } from './schema';

const MAIN_KEY = 'cityride.save.v1';
const BACKUP_KEY = 'cityride.save.v1.backup';
const QUARANTINE_KEY = 'cityride.save.quarantine';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unavailable';

/** Optional remote/platform storage (Playgama Bridge) used in addition to the local mirror. */
export interface RemoteStorage {
  name: string;
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function parse(json: string | null): SaveData | null {
  if (!json) return null;
  try {
    const res = validateSave(JSON.parse(json));
    return res.ok ? res.data : null;
  } catch {
    return null;
  }
}

export interface LoadResult {
  save: SaveData | null;
  source: 'local' | 'backup' | 'remote' | 'none';
  notice: 'corrupt_recovered' | 'corrupt_reset' | 'conflict' | null;
  conflict?: { local: SaveData; remote: SaveData };
}

export class PersistenceManager {
  status: SaveStatus = 'idle';
  private remote: RemoteStorage | null = null;
  private remoteChain: Promise<void> = Promise.resolve();
  private remoteRevision = -1;
  private pendingRemote: SaveData | null = null;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: SaveStatus) => void>();
  readonly available: boolean;

  constructor() {
    let ok = false;
    try {
      const k = '__cityride_probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      ok = true;
    } catch {
      ok = false;
    }
    this.available = ok;
    if (!ok) this.status = 'unavailable';
  }

  setRemote(remote: RemoteStorage | null) {
    this.remote = remote;
  }

  onStatus(fn: (s: SaveStatus) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private setStatus(s: SaveStatus) {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  async load(): Promise<LoadResult> {
    const mainRaw = safeGet(MAIN_KEY);
    let local = parse(mainRaw);
    let notice: LoadResult['notice'] = null;
    let source: LoadResult['source'] = local ? 'local' : 'none';
    if (!local && mainRaw) {
      // Main snapshot is corrupt: keep it aside (never silently erase), try the backup.
      safeSet(QUARANTINE_KEY, mainRaw);
      local = parse(safeGet(BACKUP_KEY));
      notice = local ? 'corrupt_recovered' : 'corrupt_reset';
      source = local ? 'backup' : 'none';
    }
    let remote: SaveData | null = null;
    if (this.remote) {
      try {
        remote = parse(await this.remote.load());
      } catch {
        remote = null;
      }
    }
    if (remote && local) {
      if (remote.profileId === local.profileId) {
        const pick = remote.revision > local.revision ? remote : local;
        return { save: pick, source: pick === remote ? 'remote' : source, notice };
      }
      // Unrelated progress chains: let the player choose; never merge wallets.
      return { save: local, source, notice: 'conflict', conflict: { local, remote } };
    }
    if (remote) return { save: remote, source: 'remote', notice };
    return { save: local, source, notice };
  }

  /** Synchronous local write (backup previous first), then serialized, debounced remote write. */
  save(data: SaveData, immediateRemote = false): boolean {
    if (!this.available) {
      this.setStatus('unavailable');
      return false;
    }
    this.setStatus('saving');
    const json = JSON.stringify(data);
    const prev = safeGet(MAIN_KEY);
    if (prev && prev !== json) safeSet(BACKUP_KEY, prev);
    const ok = safeSet(MAIN_KEY, json);
    if (!ok) {
      this.setStatus('error');
      return false;
    }
    if (this.remote) {
      // keep the newest pending snapshot: a late older revision must not replace a newer one
      if (!this.pendingRemote || data.revision >= this.pendingRemote.revision) this.pendingRemote = data;
      if (this.remoteTimer) clearTimeout(this.remoteTimer);
      this.remoteTimer = setTimeout(() => this.flushRemote(), immediateRemote ? 0 : 800);
    } else {
      this.setStatus('saved');
    }
    return true;
  }

  private flushRemote() {
    const data = this.pendingRemote;
    this.pendingRemote = null;
    if (!data || !this.remote) return;
    const remote = this.remote;
    this.remoteChain = this.remoteChain.then(async () => {
      // Never let an older revision overwrite a newer one.
      if (data.revision <= this.remoteRevision) return;
      try {
        await remote.save(JSON.stringify(data));
        this.remoteRevision = data.revision;
        this.setStatus('saved');
      } catch {
        this.setStatus('error');
      }
    });
  }

  clearAll() {
    try {
      localStorage.removeItem(MAIN_KEY);
      localStorage.removeItem(BACKUP_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const persistence = new PersistenceManager();

/** Unrelated local/platform progress found at boot, awaiting the player's choice. */
export const pendingConflict: { value: { local: SaveData; remote: SaveData } | null } = { value: null };
