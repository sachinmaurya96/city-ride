import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHARACTER_FILES, readAsset } from './assets';
import { animateAvatar, createAvatar, prepareCharacter } from '../src/game/render/importedCharacters';
import { CHARACTER_IDS } from '../src/game/data/characters';
import { BONE, createCharacterMesh, PLAYER_LOOK, PLAYER_LOOK_FEMALE } from '../src/game/render/characters';
import { animateLocomotion, newAnimState } from '../src/game/render/charAnim';
import { MATERIALS } from '../src/game/render/materials';


/** Walk an avatar straight ahead at `speed` (60 fps) after a one-second start, and measure the gait. */
function walk(avatar: ReturnType<typeof createAvatar>, speed: number) {
  const dt = 1 / 60, foot = (k: 'footL' | 'footR') => avatar.bones[k]!.getWorldPosition(new THREE.Vector3());
  let previous = { L: foot('footL'), R: foot('footR') };
  let slide = 0, slideFrames = 0, lowest = Infinity, hipLow = Infinity, hipHigh = -Infinity;
  for (let i = 0; i < 420; i++) {
    const v = i < 60 ? speed * i / 60 : speed;
    avatar.root.position.z += v * dt;
    animateAvatar(avatar, dt, v * dt, 0);
    const now = { L: foot('footL'), R: foot('footR') };
    if (i > 150) {
      for (const side of ['L', 'R'] as const) {
        // Flat-foot part of stance (after heel strike, before the heel lifts): the ankle must stay put.
        const phase = (avatar.phase + (side === 'R' ? .5 : 0)) % 1;
        if (phase > .1 && phase < .33) { slide = Math.max(slide, Math.hypot(now[side].x - previous[side].x, now[side].z - previous[side].z) / dt); slideFrames++; }
        lowest = Math.min(lowest, now[side].y);
      }
      const hip = avatar.bones.hips!.getWorldPosition(new THREE.Vector3()).y;
      hipLow = Math.min(hipLow, hip); hipHigh = Math.max(hipHigh, hip);
    }
    previous = now;
  }
  return { slide, slideFrames, lowest, bob: hipHigh - hipLow, cadence: speed / avatar.step * 60 };
}

describe('walking gait of the imported characters', () => {
  for (const id of CHARACTER_IDS) {
    it(`${id}: planted feet, a natural cadence and hip bob, no foot through the ground`, async () => {
      const avatar = createAvatar(prepareCharacter((await readAsset(CHARACTER_FILES[id])).scene, id), id);
      for (const speed of [.6, 1.3]) {
        const g = walk(avatar, speed);
        expect(g.slideFrames, `${id} ${speed}`).toBeGreaterThan(20);
        expect(g.slide, `${id} ${speed} stance foot slide (m/s)`).toBeLessThan(.02);
        expect(g.lowest, `${id} ${speed} ankle height`).toBeGreaterThan(avatar.footHeight - .005);
        if (speed > 1) {
          // A brisk walk: ~100–125 steps a minute, the pelvis rising and falling 3–6 cm.
          expect(g.cadence, id).toBeGreaterThan(95); expect(g.cadence, id).toBeLessThan(130);
          expect(g.bob, id).toBeGreaterThan(.025); expect(g.bob, id).toBeLessThan(.065);
        }
      }
      // Coming to a stop the stride shrinks to a standing stance with both feet down.
      for (let i = 0; i < 90; i++) { const v = Math.max(0, 1.3 * (1 - i / 45)); avatar.root.position.z += v / 60; animateAvatar(avatar, 1 / 60, v / 60, 0); }
      const L = avatar.bones.footL!.getWorldPosition(new THREE.Vector3()), R = avatar.bones.footR!.getWorldPosition(new THREE.Vector3());
      expect(Math.abs(L.z - R.z), `${id} standing feet`).toBeLessThan(.12);
      expect(Math.max(L.y, R.y), `${id} standing feet down`).toBeLessThan(avatar.footHeight + .02);
    }, 60000);
  }
});

describe('street pedestrians (procedural rig)', () => {
  for (const [name, look] of [['male', PLAYER_LOOK], ['female', PLAYER_LOOK_FEMALE]] as const) {
    it(`${name}: feet stay planted through stance at strolling and brisk speeds`, () => {
      for (const speed of [.8, 1.3, 2]) {
        const { mesh, rig } = createCharacterMesh(look, 1, MATERIALS.world), st = newAnimState(3);
        const foot = () => rig.bones[BONE.footL].getWorldPosition(new THREE.Vector3());
        let previous = foot();
        const speeds: number[] = [];
        for (let i = 0; i < 360; i++) {
          mesh.position.z += speed / 60; animateLocomotion(rig, st, 1 / 60, speed / 60); mesh.updateMatrixWorld(true);
          const f = foot();
          if (i > 120) speeds.push(Math.hypot(f.x - previous.x, f.z - previous.z) * 60);
          previous = f;
        }
        speeds.sort((a, b) => a - b);
        // A quarter of the frames (flat-foot stance) the ankle is all but still on the ground.
        expect(speeds[Math.floor(speeds.length * .25)], `${name} ${speed}`).toBeLessThan(.12);
      }
    });
  }
});
