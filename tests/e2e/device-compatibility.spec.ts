import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import { boot, fixture, play } from './helpers';

test.setTimeout(180000);
test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

test('iOS fullscreen guidance, portrait/landscape menus, tablets and retired garage cars', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: false });
  });
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic', 'car_compact', 'car_coupe', 'mpv_seven', 'supercar'], equipped: 'car_compact' });
  await expect(page.getByTestId('fullscreen-help')).toContainText('Add to Home Screen');
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [568, 280], [667, 320], [844, 390], [1024, 768], [768, 1024], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId('play')).toBeInViewport({ ratio: 1 });
    await page.getByTestId('menu-garage').tap();
    const garage = page.getByTestId('garage');
    await expect(garage).toBeInViewport({ ratio: 1 });
    expect(await garage.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    for (const id of ['car_compact', 'car_coupe', 'mpv_seven', 'supercar']) await expect(page.getByTestId(`vcard-${id}`)).toHaveCount(0);
    await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 60000 });
    await expect(garage.locator('.vname')).toContainText('Ninja Bike');
    await page.screenshot({ path: `test-results/${test.info().project.name}-garage-${width}x${height}.png` });
    await page.getByTestId('garage-close').tap();
  }
});

test('a cold bike or car stays behind the progress bar until its actual model is ready', async ({ page }) => {
  await boot(page, { clear: true });
  for (const [id, file] of [['ducati_v4r', 'ducativ4r'], ['mustang_rtr', 'mustang']] as const) {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(new RegExp(`${file}[^/]*\\.glb`), async route => { await held; await route.continue(); });
    await fixture(page, { owned: ['bike_basic', id], equipped: id });
    await page.getByTestId('play').tap();
    await expect(page.getByTestId('boot')).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(await page.evaluate(() => window.__cr.store.getState().appState)).toBe('LOADING');
    expect(await page.evaluate(() => window.__cr.input.enabled)).toBe(false);
    expect(await page.evaluate(() => window.__cr.runtime.vehicleId)).not.toBe(id);
    // The covered map must not consume continuous GPU frames while the vehicle is held.
    await expect.poll(() => page.evaluate(() => !!(window.__cr.debug.extra.scene as THREE.Scene)?.getObjectByName('resource-city')), { timeout: 90000 }).toBe(true);
    const frame = await page.evaluate(() => (window.__cr.runtime.renderer as THREE.WebGLRenderer).info.render.frame);
    await page.waitForTimeout(500);
    const nextFrame = await page.evaluate(() => (window.__cr.runtime.renderer as THREE.WebGLRenderer).info.render.frame);
    expect(nextFrame - frame).toBeLessThanOrEqual(3);
    release();
    await expect.poll(() => page.evaluate(() => window.__cr.store.getState().appState), { timeout: 90000 }).toBe('PLAYING');
    await expect(page.getByTestId('boot')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicleId)).toBe(id);
    const scene = await page.evaluate(() => {
      const c = window.__cr, scene = c.debug.extra.scene as THREE.Scene;
      const packs = new Set<string>();
      scene.getObjectByName('resource-city')!.traverse(object => { if (object.userData.pack) packs.add(object.userData.pack); });
      return { actualModel: !!scene.getObjectByName(`imported-vehicle-${c.runtime.vehicleId}`), packs: [...packs] };
    });
    expect(scene.actualModel).toBe(true);
    expect(scene.packs).toEqual(expect.arrayContaining(['buildings', 'roads', 'petrol']));
    await page.screenshot({ path: `test-results/${test.info().project.name}-actual-${id}.png` });
    await page.getByTestId('pause').tap();
    await page.getByTestId('to-menu').tap();
  }
});

test('a failed essential city pack exposes retry', async ({ page }) => {
  await page.route(/city-building-pack[^/]*\.glb/, route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await boot(page, { clear: true });
  await page.getByTestId('play').tap();
  await expect.poll(() => page.evaluate(() => window.__cr.store.getState().appState), { timeout: 90000 }).toBe('RECOVERABLE_ERROR');
  await expect(page.getByTestId('boot')).toContainText('buildings');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__cr.input.enabled)).toBe(false);
  await page.unroute(/city-building-pack[^/]*\.glb/);
  await page.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(page.getByTestId('play')).toBeVisible({ timeout: 90000 });
  await play(page);
});

test('slow optional scenery does not delay driving; streaming preserves city buffers and cached models', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requests: { name: string; state: string }[] = [];
  const models: string[] = [];
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('request', request => { if (/\/vehicles\/|ninjabike[^/]*\.glb/.test(request.url())) models.push(request.url()); });
  await page.route(/(night-city-building-pack|forest-tree-pack|palm-tree-pack|banana-tree-pack|billboard)[^/]*\.glb/, async route => {
    requests.push({ name: route.request().url(), state: await page.evaluate(() => window.__cr.store.getState().appState) });
    await held;
    // One missing optional pack must not interrupt gameplay or stop the remaining stream.
    if (/billboard/.test(route.request().url())) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic'], equipped: 'bike_basic' });
  await play(page);
  await expect.poll(() => requests.length, { timeout: 30000 }).toBe(1);
  expect(requests[0].state).toBe('PLAYING');
  const coreIds = await page.evaluate(() => {
    const result: string[] = [];
    (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('resource-city')!.traverse(object => {
      if (['buildings', 'roads', 'petrol'].includes(object.userData.pack)) result.push(object.uuid);
    });
    return result;
  });
  expect(coreIds.length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => window.__cr.store.getState().appState)).toBe('PLAYING');
  release();
  await expect.poll(() => requests.length, { timeout: 60000 }).toBe(5);
  await expect.poll(() => page.evaluate(() => {
    let found = false;
    (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('resource-city')!.traverse(object => { if (object.userData.pack === 'bananas') found = true; });
    return found;
  }), { timeout: 60000 }).toBe(true);
  const retainedIds = await page.evaluate(() => {
    const result: string[] = [];
    (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('resource-city')!.traverse(object => {
      if (['buildings', 'roads', 'petrol'].includes(object.userData.pack)) result.push(object.uuid);
    });
    return result;
  });
  expect(retainedIds).toEqual(coreIds);
  expect(await page.evaluate(() => window.__cr.store.getState().appState)).toBe('PLAYING');
  const initialModels = [...models];
  expect(initialModels.filter(url => /ninjabike/.test(url))).toHaveLength(1);
  await page.getByTestId('pause').tap();
  await page.getByTestId('to-menu').tap();
  const started = Date.now();
  await play(page);
  expect(Date.now() - started).toBeLessThan(2500);
  expect(models).toEqual(initialModels);
  expect(errors, `Failed requests: ${failedRequests.join('\n')}`).toEqual([]);
});

test('a cold garage car can start its test drive while the preview is still loading', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const cars: string[] = [];
  page.on('request', request => { if (/mustang[^/]*\.glb/.test(request.url())) cars.push(request.url()); });
  await page.route(/mustang[^/]*\.glb/, async route => { await held; await route.continue(); });
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic'], equipped: 'bike_basic' });
  await page.getByTestId('menu-garage').tap();
  await page.getByTestId('vcard-mustang_rtr').tap();
  await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'loading');
  await expect(page.getByTestId('test-drive')).toBeEnabled();
  await page.getByTestId('test-drive').tap();
  await expect(page.getByTestId('boot')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-label', /Mustang/);
  expect(await page.evaluate(() => window.__cr.store.getState().appState)).toBe('LOADING');
  expect(await page.evaluate(() => window.__cr.runtime.vehicleId)).not.toBe('mustang_rtr');
  release();
  await expect.poll(() => page.evaluate(() => window.__cr.store.getState().appState), { timeout: 90000 }).toBe('PLAYING');
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicleId)).toBe('mustang_rtr');
  expect(cars).toHaveLength(1);
  await expect(page.getByTestId('boot')).toBeHidden();
});
