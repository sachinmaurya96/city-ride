import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, expect, it } from 'vitest';
import { VEHICLES, VEHICLE_ORDER, type VehicleId } from '../src/game/data/vehicles';
import { deriveHandling } from '../src/game/vehicles/handling';
import { RaycastVehicle, type DriveInput } from '../src/game/vehicles/vehicleController';
import { chassisCollider } from '../src/game/vehicles/chassis';
import { GROUND_GROUPS, PLAYER_GROUPS } from '../src/game/world/collisionGroups';
const dt = 1 / 60;
beforeAll(async () => { await RAPIER.init(); });
function setup(id: VehicleId, damped = true) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = dt;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(20000,.5,20000).setTranslation(0,-.5,0).setCollisionGroups(GROUND_GROUPS),ground);
  const spec = VEHICLES[id], c = chassisCollider(spec);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,RaycastVehicle.restHeight(spec)+.2,0).enabledRotations(false,true,false).setCanSleep(false).setCcdEnabled(true).setLinearDamping(damped ? .05 : 0).setAngularDamping(damped ? .6 : 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(...c.halfExtents).setTranslation(0,c.offsetY,0).setMass(c.mass).setFriction(c.friction).setCollisionGroups(PLAYER_GROUPS),body);
  const vehicle = new RaycastVehicle(RAPIER,body,world,spec,deriveHandling(spec));
  const step = (input: DriveInput, seconds: number) => { vehicle.setInput(input); for (let i=0;i<Math.round(seconds/dt);i++) {vehicle.beforePhysicsStep(dt);world.step();vehicle.afterPhysicsStep();} };
  return {world,body,spec,vehicle,step};
}
const idle = {steer:0,throttle:0,brake:0,handbrake:false};
const creep = {...idle,throttle:1,speedLimit:20/3.6};
function measures(t: ReturnType<typeof setup>) {
  const q=t.body.rotation(), v=t.body.linvel(), yaw=Math.atan2(2*q.y*q.w,1-2*q.y*q.y), speed=t.vehicle.horizontalSpeed(), forward=t.vehicle.forwardSpeed(), side=v.x*Math.cos(yaw)-v.z*Math.sin(yaw);
  const rate=t.body.angvel().y;
  const tireSide=t.spec.wheels.physics.map((wheel,i)=>{const angle=t.vehicle.controller.wheelSteering(i)??0;return +((side+rate*wheel.z)*Math.cos(angle)-(forward-rate*wheel.x)*Math.sin(angle)).toFixed(3);});
  return {v:+speed.toFixed(3),forward:+forward.toFixed(3),side:+side.toFixed(3),slip:+(Math.atan2(side,forward)*180/Math.PI).toFixed(2),yaw:+yaw.toFixed(3),yawRate:+rate.toFixed(3),tireSide, angle:t.vehicle.controller.wheelSteering(0), height:+t.body.translation().y.toFixed(3),ground:t.spec.wheels.physics.map((_,i)=>t.vehicle.controller.wheelIsInContact(i)),forces:t.spec.wheels.physics.map((_,i)=>+(t.vehicle.controller.wheelSuspensionForce(i)??0).toFixed(0))};
}
it.each(VEHICLE_ORDER.filter(id => VEHICLES[id].kind === 'car'))('%s holds the road in full-lock turns at city speeds', (id) => {
  for (const cap of [10, 20, 30, 40]) {
    const t = setup(id); t.step(idle, 1); const input = { ...creep, speedLimit: cap / 3.6 }; t.step(input, 3);
    let lateralG = 0, scrub = 0;
    for (let i = 0; i < 20; i++) {
      t.step({ ...input, steer: 1 }, .1);
      const m = measures(t);
      lateralG = Math.max(lateralG, Math.abs(m.yawRate * m.v) / 9.81);
      scrub = Math.max(scrub, ...m.tireSide.map(Math.abs));
    }
    // The steering cap keeps full lock near 1.2 g; well beyond that the front scrubs wide and the car leaves the lane.
    expect(lateralG, `${id} at ${cap} km/h`).toBeLessThan(1.25);
    expect(scrub, `${id} at ${cap} km/h`).toBeLessThan(1);
    t.world.free();
  }
});

it.each(['mercedes_maybach', 'bmw_i8', 'porsche_718', 'black_huracan'] as const)('%s keeps a tight turn at walking pace and straightens after a drift', (id) => {
  const t = setup(id); t.step(idle, 1); t.step({ ...creep, speedLimit: 10 / 3.6 }, 3); t.step({ ...creep, speedLimit: 10 / 3.6, steer: 1 }, 2);
  const slow = measures(t);
  expect(slow.v / Math.abs(slow.yawRate)).toBeLessThan(7);
  t.world.free();
  const d = setup(id); d.step(idle, 1); d.step({ ...creep, speedLimit: 30 / 3.6 }, 2);
  d.step({ ...creep, speedLimit: 30 / 3.6, steer: 1, powerBrake: true }, .6);
  expect(Math.abs(measures(d).yawRate)).toBeGreaterThan(1.4);
  d.step({ ...creep, speedLimit: 30 / 3.6 }, 1);
  expect(Math.abs(measures(d).slip)).toBeLessThan(.5);
  d.world.free();
});

it.each(['bmw_i8', 'car_compact', 'mercedes_maybach', 'bike_basic'] as const)('%s still turns sharply at highway speed without sliding', (id) => {
  const t = setup(id); t.step(idle, 1); const input = { ...creep, speedLimit: 100 / 3.6 }; t.step(input, 10);
  let yawRate = 0, scrub = 0;
  for (let i = 0; i < 15; i++) {
    t.step({ ...input, steer: 1 }, .1);
    const m = measures(t);
    yawRate = Math.max(yawRate, Math.abs(m.yawRate));
    scrub = Math.max(scrub, ...m.tireSide.map(Math.abs));
  }
  // ~22 m radius at ~90 km/h; a plain 1.2 g cap gave ~54 m, the uncapped original slid at 2–4 m/s.
  expect(measures(t).v / yawRate).toBeLessThan(30);
  expect(scrub).toBeLessThan(1);
  t.world.free();
});

it.each(['mercedes_maybach', 'rolls_ghost', 'bmw_i8', 'mclaren_p1'] as const)('%s carves at top speed instead of sliding off the road', (id) => {
  const t = setup(id); t.step(idle, 1); const input = { ...idle, throttle: 1 }; t.step(input, 30);
  expect(t.vehicle.horizontalSpeed() * 3.6).toBeGreaterThan(190);
  let yawRate = 0, scrub = 0;
  for (let i = 0; i < 20; i++) {
    t.step({ ...input, steer: 1 }, .1);
    const m = measures(t);
    yawRate = Math.max(yawRate, Math.abs(m.yawRate));
    scrub = Math.max(scrub, ...m.tireSide.map(Math.abs));
  }
  // Without the ceiling the Maybach's front tyres slid ~3 m/s sideways here.
  expect(scrub).toBeLessThan(.8);
  expect(yawRate).toBeGreaterThan(.25);
  t.world.free();
});
