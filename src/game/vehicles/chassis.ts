import type { VehicleSpec } from '../data/vehicles';

/** Chassis collider dimensions shared by the game scene and headless physics tests. */
export function chassisCollider(spec: VehicleSpec) {
  const isBike = spec.kind === 'bike';
  return {
    halfExtents: [
      Math.max(spec.width / 2, isBike ? 0.38 : 0),
      spec.chassisHalfHeight,
      spec.length / 2,
    ] as [number, number, number],
    // Collider sits above the wheel connection plane so curbs touch wheels first.
    offsetY: spec.chassisHalfHeight * 0.45,
    mass: spec.mass,
    friction: 0.2,
    restitution: 0.05,
  };
}
