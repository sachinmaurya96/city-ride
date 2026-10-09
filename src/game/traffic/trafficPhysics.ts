import type RAPIER from '@dimforge/rapier3d-compat';
import { DIR_VEC } from '../data/cityMap';
import { VEHICLES } from '../data/vehicles';
import { TRAFFIC_GROUPS } from '../world/collisionGroups';
import type { Car, TrafficSystem } from './traffic';

type State = { body: RAPIER.RigidBody; active: boolean; model: string; vx: number; vz: number };
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Lane AI supplies targets; dynamic bodies own visible positions and receive real collision impulses. */
export class TrafficPhysics {
  readonly states = new Map<number, State>();
  private ownerBodies: RAPIER.RigidBodySet;
  constructor(private world: RAPIER.World, rapier: typeof RAPIER, private traffic: TrafficSystem) {
    this.ownerBodies = world.bodies;
    for (const c of traffic.cars) {
      const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 0, -5000)
        .enabledTranslations(true, false, true).enabledRotations(false, true, false).setGravityScale(0)
        .setCcdEnabled(true).setLinearDamping(.15).setAngularDamping(1.5));
      body.userData = { trafficId: c.id };
      world.createCollider(rapier.ColliderDesc.cuboid(.9, .7, 2).setTranslation(0, .7, 0)
        .setMass(1200).setCollisionGroups(TRAFFIC_GROUPS).setFriction(.25).setRestitution(.08), body);
      body.setEnabled(false);
      this.states.set(c.id, { body, active: false, model: '', vx: 0, vz: 0 });
    }
  }
  private readPose(c: Car, state: State) {
    const p = state.body.translation(), q = state.body.rotation();
    c.x = p.x; c.z = p.z; c.heading = Math.atan2(2 * q.y * q.w, 1 - 2 * q.y * q.y);
  }
  step(dt: number) {
    for (const c of this.traffic.cars) {
      const s = this.states.get(c.id)!; const b = s.body;
      if (!c.active) { b.setEnabled(false); s.active = false; continue; }
      if (s.model !== c.model) {
        s.model = c.model; const spec = VEHICLES[c.model], col = b.collider(0);
        col.setHalfExtents({ x: spec.width / 2, y: spec.height / 2, z: spec.length / 2 });
        col.setTranslationWrtParent({ x: 0, y: spec.height / 2, z: 0 }); col.setMass(spec.mass);
        b.recomputeMassPropertiesFromColliders();
      }
      if (!s.active) {
        b.setEnabled(true); b.setTranslation({ x: c.x, y: 0, z: c.z }, true);
        b.setRotation({ x: 0, y: Math.sin(c.heading / 2), z: 0, w: Math.cos(c.heading / 2) }, true);
        s.vx = Math.sin(c.heading) * c.speed; s.vz = Math.cos(c.heading) * c.speed;
        b.setLinvel({ x: s.vx, y: 0, z: s.vz }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); s.active = true;
      }
      const v = b.linvel();
      if (Math.hypot(v.x - s.vx, v.z - s.vz) > 2.5) this.traffic.impact(c.id);
      this.readPose(c, s);
      if (c.impactTime <= 0) {
        c.speed = Math.max(0, v.x * Math.sin(c.heading) + v.z * Math.cos(c.heading));
        if (!c.turn) { const [dx, dz] = DIR_VEC[c.seg.dir]; c.s = Math.max(0, Math.min(c.seg.length - .01, (c.x - c.seg.sx) * dx + (c.z - c.seg.sz) * dz)); }
      }
    }
    this.traffic.step(dt);
    for (const c of this.traffic.cars) {
      const s = this.states.get(c.id)!; if (!c.active || !s.active) continue;
      const b = s.body, position = b.translation(), velocity = b.linvel();
      if (c.impactTime > 0) {
        b.setLinearDamping(2.7); b.setAngularDamping(4);
        // The driver brakes after a collision, while Rapier still resolves contact momentum.
        const speed = Math.hypot(velocity.x, velocity.z), remaining = Math.max(0, speed - dt * 6);
        const factor = speed < .12 ? 0 : remaining / speed;
        b.setLinvel({ x: velocity.x * factor, y: 0, z: velocity.z * factor }, true);
      } else {
        b.setLinearDamping(.15); b.setAngularDamping(1.5);
        const goalX = Math.sin(c.heading) * c.speed + (c.x - position.x) * 1.2;
        const goalZ = Math.cos(c.heading) * c.speed + (c.z - position.z) * 1.2;
        const dx = goalX - velocity.x, dz = goalZ - velocity.z;
        const change = Math.min(1, dt * 7 / Math.max(.001, Math.hypot(dx, dz)));
        b.setLinvel({ x: velocity.x + dx * change, y: 0, z: velocity.z + dz * change }, true);
        const q = b.rotation(), actualHeading = Math.atan2(2 * q.y * q.w, 1 - 2 * q.y * q.y);
        const desiredYaw = Math.max(-.9, Math.min(.9, wrap(c.heading - actualHeading) * 3));
        const yaw = b.angvel().y, blend = 1 - Math.exp(-dt * 6);
        b.setAngvel({ x: 0, y: yaw + (desiredYaw - yaw) * blend, z: 0 }, true);
      }
      const v = b.linvel(); s.vx = v.x; s.vz = v.z;
      this.readPose(c, s);
    }
  }
  dispose() {
    if (this.world.bodies === this.ownerBodies) for (const state of this.states.values()) if (state.body.isValid()) this.world.removeRigidBody(state.body);
    this.states.clear();
  }
}
