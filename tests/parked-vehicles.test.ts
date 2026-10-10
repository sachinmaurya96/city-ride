import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, expect, it } from 'vitest';
import { VEHICLES } from '../src/game/data/vehicles';
import { buildCity, type ParkedVehicle } from '../src/game/world/cityBuilder';
import { ParkedVehiclePhysics } from '../src/game/world/parkedVehiclePhysics';
import { PLAYER_GROUPS, STATIC_GROUPS } from '../src/game/world/collisionGroups';

beforeAll(async () => { await RAPIER.init(); });
const parked: ParkedVehicle = { model: 'car_compact', x: 0, z: 0, heading: 0, color: '#ffffff' };

it.each(['car_compact', 'auto_city', 'bus_small', 'bus_long'] as const)('%s stays parked and uses its own dimensions and mass', model => {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const physics = new ParkedVehiclePhysics(world, RAPIER, [{ ...parked, model }]);
  const body = physics.states[0].body, spec = VEHICLES[model];
  expect(body.isDynamic()).toBe(true);
  expect(body.mass()).toBeCloseTo(spec.mass, 1);
  expect(body.collider(0).halfExtents()).toEqual({ x: expect.closeTo(spec.width / 2), y: expect.closeTo(spec.height / 2), z: expect.closeTo(spec.length / 2) });
  for (let i = 0; i < 180; i++) world.step();
  expect(body.isSleeping()).toBe(true);
  expect(physics.sync()).toBe(false);
  expect(body.translation()).toEqual({ x: 0, y: 0, z: 0 });
  physics.dispose(); expect(world.bodies.len()).toBe(0); expect(world.colliders.len()).toBe(0);
  physics.dispose(); world.free();
});

it.each([
  ['rear', 0, -1, 0], ['front', 0, 1, 0], ['side', -1, 0, .7],
] as const)('%s crashes wake and push parked cars, then settle without snapping back', (_name, dx, dz, offset) => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const source = { ...parked };
  const physics = new ParkedVehiclePhysics(world, RAPIER, [source]);
  const player = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(dx * 6, 0, dz * 6 + offset)
    .enabledTranslations(true, false, true).enabledRotations(false, true, false).setCcdEnabled(true).setLinearDamping(1.5));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.85, .7, 1.9).setTranslation(0, .7, 0).setMass(1400).setCollisionGroups(PLAYER_GROUPS), player);
  player.setLinvel({ x: -dx * 15, y: 0, z: -dz * 15 }, true);
  let visualMoved = false, maxJump = 0;
  const state = physics.states[0];
  for (let i = 0; i < 180; i++) {
    const { x, z } = state.pose;
    world.step();
    const moved = physics.sync(); visualMoved ||= moved;
    maxJump = Math.max(maxJump, Math.hypot(state.pose.x - x, state.pose.z - z));
  }
  expect(visualMoved).toBe(true);
  expect(state.pose.x * -dx + state.pose.z * -dz).toBeGreaterThan(.4);
  expect(maxJump).toBeLessThan(.4);
  expect(state.body.translation().y).toBe(0);
  if (offset) expect(Math.abs(state.pose.heading)).toBeGreaterThan(.01);
  expect(source).toEqual(parked);
  const settled = { ...state.pose };
  for (let i = 0; i < 300; i++) { world.step(); physics.sync(); }
  expect(state.pose.x).toBeCloseTo(settled.x, 1); expect(state.pose.z).toBeCloseTo(settled.z, 1);
  expect(state.body.isSleeping()).toBe(true);
  physics.dispose(); world.free();
});

it('generated roadside vehicles have no leftover fixed boxes and stay still before a crash', () => {
  const city = buildCity();
  expect(city.parked.length).toBeGreaterThan(30);
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const box of city.staticBoxes) {
    expect(city.parked.some(p => Math.hypot(p.x - box.x, p.z - box.z) < .01)).toBe(false);
    world.createCollider(RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
      .setTranslation(box.x, box.y, box.z)
      .setRotation({ x: 0, y: Math.sin(box.ry / 2), z: 0, w: Math.cos(box.ry / 2) }).setCollisionGroups(STATIC_GROUPS), fixed);
  }
  const physics = new ParkedVehiclePhysics(world, RAPIER, city.parked);
  for (let i = 0; i < 120; i++) world.step();
  physics.sync();
  for (const [id, { body, pose }] of physics.states.entries()) {
    expect(body.isSleeping(), `parked vehicle ${id}`).toBe(true);
    expect(pose.x).toBeCloseTo(city.parked[id].x, 3); expect(pose.z).toBeCloseTo(city.parked[id].z, 3);
  }
  physics.dispose(); world.free();
});
