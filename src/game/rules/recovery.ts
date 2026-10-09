import { garageSpawn, SEGMENT_BY_ID, DIR_VEC } from '../data/cityMap';
import { runtime } from '../core/runtime';
import { input } from '../input/input';
import { lanePoint, projectToRoad, type RoadProjection } from '../navigation/roadGraph';
import type { SafeRoadPose } from '../vehicles/vehicleController';

/** Most recent projection of the player onto the road network (refreshed at ~8 Hz). */
export const playerRoad: { proj: RoadProjection; offRoadTime: number } = {
  proj: { kind: 'off', s: 0, lateral: 0, correctSide: false, aligned: 0 },
  offRoadTime: 0,
};

let acc = 0;
let notGrounded = 0;
/** Optional occupancy test (traffic system registers one) so we never recover into another car. */
export const recoveryOccupancy: { test: ((x: number, z: number) => boolean) | null } = { test: null };

export function recoverySystem(dt: number) {
  const t = runtime.telemetry;
  const held = input.hasDriveInput;
  if (held && Math.abs(t.speed) < 0.6) runtime.stuckTime += dt;
  else runtime.stuckTime = Math.max(0, runtime.stuckTime - dt * 2);
  notGrounded = t.grounded ? 0 : notGrounded + dt;

  acc += dt;
  if (acc >= 0.125) {
    acc = 0;
    const p = runtime.pose;
    const proj = projectToRoad(p.x, p.z, p.fx, p.fz);
    playerRoad.proj = proj;
    if (proj.kind === 'off') playerRoad.offRoadTime += 0.125;
    else playerRoad.offRoadTime = 0;
    if (proj.kind === 'segment' && proj.segment && proj.correctSide && proj.aligned > 0.75 && t.grounded && !runtime.vehicle?.spawnProtected) {
      const seg = proj.segment;
      const s = Math.max(8, Math.min(seg.length - 8, proj.s));
      const [x, z] = lanePoint(seg, s);
      const [dx, dz] = DIR_VEC[seg.dir];
      runtime.lastSafePose = { x, z, heading: Math.atan2(dx, dz) };
    }
  }
  runtime.canRecover = runtime.stuckTime > 3 || notGrounded > 3 || (playerRoad.offRoadTime > 4 && Math.abs(t.speed) < 2);
}

/** Free recovery to the last safe road pose (or garage). Returns the pose used. */
export function recoverVehicle(force = false): SafeRoadPose | null {
  if (!force && !runtime.canRecover) return null;
  let pose = runtime.lastSafePose ?? garageSpawn();
  if (recoveryOccupancy.test && recoveryOccupancy.test(pose.x, pose.z)) {
    // try a little further along the same direction, else the garage
    const fx = Math.sin(pose.heading);
    const fz = Math.cos(pose.heading);
    const alt = { x: pose.x + fx * 15, z: pose.z + fz * 15, heading: pose.heading };
    pose = recoveryOccupancy.test(alt.x, alt.z) ? garageSpawn() : alt;
  }
  runtime.requestRecovery(pose);
  runtime.stuckTime = 0;
  runtime.canRecover = false;
  input.reset();
  return pose;
}

export { SEGMENT_BY_ID };
