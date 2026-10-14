import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHARACTER_FILES, readAsset } from './assets';
import { animateAvatar, createAvatar, prepareCharacter } from '../src/game/render/importedCharacters';
import { characterBounds } from '../src/game/render/characterBounds';
import { SettingsSchema } from '../src/storage/schema';
import { CHARACTER_IDS, PASSENGER_CHARACTER_IDS, type CharacterId } from '../src/game/data/characters';

const NEW = ['carlotta', 'chisa', 'zani', 'shorekeeper', 'mint', 'phoebe'] as const;
const EYES: Record<(typeof NEW)[number], RegExp> = { carlotta: /^material$/, chisa: /Eye/, zani: /^material$/, shorekeeper: /MI_Eye_MI/, mint: /mint_eyes/, phoebe: /^eye_eye/ };
const load = async (id: CharacterId) => createAvatar(prepareCharacter((await readAsset(CHARACTER_FILES[id])).scene, id), id);
const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('added characters', () => {
  for (const id of NEW) {
    it(`${id}: every limb joint found and tagged, eyes at 1.525 m, lit materials, finite poses`, async () => {
      const avatar = await load(id);
      for (const [key, bone] of Object.entries(avatar.bones)) expect(bone?.userData.joint, `${id} ${key}`).toBe(key);
      // Left is +X, feet below knees below hips below the head.
      expect(at(avatar.bones.handL!).x).toBeGreaterThan(at(avatar.bones.handR!).x);
      expect(at(avatar.bones.footL!).y).toBeLessThan(at(avatar.bones.calfL!).y);
      expect(at(avatar.bones.calfL!).y).toBeLessThan(at(avatar.bones.thighL!).y);
      expect(at(avatar.bones.thighL!).y).toBeLessThan(at(avatar.bones.head!).y);
      const eye = new THREE.Box3(), v = new THREE.Vector3();
      avatar.root.updateMatrixWorld(true);
      avatar.root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) expect(m, `${id} ${m.name}`).not.toBeInstanceOf(THREE.MeshBasicMaterial);
        if (!EYES[id].test(o.name) && !materials.some((m) => EYES[id].test(m.name))) return;
        if (o instanceof THREE.SkinnedMesh) o.skeleton.update();
        const p = o.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) eye.expandByPoint(o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld));
      });
      expect(Math.abs((eye.min.y + eye.max.y) / 2 - 1.525), `${id} eye height`).toBeLessThan(.012);
      for (const pose of ['car', 'bike', 'pillion', 'auto', 'bus'] as const) {
        for (let i = 0; i < 20; i++) animateAvatar(avatar, 1 / 60, 0, 1, 0, 0, false, true, pose);
        const bounds = characterBounds(avatar.root);
        expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite), `${id} ${pose}`).toBe(true);
      }
    }, 60000);
  }

  it('auxiliary hip/shoulder bones take half the limb turn', async () => {
    const avatar = await load('chisa');
    const helper = avatar.helpers.find((h) => /Leg_L_M/.test(h.bone.name))!;
    expect(helper).toBeDefined();
    for (let i = 0; i < 30; i++) animateAvatar(avatar, 1 / 60, 0, 1, 0, 0, false, true, 'car');
    const limbTurn = helper.limb.quaternion.angleTo(helper.limbRest), helperTurn = helper.bone.quaternion.angleTo(helper.rest);
    expect(limbTurn).toBeGreaterThan(.8);
    expect(helperTurn / limbTurn).toBeCloseTo(.5, 1);
  });

  it("Zani's tail hangs when standing and curls behind the hips when seated, never far behind or below them", async () => {
    const avatar = await load('zani'), tail = avatar.chains.find((c) => c.kind === 'tail')!;
    expect(tail.joints.length).toBe(13);
    const tip = () => at(tail.joints[tail.joints.length - 1].bone), hips = () => at(avatar.bones.hips!);
    for (let i = 0; i < 20; i++) animateAvatar(avatar, 1 / 60, 0, 0);
    // Bind pose: straight out behind at hip height. Standing: drooped well below the hips.
    expect(hips().y - tip().y).toBeGreaterThan(.35);
    for (let i = 0; i < 20; i++) animateAvatar(avatar, 1 / 60, 0, 1, 0, 0, false, true, 'car');
    const d = tip().sub(hips());
    expect(Math.hypot(d.x, d.z)).toBeLessThan(.4);
    expect(d.y).toBeGreaterThan(-.15);
  });

  it('skirt panels drape over the thighs: seated, a front panel turns with the thigh', async () => {
    const avatar = await load('mint');
    const skirt = avatar.chains.filter((c) => c.kind === 'skirt').flatMap((c) => c.hinges).sort((a, b) => b.weight - a.weight)[0];
    expect(skirt.weight).toBeGreaterThan(.6);
    for (let i = 0; i < 30; i++) animateAvatar(avatar, 1 / 60, 0, 1, 0, 0, false, true, 'car');
    expect(skirt.bone.getWorldQuaternion(new THREE.Quaternion()).angleTo(avatar.root.getWorldQuaternion(new THREE.Quaternion()).multiply(skirt.restTurn))).toBeGreaterThan(.6);
  });

  it('every added character can be the driver and every non-Rover one the passenger; older saves still load', () => {
    const base = SettingsSchema.parse({ masterVolume: 1, sfxVolume: 1, ambienceVolume: 1, musicVolume: 1, muted: false, quality: 'low', controls: 'joystick', autoRecenter: true, language: 'en', uiScale: 1, reducedMotion: false, cameraMode: 'chase' });
    expect(base.driver).toBe('male'); expect(base.passengerCharacter).toBe('mixed');
    for (const id of CHARACTER_IDS) expect(SettingsSchema.parse({ ...base, driver: id }).driver).toBe(id);
    for (const id of PASSENGER_CHARACTER_IDS) expect(SettingsSchema.parse({ ...base, passengerCharacter: id }).passengerCharacter).toBe(id);
    expect(() => SettingsSchema.parse({ ...base, passengerCharacter: 'male' })).toThrow();
  });
});
