import { expect, test } from '@playwright/test';
import { boot, fixture, play } from './helpers';

test.setTimeout(180000);
test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

test('car controls fit both presets when Safari toolbars reduce the visible viewport', async ({ page }) => {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { width: 844, height: 330, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic', 'bmw_i8'], equipped: 'bmw_i8' });
  await play(page);
  await expect(page.getByTestId('car-door')).toBeVisible();
  for (const controls of ['joystick', 'pedals'] as const) for (const [width, height] of [[568, 280], [667, 280], [844, 300], [932, 340], [1024, 600]]) {
    await page.setViewportSize({ width, height: height + 60 });
    await page.evaluate(({ width, height, controls }) => {
      const viewport = window.visualViewport! as unknown as { width: number; height: number; dispatchEvent(e: Event): void };
      viewport.width = width; viewport.height = height;
      viewport.dispatchEvent(new Event('resize'));
      window.__cr.store.getState().updateSettings({ controls });
    }, { width, height, controls });
    await expect.poll(async () => Math.round((await page.locator('.app').boundingBox())!.height)).toBe(height);
    const boxes = [];
    for (const selector of ['.minimap', '.pause-btn', '.camera-control', '.hud-instruments', '.util-buttons', '.power-brake', '.pedals', controls === 'joystick' ? '.joy-home' : '.steer-pad']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.y, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
      expect(box.y + box.height, selector).toBeLessThanOrEqual(height);
      boxes.push({ selector, ...box });
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1,
        `${controls} ${width}×${height}: ${a.selector} / ${b.selector}`).toBe(false);
    }
    await page.screenshot({ path: `test-results/${test.info().project.name}-toolbar-${controls}-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 568, height: 340 });
  await page.evaluate(() => {
    const viewport = window.visualViewport! as unknown as { width: number; height: number; offsetTop: number; dispatchEvent(e: Event): void };
    viewport.width = 568; viewport.height = 280; viewport.offsetTop = 20;
    viewport.dispatchEvent(new Event('scroll'));
    window.__cr.store.getState().updateSettings({ controls: 'joystick' });
  });
  await expect.poll(async () => (await page.locator('.app').boundingBox())!.y).toBe(20);
  await page.getByTestId('gesture-layer').evaluate(el => { el.setPointerCapture = () => {}; });
  const home = (await page.locator('.joy-home').boundingBox())!;
  await page.getByTestId('gesture-layer').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: home.x + home.width / 2, clientY: home.y + home.height / 2 });
  const live = (await page.locator('.joy-live').boundingBox())!;
  expect(live.x).toBeCloseTo(home.x, 0);
  expect(live.y).toBeCloseTo(home.y, 0);
  await page.getByTestId('gesture-layer').dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch' });
});
