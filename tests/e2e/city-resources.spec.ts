import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import { boot, play, fixture } from './helpers';

test.setTimeout(180000);
test('supplied city packs and petrol pumps render, with filling only in the off-road forecourt', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, { clear: true }); await play(page);
  const packs = await page.evaluate(() => {
    const c = window.__cr, scene = c.debug.extra.scene as THREE.Scene;
    const counts: Record<string, number> = {}, textured: Record<string, number> = {};
    scene.getObjectByName('resource-city')!.traverse(o => {
      const mesh = o as THREE.InstancedMesh; if (!mesh.isInstancedMesh) return;
      const pack = mesh.userData.pack as string; counts[pack] = (counts[pack] ?? 0) + 1;
      if ((mesh.material as THREE.MeshStandardMaterial).map) textured[pack] = (textured[pack] ?? 0) + 1;
    });
    return { counts, textured, pumps: c.cityMap.FUEL_STATIONS.length };
  });
  expect(packs.pumps).toBe(40);
  for (const pack of ['buildings', 'skyline', 'forest', 'palms', 'bananas', 'roads', 'petrol']) {
    expect(packs.counts[pack], pack).toBeGreaterThan(0);
    // The supplied banana model uses colored materials; the other packs contain texture maps.
    if (pack !== 'bananas') expect(packs.textured[pack], pack).toBeGreaterThan(0);
  }
  await page.evaluate(() => {
    const c = window.__cr;
    c.runtime.requestRecovery({ x: 60, z: -4, heading: Math.PI / 2 });
    c.debug.cam = { x: 80, y: 55, z: 55, tx: 0, ty: 8, tz: -100 };
  });
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.pendingRecovery)).toBeNull();
  await page.screenshot({ path: 'test-results/resource-city.png' });
  await page.evaluate(() => {
    const c = window.__cr, station = c.cityMap.FUEL_STATIONS.find(s => s.id === 'petrol_south_bay1')!;
    const seg = c.cityMap.SEGMENT_BY_ID.get(station.segmentId)!, [x, z] = c.cityMap.segmentPoint(seg, station.s, c.cityMap.laneOffset(seg, 0));
    c.fuel.tank.percent = 20; c.runtime.requestRecovery({ x, z, heading: station.heading });
  });
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.pendingRecovery)).toBeNull();
  const started = await page.evaluate(() => window.__cr.runtime.simTime);
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.simTime)).toBeGreaterThan(started + 1);
  await expect(page.getByTestId('fuel-station')).toBeHidden();
  expect(await page.evaluate(() => window.__cr.fuel.openPump())).toBe(false);
  await page.evaluate(() => {
    const c = window.__cr, station = c.cityMap.FUEL_STATIONS.find(s => s.id === 'petrol_south_bay1')!;
    c.runtime.requestRecovery({ x: station.x, z: station.z, heading: station.heading });
    c.debug.cam = { x: station.pumpX + 36, y: 19, z: station.pumpZ + 36, tx: station.pumpX, ty: 4, tz: station.pumpZ };
  });
  await expect(page.getByTestId('fuel-station')).toBeVisible();
  await page.getByTestId('fuel-cancel').click();
  await page.screenshot({ path: 'test-results/hp-petrol-pump.png' });
  const marker = await page.evaluate(() => {
    const scene = window.__cr.debug.extra.scene as THREE.Scene;
    const group = scene.getObjectByName('fuel-bay-petrol_south_bay1')!;
    return { inside: group.userData.inside, visible: group.visible };
  });
  expect(marker).toEqual({ inside: true, visible: true });
  expect(errors).toEqual([]);
});

test.describe('mobile pump', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  test('free full-tank confirmation fits touch screens and works with zero cash', async ({ page }) => {
    await boot(page, { clear: true });
    await fixture(page, { owned: ['mclaren_p1'], equipped: 'mclaren_p1', wallet: 0 });
    await play(page);
    await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
    await page.evaluate(() => {
      const c = window.__cr, st = c.store.getState(), station = c.cityMap.FUEL_STATIONS[0];
      st.commit({ ...st.save, wallet: 0, fuelByVehicle: { ...st.save.fuelByVehicle, [c.runtime.vehicleId]: 0 }, revision: st.save.revision + 1 }, true);
      c.fuel.tank.percent = 0; c.runtime.requestRecovery({ x: station.x, z: station.z, heading: station.heading });
    });
    const dialog = page.getByTestId('fuel-station'); await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.__cr.fuel.percent)).toBe(0);
    await expect(dialog).toContainText('Current tank: 0%');
    await expect(dialog).toContainText('No money required');
    const button = dialog.getByTestId('fuel-confirm'); const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44); expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/mobile-pump.png' });
    await button.tap(); await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => ({ fuel: window.__cr.fuel.percent, cash: window.__cr.store.getState().save.wallet }))).toEqual({ fuel: 100, cash: 0 });
  });
});
