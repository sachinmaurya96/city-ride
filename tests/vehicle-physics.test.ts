import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { VEHICLES, VEHICLE_ORDER, type VehicleId } from '../src/game/data/vehicles';
import { deriveHandling } from '../src/game/vehicles/handling';
import { RaycastVehicle, type DriveInput } from '../src/game/vehicles/vehicleController';
import { chassisCollider } from '../src/game/vehicles/chassis';
import { GROUND_GROUPS, PLAYER_GROUPS } from '../src/game/world/collisionGroups';

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
});

function setup(id: VehicleId) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setCollisionGroups(GROUND_GROUPS), ground);
  const spec = VEHICLES[id];
  const c = chassisCollider(spec);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, RaycastVehicle.restHeight(spec) + 0.2, 0)
      .enabledRotations(false, true, false)
      .setCanSleep(false)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(...c.halfExtents).setTranslation(0, c.offsetY, 0).setMass(c.mass).setFriction(c.friction).setCollisionGroups(PLAYER_GROUPS),
    body,
  );
  const vehicle = new RaycastVehicle(RAPIER, body, world, spec, deriveHandling(spec));
  const step = (input: DriveInput, seconds: number, until?: () => boolean) => {
    vehicle.setInput(input);
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      vehicle.beforePhysicsStep(DT);
      world.step();
      vehicle.afterPhysicsStep();
      if (until?.()) return (i + 1) * DT;
    }
    return seconds;
  };
  const speed = () => vehicle.forwardSpeed();
  return { world, body, vehicle, step, speed, spec };
}

const idle: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false };
const gas: DriveInput = { steer: 0, throttle: 1, brake: 0, handbrake: false };

describe('raycast vehicle feasibility', () => {
  for (const id of VEHICLE_ORDER.filter(id => VEHICLES[id].kind === 'car')) {
    it(`${id}: Power Brake without acceleration immediately stops sideways/forward motion even when steering`, () => {
      const t = setup(id);
      t.step(idle, 1);
      t.body.setLinvel({ x: 8, y: 0, z: 25 }, true);
      t.body.setAngvel({ x: 0, y: 1, z: 0 }, true);
      t.step({ ...idle, steer: .8, powerBrake: true }, DT);
      expect(t.vehicle.horizontalSpeed()).toBeLessThan(.03);
      expect(Math.abs(t.body.angvel().y)).toBeLessThan(.01);
      expect(t.speed()).toBeGreaterThan(-.03);
      // Contact resolution may nudge the chassis after its pre-step brake.
      t.body.setLinvel({ x: .2, y: -.1, z: .15 }, true);
      t.vehicle.afterPhysicsStep();
      expect(t.vehicle.horizontalSpeed()).toBe(0);
      expect(t.body.linvel().y).toBeCloseTo(-.1);
      t.world.free();
    });
  }
  it('Power Brake with steering preserves momentum, slides, then restores normal grip', () => {
    const t = setup('bmw_i8');
    t.step(idle, 1);
    t.step(gas, 5);
    t.step({ ...gas, steer: 1, powerBrake: true }, .7);
    const drift = t.vehicle.getTelemetry({ speed: 0, speedKmh: 0, reversing: false, steerAngle: 0, grounded: false, holding: false, longAccel: 0, lateralAccel: 0 });
    expect(drift.drifting).toBe(true);
    expect(t.vehicle.horizontalSpeed()).toBeGreaterThan(5);
    const q = t.body.rotation(), l = t.body.linvel();
    const lateral = Math.abs(l.x * (1 - 2 * q.y * q.y) - l.z * 2 * q.y * q.w);
    expect(lateral).toBeGreaterThan(1);
    t.step({ ...idle, powerBrake: true }, DT);
    expect(t.vehicle.horizontalSpeed()).toBeLessThan(.03);
    expect(t.vehicle.getTelemetry(drift).drifting).toBe(false);
    t.step(gas, 2);
    expect(t.speed()).toBeGreaterThan(1);
    t.world.free();
  });
  it('bike settles on the ground', () => {
    const t = setup('bike_basic');
    t.step(idle, 4);
    const p = t.body.translation();
    expect(Math.hypot(p.x, p.z)).toBeLessThan(0.05);
    expect(Math.abs(t.speed())).toBeLessThan(0.05);
    expect(p.y).toBeGreaterThan(0.3);
    expect(p.y).toBeLessThan(1.2);
    expect(t.vehicle.controller.wheelIsInContact(0)).toBe(true);
  });

  it('throttle moves the vehicle forward along +Z', () => {
    const t = setup('bike_basic');
    t.step(idle, 1);
    t.step(gas, 3);
    expect(t.body.translation().z).toBeGreaterThan(5);
    expect(Math.abs(t.body.translation().x)).toBeLessThan(0.5);
  });

  it('positive steer turns right (toward -X when facing +Z)', () => {
    const t = setup('car_compact');
    t.step(idle, 1);
    t.step(gas, 2);
    t.step({ ...gas, steer: 1 }, 1.5);
    expect(t.body.translation().x).toBeLessThan(-1);
  });

  it('brakes from 40 km/h within a reasonable distance and reverses after holding', () => {
    const t = setup('car_compact');
    t.step(idle, 1);
    t.step(gas, 15, () => t.speed() >= 40 / 3.6);
    const z0 = t.body.translation().z;
    t.step({ ...idle, brake: 1 }, 6, () => t.speed() < 0.3);
    const dist = t.body.translation().z - z0;
    expect(dist).toBeGreaterThan(7);
    expect(dist).toBeLessThan(20);
    t.step({ ...idle, brake: 1 }, 3);
    expect(t.speed()).toBeLessThan(-0.5);
    expect(t.speed()).toBeGreaterThan(-(10 / 3.6) - 0.3);
    t.step(idle, 3);
    expect(Math.abs(t.speed())).toBeLessThan(0.2);
  });

  for (const id of VEHICLE_ORDER) {
    it(`${id}: 0–40 km/h near target and plausible top speed`, () => {
      const t = setup(id);
      t.step(idle, 1);
      const time = t.step(gas, 25, () => t.speed() >= 40 / 3.6);
      expect(time).toBeLessThan(t.spec.accel0to40 * 1.35);
      expect(time).toBeGreaterThan(t.spec.accel0to40 * 0.6);
      t.step(gas, 40);
      const top = t.speed() * 3.6;
      expect(top).toBeGreaterThan(t.spec.topSpeedKmh * 0.8);
      expect(top).toBeLessThan(t.spec.topSpeedKmh * 1.05);
      console.log(`${id}: 0-40 ${time.toFixed(2)}s (target ${t.spec.accel0to40}), top ${top.toFixed(1)} km/h`);
    });
  }
  for (const id of VEHICLE_ORDER.filter(id => VEHICLES[id].kind === 'car')) {
    it(`${id}: reaches 100 km/h in about 2–3 seconds`, () => {
      const t = setup(id); t.step(idle, 1);
      const seconds = t.step(gas, 4, () => t.speed() >= 100 / 3.6);
      expect(t.speed() * 3.6).toBeGreaterThanOrEqual(100);
      expect(seconds).toBeGreaterThan(1.7); expect(seconds).toBeLessThan(3.3);
      t.world.free();
    });
  }
  it('drift countersteering crosses center without an instant stop, and grip returns gradually', () => {
    const t = setup('bmw_i8'); t.step(idle, 1); t.step(gas, 2);
    t.step({ ...gas, steer: .6, powerBrake: true }, .6);
    const speed = t.vehicle.horizontalSpeed();
    t.step({ ...gas, steer: 0, powerBrake: true }, .12);
    expect(t.vehicle.horizontalSpeed()).toBeGreaterThan(speed * .65);
    const telemetry = t.vehicle.getTelemetry({ speed: 0, speedKmh: 0, reversing: false, steerAngle: 0, grounded: false, holding: false, longAccel: 0, lateralAccel: 0 });
    expect(telemetry.drifting).toBe(true); expect(Math.abs(telemetry.slipAngle!)).toBeLessThan(.9);
    t.step({ ...gas, steer: -.6, powerBrake: true }, .4);
    expect(Math.abs(t.body.angvel().y)).toBeLessThan(1.7);
    t.step(gas, DT); t.vehicle.getTelemetry(telemetry); expect(telemetry.driftAmount).toBeGreaterThan(.7);
    t.step(gas, 1.5); t.vehicle.getTelemetry(telemetry); expect(telemetry.driftAmount).toBeLessThan(.05);
    t.world.free();
  });
  it('holding acceleration and Power Brake starts from rest and never selects an emergency stop at low speed', () => {
    const t = setup('bmw_i8'); t.step(idle, 1);
    t.step({ ...gas, powerBrake: true }, .6);
    expect(t.vehicle.horizontalSpeed()).toBeGreaterThan(2);
    const telemetry = t.vehicle.getTelemetry({ speed: 0, speedKmh: 0, reversing: false, steerAngle: 0, grounded: false, holding: false, longAccel: 0, lateralAccel: 0 });
    expect(telemetry.drifting).toBe(true); expect(telemetry.holding).toBe(false);
    t.body.setLinvel({ x: 0, y: 0, z: .1 }, true);
    t.step({ ...gas, steer: .6, powerBrake: true }, .8);
    expect(t.vehicle.horizontalSpeed()).toBeGreaterThan(2);
    t.step({ ...idle, steer: .6, powerBrake: true }, DT);
    expect(t.vehicle.horizontalSpeed()).toBeLessThan(.03); t.world.free();
  });
  it('NPC impact recoil cannot send the player backward along their approach', () => {
    const t = setup('bmw_i8'); t.step(idle, 1); t.step(gas, .5);
    t.body.setLinvel({ x: 2, y: 0, z: -8 }, true); t.vehicle.onNpcImpact(); t.vehicle.afterPhysicsStep();
    expect(t.speed()).toBeGreaterThanOrEqual(0); expect(t.body.linvel().x).toBeCloseTo(2);
    t.world.free();
  });
});
