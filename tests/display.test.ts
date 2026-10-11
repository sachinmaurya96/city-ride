import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canFullscreen, observeViewport, requestGameFullscreen } from '../src/app/display';

let root: { requestFullscreen?: ReturnType<typeof vi.fn>; webkitRequestFullscreen?: ReturnType<typeof vi.fn>; style: { setProperty: ReturnType<typeof vi.fn> } };
let doc: EventTarget & { documentElement: typeof root; fullscreenEnabled?: boolean };
beforeEach(() => {
  root = { requestFullscreen: vi.fn(async () => {}), style: { setProperty: vi.fn() } };
  doc = Object.assign(new EventTarget(), { documentElement: root });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 });
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(pointer: coarse)' })));
  vi.stubGlobal('screen', {});
});
afterEach(() => vi.unstubAllGlobals());

it('enters fullscreen from a tap even when orientation locking is absent', async () => {
  const result = requestGameFullscreen();
  expect(root.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
  expect(await result).toBe(true);
});
it('uses the Safari-prefixed API and keeps fullscreen when locking rejects', async () => {
  delete root.requestFullscreen;
  root.webkitRequestFullscreen = vi.fn();
  vi.stubGlobal('screen', { orientation: { lock: vi.fn(async () => { throw new Error('unsupported'); }) } });
  expect(canFullscreen()).toBe(true);
  expect(await requestGameFullscreen()).toBe(true);
  expect(root.webkitRequestFullscreen).toHaveBeenCalledOnce();
});
it('reports unavailable or denied fullscreen without preventing play', async () => {
  delete root.requestFullscreen;
  expect(canFullscreen()).toBe(false);
  expect(await requestGameFullscreen()).toBe(false);
  root.requestFullscreen = vi.fn(async () => { throw new Error('denied'); });
  expect(await requestGameFullscreen()).toBe(false);
});
it('does not request fullscreen again when launched from the iOS Home Screen', async () => {
  vi.stubGlobal('navigator', { standalone: true });
  expect(await requestGameFullscreen()).toBe(true);
  expect(root.requestFullscreen).not.toHaveBeenCalled();
});
it('resizes to Safari’s visible viewport and removes listeners on cleanup', () => {
  const viewport = Object.assign(new EventTarget(), { width: 844, height: 280, offsetTop: 12, offsetLeft: 0 });
  const win = Object.assign(new EventTarget(), { innerWidth: 844, innerHeight: 390, visualViewport: viewport });
  vi.stubGlobal('window', win);
  const resized = vi.fn();
  const cleanup = observeViewport(resized);
  expect(resized).toHaveBeenLastCalledWith(844, 280);
  expect(root.style.setProperty).toHaveBeenCalledWith('--viewport-top', '12px');
  viewport.height = 340;
  viewport.dispatchEvent(new Event('resize'));
  expect(resized).toHaveBeenLastCalledWith(844, 340);
  cleanup();
  viewport.dispatchEvent(new Event('resize'));
  expect(resized).toHaveBeenCalledTimes(2);
});
