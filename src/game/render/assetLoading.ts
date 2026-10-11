import { useSyncExternalStore } from 'react';

const assets = new Map<string, number>();
const listeners = new Set<() => void>();
let lastUpdate = 0;

/** Downloads occupy 90%; decoding, materials and geometry complete the remaining work. */
export function reportAssetProgress(url: string, value: number) {
  assets.set(url, value);
  const now = performance.now();
  if (value > 0 && value < 1 && now - lastUpdate < 100) return;
  lastUpdate = now;
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Track this vehicle, independently of already loaded cars and background scenery. */
export const useAssetProgress = (url?: string) => useSyncExternalStore(subscribe, () => url ? assets.get(url) ?? 0 : 0);
