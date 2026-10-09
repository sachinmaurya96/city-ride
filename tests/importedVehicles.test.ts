import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { modelNormalization, wheelSideGeometry } from '../src/game/render/importedVehicles';

describe('supplied car transforms', () => {
  it('normalizes different export units, centers the car and places its tires on the ground', () => {
    for (const scale of [0.01, 1, 100]) {
      const bounds = new THREE.Box3(new THREE.Vector3(-2 * scale, -scale, -3 * scale), new THREE.Vector3(2 * scale, scale, 7 * scale));
      bounds.applyMatrix4(modelNormalization(bounds, 5));
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
      expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
      expect(bounds.getSize(new THREE.Vector3()).toArray()).toEqual([2, 1, 5]);
    }
  });
  it('rejects an empty model instead of producing an infinite scale', () => {
    expect(() => modelNormalization(new THREE.Box3(), 5)).toThrow('Invalid car model bounds');
  });
  it('separates the combined rear wheels without losing triangles, UVs or normals', () => {
    const source = new THREE.BoxGeometry(2, 1, 1).toNonIndexed();
    const right = wheelSideGeometry(source, 1);
    const left = wheelSideGeometry(source, -1);
    expect(right.getAttribute('position').count + left.getAttribute('position').count).toBe(source.getAttribute('position').count);
    for (const geometry of [right, left]) {
      expect(geometry.getAttribute('position').count % 3).toBe(0);
      expect(geometry.getAttribute('normal').count).toBe(geometry.getAttribute('position').count);
      expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
      expect([...geometry.getAttribute('uv').array].every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });
});
