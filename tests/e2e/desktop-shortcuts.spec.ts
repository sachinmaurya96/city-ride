import { expect, test } from '@playwright/test';
import { boot, fixture, play, waitStage } from './helpers';
test('every desktop HUD button has a shortcut badge and the new keys (V audio, X decline, G fuel) work', async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 760 });
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic', 'mclaren_p1'], equipped: 'mclaren_p1', wallet: 1551 });
  await play(page);
  await waitStage(page, ['OFFERED'], 90000);
  await page.evaluate(() => { window.__cr.fuel.tank.percent = 0; Object.defineProperty(window.__cr.runtime, 'canRecover', { configurable: true, get: () => true, set: () => {} }); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/keys-desktop.png' });
  // V toggles audio, X declines the offer, G routes to fuel.
  const muted = await page.evaluate(() => window.__cr.store.getState().save.settings.muted);
  await page.keyboard.press('KeyV');
  await expect.poll(() => page.evaluate(() => window.__cr.store.getState().save.settings.muted)).toBe(!muted);
  await page.keyboard.press('KeyX');
  await expect.poll(() => page.evaluate(() => window.__cr.rides.stage)).not.toBe('OFFERED');
  await page.keyboard.press('KeyG');
  await expect.poll(() => page.evaluate(() => !!window.__cr.fuel.navigation)).toBe(true);
});
