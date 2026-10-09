// Dev check: drive the guided first ride end-to-end with the test autopilot and take screenshots.
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/', outDir = '.'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForSelector('[data-testid=play]', { timeout: 60000 });
await page.evaluate(() => window.__cr.store.getState().updateSettings({ quality: 'low' }));
await page.screenshot({ path: `${outDir}/r0-menu.png` });
await page.click('[data-testid=play]');
await page.waitForSelector('[data-testid=controls-ok]', { timeout: 10000 });
await page.screenshot({ path: `${outDir}/r1-controls.png` });
await page.click('[data-testid=controls-ok]');
await page.waitForSelector('[data-testid=offer-card]', { timeout: 30000 });
await page.screenshot({ path: `${outDir}/r2-offer.png` });
const state = () => page.evaluate(() => { const c = window.__cr; return { stage: c.rides.stage, rem: Math.round(c.nav.remaining), v: +c.runtime.telemetry.speed.toFixed(1), wallet: c.store.getState().save.wallet, x: Math.round(c.runtime.pose.x), z: Math.round(c.runtime.pose.z), sp: +c.nav.stopProgress.toFixed(2), hint: c.nav.stopHint }; });
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
console.log('accepted', await state());
await page.evaluate(() => window.__cr.autopilot.start(9));
const waitStage = async (stages, timeout, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await state();
    if (stages.includes(s.stage)) return s;
    await page.waitForTimeout(1000);
    if ((Date.now() - t0) % 10000 < 1000) console.log(label, s);
  }
  console.log('TIMEOUT', label, await state());
  return null;
};
let s = await waitStage(['BOARDING', 'TO_DROPOFF'], 240000, 'to pickup');
await page.screenshot({ path: `${outDir}/r3-pickup.png` });
s = await waitStage(['TO_DROPOFF'], 20000, 'boarding');
console.log('boarded', s);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/r4-driving.png` });
s = await waitStage(['ALIGHTING', 'COMPLETED'], 240000, 'to drop');
s = await waitStage(['COMPLETED'], 20000, 'alighting');
await page.evaluate(() => window.__cr.autopilot.stop());
await page.waitForSelector('[data-testid=receipt]', { timeout: 10000 }).catch(() => {});
await page.screenshot({ path: `${outDir}/r5-receipt.png` });
console.log('completed', await state(), await page.evaluate(() => JSON.stringify(window.__cr.store.getState().save.pendingReceipts[0])));
console.log('errors', errors.slice(0, 10));
await browser.close();
