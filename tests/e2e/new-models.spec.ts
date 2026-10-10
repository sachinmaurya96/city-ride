import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { boot, fixture, play, waitStage } from './helpers';

test.setTimeout(240000);
test.use({ viewport: { width: 800, height: 500 } });
async function state(page: Page) {
  return page.evaluate(() => {
    const c = window.__cr; const scene = c.debug.extra.scene as THREE.Scene;
    const driver = scene.getObjectByName('player-driver'); const passenger = scene.getObjectByName('ride-passenger-lead');
    const car = scene.getObjectByName(`imported-vehicle-${c.runtime.vehicleId}`);
    return { entry: c.vehicleEntry.progress, locked: c.vehicleEntry.active, speed: c.runtime.telemetry.speedKmh,
      driver: driver?.userData.character, passenger: passenger?.userData.character, passengerVisible: passenger?.visible,
      passengerPhase: passenger?.userData.phase, inside: passenger?.userData.inside,
      doors: [1, -1].map((side) => car?.getObjectByName(`vehicle-door-${side}`)?.userData.open ?? 0),
      recording: c.audio.recorded?.status, profile: c.audio.recorded?.profile, rpm: c.audio.recorded?.rpm,
      doorColliders: c.runtime.vehicle?.body.numColliders(), traffic: c.traffic.cars.filter((car) => car.active && car.model.startsWith('pack_')).length,
    };
  });
}

test('all new vehicles load with original materials and usable wheel/door parts', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, { clear: true });
  const results = await page.evaluate(async () => {
    const { vehicles: VEHICLES, loadImportedModel } = window.__cr;
    const results: { id: string; npc: boolean; bike: boolean; doors: number[]; wheels: number[]; triangles: number; textures: number; dimensions: number[] }[] = [];
    for (const spec of Object.values(VEHICLES)) {
      if (!spec.importedModel) continue;
      const root = await loadImportedModel(spec) as THREE.Group;
      let triangles = 0, textures = 0;
      root.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { triangles += mesh.geometry.getAttribute('position').count / 3; if ((mesh.material as THREE.MeshStandardMaterial).map) textures++; } });
      results.push({ id: spec.id, npc: !!spec.npcOnly, bike: spec.kind === 'bike', triangles, textures, dimensions: root.userData.dimensions,
        doors: [1, -1].map((side) => root.getObjectByName(`vehicle-door-${side}`)?.children.length ?? 0),
        wheels: spec.wheels.visual.map((_, i) => root.getObjectByName(`imported-wheel-spin-${i}`)!.children.length) });
    }
    return results;
  });
  // 31 cars (13 in the garage, 18 traffic-only) and the two imported superbikes.
  expect(results).toHaveLength(33);
  for (const car of results) {
    expect(car.triangles, car.id).toBeGreaterThan(100);
    if (car.bike) expect(car.wheels).toHaveLength(2);
    if (!car.npc && !car.bike) {
      expect(car.doors.every((n) => n > 0), car.id).toBe(true);
      expect(car.wheels.every((n) => n > 0), car.id).toBe(true);
    }
    expect(car.dimensions.every((n) => Number.isFinite(n) && n > .5 && n < 12), car.id).toBe(true);
  }
  await test.info().attach('all-models.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  for (const id of ['lambo_lp670', 'black_huracan', 'mclaren_p1', 'mustang_rtr', 'rolls_spectre']) {
    await page.evaluate(() => window.__cr.store.getState().openOverlay('garage'));
    await page.getByTestId(`vcard-${id}`).click();
    await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready');
    await page.locator('.preview').screenshot({ path: `test-results/${id}-preview.png` });
    await page.getByTestId('garage-close').click();
  }
  expect(errors).toEqual([]);
});

test('native characters open doors before entry, sit, exit, preserve their appearance and use recorded engines', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bike_basic', 'supra_a80'] });
  await page.getByTestId('menu-settings').click();
  await page.getByTestId('driver-lynae').click();
  await page.getByTestId('passenger-character').selectOption('cartethyia');
  await page.getByTestId('settings').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('menu-garage').click(); await page.getByTestId('vcard-supra_a80').click();
  await expect(page.getByTestId('vehicle-preview')).toHaveAttribute('data-model-state', 'ready', { timeout: 60000 });
  await page.getByTestId('try-car').click(); await play(page);
  await expect.poll(() => state(page)).toMatchObject({ driver: 'lynae', locked: true });
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await state(page)).doors[1], { intervals: [100] }).toBeGreaterThan(.3);
  expect((await state(page)).speed).toBeLessThan(1);
  expect((await state(page)).doorColliders).toBe(3);
  await page.screenshot({ path: 'test-results/lynae-driver-entry.png' });
  await expect.poll(() => state(page), { timeout: 30000 }).toMatchObject({ locked: false, doors: [0, 0], profile: 'inline6', recording: 'ready' });
  await expect.poll(() => state(page)).toMatchObject({ driver: 'lynae' });
  await expect.poll(async () => (await state(page)).speed).toBeGreaterThan(5); await page.keyboard.up('KeyW');
  await page.evaluate(() => window.__cr.input.reset());
  // Use fixed stops so this animation test does not depend on random offer sampling/expiry.
  await page.evaluate(() => {
    const c = window.__cr;
    c.rides.restore({ id: 'character-door-fixture', kind: 'ride', seed: 12, state: 'TO_PICKUP', vehicleId: 'supra_a80',
      passengerName: 'Diya', avatar: 1, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
      quote: c.quoteRide({ vehicleId: 'supra_a80', routeMeters: 250, rideType: 'standard', rain: false, estSeconds: 45 }),
      elapsed: 0, satisfaction: 100, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: c.runtime.lastSafePose, bus: null });
    c.rides.checkpoint(true);
  });
  await expect.poll(() => state(page), { timeout: 60000 }).toMatchObject({ passenger: 'cartethyia', passengerPhase: 'waiting', passengerVisible: true });
  await page.evaluate(() => { const c = window.__cr; const bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.pickupBayId)!; c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading }); });
  await waitStage(page, ['BOARDING']);
  await expect.poll(async () => (await state(page)).doors[0], { intervals: [100] }).toBeGreaterThan(.5);
  expect((await state(page)).inside).toBeLessThan(.15);
  const passengerCamera = await page.evaluate(() => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof THREE, scene = c.debug.extra.scene as THREE.Scene, camera = c.debug.extra.camera as THREE.Camera;
    const passenger = scene.getObjectByName('ride-passenger-lead')!;
    const chest = passenger.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 1.2, 0));
    const projected = chest.clone().project(camera);
    const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(projected.x, projected.y), camera);
    const hit = ray.intersectObjects(scene.children, true).find((hit) => { let node: THREE.Object3D | null = hit.object; while (node) { if (!node.visible) return false; node = node.parent; } return true; });
    let node = hit?.object as THREE.Object3D | null | undefined;
    while (node && node !== passenger) node = node.parent;
    return { inFrame: Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z < 1, unobstructed: node === passenger, camera: camera.position.toArray(), projected: projected.toArray() };
  });
  await test.info().attach('passenger-camera.json', { contentType: 'application/json', body: JSON.stringify(passengerCamera, null, 2) });
  expect(passengerCamera).toMatchObject({ inFrame: true, unobstructed: true });
  await page.screenshot({ path: 'test-results/cartethyia-opening-door.png' });
  await expect.poll(async () => (await state(page)).inside, { intervals: [100] }).toBeGreaterThan(.4);
  expect((await state(page)).doors[0]).toBeGreaterThan(.8);
  expect((await state(page)).passengerVisible).toBe(true);
  await page.screenshot({ path: 'test-results/cartethyia-entering.png' });
  await waitStage(page, ['TO_DROPOFF']);
  await expect.poll(() => state(page)).toMatchObject({ inside: 1, doors: [0, 0], passengerPhase: 'seated', passenger: 'cartethyia' });
  await page.evaluate(() => { const c = window.__cr; const bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.dropBayId)!; c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading }); });
  await waitStage(page, ['ALIGHTING']);
  await expect.poll(async () => (await state(page)).doors[0], { intervals: [100] }).toBeGreaterThan(.7);
  await expect.poll(async () => (await state(page)).inside, { intervals: [100] }).toBeLessThan(.3);
  await page.screenshot({ path: 'test-results/cartethyia-exiting.png' });
  await waitStage(page, ['COMPLETED']);
  expect((await state(page)).passenger).toBe('cartethyia'); expect((await state(page)).passengerVisible).toBe(true);
  await page.reload(); await page.getByTestId('play').waitFor({ timeout: 90000 });
  await page.waitForFunction(() => !!window.__cr?.store);
  expect(await page.evaluate(() => window.__cr.store.getState().save.settings.driver)).toBe('lynae');
  expect(errors).toEqual([]);
});
