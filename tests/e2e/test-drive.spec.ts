import { expect, test } from '@playwright/test';
import { boot } from './helpers';

test.setTimeout(240000);
test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

test('any unowned car can be test driven free for one minute from the garage, then the bike returns', async ({ page }) => {
  await boot(page, { clear: true });
  const wallet = await page.evaluate(() => window.__cr.store.getState().save.wallet);
  await page.getByTestId('menu-garage').tap();
  await page.getByTestId('vcard-bmw_i8').tap();
  await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 60000 });
  await expect(page.getByTestId('try-car')).toHaveCount(0);
  await expect(page.getByTestId('test-drive')).toBeEnabled();
  await page.getByTestId('test-drive').tap();
  await expect.poll(() => page.evaluate(() => window.__cr.store.getState().appState), { timeout: 90000 }).toBe('PLAYING');
  const ok = page.getByTestId('controls-ok');
  if (await ok.isVisible({ timeout: 2500 }).catch(() => false)) await ok.tap();
  await expect(page.getByTestId('test-drive-banner')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicleId), { timeout: 60000 }).toBe('bmw_i8');
  await expect(page.getByTestId('test-drive-time')).toHaveText(/^(1:00|0:5\d)$/);
  await page.screenshot({ path: 'test-results/test-drive.png' });
  // Fast-forward the minute through the real step system.
  await page.evaluate(() => { for (let i = 0; i < 62; i++) window.__cr.runtime.step(1); });
  await expect(page.getByTestId('test-drive-banner')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicleId), { timeout: 60000 }).toBe('bike_basic');
  const save = await page.evaluate(() => window.__cr.store.getState().save);
  expect(save.wallet).toBe(wallet);
  expect(save.ownedVehicleIds).toEqual(['bike_basic']);
  expect(save.equippedVehicleId).toBe('bike_basic');
});
