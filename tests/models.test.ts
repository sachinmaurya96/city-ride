import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONE, PLAYER_LOOK, bakeCharacter, buildCharacterGeometry, createRig, genderForName, randomLook } from '../src/game/render/characters';
import { animateLocomotion, newAnimState, poseSeated, reachArm } from '../src/game/render/charAnim';
import { buildStaticVehicleGeometry, buildVehicleParts, gripWorld } from '../src/game/render/models';
import { VEHICLES, type VehicleId } from '../src/game/data/vehicles';
import { mulberry32 } from '../src/game/core/rng';
import { SHOPS, slotUV, ATLAS_COLS, ATLAS_ROWS, streetSlot } from '../src/game/world/shopSigns';

const tris = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3;
const IDS = Object.keys(VEHICLES) as VehicleId[];

describe('model triangle budgets (mobile performance)', () => {
  it('characters stay within budget at both detail levels', () => {
    expect(tris(buildCharacterGeometry(PLAYER_LOOK, 1))).toBeLessThan(7000);
    for (let i = 0; i < 12; i++) expect(tris(buildCharacterGeometry(randomLook(mulberry32(i)), 0))).toBeLessThan(3200);
  });
  it('traffic LODs stay within budget; far LOD has no driver', () => {
    for (const id of IDS) {
      expect(tris(buildStaticVehicleGeometry(VEHICLES[id], '#fff', true, 'mid')), id).toBeLessThan(8000);
      expect(tris(buildStaticVehicleGeometry(VEHICLES[id], '#fff', true, true)), id).toBeLessThan(3200);
      const p = buildVehicleParts(VEHICLES[id], '#fff', false);
      expect(tris(p.body) + (p.glass ? tris(p.glass) : 0), id).toBeLessThan(24000);
    }
  });
});

describe('character rig', () => {
  it('male and female builds have distinct proportions and every vertex is bound to one bone', () => {
    const m = buildCharacterGeometry(randomLook(mulberry32(1), 'male'), 0);
    const f = buildCharacterGeometry(randomLook(mulberry32(1), 'female'), 0);
    expect(createRig('male').P.shoulderW).toBeGreaterThan(createRig('female').P.shoulderW);
    for (const g of [m, f]) {
      const w = g.getAttribute('skinWeight');
      const idx = g.getAttribute('skinIndex');
      for (let i = 0; i < w.count; i += 37) {
        expect(w.getX(i)).toBe(1);
        expect(idx.getX(i)).toBeLessThan(13);
      }
    }
  });
  it('walking keeps the planted foot on the ground and advances the gait by distance', () => {
    const rig = createRig('female');
    const root = new THREE.Group();
    root.add(rig.bones[0]);
    const st = newAnimState(0);
    const lowest: number[] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < 120; i++) {
      animateLocomotion(rig, st, 1 / 60, 1.25 / 60);
      root.updateMatrixWorld(true);
      const ys = [BONE.footL, BONE.footR].map((b) => rig.bones[b].getWorldPosition(v).y);
      lowest.push(Math.min(...ys));
    }
    // ankle joints of the stance foot stay at ankle height (no floating / sinking) within 2.5 cm
    const ankle = rig.P.ankleH;
    for (const y of lowest.slice(30)) expect(Math.abs(y - ankle)).toBeLessThan(0.025);
    expect(st.speed).toBeGreaterThan(1.1);
  });
  it('arm IK puts the hand on the steering grip', () => {
    for (const id of ['bike_basic', 'car_compact', 'bus_medium', 'auto_city'] as VehicleId[]) {
      const parts = buildVehicleParts(VEHICLES[id], '#fff', false);
      const seat = parts.seat!;
      const rig = createRig('male');
      const root = new THREE.Group();
      root.add(rig.bones[0]);
      root.position.set(seat.hip.x, seat.hip.y - rig.P.joints[0].y * seat.scale, seat.hip.z);
      root.scale.setScalar(seat.scale);
      poseSeated(rig, seat.pose, newAnimState(1), 0, { steer: 0.5, longAccel: 1, lateralAccel: -2, speed: 5, roll: 0, bar: parts.steer!.axis === 'y' ? 0.4 : 0 });
      root.updateMatrixWorld(true);
      for (const side of [1, -1] as const) {
        const t = gripWorld(parts.steer!, side > 0 ? 0 : 1, 0.4);
        reachArm(rig, side, t, new THREE.Vector3(side, -1, 0), seat.scale);
        root.updateMatrixWorld(true);
        // hand centre = forearm bone origin + rest offset to the hand; measure via a baked marker
        const fa = rig.bones[side > 0 ? BONE.fArmL : BONE.fArmR];
        const wr = (side > 0 ? rig.P.wristL : rig.P.wristR).clone().add(new THREE.Vector3(0, -0.045, 0.01));
        const local = wr.sub(rig.P.joints[side > 0 ? BONE.fArmL : BONE.fArmR]);
        const hand = local.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(fa.getWorldQuaternion(new THREE.Quaternion())).scale(new THREE.Vector3(seat.scale, seat.scale, seat.scale))).add(fa.getWorldPosition(new THREE.Vector3()));
        expect(hand.distanceTo(t), `${id} side ${side}`).toBeLessThan(0.06);
      }
    }
  });
  it('baking a pose produces geometry; names map to genders', () => {
    const g = bakeCharacter(PLAYER_LOOK, 0, (rig) => poseSeated(rig, 'chair', newAnimState(1), 0));
    expect(tris(g)).toBeGreaterThan(500);
    expect(genderForName('Priya', () => 0.9)).toBe('female');
    expect(genderForName('Kabir', () => 0.1)).toBe('male');
  });
});

describe('sign atlas', () => {
  it('every shop and the ten street names fit in the atlas', () => {
    expect(streetSlot(9)).toBeLessThan(ATLAS_COLS * ATLAS_ROWS);
    for (let i = 0; i < SHOPS.length + 10; i++) {
      const [u0, v0, u1, v1] = slotUV(i);
      expect(u0).toBeGreaterThanOrEqual(0);
      expect(v0).toBeGreaterThanOrEqual(0);
      expect(u1).toBeLessThanOrEqual(1);
      expect(v1).toBeLessThanOrEqual(1);
    }
  });
});
