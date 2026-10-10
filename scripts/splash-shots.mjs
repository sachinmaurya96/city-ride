// Captures the splash-screen supercar photos from the real game (run against an e2e build: E2E_URL=http://localhost:4190/).
import { chromium } from '@playwright/test';
import { access, mkdir, writeFile } from 'node:fs/promises';

const url = process.env.E2E_URL ?? 'http://localhost:4190/';
const cars = (process.env.CARS ?? (process.env.THUMB ? 'bike_basic,bmw_i8,bmw_m4_gt3,lambo_lp670,black_huracan,mclaren_p1,mustang_rtr,porsche_718,supra_a80,mercedes_maybach,amg_gt_mansory,naran_hyper,aston_one77,audi_r8_gt,bmw_m4_widebody,bmw_m3_gtr,rolls_ghost' : 'bmw_m4_gt3,black_huracan,porsche_718,mclaren_p1')).split(',');
// THUMB=1 writes small garage-card thumbnails instead of full splash covers.
const thumb = !!process.env.THUMB, dir = thumb ? 'src/assets/thumbs' : 'src/assets/splash';
const [outW, outH] = thumb ? [400, 225] : [960, 540];
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function shoot(id) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  await page.goto(url); await page.waitForFunction(() => !!window.__cr?.store);
  await page.evaluate((id) => {
    const st = window.__cr.store.getState();
    st.commit({ ...st.save, ownedVehicleIds: ['bike_basic', id], equippedVehicleId: id, tutorial: { controlsSeen: true, firstRideDone: true, skipped: false }, revision: st.save.revision + 1 }, true);
    st.updateSettings({ quality: 'ultra' });
  }, id);
  await page.click('[data-testid=play]');
  await page.waitForFunction(() => window.__cr.store.getState().appState === 'PLAYING', null, { timeout: 120000 });
  await page.waitForFunction(() => window.__cr.vehicleEntry.mode === 'seated', null, { timeout: 150000 });
  await page.addStyleTag({ content: '.hud, .hud *, .util-buttons, .power-brake, .pedals, .joy-home, .minimap, .toast, .toasts, .pause-btn, .hud-top-left, .hud-instruments, .kbd-strip, .tutorial-hint, .look-hint, .offer, [data-testid=offer] { visibility: hidden !important; }' });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const c = window.__cr, p = c.runtime.pose, fx = Math.sin(p.heading), fz = Math.cos(p.heading), rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    const spec = c.vehicles[c.runtime.vehicleId], k = Math.max(.75, spec.length / 4.6), h = Math.max(1, spec.height / 1.3);
    // Low three-quarter front view, slightly to the side, looking back at the nose (scaled to the vehicle).
    c.debug.cam = { x: p.x + (fx * 4.4 + rx * 2.9) * k, y: 1.05 * h, z: p.z + (fz * 4.4 + rz * 2.9) * k, tx: p.x + (fx * .2 - rx * .3) * k, ty: .65 * h, tz: p.z + (fz * .2 - rz * .3) * k };
  });
  await page.waitForTimeout(2500);
  const png = await page.screenshot({ type: 'png' });
  const webp = await page.evaluate(async ({ b64, outW, outH, thumb }) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const canvas = Object.assign(document.createElement('canvas'), { width: outW, height: outH });
    // Thumbnails crop toward the car (centre 70%) so it reads at card size.
    const crop = thumb ? .7 : 1, sw = img.width * crop, sh = img.height * crop;
    canvas.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) * .6, sw, sh, 0, 0, outW, outH);
    return canvas.toDataURL('image/webp', thumb ? .78 : .82).split(',')[1];
  }, { b64: png.toString('base64'), outW, outH, thumb });
  await writeFile(`${dir}/${id}.webp`, Buffer.from(webp, 'base64'));
  console.log(id, Math.round(webp.length * .75 / 1024), 'KB');
  await page.close();
}
for (const id of cars) {
  if (!process.env.FORCE && await access(`${dir}/${id}.webp`).then(() => true, () => false)) continue;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await shoot(id); break; } catch (error) { console.log(id, `attempt ${attempt} failed:`, error.message.split('\n')[0]); }
  }
}
await browser.close();
