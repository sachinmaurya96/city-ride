import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, expect, it } from 'vitest';
import { TrafficPhysics } from '../src/game/traffic/trafficPhysics';
import { TrafficSystem } from '../src/game/traffic/traffic';
import { SEGMENTS, DIR_VEC, laneOffset, segmentPoint } from '../src/game/data/cityMap';
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
