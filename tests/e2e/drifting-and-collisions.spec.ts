import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import { boot, fixture, play } from './helpers';

test.use({ viewport: { width: 1100, height: 650 }, hasTouch: false });
test.setTimeout(240000);

test('desktop drifting keeps speed through countersteering, leaves ten-second tracks and preserves character size', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, { clear: true });
  await fixture(page, { owned: ['bmw_i8'], equipped: 'bmw_i8' });
  await page.evaluate(() => window.__cr.store.getState().updateSettings({ driver: 'cartethyia' }));
  await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
  await expect.poll(() => page.evaluate(() => (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')?.userData.character), { timeout: 60000 }).toBe('cartethyia');
  expect(await page.evaluate(() => (window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')!.scale.y)).toBeGreaterThan(.9);
  await expect(page.getByTestId('power-brake')).toContainText('Space'); // Shift also brakes; the badge names the main key
  expect(await page.getByTestId('heat').count()).toBe(0);
  expect(await page.getByTestId('red-hint').count()).toBe(0);
  await page.evaluate(() => {
    const c = window.__cr, seg = c.cityMap.SEGMENTS.find(s => s.dir === 'N' && s.length > 160)!;
    // Mid-segment: the drift's slide stays clear of the curb strip's parked cars.
    const [x, z] = c.cityMap.segmentPoint(seg, 90, c.cityMap.laneOffset(seg, 0));
    c.runtime.requestRecovery({ x, z, heading: Math.PI });
  });
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.pendingRecovery)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.grounded)).toBe(true);
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
  await page.evaluate(() => {
    const c = window.__cr, p = c.runtime.pose;
    c.runtime.vehicle!.body.setLinvel({ x: p.fx * 18, y: 0, z: p.fz * 18 }, true);
  });
  await page.keyboard.down('ShiftLeft');
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.drifting), { intervals: [50] }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.skidMarkCount), { intervals: [50] }).toBeGreaterThan(4);
  await page.keyboard.up('KeyD');
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.steerAngle), { intervals: [50] }).toBeLessThan(.1);
  expect(await page.evaluate(() => window.__cr.runtime.telemetry.drifting)).toBe(true);
  expect(await page.evaluate(() => window.__cr.runtime.telemetry.speedKmh)).toBeGreaterThan(10);
  await page.keyboard.up('KeyW');
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicle!.horizontalSpeed()), { intervals: [50] }).toBeLessThan(.05);
  await page.keyboard.up('ShiftLeft');
  const tracks = await page.evaluate(() => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof THREE;
    const mesh = (c.debug.extra.scene as THREE.Scene).getObjectByName('tire-skid-marks') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const born = mesh.geometry.getAttribute('born'), positions = mesh.geometry.getAttribute('position');
    const center = new T.Vector3(), vertex = new T.Vector3(); let count = 0, latest = 0;
    for (let i = 0; i < born.count; i++) if (born.getX(i) >= 0) { center.add(vertex.fromBufferAttribute(positions, i)); count++; latest = Math.max(latest, born.getX(i)); }
    center.divideScalar(count); c.debug.cam = { x: center.x + 9, y: 12, z: center.z + 9, tx: center.x, ty: 0, tz: center.z };
    return { segments: count / 6, latest, lifetime: mesh.material.uniforms.lifetime.value };
  });
  expect(tracks.segments).toBeGreaterThan(4); expect(tracks.lifetime).toBe(10);
  await page.screenshot({ path: 'test-results/desktop-tire-tracks.png' });
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.skidMarkCount), { timeout: 120000, intervals: [500] }).toBe(0);
  expect(await page.evaluate(() => window.__cr.runtime.simTime)).toBeGreaterThanOrEqual(tracks.latest + 9.99);
  await page.screenshot({ path: 'test-results/desktop-tire-tracks-expired.png' });
  await page.evaluate(() => { window.__cr.debug.cam = null; });
  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('outside');
  const start = await page.evaluate(() => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof THREE, driver = (c.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')!;
    const foot = driver.getObjectByName('avatar-footL')!.getWorldPosition(new T.Vector3());
    return { foot: foot.toArray(), x: c.vehicleEntry.outside.x, z: c.vehicleEntry.outside.z };
  });
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(({ x, z }) => Math.hypot(window.__cr.vehicleEntry.outside.x - x, window.__cr.vehicleEntry.outside.z - z), start)).toBeGreaterThan(.7);
  const stride = await page.evaluate(() => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof THREE, driver = (c.debug.extra.scene as THREE.Scene).getObjectByName('player-driver')!;
    const left = driver.getObjectByName('avatar-footL')!.getWorldPosition(new T.Vector3()), right = driver.getObjectByName('avatar-footR')!.getWorldPosition(new T.Vector3());
    const center = driver.getWorldPosition(new T.Vector3()); c.debug.cam = { x: center.x + 2.5, y: center.y + 1.4, z: center.z + 3, tx: center.x, ty: center.y + .85, tz: center.z };
    return { difference: left.distanceTo(right), scale: driver.scale.y };
  });
  expect(stride.difference).toBeGreaterThan(.18); expect(stride.scale).toBe(1);
  await page.screenshot({ path: 'test-results/cartethyia-walking-clear.png' });
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('a real head-on collision pushes an NPC backward and pauses its driving without a fine', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, { clear: true }); await fixture(page, { owned: ['bmw_i8'], equipped: 'bmw_i8', wallet: 1000 }); await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
  const collision = await page.evaluate(() => {
    const c = window.__cr, seg = c.cityMap.SEGMENTS.find(s => s.dir === 'N' && s.length > 160)!;
    const [fx, fz] = c.cityMap.DIR_VEC[seg.dir], [x, z] = c.cityMap.segmentPoint(seg, 60, c.cityMap.laneOffset(seg, 0));
    const npc = c.traffic.cars.find(car => !car.active)!;
    Object.assign(npc, { active: true, seg, lane: 0, s: 60, x, z, heading: Math.atan2(fx, fz), speed: 0, cruise: 0, model: 'car_compact', length: 3.8, halfWidth: .85, turn: null, next: null, impactTime: 0 });
    c.runtime.requestRecovery({ x: x + 8 * fx, z: z + 8 * fz, heading: Math.atan2(-fx, -fz) });
    return { id: npc.id, x, z, fx, fz, wallet: c.store.getState().save.wallet };
  });
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.pendingRecovery)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.grounded)).toBe(true);
  await page.evaluate(({ fx, fz }) => window.__cr.runtime.vehicle!.body.setLinvel({ x: -fx * 15, y: 0, z: -fz * 15 }, true), collision);
  await expect.poll(() => page.evaluate(id => window.__cr.traffic.cars[id].impactTime, collision.id), { intervals: [50] }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(({ id, x, z, fx, fz }) => {
    const npc = window.__cr.traffic.cars[id]; return (npc.x - x) * fx + (npc.z - z) * fz;
  }, collision), { intervals: [50] }).toBeLessThan(-.4);
  expect(await page.evaluate(id => window.__cr.traffic.cars[id].speed, collision.id)).toBe(0);
  expect(await page.evaluate(({ fx, fz }) => {
    const v = window.__cr.runtime.vehicle!.body.linvel(); return v.x * fx + v.z * fz;
  }, collision)).toBeLessThanOrEqual(.05);
  expect(await page.evaluate(() => window.__cr.store.getState().save.wallet)).toBe(collision.wallet);
  await page.screenshot({ path: 'test-results/npc-collision-response.png' });
  expect(errors).toEqual([]);
});

test('crashing into a roadside parked car moves its visible instance and leaves it in the new position', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, { clear: true }); await fixture(page, { owned: ['bmw_i8'], equipped: 'bmw_i8', wallet: 1000 }); await play(page);
  await expect.poll(() => page.evaluate(() => window.__cr.vehicleEntry.mode), { timeout: 60000 }).toBe('seated');
  await expect.poll(() => page.evaluate(() => ((window.__cr.debug.extra.scene as THREE.Scene).getObjectByName('parked-car_compact') as THREE.InstancedMesh)?.count ?? 0)).toBeGreaterThan(0);
  const collision = await page.evaluate(() => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof THREE;
    const mesh = (c.debug.extra.scene as THREE.Scene).getObjectByName('parked-car_compact') as THREE.InstancedMesh;
    const matrix = new T.Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const x = matrix.elements[12], z = matrix.elements[14], fx = matrix.elements[8], fz = matrix.elements[10];
      // Choose a mid-segment curb-strip car with room to approach from behind.
      const seg = c.cityMap.SEGMENTS.find(s => {
        const [dx, dz] = c.cityMap.DIR_VEC[s.dir], along = (x - s.sx) * dx + (z - s.sz) * dz;
        return dx * fx + dz * fz > .99 && along > 30 && along < s.length - 30 && Math.abs((x - s.sx) * dz - (z - s.sz) * dx) < 22;
      });
      if (!seg) continue;
      c.runtime.requestRecovery({ x: x - fx * 8, z: z - fz * 8, heading: Math.atan2(fx, fz) });
      return { id: mesh.userData.vehicleIds[i] as number, x, z, fx, fz, wallet: c.store.getState().save.wallet };
    }
    throw new Error('No roadside parked car with a clear approach was visible');
  });
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.pendingRecovery)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.telemetry.grounded)).toBe(true);
  await page.evaluate(({ fx, fz }) => window.__cr.runtime.vehicle!.body.setLinvel({ x: fx * 15, y: 0, z: fz * 15 }, true), collision);
  const displacement = () => page.evaluate(({ id, x, z, fx, fz }) => {
    const c = window.__cr, T = c.debug.extra.THREE as typeof THREE;
    const mesh = (c.debug.extra.scene as THREE.Scene).getObjectByName('parked-car_compact') as THREE.InstancedMesh;
    const index = (mesh.userData.vehicleIds as number[]).indexOf(id);
    if (index < 0) throw new Error('The crashed parked car disappeared');
    const matrix = new T.Matrix4(); mesh.getMatrixAt(index, matrix);
    return (matrix.elements[12] - x) * fx + (matrix.elements[14] - z) * fz;
  }, collision);
  await expect.poll(displacement, { intervals: [50] }).toBeGreaterThan(.4);
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.vehicle!.horizontalSpeed()), { timeout: 30000 }).toBeLessThan(.1);
  // The struck car coasts after the player's brakes have stopped the player.
  const coastStart = await page.evaluate(() => window.__cr.runtime.simTime);
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.simTime), { timeout: 60000 }).toBeGreaterThan(coastStart + 3);
  const settled = await displacement();
  const start = await page.evaluate(() => window.__cr.runtime.simTime);
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.simTime), { timeout: 60000 }).toBeGreaterThan(start + 3);
  expect(await displacement()).toBeCloseTo(settled, 1);
  expect(await page.evaluate(() => window.__cr.store.getState().save.wallet)).toBe(collision.wallet);
  await page.screenshot({ path: 'test-results/parked-car-collision-response.png' });
  expect(errors).toEqual([]);
});
