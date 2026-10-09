// Dev helper: close-up screenshots of walking pedestrians (debug camera follows one person).
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/', outDir = '.', count = '4'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForSelector('[data-testid=play]', { timeout: 90000 });
await page.click('[data-testid=play]');
await page.waitForTimeout(1500);
await page.click('[data-testid=controls-ok]').catch(() => {});
await page.addStyleTag({ content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }' });
await page.waitForTimeout(9000);
for (let k = 0; k < Number(count); k++) {
  const info = await page.evaluate((k) => {
    const me = window.__cr.runtime.pose;
    const list = window.__cr.pedestrians.peds.filter((p) => p.active).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    const p = list[k];
    if (!p) return null;
    window.__follow = p.id;
    return { id: p.id, gender: p.gender, state: p.state };
  }, k);
  if (!info) break;
  for (let f = 0; f < 3; f++) {
    await page.evaluate(() => {
      const p = window.__cr.pedestrians.peds.find((q) => q.id === window.__follow);
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      // three-quarter front view, 3.4 m away
      window.__cr.debug.cam = { x: p.x + fx * 2.6 + fz * 2.2, y: 1.5, z: p.z + fz * 2.6 - fx * 2.2, tx: p.x, ty: 0.9, tz: p.z };
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outDir}/ped-${k}-${f}.png` });
  }
  console.log(JSON.stringify(info));
}
await browser.close();
