import { expect, test } from '@playwright/test';
import { boot, fixture, play } from './helpers';

test.setTimeout(240000);
test.use({ viewport: { width: 844, height: 390 } });

for (const id of ['bmw_i8', 'lambo_lp670']) {
  test(`${id}: brake lamps light while braking and the exhaust burns under sustained throttle`, async ({ page }) => {
    await boot(page, { clear: true });
    await fixture(page, { owned: ['bike_basic', id], equipped: id });
    await play(page);
    await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
    const fx = () => page.evaluate(() => {
      const scene = window.__cr.debug.extra.scene as import('three').Scene;
      const lamp = scene.getObjectByName('brake-light') as import('three').Sprite, flame = scene.getObjectByName('exhaust-flame') as import('three').Sprite;
      return { lamp: (lamp.material as import('three').SpriteMaterial).opacity, flame: flame.visible ? (flame.material as import('three').SpriteMaterial).opacity : 0 };
    });
    expect((await fx()).lamp).toBeLessThan(.05);
    await page.keyboard.down('KeyS');
    await expect.poll(async () => (await fx()).lamp).toBeGreaterThan(.8);
    await page.screenshot({ path: `test-results/fx-brake-${id}.png` });
    await page.keyboard.up('KeyS');
    await expect.poll(async () => (await fx()).lamp).toBeLessThan(.05);
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await fx()).flame, { timeout: 30000 }).toBeGreaterThan(.5);
    await page.screenshot({ path: `test-results/fx-flame-${id}.png` });
    await page.keyboard.up('KeyW');
    await expect.poll(async () => (await fx()).flame, { timeout: 10000 }).toBe(0);
  });
}
