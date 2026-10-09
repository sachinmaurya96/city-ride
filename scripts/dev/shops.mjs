// Dev helper: screenshot named storefronts (banners, café terraces, guests) and street-name boards.
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/', outDir = '.', count = '3'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForSelector('[data-testid=play]', { timeout: 90000 });
await page.click('[data-testid=play]');
await page.waitForTimeout(1500);
await page.click('[data-testid=controls-ok]').catch(() => {});
await page.addStyleTag({ content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }' });
const info = await page.evaluate(async () => {
  const { getCity } = await import('/src/game/world/City.tsx');
  const c = getCity();
  const shops = c.boards.filter((b) => !b.double);
  return { stats: c.stats, boards: c.boards.length, patrons: c.patrons.length, shops: shops.slice(0, 60), street: c.boards.filter((b) => b.double).slice(0, 4) };
});
console.log(JSON.stringify({ stats: info.stats, boards: info.boards, patrons: info.patrons }));
const picks = [info.shops[3], info.shops[11], info.shops[25], info.shops[40], info.street[2]].filter(Boolean).slice(0, Number(count) + 1);
let k = 0;
for (const b of picks) {
  const nx = Math.sin(b.ry), nz = Math.cos(b.ry);
  const tx = Math.cos(b.ry), tz = -Math.sin(b.ry);
  const dist = b.double ? 7 : 13;
  const cam = { x: b.x + nx * dist + tx * 4, y: b.double ? 2.4 : 2.6, z: b.z + nz * dist + tz * 4, tx: b.x, ty: b.double ? 2.8 : 2.2, tz: b.z };
  await page.evaluate(({ b, cam, nx, nz }) => {
    window.__cr.runtime.requestRecovery({ x: b.x + nx * 18, z: b.z + nz * 18, heading: b.ry + Math.PI / 2 });
    window.__cr.debug.cam = cam;
  }, { b, cam, nx, nz });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${outDir}/shop-${k++}.png` });
}
await browser.close();
