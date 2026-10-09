import { expect, test, type Page } from '@playwright/test';
import { boot, play, waitStage } from './helpers';

test.setTimeout(120000);

type Box = { x: number; y: number; width: number; height: number };
function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}

async function checkHud(page: Page, width: number, height: number, preset: 'joystick' | 'pedals', touch = true) {
  const map = (await page.getByTestId('minimap').boundingBox())!;
  expect(map.y).toBeLessThanOrEqual(15);
  expect(width - map.x - map.width).toBeLessThanOrEqual(15);
  expect(map.width).toBeLessThanOrEqual(105);
  const selectors = ['.hud-top-left', '.minimap', '.pause-btn', '.hud-instruments', '.util-buttons'];
  if (touch) selectors.push(preset === 'joystick' ? '.joy-home' : '.steer-pad');
  if (touch && preset === 'pedals') selectors.push('.pedals');
  const boxes: { selector: string; box: Box }[] = [];
  for (const selector of selectors) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x, selector).toBeGreaterThanOrEqual(0);
    expect(box.y, selector).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
    expect(box.y + box.height, selector).toBeLessThanOrEqual(height);
    boxes.push({ selector, box });
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    expect(overlaps(boxes[i].box, boxes[j].box), `${width}×${height} ${preset}: ${boxes[i].selector} / ${boxes[j].selector}`).toBe(false);
  }
  const clearRoad = { x: width * .4, y: height * .3, width: width * .35, height: height * .4 };
  for (const item of boxes) expect(overlaps(item.box, clearRoad), `road covered by ${item.selector}`).toBe(false);
  for (const control of await page.locator('.util-buttons .util, .pause-btn, .pedal').all()) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

test.describe('responsive touch UI', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('HUD stays at the edges across small phones, tablets, both presets and empty fuel', async ({ page }) => {
    await boot(page, { clear: true });
    await play(page);
    await page.getByTestId('gesture-layer').tap({ position: { x: 540, y: 300 } });
    await expect(page.locator('.app')).toHaveClass(/touch-mode/);
    await waitStage(page, ['OFFERED'], 60000);
    const sizes = [[568, 280], [667, 375], [800, 300], [844, 390], [1024, 768], [1366, 768]];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId('accept')).toBeInViewport({ ratio: 1 });
      await checkHud(page, width, height, 'joystick');
      await page.screenshot({ path: `test-results/ui-offer-${width}x${height}.png` });
    }
    await page.getByTestId('accept').tap();
    await page.evaluate(() => {
      const mission = window.__cr.rides.mission!;
      window.__cr.rides.restore({ ...mission, state: 'TO_DROPOFF', quote: { ...mission.quote, deadlineSeconds: 90 }, elapsed: 0 });
    });
    await expect(page.getByTestId('deadline')).toBeVisible();
    await page.evaluate(() => { Object.defineProperty(window.__cr.runtime, 'canRecover', { configurable: true, get: () => true, set: () => {} }); });
    for (const preset of ['joystick', 'pedals'] as const) for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate((controls) => { window.__cr.store.getState().updateSettings({ controls }); window.__cr.fuel.tank.percent = 0; }, preset);
      await expect(page.locator('.app')).toHaveAttribute('data-controls', preset);
      await expect(page.getByTestId('emergency-fuel')).toBeVisible();
      await expect(page.locator('.util.recover')).toBeVisible();
      await checkHud(page, width, height, preset);
      await page.screenshot({ path: `test-results/ui-empty-${preset}-${width}x${height}.png` });
    }
    await page.setViewportSize({ width: 568, height: 280 });
    for (const language of ['en', 'ru'] as const) {
      await page.evaluate((language) => window.__cr.store.getState().updateSettings({ language, uiScale: 1.3 }), language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await checkHud(page, 568, 280, 'pedals');
      await expect(page.getByTestId('deadline')).toBeInViewport({ ratio: 1 });
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('.app').evaluate((el) => {
      const app = el as HTMLElement;
      for (const [side, value] of [['l', 40], ['r', 30], ['t', 10], ['b', 20]]) app.style.setProperty(`--safe-${side}`, `${value}px`);
    });
    for (const selector of ['.hud-top-left', '.minimap', '.pause-btn', '.hud-instruments', '.util-buttons', '.pedals', '.steer-pad']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(40);
      expect(box.y).toBeGreaterThanOrEqual(10);
      expect(box.x + box.width).toBeLessThanOrEqual(844 - 30);
      expect(box.y + box.height).toBeLessThanOrEqual(390 - 20);
    }
    await page.locator('.app').evaluate((el) => { for (const side of ['l', 'r', 't', 'b']) (el as HTMLElement).style.removeProperty(`--safe-${side}`); });
    await page.setViewportSize({ width: 800, height: 300 });
    await page.evaluate(() => { window.__cr.fuel.tank.percent = 100; window.__cr.store.getState().updateSettings({ controls: 'joystick', language: 'en', uiScale: 1 }); });
    await expect(page.locator('.app')).toHaveAttribute('data-controls', 'joystick');
    const home = (await page.locator('.joy-home').boundingBox())!;
    const center = { x: home.x + home.width / 2, y: home.y + home.height / 2, id: 1 };
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...center, y: center.y - 30 }] });
    await expect.poll(() => page.evaluate(() => window.__cr.input.joystick.y)).toBeGreaterThan(.9);
    const live = (await page.locator('.joy-live').boundingBox())!;
    expect(Math.abs(live.x - home.x)).toBeLessThan(1);
    expect(Math.abs(live.y - home.y)).toBeLessThan(1);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.__cr.input.joystick.active)).toBe(false);
    await touch.detach();
    await page.getByTestId('minimap').tap();
    await expect(page.getByTestId('city-map')).toBeVisible();
    for (const [width, height] of [[800, 300], [667, 375], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator('.map-viewport canvas')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.legend')).toBeInViewport({ ratio: 1 });
    }
    await page.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(page.getByTestId('city-map')).not.toBeVisible();
  });

  test('menus and dialogs fit narrow portrait and short landscape screens without horizontal overflow', async ({ page }) => {
    await boot(page, { clear: true });
    for (const [width, height] of [[320, 568], [390, 844], [568, 280], [800, 300], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId('play')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `test-results/ui-menu-${width}x${height}.png` });
      for (const overlay of ['settings', 'garage', 'daily', 'stats'] as const) {
        await page.getByTestId(`menu-${overlay}`).tap();
        const modal = page.getByTestId(overlay);
        await expect(modal).toBeVisible();
        await expect(modal).toBeInViewport({ ratio: 1 });
        expect(await modal.evaluate((el) => el.scrollWidth - el.clientWidth), `${width}×${height} ${overlay}`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `test-results/ui-${overlay}-${width}x${height}.png` });
        const close = modal.getByRole('button', { name: 'Close', exact: true }).first();
        await expect(close).toBeInViewport({ ratio: 1 });
        await close.tap();
      }
    }
  });
});

test('desktop HUD keeps the road clear at laptop and desktop sizes', async ({ page }) => {
  await boot(page, { clear: true });
  await play(page);
  await waitStage(page, ['OFFERED'], 60000);
  await page.getByTestId('accept').click();
  await expect(page.locator('.app')).toHaveClass(/desktop-mode/);
  for (const [width, height] of [[800, 300], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await checkHud(page, width, height, 'joystick', false);
    await page.screenshot({ path: `test-results/ui-desktop-${width}x${height}.png` });
  }
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('pause-menu')).toBeInViewport({ ratio: 1 });
  await page.getByTestId('resume').click();
  await page.keyboard.press('KeyH');
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.hornUntil - window.__cr.runtime.simTime)).toBeGreaterThan(0);
});
