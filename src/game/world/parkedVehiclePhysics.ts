import type RAPIER from '@dimforge/rapier3d-compat';
import { VEHICLES } from '../data/vehicles';
import type { ParkedVehicle } from './cityBuilder';
import { TRAFFIC_GROUPS } from './collisionGroups';

/** Parked vehicles sleep until contact, then coast to rest where the crash leaves them. */
export class ParkedVehiclePhysics {
  readonly states: { body: RAPIER.RigidBody; pose: ParkedVehicle; sleeping: boolean }[];
  private ownerBodies: RAPIER.RigidBodySet;

  constructor(private world: RAPIER.World, rapier: typeof RAPIER, parked: readonly ParkedVehicle[]) {
    this.ownerBodies = world.bodies;
    this.states = parked.map((vehicle, id) => {
      const spec = VEHICLES[vehicle.model];
      const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic()
        .setTranslation(vehicle.x, 0, vehicle.z)
        .setRotation({ x: 0, y: Math.sin(vehicle.heading / 2), z: 0, w: Math.cos(vehicle.heading / 2) })
        .enabledTranslations(true, false, true).enabledRotations(false, true, false)
        .setGravityScale(0).setCcdEnabled(true).setLinearDamping(2.7).setAngularDamping(4)
        .setSleeping(true));
      body.userData = { parkedId: id };
      world.createCollider(rapier.ColliderDesc.cuboid(spec.width / 2, spec.height / 2, spec.length / 2)
        .setTranslation(0, spec.height / 2, 0).setMass(spec.mass)
        .setCollisionGroups(TRAFFIC_GROUPS).setFriction(.25).setRestitution(.08), body);
      return { body, pose: { ...vehicle }, sleeping: false };
    });
  }

  /** Copy physics poses for instancing without changing the cached city generation. */
  sync() {
    let moved = false;
    for (const state of this.states) {
      const { body, pose } = state, sleeping = body.isSleeping();
      if (sleeping && state.sleeping) continue;
      state.sleeping = sleeping;
      const p = body.translation(), q = body.rotation();
      const heading = Math.atan2(2 * q.y * q.w, 1 - 2 * q.y * q.y);
      moved ||= Math.abs(p.x - pose.x) + Math.abs(p.z - pose.z) + Math.abs(heading - pose.heading) > .00001;
      pose.x = p.x; pose.z = p.z; pose.heading = heading;
    }
    return moved;
  }

  dispose() {
    if (this.world.bodies === this.ownerBodies) {
      for (const { body } of this.states) if (body.isValid()) this.world.removeRigidBody(body);
    }
    this.states.length = 0;
  }
}
