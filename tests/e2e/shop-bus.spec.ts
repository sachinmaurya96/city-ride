import { expect, test } from '@playwright/test';
import { autopilot, boot, completeRide, fixture, play, state, waitStage } from './helpers';

// Plan §21.2 flow 2 (buy auto → equip → group-capable ride → reload) and Phase 6 exit (bus tiers complete routes).

test('buy the BMW M3 GTR, drive it, complete a ride, keep it after reload', async ({ page }) => {
  await boot(page, { clear: true });
  await fixture(page, { wallet: 4500, xp: 400, jobs: 3 }); // level 3, enough cash (test fixture)
  await page.click('[data-testid=menu-garage]');
  await page.click('[data-testid=vcard-bmw_m3_gtr]');
  await expect(page.getByTestId('vcard-auto_city')).toHaveCount(0);
  await page.click('[data-testid=buy]');
  await page.click('[data-testid=confirm-yes]');
  // a second click on a stale button cannot buy twice
  await expect(page.locator('[data-testid=buy]')).toHaveCount(0);
  await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 60000 });
  // Equips and closes the garage. The garage ignores taps for 250 ms after the purchase (double-tap guard), and a
  // cached model can be ready sooner than that, so repeat the tap until it lands.
  await expect(async () => {
    if (await page.getByTestId('try-car').isVisible()) await page.getByTestId('try-car').click();
    expect(await page.evaluate(() => window.__cr.store.getState().save.equippedVehicleId)).toBe('bmw_m3_gtr');
  }).toPass({ intervals: [300, 500, 1000] });
  let s = await page.evaluate(() => (window as unknown as { __cr: { store: { getState(): { save: { wallet: number; ownedVehicleIds: string[]; equippedVehicleId: string } } } } }).__cr.store.getState().save);
  expect(s.wallet).toBe(500);
  expect(s.ownedVehicleIds).toEqual(['bike_basic', 'bmw_m3_gtr']);
  expect(s.equippedVehicleId).toBe('bmw_m3_gtr');
  await play(page);
  await completeRide(page);
  const after = await state(page);
  expect(after.wallet).toBeGreaterThan(500);
  await page.click('[data-testid=next-ride]');
  await boot(page);
  s = await page.evaluate(() => (window as unknown as { __cr: { store: { getState(): { save: { wallet: number; ownedVehicleIds: string[]; equippedVehicleId: string } } } } }).__cr.store.getState().save);
  expect(s.ownedVehicleIds).toEqual(['bike_basic', 'bmw_m3_gtr']);
  expect(s.equippedVehicleId).toBe('bmw_m3_gtr');
  expect(s.wallet).toBe(after.wallet);
});

for (const [bus, route] of [
  ['bus_small', 'neighborhood'],
  ['bus_medium', 'commuter'],
  ['bus_long', 'connector'],
] as const) {
  test(`${bus} completes the ${route} route and is paid once`, async ({ page }) => {
    await boot(page, { clear: true });
    await fixture(page, { wallet: 0, xp: 20000, owned: ['bike_basic', bus], equipped: bus, jobs: 10 });
    await play(page);
    await page.click('[data-testid=dispatch-btn]');
    await page.click(`[data-testid=start-${route}]`);
    const stops = route === 'neighborhood' ? 3 : route === 'commuter' ? 4 : 5;
    await autopilot(page, true);
    await waitStage(page, ['COMPLETED'], 40 * 60 * 1000);
    await autopilot(page, false);
    await expect(page.locator('[data-testid=receipt]')).toBeVisible();
    const s = await page.evaluate(() => (window as unknown as { __cr: { store: { getState(): { save: { wallet: number; lifetime: { busRoutes: number; jobs: number }; pendingReceipts: { net: number; passengers: number }[] } } } } }).__cr.store.getState().save);
    expect(s.lifetime.busRoutes).toBe(1);
    expect(s.lifetime.jobs).toBe(11);
    expect(s.wallet).toBe(s.pendingReceipts[0].net);
    expect(s.pendingReceipts[0].passengers).toBeGreaterThan(0);
    void stops;
    await page.click('[data-testid=next-ride]');
    expect((await state(page)).wallet).toBe(s.wallet);
  });
}
