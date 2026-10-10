import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { boot, play } from './helpers';

test.setTimeout(180000);
test.use({ viewport: { width: 1000, height: 650 } });

async function carState(page: Page, id: string) {
  return page.evaluate((id) => {
    const scene = window.__cr.debug.extra.scene as THREE.Scene;
    const car = scene.getObjectByName(`imported-vehicle-${id}`);
    if (!car) return null;
    let meshes = 0, triangles = 0, reflected = 0, textured = 0;
    car.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === 'player-driver') return;
      meshes++;
      triangles += mesh.geometry.getAttribute('position').count / 3;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.envMap) reflected++;
      if (mat.map) textured++;
    });
    const wheel = car.getObjectByName('imported-wheel-0')!;
    return { meshes, triangles, reflected, textured, spin: car.getObjectByName('imported-wheel-spin-0')!.rotation.x, steer: wheel.rotation.y, wheelY: wheel.position.y, position: car.getWorldPosition(new (window.__cr.debug.extra.THREE as typeof THREE).Vector3()).toArray() };
  }, id);
}

test('both supplied cars preview, drive with animated wheels and persist without spending cash', async ({ page }) => {
  const errors: string[] = [];
  const modelRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (r.url().includes('.glb') && r.resourceType() === 'fetch') modelRequests.push(r.url()); });
  await boot(page);
  expect(modelRequests.filter(url => /bmw_|lambo|mustang|mclaren|rr-spectr/.test(url))).toEqual([]);
  const wallet = await page.evaluate(() => window.__cr.store.getState().save.wallet);
  for (const id of ['bmw_i8', 'bmw_m4_gt3']) {
    await page.evaluate(() => window.__cr.store.getState().openOverlay('garage'));
    await page.getByTestId(`vcard-${id}`).click();
    await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 60000 });
    await expect(page.getByTestId('try-car')).toBeEnabled();
    await page.locator('.preview').screenshot({ path: `test-results/${id}-garage.png` });
    await page.getByTestId('try-car').click();
    expect(await page.evaluate(() => window.__cr.store.getState().save.equippedVehicleId)).toBe(id);
    expect(await page.evaluate(() => window.__cr.store.getState().save.wallet)).toBe(wallet);
    if (id === 'bmw_i8') await play(page);
    await expect.poll(() => carState(page, id)).not.toBeNull();
    await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.active), { timeout: 60000 }).toBe(false);
    const car = (await carState(page, id))!;
    await test.info().attach(`${id}-render.json`, { body: JSON.stringify(car, null, 2), contentType: 'application/json' });
    expect(car.triangles).toBe(id === 'bmw_i8' ? 39933 : 107980);
    expect(car.meshes).toBeLessThan(70);
    expect(car.reflected).toBe(car.meshes);
    expect(car.textured).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/${id}-road.png` });
    await page.keyboard.down('KeyW');
    await expect.poll(() => carState(page, id), { intervals: [200] }).not.toMatchObject({ spin: car.spin });
    await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.speedKmh)).toBeGreaterThan(5);
    await page.keyboard.down('KeyD');
    await expect.poll(async () => Math.abs((await carState(page, id))!.steer)).toBeGreaterThan(0.03);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await page.evaluate(() => {
      window.__cr.input.reset();
      if (window.__cr.runtime.lastSafePose) window.__cr.runtime.requestRecovery(window.__cr.runtime.lastSafePose);
    });
  }
  expect(modelRequests.filter((url) => /bmw_/i.test(url))).toHaveLength(2);
  await page.reload();
  await page.getByTestId('play').waitFor({ timeout: 90000 });
  expect(await page.evaluate(() => window.__cr.store.getState().save.equippedVehicleId)).toBe('bmw_m4_gt3');
  await expect.poll(() => carState(page, 'bmw_m4_gt3'), { timeout: 60000 }).not.toBeNull();
  await expect.poll(async () => {
    const car = await carState(page, 'bmw_m4_gt3');
    return car ? car.reflected === car.meshes : false;
  }).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('touch garage', () => {
test.use({ viewport: { width: 667, height: 375 }, hasTouch: true, isMobile: true });
test('a failed model download offers a retry, new cars fit mobile menus and active rides stay protected', async ({ page }) => {
  await boot(page);
  let fail = true;
  await page.route('**/*bmw_i8*.glb*', (route) => fail ? route.abort() : route.continue());
  await page.getByTestId('menu-garage').click();
  await page.getByTestId('vcard-bmw_i8').click();
  await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'error');
  await expect(page.getByTestId('try-car')).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 60000 });
  await page.getByTestId('vcard-bmw_m4_gt3').tap();
  await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 60000 });
  for (const [width, height] of [[667, 375], [568, 320], [320, 568], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    const garage = page.getByTestId('garage');
    expect(await garage.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByTestId('try-car').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('try-car')).toBeInViewport({ ratio: .99 });
    await garage.evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: `test-results/bmw-mobile-garage-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 667, height: 375 });
  await page.getByTestId('garage-close').click();
  await play(page);
  await page.getByTestId('accept').waitFor({ timeout: 60000 });
  await page.getByTestId('accept').click();
  const mission = await page.evaluate(() => window.__cr.store.getState().save.mission!.id);
  await page.evaluate(() => window.__cr.store.getState().openOverlay('garage'));
  await page.getByTestId('vcard-bmw_i8').click();
  await expect(page.getByTestId('try-car')).toBeDisabled();
  expect(await page.evaluate(() => window.__cr.store.getState().save.equippedVehicleId)).toBe('bike_basic');
  expect(await page.evaluate(() => window.__cr.store.getState().save.mission!.id)).toBe(mission);
});
});
