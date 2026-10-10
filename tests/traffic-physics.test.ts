import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, expect, it } from 'vitest';
import { TrafficPhysics } from '../src/game/traffic/trafficPhysics';
import { TrafficSystem } from '../src/game/traffic/traffic';
import { SEGMENTS, DIR_VEC, laneOffset, segmentPoint, INTERSECTIONS } from '../src/game/data/cityMap';
import { lightFor } from '../src/game/traffic/signals';
import { PLAYER_GROUPS } from '../src/game/world/collisionGroups';
import { runtime } from '../src/game/core/runtime';

beforeAll(async () => { await RAPIER.init(); });
it.each([['head-on', 1], ['rear', -1]] as const)('%s hits transfer momentum in the impact direction, pause NPC AI and settle without snapping back', (_name, side) => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), traffic = new TrafficSystem(); traffic.target = 0;
  const c = traffic.cars[0], seg = SEGMENTS.find(s => s.dir === 'N' && s.length > 100)!;
  const [fx, fz] = DIR_VEC[seg.dir], [x, z] = segmentPoint(seg, 50, laneOffset(seg, 0));
  Object.assign(c, { active: true, seg, lane: 0, s: 50, x, z, heading: Math.atan2(fx, fz), speed: 0, cruise: 0, model: 'car_compact', length: 3.8, halfWidth: .85 });
  runtime.pose = { x: x + side * 6 * fx, y: .5, z: z + side * 6 * fz, heading: 0, fx: -side * fx, fz: -side * fz };
  const physics = new TrafficPhysics(world, RAPIER, traffic); physics.step(1 / 60);
  const player = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x + side * 6 * fx, 0, z + side * 6 * fz).enabledTranslations(true, false, true).enabledRotations(false, true, false).setCcdEnabled(true));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.85, .7, 1.9).setTranslation(0, .7, 0).setMass(1400).setCollisionGroups(PLAYER_GROUPS), player);
  player.setLinvel({ x: -side * fx * 15, y: 0, z: -side * fz * 15 }, true);
  let crashed = false, greatestMove = 0, previousX = c.x, previousZ = c.z;
  for (let i = 0; i < 110; i++) {
    world.step(); physics.step(1 / 60);
    crashed ||= c.impactTime > 0;
    greatestMove = Math.max(greatestMove, Math.hypot(c.x - previousX, c.z - previousZ)); previousX = c.x; previousZ = c.z;
  }
  expect(crashed).toBe(true); expect(((c.x - x) * fx + (c.z - z) * fz) * side).toBeLessThan(-.4);
  expect(greatestMove).toBeLessThan(.4); expect(c.speed).toBe(0);
  const npc = physics.states.get(c.id)!.body;
  expect(Math.hypot(npc.linvel().x, npc.linvel().z)).toBeLessThan(.4);
  physics.dispose(); world.free();
});

it('NPC brakes before a parked player and never automatically rams their car', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), traffic = new TrafficSystem(); traffic.target = 0;
  const c = traffic.cars[0], seg = SEGMENTS.find(s => s.dir === 'N' && s.length > 150)!;
  const [fx, fz] = DIR_VEC[seg.dir], [x, z] = segmentPoint(seg, 60, laneOffset(seg, 0));
  Object.assign(c, { active: true, seg, lane: 0, s: 60, x, z, heading: Math.atan2(fx, fz), speed: 10, cruise: 10, model: 'car_compact', length: 3.8, halfWidth: .85 });
  runtime.pose = { x: x + fx * 32, y: .5, z: z + fz * 32, heading: c.heading, fx, fz };
  runtime.vehicleId = 'car_compact';
  const physics = new TrafficPhysics(world, RAPIER, traffic);
  const player = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(runtime.pose.x, 0, runtime.pose.z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(.85, .7, 1.9).setTranslation(0, .7, 0).setCollisionGroups(PLAYER_GROUPS), player);
  for (let i = 0; i < 600; i++) { physics.step(1 / 60); world.step(); expect(c.impactTime, JSON.stringify({i,x:c.x,z:c.z,speed:c.speed,player:runtime.pose,body:physics.states.get(0)!.body.linvel()})).toBe(0); }
  expect((runtime.pose.x - c.x) * fx + (runtime.pose.z - c.z) * fz).toBeGreaterThan(5);
  expect(c.speed).toBeLessThan(.3); physics.dispose(); world.free();
});

it.each([false, true])('dynamic NPC bodies (police=%s) keep their front bumper behind a red stop line', police => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), traffic = new TrafficSystem(); traffic.target = 0;
  const c = traffic.cars[0], seg = SEGMENTS.find(s => s.dir === 'N' && s.length > 150 && INTERSECTIONS.find(j => j.id === s.to)!.signal)!;
  const junction = INTERSECTIONS.find(j => j.id === seg.to)!;
  runtime.simTime = Array.from({ length: 56 }, (_, i) => i).find(time => lightFor(junction, seg.dir, time) === 'R')!;
  const [fx, fz] = DIR_VEC[seg.dir], s = seg.length - 28, [x, z] = segmentPoint(seg, s, laneOffset(seg, 0));
  Object.assign(c, { active: true, seg, lane: 0, s, x, z, heading: Math.atan2(fx, fz), speed: 9, cruise: 10, model: 'car_compact', length: 3.8, halfWidth: .85, police, chase: police ? { x, z: z - 40 } : null });
  runtime.pose = { x: x + fz * 20, y: .5, z: z - fx * 20, heading: 0, fx: 0, fz: 1 };
  const physics = new TrafficPhysics(world, RAPIER, traffic);
  for (let i = 0; i < 600; i++) {
    physics.step(1 / 60); world.step();
    const body = physics.states.get(c.id)!.body.translation();
    expect((body.x - seg.sx) * fx + (body.z - seg.sz) * fz + c.length / 2).toBeLessThan(seg.length - .8);
    expect(c.impactTime).toBe(0);
  }
  expect(c.speed).toBeLessThan(.3); expect(c.atSignal).toBe(true); physics.dispose(); world.free();
});

it('ambient NPC traffic stays below road limits and does not spontaneously crash during normal driving', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), traffic = new TrafficSystem(); traffic.target = 14;
  runtime.vehicleId = 'car_compact'; runtime.pose = { x: 240, y: .5, z: 240, heading: 0, fx: 0, fz: 1 };
  runtime.cameraPose = { x: 240, z: 240, fx: 0, fz: 1 };
  const physics = new TrafficPhysics(world, RAPIER, traffic); let moving = 0;
  for (let i = 0; i < 7200; i++) {
    runtime.simTime = i / 60; physics.step(1 / 60); world.step();
    for (const c of traffic.cars.filter(c => c.active)) {
      expect(c.impactTime, `car ${c.id} at ${runtime.simTime.toFixed(2)}s`).toBe(0);
      expect(Math.hypot(physics.states.get(c.id)!.body.linvel().x, physics.states.get(c.id)!.body.linvel().z), JSON.stringify({time:runtime.simTime, id:c.id,model:c.model,seg:c.seg.id,s:c.s,turn:!!c.turn,x:c.x,z:c.z,heading:c.heading,neighbors:traffic.cars.filter(o=>o.active&&o!==c&&Math.hypot(o.x-c.x,o.z-c.z)<18).map(o=>({id:o.id,model:o.model,x:o.x,z:o.z,heading:o.heading,speed:o.speed,seg:o.seg.id,turn:!!o.turn}))})).toBeLessThanOrEqual(c.seg.limitKmh / 3.6 + .4);
      moving += c.speed > 2 ? 1 : 0;
    }
  }
  expect(moving).toBeGreaterThan(1000); physics.dispose(); world.free();
});
