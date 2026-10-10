import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { play, waitStage } from './helpers';

test.setTimeout(180000);

async function graphics(page: Page) {
  return page.evaluate(() => {
    const gl = window.__cr.runtime.renderer!;
    const scene = window.__cr.debug.extra.scene as THREE.Scene;
    const sun = scene.getObjectByName('daylight-sun') as THREE.DirectionalLight;
    return {
      pixelRatio: gl.getPixelRatio(),
      shadows: gl.shadowMap.enabled,
      shadowSize: sun.shadow.map?.width ?? 0,
      fogFar: (scene.fog as THREE.Fog).far,
      antialias: gl.getContext().getContextAttributes()?.antialias,
    };
  });
}

test.describe('mobile graphics', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 3, viewport: { width: 568, height: 320 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36' });

  test('presets and Native resolution update the real renderer immediately, preserve a ride and survive reload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.getByTestId('play').waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !!window.__cr?.store);
    expect(await page.evaluate(() => window.__cr.store.getState().save.settings.quality)).toBe('medium');
    await play(page);
    await waitStage(page, ['OFFERED'], 60000);
    await page.getByTestId('accept').tap();
    await page.getByTestId('pause').tap();
    await page.getByTestId('pause-menu').getByRole('button', { name: /Settings/ }).tap();
    await expect(page.getByTestId('graphics-settings')).toBeVisible();
    const missionId = await page.evaluate(() => window.__cr.rides.mission!.id);
    const spawn = await page.evaluate(() => window.__cr.store.getState().spawnNonce);
    await page.evaluate(() => { window.__cr.debug.extra.graphicsRenderer = window.__cr.runtime.renderer; });

    await page.getByTestId('quality-low').tap();
    await expect.poll(() => graphics(page), { timeout: 30000 }).toMatchObject({ pixelRatio: 1, shadows: false, fogFar: 270, antialias: true });
    await page.getByTestId('quality-high').tap();
    await expect.poll(() => graphics(page), { timeout: 30000 }).toMatchObject({ pixelRatio: 2, shadows: true, shadowSize: 2048, fogFar: 480 });
    await page.getByTestId('quality-ultra').tap();
    await expect.poll(() => graphics(page), { timeout: 30000 }).toMatchObject({ pixelRatio: 3, shadows: true, shadowSize: 4096, fogFar: 620 });
    await page.getByTestId('quality-high').tap();
    await expect.poll(() => graphics(page), { timeout: 30000 }).toMatchObject({ pixelRatio: 2, shadowSize: 2048 });
    await page.getByTestId('graphics-resolution').selectOption('native');
    await expect.poll(() => graphics(page), { timeout: 30000 }).toMatchObject({ pixelRatio: 3 });
    await page.getByTestId('graphics-shadows').selectOption('off');
    await expect.poll(() => graphics(page)).toMatchObject({ shadows: false, shadowSize: 0 });
    await page.getByTestId('graphics-distance').selectOption('near');
    await expect.poll(() => graphics(page)).toMatchObject({ fogFar: 270 });
    expect(await page.evaluate(() => window.__cr.runtime.renderer === window.__cr.debug.extra.graphicsRenderer)).toBe(true);
    expect(await page.evaluate(() => window.__cr.rides.mission!.id)).toBe(missionId);
    expect(await page.evaluate(() => window.__cr.store.getState().spawnNonce)).toBe(spawn);
    await page.getByRole('button', { name: 'Close', exact: true }).tap();
    await page.getByTestId('resume').tap();
    await page.screenshot({ path: 'test-results/graphics-native-mobile.png' });
    await page.getByTestId('pause').tap();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cityride.save.v1')!).settings)).toMatchObject({ quality: 'high', renderResolution: 'native', shadows: 'off', viewDistance: 'near' });

    await page.reload();
    await page.getByTestId('play').waitFor({ timeout: 90000 });
    await page.getByTestId('menu-settings').tap();
    await expect(page.getByTestId('quality-high')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('graphics-resolution')).toHaveValue('native');
    await expect(page.getByTestId('graphics-shadows')).toHaveValue('off');
    await expect(page.getByTestId('graphics-distance')).toHaveValue('near');
    // Cold menus have no renderer; saved graphics are applied when Play creates it.
    expect(await page.evaluate(() => window.__cr.runtime.renderer)).toBeNull();
    await page.getByRole('button', { name: 'Close', exact: true }).tap();
    await play(page);
    await page.getByTestId('pause').tap();
    await page.getByTestId('pause-menu').getByRole('button', { name: /Settings/ }).tap();
    await expect.poll(() => graphics(page)).toMatchObject({ pixelRatio: 3, shadows: false, fogFar: 270 });
    await page.getByTestId('reset-graphics').tap();
    await expect(page.getByTestId('quality-medium')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => graphics(page), { timeout: 30000 }).toMatchObject({ pixelRatio: 1.5, shadows: true, shadowSize: 1024, fogFar: 380 });
    expect(await page.evaluate(() => window.__cr.store.getState().save.mission!.id)).toBe(missionId);
    expect(errors).toEqual([]);
  });
});

test.describe('graphics panel layout', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('graphics controls fit phone and tablet screens in both languages', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('play').waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !!window.__cr?.store);
    await page.getByTestId('menu-settings').tap();
    for (const language of ['en', 'ru'] as const) {
      await page.evaluate((language) => window.__cr.store.getState().updateSettings({ language, uiScale: language === 'ru' ? 1.3 : 1 }), language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      for (const [width, height] of [[320, 568], [667, 375], [800, 300], [1024, 768]]) {
        await page.setViewportSize({ width, height });
        const modal = page.getByTestId('settings');
        await expect(modal).toBeInViewport({ ratio: 1 });
        expect(await modal.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        for (const control of await page.locator('.graphics-settings button, .graphics-settings select').all()) {
          await control.scrollIntoViewIfNeeded();
          // Browser scrolling rounds to CSS pixels, so allow less than 1px of clipping.
          await expect(control).toBeInViewport({ ratio: .98 });
          const box = (await control.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await modal.evaluate((el) => { el.scrollTop = 0; });
        await page.screenshot({ path: `test-results/graphics-panel-${language}-${width}x${height}.png` });
      }
    }
  });
});
