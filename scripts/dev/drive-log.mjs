// Dev: equip a vehicle via fixture, accept the first offer (or start a bus route), autopilot, log every 4 s.
import { chromium } from '@playwright/test';
const [url = 'http://localhost:5173/', vehicle = 'auto_city', seconds = '120', route = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(url);
await page.waitForSelector('[data-testid=play]', { timeout: 60000 });
await page.evaluate((v) => {
  localStorage.clear();
  const st = window.__cr.store.getState();
  st.updateSettings({ quality: 'low' });
  const s = structuredClone(st.save);
  s.wallet = 0; s.totalXP = 20000; s.ownedVehicleIds = ['bike_basic', v]; s.equippedVehicleId = v; s.lifetime.jobs = 10;
  s.tutorial = { controlsSeen: true, firstRideDone: true, skipped: false };
  st.commit(s);
}, vehicle);
await page.click('[data-testid=play]');
await page.waitForTimeout(1500);
if (route) {
  await page.click('[data-testid=dispatch-btn]');
  await page.click(`[data-testid=start-${route}]`);
} else {
  await page.waitForSelector('[data-testid=accept]', { timeout: 60000 });
  await page.click('[data-testid=accept]');
}
await page.evaluate(() => window.__cr.autopilot.start(9));
const t0 = Date.now();
while (Date.now() - t0 < Number(seconds) * 1000) {
  await page.waitForTimeout(4000);
  console.log(JSON.stringify(await page.evaluate(() => {
    const c = window.__cr; const p = c.runtime.pose; const pr = c.store.getState();
    return { sim: +c.runtime.simTime.toFixed(0), stage: c.rides.stage, bus: pr.ride.bus && `${pr.ride.bus.nextStop}/${pr.ride.bus.stopNames.length} on${pr.ride.bus.onboard}`, x: Math.round(p.x), z: Math.round(p.z), v: +c.runtime.telemetry.speed.toFixed(1), rem: Math.round(c.nav.remaining), stuck: +c.runtime.stuckTime.toFixed(1), gas: +c.input.pedals.gas.toFixed(2), brk: +c.input.pedals.brake.toFixed(2), steer: +c.input.pedals.steer.toFixed(2), hint: c.nav.stopHint, sp: +c.nav.stopProgress.toFixed(2), canRec: c.runtime.canRecover };
  })));
  const st = await page.evaluate(() => window.__cr.store.getState().ride.stage);
  if (st === 'COMPLETED') break;
}
await page.screenshot({ path: process.env.SHOT ?? 'drive.png' });
await browser.close();
