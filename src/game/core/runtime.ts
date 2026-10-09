import type { RaycastVehicle, SafeRoadPose, VehicleTelemetry } from '../vehicles/vehicleController';
import type { VehicleId } from '../data/vehicles';
import type { WebGLRenderer } from 'three';

export type CameraMode = 'chase' | 'high' | 'eye';

export interface PlayerPose {
  x: number;
  y: number;
  z: number;
  heading: number; // yaw, 0 = +Z
  fx: number; // forward unit vector (xz)
  fz: number;
}

type StepSystem = (dt: number) => void;

/**
 * Frame-independent game runtime: the single owner of simulation-side references.
 * React components read from it (polling at limited rates); it never stores React state.
 */
class Runtime {
  vehicle: RaycastVehicle | null = null;
  vehicleId: VehicleId = 'bike_basic';
  pose: PlayerPose = { x: 0, y: 0, z: 0, heading: 0, fx: 0, fz: 1 };
  telemetry: VehicleTelemetry = { speed: 0, speedKmh: 0, reversing: false, steerAngle: 0, grounded: true, holding: false, longAccel: 0, lateralAccel: 0 };
  cameraMode: CameraMode = 'chase';
  /** Camera ground position + view direction (for spawn visibility tests). */
  cameraPose = { x: 0, z: 0, fx: 0, fz: 1 };
  /** Simulation seconds (advances only while unpaused, in fixed steps). */
  simTime = 0;
  lastSafePose: SafeRoadPose | null = null;
  stuckTime = 0;
  canRecover = false;
  distanceDriven = 0;
  /** Systems run after each fixed physics step, in registration order. */
  private systems = new Map<string, StepSystem>();
  /** Pending recovery request (executed before the next physics step). */
  pendingRecovery: SafeRoadPose | null = null;
  reducedMotion = false;
  hornUntil = 0;
  /** Optional speed limiter (km/h) from settings + posted limit; null = off. */
  limiterKmh: number | null = null;
  /** The single shared renderer (also used for garage previews). */
  renderer: WebGLRenderer | null = null;

  register(id: string, fn: StepSystem) {
    this.systems.set(id, fn);
    return () => {
      if (this.systems.get(id) === fn) this.systems.delete(id);
    };
  }

  step(dt: number) {
    this.simTime += dt;
    for (const fn of this.systems.values()) fn(dt);
  }

  requestRecovery(pose: SafeRoadPose) {
    this.pendingRecovery = pose;
  }
}

export const runtime = new Runtime();
