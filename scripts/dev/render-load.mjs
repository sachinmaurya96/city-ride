// Dev helper: triangles + draw calls of one rendered frame per quality preset (incl. shadow pass), at spawn.
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForSelector('[data-testid=play]', { timeout: 90000 });
await page.click('[data-testid=play]');
await page.waitForTimeout(1500);
await page.click('[data-testid=controls-ok]').catch(() => {});
await page.waitForTimeout(8000);
for (const q of ['low', 'medium', 'high', 'ultra']) {
  await page.evaluate((q) => window.__cr.store.getState().updateSettings({ quality: q }), q);
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => {
    const { gl } = window.__cr.debug.extra;
    const peds = window.__cr.pedestrians.peds.filter((p) => p.active).length;
    const cars = window.__cr.traffic.cars.filter((c) => c.active).length;
    return { triangles: gl.info.render.triangles, calls: gl.info.render.calls, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, peds, cars };
  });
  console.log(q, JSON.stringify(r));
}
await browser.close();
