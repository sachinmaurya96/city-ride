import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import { boot, fixture, play, waitStage } from './helpers';

test.setTimeout(240000);
test.use({ viewport: { width: 800, height: 500 } });

async function headroom(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof THREE;
    const scene = c.debug.extra.scene as THREE.Scene;
    const driver = scene.getObjectByName('player-driver')!;
    const actor = scene.getObjectByName(name)!;
    const model = await c.loadImportedModel(c.vehicles.mclaren_p1) as THREE.Group;
    driver.parent!.updateWorldMatrix(true, true);
    actor.updateWorldMatrix(true, true);
    const inverse = driver.parent!.matrixWorld.clone().invert();
    const vertex = new T.Vector3(), samples = new Map<string, THREE.Vector3>();
    actor.traverse(o => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) mesh.skeleton.update();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        if (vertex.y < .85) continue;
        const key = `${Math.round(vertex.x / .04)}:${Math.round(vertex.z / .04)}`;
        if (!samples.has(key) || vertex.y > samples.get(key)!.y) samples.set(key, vertex.clone());
      }
    });
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
    let clearance = Infinity;
    for (const point of samples.values()) {
      ray.ray.origin.set(point.x, 3, point.z);
      const roof = ray.intersectObject(model, true)[0];
      clearance = Math.min(clearance, roof ? roof.point.y - point.y : -Infinity);
    }
    const camera = driver.parent!.localToWorld(new T.Vector3(3.5, 1.6, 4));
    const target = driver.parent!.localToWorld(new T.Vector3(0, .8, 0));
    c.debug.cam = { x: camera.x, y: camera.y, z: camera.z, tx: target.x, ty: target.y, tz: target.z };
    return { character: actor.userData.character, samples: samples.size, clearance, scale: actor.scale.y };
  }, name);
}

test('McLaren keeps all drivers and the boarded passenger beneath its actual roof', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await boot(page, { clear: true });
  await fixture(page, { owned: ['mclaren_p1'], equipped: 'mclaren_p1' });
  await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
  for (const id of ['male', 'female', 'lynae', 'cartethyia', 'carlotta', 'chisa', 'zani', 'shorekeeper', 'mint', 'phoebe'] as const) {
    await page.evaluate(id => window.__cr.store.getState().updateSettings({ driver: id }), id);
    await expect.poll(() => page.evaluate(() => {
      const scene = window.__cr.debug.extra.scene as THREE.Scene;
      const driver = scene.getObjectByName('player-driver');
      return { character: driver?.userData.character, mode: driver?.userData.mode };
    }), { timeout: 60000 }).toEqual({ character: id, mode: 'seated' });
    const fit = await headroom(page, 'player-driver');
    expect(fit.samples).toBeGreaterThan(10);
    expect(fit.clearance).toBeGreaterThan(.015);
    expect(fit.scale).toBeGreaterThan(.75);
    await page.screenshot({ path: `test-results/mclaren-${id}-seated.png` });
  }
  await page.evaluate(() => {
    const c = window.__cr;
    c.store.getState().updateSettings({ passengerCharacter: 'cartethyia' });
    c.rides.restore({ id: 'mclaren-cabin-fixture', kind: 'ride', seed: 12, state: 'TO_PICKUP', vehicleId: 'mclaren_p1',
      passengerName: 'Diya', avatar: 1, partySize: 1, rideType: 'standard', pickupBayId: 'homes_west_bay2', dropBayId: 'central_park_bay1',
      quote: c.quoteRide({ vehicleId: 'mclaren_p1', routeMeters: 250, rideType: 'standard', rain: false, estSeconds: 45 }),
      elapsed: 0, satisfaction: 100, finesPaid: 0, incidents: 0, recovered: false, harshEvents: 0, safePose: null, bus: null });
    const bay = c.cityMap.BAY_BY_ID.get(c.rides.mission!.pickupBayId)!;
    c.runtime.requestRecovery({ x: bay.x, z: bay.z, heading: bay.heading });
  });
  await waitStage(page, ['TO_DROPOFF'], 90000);
  await expect.poll(() => page.evaluate(() => {
    const scene = window.__cr.debug.extra.scene as THREE.Scene;
    return scene.getObjectByName('ride-passenger-lead')?.userData.phase;
  })).toBe('seated');
  const fit = await headroom(page, 'ride-passenger-lead');
  expect(fit.character).toBe('cartethyia');
  expect(fit.samples).toBeGreaterThan(10);
  expect(fit.clearance).toBeGreaterThan(.015);
  expect(fit.scale).toBeGreaterThan(.75);
  await page.screenshot({ path: 'test-results/mclaren-driver-and-passenger.png' });
  expect(errors).toEqual([]);
});
