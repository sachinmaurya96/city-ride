import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { VehicleSpec } from '../data/vehicles';
import type { Handling } from './handling';
import { GROUND_QUERY_GROUPS } from '../world/collisionGroups';

type Rapier = typeof RAPIER_NS;

export interface DriveInput {
  /** -1 (left) … +1 (right). */
  steer: number;
  /** 0 … 1. */
  throttle: number;
  /** 0 … 1; brakes, then selects reverse after holding near standstill. */
  brake: number;
  /** Brake override: cancels throttle immediately. */
  handbrake: boolean;
}

export const NEUTRAL_INPUT: DriveInput = { steer: 0, throttle: 0, brake: 0, handbrake: false };

export interface VehicleTelemetry {
  speed: number; // signed forward m/s
  speedKmh: number; // absolute
  reversing: boolean;
  steerAngle: number;
  grounded: boolean;
  holding: boolean;
  /** Smoothed longitudinal acceleration m/s², for comfort scoring. */
  longAccel: number;
  lateralAccel: number;
}

export interface SafeRoadPose {
  x: number;
  z: number;
  heading: number; // yaw radians, 0 = +Z
}

const REVERSE_HOLD_TIME = 0.4;
const REVERSE_MAX = 10 / 3.6;

/**
 * Arcade raycast vehicle on top of Rapier's DynamicRayCastVehicleController.
 * Roll and pitch are locked on the chassis (enabledRotations) so vehicles never tip over;
 * lean/roll is purely visual.
 */
export class RaycastVehicle {
  readonly controller: RAPIER_NS.DynamicRayCastVehicleController;
  private input: DriveInput = { ...NEUTRAL_INPUT };
  private steerState = 0;
  private reverseTimer = 0;
  private reverseMode = false;
  private lastSpeed = 0;
  private longAccel = 0;
  private latAccel = 0;
  private protectionTimer = 0;
  private wheelSpin: number[];
  private readonly ownerBodies: RAPIER_NS.RigidBodySet;
  holdBrake = false; // forced brake hold (boarding, capture, pause)

  constructor(
    private readonly rapier: Rapier,
    readonly body: RAPIER_NS.RigidBody,
    world: RAPIER_NS.World,
    readonly spec: VehicleSpec,
    private handling: Handling,
  ) {
    this.ownerBodies = world.bodies;
    this.controller = world.createVehicleController(body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const connY = -spec.chassisHalfHeight * 0.6;
    for (const w of spec.wheels.physics) {
      this.controller.addWheel(
        { x: w.x, y: connY, z: w.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        spec.suspension,
        spec.wheelRadius,
      );
    }
    this.wheelSpin = spec.wheels.visual.map(() => 0);
    this.applySuspension();
  }

  private applySuspension() {
    const n = this.spec.wheels.physics.length;
    for (let i = 0; i < n; i++) {
      this.controller.setWheelSuspensionStiffness(i, 32);
      this.controller.setWheelSuspensionCompression(i, 2.6);
      this.controller.setWheelSuspensionRelaxation(i, 3.4);
      this.controller.setWheelMaxSuspensionTravel(i, this.spec.suspension * 0.9);
      this.controller.setWheelMaxSuspensionForce(i, this.handling.mass * 40);
      this.controller.setWheelFrictionSlip(i, this.handling.grip);
      this.controller.setWheelSideFrictionStiffness(i, 1.0);
    }
  }

  setHandling(h: Handling) {
    this.handling = h;
    this.applySuspension();
  }

  setInput(input: DriveInput) {
    this.input.steer = Math.max(-1, Math.min(1, input.steer || 0));
    this.input.throttle = Math.max(0, Math.min(1, input.throttle || 0));
    this.input.brake = Math.max(0, Math.min(1, input.brake || 0));
    this.input.handbrake = !!input.handbrake;
  }

  beforePhysicsStep(dt: number) {
    const h = this.handling;
    const c = this.controller;
    const v = this.forwardSpeed();
    const absV = Math.abs(v);
    const n = this.spec.wheels.physics.length;
    const inp = this.holdBrake ? NEUTRAL_INPUT : this.input;
    if (this.protectionTimer > 0) this.protectionTimer -= dt;

    // Steering: smoothed, reduced with speed. Positive wheel angle turns left (+Z → +X).
    const k = Math.min(1, dt / Math.max(0.02, h.steerResponse));
    this.steerState += (inp.steer - this.steerState) * k;
    const speedFrac = Math.min(1, absV / h.topSpeed);
    const maxSteer = h.maxSteer * (1 - (1 - h.highSpeedSteer) * speedFrac);
    const angle = -this.steerState * maxSteer;

    let engine = 0; // total force, N
    let brakeDecel = 0; // m/s²

    if (this.holdBrake || inp.handbrake) {
      brakeDecel = h.brakeDecel * 1.15;
      this.reverseTimer = 0;
    } else if (inp.throttle > 0.02) {
      this.reverseTimer = 0;
      if (this.reverseMode && v < -0.4) {
        brakeDecel = h.brakeDecel * inp.throttle;
      } else {
        this.reverseMode = false;
        const fade = Math.max(0, 1 - Math.max(0, v) / h.topSpeed);
        engine = h.mass * h.accel0 * fade * inp.throttle;
      }
    } else if (inp.brake > 0.02) {
      if (!this.reverseMode && v > 0.6) {
        brakeDecel = h.brakeDecel * inp.brake;
        this.reverseTimer = 0;
      } else if (!this.reverseMode) {
        this.reverseTimer += dt;
        brakeDecel = h.brakeDecel;
        if (this.reverseTimer >= REVERSE_HOLD_TIME && absV < 0.6) this.reverseMode = true;
      }
      if (this.reverseMode) {
        const fade = Math.max(0, 1 - Math.max(0, -v) / REVERSE_MAX);
        engine = -h.mass * Math.min(2.5, h.accel0) * fade * inp.brake;
      }
    } else {
      // Released: gentle assisted deceleration, then auto-hold.
      this.reverseTimer = 0;
      brakeDecel = absV < 1.2 ? h.brakeDecel : 1.1;
    }

    const brakeImpulsePerWheel = brakeDecel > 0 ? (h.mass * brakeDecel * dt) / n : 0;
    for (let i = 0; i < n; i++) {
      const steerable = this.spec.wheels.physics[i].steer;
      c.setWheelSteering(i, steerable ? angle : 0);
      if (engine !== 0) {
        c.setWheelEngineForce(i, engine / n);
        c.setWheelBrake(i, 0);
      } else {
        c.setWheelEngineForce(i, 0);
        c.setWheelBrake(i, brakeImpulsePerWheel);
      }
    }

    c.updateVehicle(dt, undefined, GROUND_QUERY_GROUPS);

    // Light aerodynamic + yaw damping (timestep-aware), and anti-slide at standstill.
    const lin = this.body.linvel();
    if (engine === 0 && absV < 0.25 && brakeDecel > 0) {
      this.body.setLinvel({ x: lin.x * 0.5, y: lin.y, z: lin.z * 0.5 }, true);
    }

    // Filtered accelerations for comfort scoring.
    const a = (v - this.lastSpeed) / dt;
    this.lastSpeed = v;
    const kf = Math.min(1, dt / 0.25);
    this.longAccel += (a - this.longAccel) * kf;
    const yawRate = this.body.angvel().y;
    this.latAccel += (yawRate * v - this.latAccel) * kf;

    // Visual wheel spin from travelled distance.
    for (let i = 0; i < this.wheelSpin.length; i++) {
      this.wheelSpin[i] += (v * dt) / this.spec.wheels.visual[i].radius;
    }
  }

  wheelSpinAngle(i: number) {
    return this.wheelSpin[i] ?? 0;
  }

  /** Signed speed along the chassis forward axis (Rapier's currentVehicleSpeed includes vertical motion). */
  forwardSpeed() {
    const l = this.body.linvel();
    const q = this.body.rotation();
    // Local +Z rotated by q (yaw-only chassis, but keep the general form).
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return l.x * fx + l.z * fz;
  }

  getTelemetry(out: VehicleTelemetry): VehicleTelemetry {
    const v = this.forwardSpeed();
    let grounded = false;
    for (let i = 0; i < this.spec.wheels.physics.length; i++) grounded ||= this.controller.wheelIsInContact(i);
    out.speed = v;
    out.speedKmh = Math.abs(v) * 3.6;
    out.reversing = this.reverseMode;
    out.steerAngle = this.steerState;
    out.grounded = grounded;
    out.holding = this.holdBrake;
    out.longAccel = this.protectionTimer > 0 ? 0 : this.longAccel;
    out.lateralAccel = this.protectionTimer > 0 ? 0 : this.latAccel;
    return out;
  }

  get spawnProtected() {
    return this.protectionTimer > 0;
  }

  recoverTo(pose: SafeRoadPose) {
    const y = this.spec.wheelRadius + this.spec.suspension + this.spec.chassisHalfHeight * 0.6 + 0.05;
    this.body.setTranslation({ x: pose.x, y, z: pose.z }, true);
    const half = pose.heading / 2;
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.input = { ...NEUTRAL_INPUT };
    this.steerState = 0;
    this.reverseMode = false;
    this.reverseTimer = 0;
    this.lastSpeed = 0;
    this.longAccel = 0;
    this.latAccel = 0;
    this.protectionTimer = 2;
  }

  dispose(world: RAPIER_NS.World) {
    // Only the world that created the controller may remove it (a replaced world was already freed).
    if (world.bodies === this.ownerBodies) world.removeVehicleController(this.controller);
  }

  /** Utility for spawning: chassis center height above ground at rest. */
  static restHeight(spec: VehicleSpec) {
    return spec.wheelRadius + spec.suspension * 0.75 + spec.chassisHalfHeight * 0.6;
  }

  get rapierModule() {
    return this.rapier;
  }
}
