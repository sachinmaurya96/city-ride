import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const worldFiles = new Set(['city-building-pack', 'night-city-building-pack', 'forest-tree-pack', 'palm-tree-pack',
  'banana-tree-pack', 'road-pack', 'hp-petrol-pump']);
async function asset(path: string) {
  const bytes = await readFile(new URL(`../assets/${path}.glb`, import.meta.url));
  const length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + length).toString()), binary: bytes.subarray(28 + length) };
}

it('reduces all supplied models by at least 60% and the world by 75%, retaining exact geometry, rigs and credits', async () => {
  await MeshoptDecoder.ready;
  const files = (await readdir(new URL('../assets/glb-files', import.meta.url))).filter(file => file.endsWith('.glb')).map(file => file.slice(0, -4));
  let originalBytes = 0, runtimeBytes = 0, worldOriginal = 0, worldRuntime = 0;
  for (const file of files) {
    const folder = worldFiles.has(file) ? 'world' : /rover|lynae|cartethyia/.test(file) ? 'characters' : 'vehicles';
    const original = await asset(`glb-files/${file}`), optimized = await asset(`optimized/${folder}/${file}`);
    originalBytes += original.bytes.length; runtimeBytes += optimized.bytes.length;
    if (folder === 'world') { worldOriginal += original.bytes.length; worldRuntime += optimized.bytes.length; }
    // JSON serialization canonicalizes -0 to 0; both describe the same export transform.
    for (const key of ['nodes', 'meshes', 'accessors', 'materials', 'asset', 'skins', 'animations']) expect(JSON.stringify(optimized.json[key]), `${file}: ${key}`).toBe(JSON.stringify(original.json[key]));
    const images = new Set((original.json.images ?? []).map((image: { bufferView: number }) => image.bufferView));
    for (let i = 0; i < original.json.bufferViews.length; i++) {
      if (images.has(i)) continue;
      const a = original.json.bufferViews[i], b = optimized.json.bufferViews[i];
      const compressed = b.extensions?.EXT_meshopt_compression;
      let decoded: Uint8Array = optimized.binary.subarray(b.byteOffset ?? 0, (b.byteOffset ?? 0) + b.byteLength);
      if (compressed) {
        decoded = new Uint8Array(compressed.count * compressed.byteStride);
        MeshoptDecoder.decodeGltfBuffer(decoded, compressed.count, compressed.byteStride,
          optimized.binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength), compressed.mode);
      }
      expect(original.binary.subarray(a.byteOffset ?? 0, (a.byteOffset ?? 0) + a.byteLength)
        .equals(decoded), `${file}: buffer ${i}`).toBe(true);
    }
    for (const image of optimized.json.images ?? []) {
      const view = optimized.json.bufferViews[image.bufferView];
      expect(image.mimeType).toBe('image/webp');
      expect(optimized.binary.subarray(view.byteOffset + 8, view.byteOffset + 12).toString()).toBe('WEBP');
    }
  }
  expect(runtimeBytes).toBeLessThan(originalBytes * .4);
  expect(worldRuntime).toBeLessThan(worldOriginal * .25);
});
