import { expect, test } from '@playwright/test';
import { autopilot, boot, completeRide, play, state, waitStage } from './helpers';

// Plan §20 Phase 2 exit + §21.2 flow 1: fresh boot → tutorial → completed ride → receipt → reload →
// same wallet/stats; reload at several mission states; five rides without duplicate rewards.
test('five rides with reloads preserve cash exactly once', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, { clear: true });
  await play(page);
  await waitStage(page, ['OFFERED'], 60000);
  await expect(page.locator('[data-testid=offer-fare]')).toHaveText('₹120');
  await page.keyboard.press('KeyE');
  await waitStage(page, ['TO_PICKUP']);
  const s1 = await state(page);
  expect(s1.savedMission).toMatch(/:TO_PICKUP$/);

  // Reload while heading to pickup → checkpoint restored, same job, nothing paid.
  await boot(page);
  await play(page);
  const s2 = await state(page);
  expect(s2.missionId).toBe(s1.missionId);
  expect(s2.stage).toBe('TO_PICKUP');
  expect(s2.wallet).toBe(0);

  await autopilot(page, true);
  await waitStage(page, ['TO_DROPOFF']);
  await autopilot(page, false);
  await page.waitForTimeout(1500);
  expect((await state(page)).savedMission).toMatch(/:TO_DROPOFF$/);

  // Reload with the passenger aboard → still one job, passenger still aboard.
  await boot(page);
  await play(page);
  const s3 = await state(page);
  expect(s3.stage).toBe('TO_DROPOFF');
  expect(s3.missionId).toBe(s1.missionId);

  await autopilot(page, true);
  await waitStage(page, ['COMPLETED']);
  await autopilot(page, false);
  await expect(page.locator('[data-testid=receipt]')).toBeVisible();
  const done = await state(page);
  expect(done.wallet).toBe(150);
  expect(done.jobs).toBe(1);
  expect(done.savedMission).toBeNull();

  // Reload with the receipt still open → shown again, never paid again.
  await boot(page);
  await play(page);
  await expect(page.locator('[data-testid=receipt]')).toBeVisible();
  expect((await state(page)).wallet).toBe(150);
  await page.click('[data-testid=next-ride]');
  expect((await state(page)).wallet).toBe(150);
  expect((await state(page)).receipts).toEqual([]);

  // Four more ordinary rides.
  let wallet = 150;
  for (let i = 0; i < 4; i++) {
    await completeRide(page);
    const net = Number((await page.locator('[data-testid=receipt-net]').innerText()).replace(/[^\d-]/g, ''));
    const st = await state(page);
    expect(st.wallet).toBe(wallet + net);
    wallet = st.wallet;
    await page.click('[data-testid=next-ride]');
  }
  const end = await state(page);
  expect(end.jobs).toBe(5);
  await boot(page);
  expect((await state(page)).wallet).toBe(wallet);
  expect((await state(page)).jobs).toBe(5);
  expect(errors).toEqual([]);
});
