import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { advanceVehicleEntry, CAR_ALIGHT_SECONDS, DRIVER_ENTRY_SECONDS, entryPhase, entryPosition, requestDriverDoor, resetVehicleEntry, vehicleEntry } from '../src/game/vehicles/entry';
import { runtime } from '../src/game/core/runtime';
import type { RaycastVehicle } from '../src/game/vehicles/vehicleController';
import { splitGeometryBox } from '../src/game/render/doorGeometry';
import { upgradeLegacyMaterials } from '../src/game/render/glbAssets';
import { engineProfile } from '../src/game/audio/recordedEngine';
import { cabinLayout, doorPivot, setDoorPose } from '../src/game/vehicles/cabin';
import { VEHICLES } from '../src/game/data/vehicles';

afterEach(() => { runtime.vehicle = null; resetVehicleEntry(false); });

describe('character entry and physical doors', () => {
  it('requires a stopped car, completes exit, and requires returning to its door before entry', () => {
    let speed = 10;
    const stop = vi.fn();
    runtime.vehicle = { spec: VEHICLES.bmw_i8, holdBrake: false, horizontalSpeed: () => speed, stopImmediately: stop } as unknown as RaycastVehicle;
    resetVehicleEntry(false);
    expect(requestDriverDoor()).toBe('moving');
    expect(vehicleEntry.mode).toBe('seated');
    speed = 0;
    expect(requestDriverDoor()).toBe('ok');
    expect(vehicleEntry.mode).toBe('exiting');
    expect(requestDriverDoor()).toBe('busy');
    advanceVehicleEntry(CAR_ALIGHT_SECONDS);
    expect(vehicleEntry).toMatchObject({ mode: 'outside', active: false, doorOpen: 0 });
    const outside = vehicleEntry.outside.clone();
    vehicleEntry.outside.x -= 10;
    expect(requestDriverDoor()).toBe('far');
    vehicleEntry.outside.copy(outside);
    expect(requestDriverDoor()).toBe('ok');
    expect(vehicleEntry.mode).toBe('entering');
    advanceVehicleEntry(DRIVER_ENTRY_SECONDS);
    expect(vehicleEntry).toMatchObject({ mode: 'seated', active: false, doorOpen: 0 });
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it('opens before crossing the sill and closes only after sitting; reverses safely for exit', () => {
    expect(entryPhase(.34).inside).toBe(0);
    expect(entryPhase(.51)).toMatchObject({ inside: 0, door: 1 });
    expect(entryPhase(.75).door).toBe(1);
    expect(entryPhase(.83).inside).toBe(1);
    expect(entryPhase(1).door).toBe(0);
    expect(entryPhase(.19, true)).toMatchObject({ inside: 1, door: 1 });
    expect(entryPhase(.48, true)).toMatchObject({ inside: 0, door: 1 });
    expect(entryPhase(1, true)).toMatchObject({ inside: 0, door: 0, walk: 1 });
    const start = new THREE.Vector3(4, .2, 0), door = new THREE.Vector3(2, .2, 0), seat = new THREE.Vector3(.5, .6, 0), out = new THREE.Vector3();
    entryPosition(out, 1, start, door, seat, .9); expect(out.toArray()).toEqual([.5, -.3, 0]);
    entryPosition(out, 1, start, door, seat, .9, true); expect(out.toArray()).toEqual(start.toArray());
  });
  it('lifts an i8 door outward around its upper hinge while ordinary doors swing outward', () => {
    for (const side of [1, -1]) {
      const spec = VEHICLES.bmw_i8, c = cabinLayout(spec), door = new THREE.Group(); door.position.copy(doorPivot(spec, side));
      const panel = new THREE.Vector3(0, c.sill - c.hingeY, -.5);
      const closed = panel.clone().add(door.position); setDoorPose(door, spec, side, 1);
      const opened = panel.applyEuler(door.rotation).add(door.position);
      expect(opened.y).toBeGreaterThan(closed.y); expect((opened.x - closed.x) * side).toBeGreaterThan(0);
    }
  });
  it('cuts a door out of merged surfaces without losing area or UV interpolation', () => {
    const source = new THREE.PlaneGeometry(4, 2).toNonIndexed();
    const parts = splitGeometryBox(source, new THREE.Vector3(-.5, -.75, -.1), new THREE.Vector3(.5, .75, .1));
    const area = (g: THREE.BufferGeometry) => {
      const p = g.getAttribute('position'); let sum = 0;
      for (let i = 0; i < p.count; i += 3) { const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2); sum += b.sub(a).cross(c.sub(a)).length() * .5; }
      return sum;
    };
    expect(area(parts.inside)).toBeCloseTo(1.5);
    expect(area(parts.inside) + area(parts.outside)).toBeCloseTo(area(source));
    for (const g of Object.values(parts)) expect([...g.getAttribute('uv').array].every((n) => n >= 0 && n <= 1)).toBe(true);
  });
});

describe('asset compatibility and recorded engine selection', () => {
  it('keeps legacy diffuse textures and the binary payload while removing the obsolete extension', () => {
    const json = { extensionsUsed: ['KHR_materials_pbrSpecularGlossiness'], materials: [{ extensions: { KHR_materials_pbrSpecularGlossiness: { diffuseTexture: { index: 7 }, diffuseFactor: [.5, .6, .7, 1], glossinessFactor: .8 } } }] };
    const encoded = new TextEncoder().encode(JSON.stringify(json)), length = Math.ceil(encoded.length / 4) * 4;
    const glb = new ArrayBuffer(20 + length + 12), bytes = new Uint8Array(glb), view = new DataView(glb);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, glb.byteLength, true); view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
    bytes.fill(32, 20, 20 + length); bytes.set(encoded, 20); bytes.set([4, 0, 0, 0, 66, 73, 78, 0, 1, 2, 3, 4], 20 + length);
    const converted = upgradeLegacyMaterials(glb), header = new DataView(converted), jsonLength = header.getUint32(12, true);
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(converted, 20, jsonLength)));
    expect(data.materials[0].pbrMetallicRoughness.baseColorTexture.index).toBe(7);
    expect(data.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([.5, .6, .7, 1]);
    expect(data.extensionsUsed).toEqual([]);
    expect([...new Uint8Array(converted).slice(-12)]).toEqual([...bytes.slice(-12)]);
  });
  it('assigns different RPM ranges and recordings to sport cars, bikes and heavy trucks', () => {
    expect(engineProfile(VEHICLES.porsche_718).recording).toBe('supercar');
    expect(engineProfile(VEHICLES.bmw_i8).recording).toBe('supercar');
    expect(engineProfile(VEHICLES.supercar).recording).toBe('supercar');
    expect(engineProfile(VEHICLES.western_star).recording).toBe('diesel');
    expect(engineProfile(VEHICLES.bike_basic).recording).toBe('bike');
    expect(engineProfile(VEHICLES.bmw_i8).pitch).not.toBe(engineProfile(VEHICLES.bmw_m4_gt3).pitch);
    expect(engineProfile(VEHICLES.western_star).redline).toBeLessThan(engineProfile(VEHICLES.supra_a80).redline);
  });
});
