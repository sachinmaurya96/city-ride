// Dev helper: screenshot every vehicle with its animated driver from a 3/4 view (dev server).
// Usage: node scripts/dev/showcase.mjs [url] [outDir] [ids...]
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/', outDir = '.', ...ids] = process.argv.slice(2);
const ALL = ['bike_basic', 'auto_city', 'car_compact', 'car_coupe', 'mpv_seven', 'bus_small', 'bus_medium', 'bus_long', 'supercar'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForSelector('[data-testid=play]', { timeout: 90000 });
await page.click('[data-testid=play]');
await page.waitForTimeout(1500);
await page.click('[data-testid=controls-ok]').catch(() => {});
await page.addStyleTag({ content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }' });
for (const id of ids.length ? ids : ALL) {
  await page.evaluate((id) => {
    const st = window.__cr.store.getState();
    const s = st.save;
    st.commit({ ...s, ownedVehicleIds: [...new Set([...s.ownedVehicleIds, id])], equippedVehicleId: id, revision: s.revision + 1 });
    st.respawn();
  }, id);
  await page.waitForTimeout(2500);
  for (const [name, side, front, h] of [['front', 1, 1, 0.55], ['rear', -0.6, -1, 0.75]]) {
    await page.evaluate(({ id, side, front, h }) => {
      const p = window.__cr.runtime.pose;
      const L = { bike_basic: 2.6, auto_city: 3.4, car_compact: 4.6, car_coupe: 4.8, mpv_seven: 5.4, bus_small: 8, bus_medium: 10, bus_long: 12.5, supercar: 5 }[id];
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading), lx = fz, lz = -fx;
      window.__cr.debug.cam = { x: p.x + fx * L * front * 0.8 + lx * L * side * 0.75, y: L * h, z: p.z + fz * L * front * 0.8 + lz * L * side * 0.75, tx: p.x, ty: L * 0.16, tz: p.z };
    }, { id, side, front, h });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${outDir}/veh-${id}-${name}.png` });
  }
  await page.evaluate(() => (window.__cr.debug.cam = null));
}
await browser.close();
