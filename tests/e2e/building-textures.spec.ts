import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type * as THREE from 'three';
import { boot, play } from './helpers';

test.setTimeout(180000);
test('building atlas textures decode and remain visible on the imported facades', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, { clear: true }); await play(page);
  const bytes = await readFile('assets/glb-files/city-building-pack.glb');
  const n = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + n).toString());
  const binary = bytes.subarray(28 + n);
  const originals = [0, 8].map(i => {
    const v = json.bufferViews[json.images[i].bufferView];
    return binary.subarray(v.byteOffset, v.byteOffset + v.byteLength).toString('base64');
  });
  const textures = await page.evaluate(async originals => {
    const scene = window.__cr.debug.extra.scene as THREE.Scene;
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    scene.getObjectByName('resource-city')!.traverse(o => {
      const mesh = o as THREE.InstancedMesh;
      if (mesh.isInstancedMesh && mesh.userData.pack === 'buildings') {
        const m = mesh.material as THREE.MeshStandardMaterial;
        materials.set(m.name, m);
      }
    });
    const inspect = (image: CanvasImageSource & { width: number; height: number }) => {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let alphaMin = 255, transparent = 0, colored = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        alphaMin = Math.min(alphaMin, pixels[i + 3]); transparent += pixels[i + 3] < 250 ? 1 : 0;
        colored += pixels[i] + pixels[i + 1] + pixels[i + 2] > 30 ? 1 : 0;
      }
      return { width: canvas.width, height: canvas.height, alphaMin, transparent, colored };
    };
    const originalStats = await Promise.all(originals.map(async base64 => {
      const blob = await fetch(`data:image/png;base64,${base64}`).then(r => r.blob());
      const image = await createImageBitmap(blob); const result = inspect(image); image.close(); return result;
    }));
    return { originals: originalStats, runtime: [...materials.values()].map(m => ({ name: m.name, transparent: m.transparent,
      alphaTest: m.alphaTest, map: inspect(m.map!.image), color: m.color.toArray(), emissive: m.emissiveIntensity })) };
  }, originals);
  await test.info().attach('building-textures.json', { body: JSON.stringify(textures, null, 2), contentType: 'application/json' });
  for (const material of textures.runtime) {
    expect(material.map.colored).toBeGreaterThan(1000);
    expect(material.map.width).toBe(2048);
    if (material.name === 'BACKGROUND_BUILDING_2') {
      expect(material.transparent).toBe(false);
      expect(material.alphaTest).toBe(0);
      expect(material.map.alphaMin).toBe(0);
    }
  }
  await page.evaluate(() => {
    window.__cr.debug.cam = { x: 80, y: 24, z: 55, tx: 0, ty: 12, tz: -100 };
  });
  const started = await page.evaluate(() => window.__cr.runtime.simTime);
  await expect.poll(() => page.evaluate(() => window.__cr.runtime.simTime)).toBeGreaterThan(started + .5);
  await page.screenshot({ path: 'test-results/building-textures.png' });
  expect(errors).toEqual([]);
});
