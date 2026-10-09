import { MockPlatform } from './mock';
import { PlaygamaPlatform } from './playgama';
import type { PlatformAdapter } from './types';

/** Platform builds (`--mode playgama`) use the Bridge adapter; dev/e2e/standalone use the offline mock. */
export const IS_PLATFORM_BUILD = import.meta.env.VITE_PLATFORM === 'playgama';

export const platformRef: { current: PlatformAdapter } = { current: IS_PLATFORM_BUILD ? new PlaygamaPlatform() : new MockPlatform() };

export function platform() {
  return platformRef.current;
}
