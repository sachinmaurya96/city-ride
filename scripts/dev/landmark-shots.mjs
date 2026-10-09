// Dev helper: screenshot each landmark's frontage from across the street (debug camera, dev server).
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/', outDir = '.', ...ids] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(url);
await page.waitForSelector('[data-testid=play]', { timeout: 60000 });
await page.evaluate(() => window.__cr.store.getState().updateSettings({ quality: 'medium' }));
await page.click('[data-testid=play]');
await page.waitForTimeout(1200);
await page.click('[data-testid=controls-ok]').catch(() => {});
const bays = await page.evaluate(async () => (await import('/src/game/data/cityMap.ts')).BAYS.map((b) => ({ id: b.id, x: b.x, z: b.z, h: b.heading })));
for (const id of ids) {
  const b = bays.find((x) => x.id === id);
  if (!b) continue;
  const fx = Math.sin(b.h), fz = Math.cos(b.h);
  const lx = fz, lz = -fx; // driver's left = landmark side
  const cam = { x: b.x - lx * 16 - fx * 22, y: 7, z: b.z - lz * 16 - fz * 22, tx: b.x + lx * 18, ty: 6, tz: b.z + lz * 18 };
  // teleport the player too so chunks/LOD/shadows follow
  await page.evaluate(({ b, cam }) => { window.__cr.runtime.requestRecovery({ x: b.x - Math.cos(b.h) * 4, z: b.z + Math.sin(b.h) * 4, heading: b.h }); window.__cr.debug.cam = cam; }, { b, cam });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${outDir}/lm-${id}.png` });
}
await browser.close();
