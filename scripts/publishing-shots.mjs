// Real game screenshots for the publishing kit. Uses a dedicated e2e build, never release hooks.
// npm run build:e2e; serve dist-e2e; E2E_URL=http://127.0.0.1:4190/ node scripts/publishing-shots.mjs
import { chromium } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const baseURL = process.env.E2E_URL ?? 'http://127.0.0.1:4190/';
const output = 'playgama/assets/screenshots';
const manifestPath = join(output, 'manifest.json');
const viewport = { width: 1920, height: 1080 };
await mkdir(join(output, 'supercars'), { recursive: true });
await mkdir(join(output, 'gameplay'), { recursive: true });
const previous = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => ({ images: [] }));
const images = new Map(previous.images.map(image => [image.file, image]));
const exists = path => access(path).then(() => true, () => false);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const failures = [];

async function boot() {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  await page.goto(baseURL);
  await page.waitForFunction(() => !!window.__cr?.store);
  return page;
}
async function shoot(page, file, caption, extra = {}) {
  const png = await page.screenshot({ type: 'png' });
  if (png.length < 75000) throw new Error(`Blank or incomplete capture: ${file}`);
  await writeFile(join(output, file), png);
  images.set(file, { file, caption, width: viewport.width, height: viewport.height, source: 'Actual game capture', ...extra });
  await writeFile(manifestPath, JSON.stringify({ game: 'City Ride', capturedAt: new Date().toISOString(), images: [...images.values()] }, null, 2) + '\n');
  console.log(`Captured ${file}`);
}
async function frames(page, seconds = .35) {
  const start = await page.evaluate(() => window.__cr.runtime.simTime);
  await page.waitForFunction(({ start, seconds }) => window.__cr.runtime.simTime > start + seconds, { start, seconds });
}
async function camera(page, rear = false) {
  await page.evaluate(rear => {
    const c = window.__cr, p = c.runtime.pose;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading), rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
    const spec = c.vehicles[c.runtime.vehicleId], k = Math.max(.8, spec.length / 4.6), h = Math.max(1, spec.height / 1.3);
    const side = rear ? -1 : 1;
    c.debug.cam = { x: p.x + side * (fx * 5.5 + rx * 3.3) * k, y: (rear ? 1.45 : 1.1) * h,
      z: p.z + side * (fz * 5.5 + rz * 3.3) * k, tx: p.x, ty: .65 * h, tz: p.z };
    c.debug.extra.camera.fov = 43; c.debug.extra.camera.updateProjectionMatrix();
  }, rear);
  await frames(page);
}

try {
  const catalog = await boot();
  const cars = await catalog.evaluate(() => Object.values(window.__cr.vehicles)
    .filter(spec => spec.kind === 'car' && (spec.importedModel || spec.id === 'supercar') && !spec.npcOnly)
    .map(({ id, name }) => ({ id, name })));
  await catalog.close();
  const selected = process.env.CARS ? cars.filter(car => process.env.CARS.split(',').includes(car.id)) : cars;
  for (const { id, name } of selected) {
    if (!process.env.FORCE && await exists(join(output, `supercars/${id}-front.png`)) && await exists(join(output, `supercars/${id}-rear.png`))) continue;
    let page;
    try {
      page = await boot();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.evaluate(id => {
        const st = window.__cr.store.getState();
        st.commit({ ...st.save, ownedVehicleIds: ['bike_basic', id], equippedVehicleId: id, wallet: 12500,
          totalXP: 1200, mission: null, tutorial: { controlsSeen: true, firstRideDone: true, skipped: false }, revision: st.save.revision + 1 }, true);
        st.updateSettings({ quality: 'high', renderResolution: 'native', language: 'en', muted: true });
      }, id);
      await page.click('[data-testid=play]');
      await page.waitForFunction(id => {
        const c = window.__cr;
        return c.store.getState().appState === 'PLAYING' && c.runtime.vehicle?.spec.id === id &&
          (!c.vehicles[id].importedModel || c.debug.extra.scene.getObjectByName(`imported-vehicle-${id}`));
      }, id);
      // Stage a stationary photograph via the normal recovery action, without waiting for an entry cinematic.
      await page.evaluate(() => {
        const c = window.__cr, p = c.runtime.pose;
        c.runtime.requestRecovery({ x: p.x, z: p.z, heading: p.heading });
      });
      await page.waitForFunction(() => !window.__cr.runtime.pendingRecovery && window.__cr.vehicleEntry.mode === 'seated');
      await frames(page, 1);
      if (id === 'bmw_i8') {
        await shoot(page, 'gameplay/city-driving.png', 'BMW i8 in the city with the actual driving interface');
        await page.click('[data-testid=accept]');
        await page.waitForFunction(() => window.__cr.rides.stage === 'TO_PICKUP');
        await shoot(page, 'gameplay/passenger-gps.png', 'Accepted passenger job with GPS directions and road navigation');
        await page.evaluate(() => window.__cr.rides.cancel());
      }
      // Capture the real renderer with HUD removed; no image retouching or replacement models.
      await page.evaluate(() => {
        const canvas = window.__cr.debug.extra.gl.domElement;
        canvas.setAttribute('data-publishing-canvas', 'true');
      });
      const hidden = await page.addStyleTag({ content: '#root * { visibility: hidden !important; } #root canvas[data-publishing-canvas] { visibility: visible !important; }' });
      await page.waitForFunction(() => getComputedStyle(window.__cr.debug.extra.gl.domElement).visibility === 'visible');
      await camera(page);
      await shoot(page, `supercars/${id}-front.png`, `${name} — front three-quarter city view`, { vehicleId: id, vehicleName: name, view: 'front' });
      await camera(page, true);
      await shoot(page, `supercars/${id}-rear.png`, `${name} — rear three-quarter city view`, { vehicleId: id, vehicleName: name, view: 'rear' });
      if (id === 'bmw_i8') {
        await hidden.evaluate(element => element.remove());
        await page.evaluate(() => { window.__cr.debug.cam = null; window.__cr.store.getState().openOverlay('garage'); });
        await page.waitForSelector('[data-testid=vehicle-preview][data-model-state=ready]');
        await shoot(page, 'gameplay/garage.png', 'Actual garage, car collection and vehicle preview');
      }
      if (errors.length) throw new Error(errors.join('\n'));
    } catch (error) {
      failures.push({ id, error: error.message }); console.error(`Failed ${id}: ${error.message}`);
    } finally { await page?.close(); }
  }
  await writeFile(join(output, 'capture-report.json'), JSON.stringify({ cars, selected: selected.map(car => car.id), failures }, null, 2) + '\n');
} finally { await browser.close(); }
if (failures.length) throw new Error(`${failures.length} car captures failed; see capture-report.json`);
