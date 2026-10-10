import { expect, test } from '@playwright/test';
import { boot, fixture, play } from './helpers';
test.use({ viewport: { width: 1100, height: 620 } });
for (const id of ['bike_basic', 'ducati_v4r', 'mercedes_maybach']) {
  test(`${id}: loads in the garage, drives, and renders from chase, side and moving views`, async ({ page }) => {
    test.setTimeout(300000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await boot(page, { clear: true });
    await fixture(page, { owned: ['bike_basic', id], equipped: id });
    await page.getByTestId('menu-garage').click();
    await page.getByTestId(`vcard-${id}`).click();
    await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 120000 });
    await page.waitForTimeout(800);
    await page.locator('.preview').screenshot({ path: `test-results/nv-garage-${id}.png` });
    await page.getByTestId('garage-close').click();
    await play(page);
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `test-results/nv-chase-${id}.png` });
    await page.evaluate(() => { const c = window.__cr, p = c.runtime.pose, rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
      c.debug.cam = { x: p.x + rx * 4.2, y: 1.1, z: p.z + rz * 4.2, tx: p.x, ty: .6, tz: p.z }; });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/nv-side-${id}.png` });
    await page.evaluate(() => { window.__cr.debug.cam = null; });
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
    await page.evaluate(() => { const c = window.__cr, p = c.runtime.pose, rx = Math.cos(p.heading), rz = -Math.sin(p.heading), fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      c.debug.cam = { x: p.x + rx * 3.6 + fx * 2, y: 1.0, z: p.z + rz * 3.6 + fz * 2, tx: p.x + fx * 2, ty: .6, tz: p.z + fz * 2 }; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/nv-moving-${id}.png` });
    await page.evaluate(() => { window.__cr.debug.cam = null; });
    await page.keyboard.up('KeyW');
    expect(await page.evaluate(() => window.__cr.runtime.telemetry.speedKmh)).toBeGreaterThan(15);
    expect(errors).toEqual([]);
  });
}
