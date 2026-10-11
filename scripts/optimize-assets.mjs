import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { MeshoptEncoder } from 'meshoptimizer';

// Offline texture resizing and lossless buffer compression. Geometry, rigs, UVs and credits stay intact.
// Chromium's native WebP encoder preserves transparency without a runtime decoder dependency.
const worldFiles = new Set(['city-building-pack', 'night-city-building-pack', 'forest-tree-pack', 'palm-tree-pack',
  'banana-tree-pack', 'road-pack', 'hp-petrol-pump', 'billboard']);
// ONLY=a,b limits the run to those files (new models) instead of re-optimizing everything.
const only = process.env.ONLY?.split(',');
const allFiles = (await readdir('assets/glb-files')).filter(file => file.endsWith('.glb')).map(file => file.slice(0, -4));
const files = allFiles.filter(name => !only || only.includes(name));
const kindOf = name => worldFiles.has(name) ? 'world' : /rover|lynae|cartethyia/.test(name) ? 'characters' : 'vehicles';
await MeshoptEncoder.ready;
const output = resolve('assets/optimized');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const report = [];
try {
  for (const name of files) {
    const kind = kindOf(name);
    const folder = join(output, kind); await mkdir(folder, { recursive: true });
    const source = await readFile(`assets/glb-files/${name}.glb`);
    const jsonLength = source.readUInt32LE(12);
    const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
    const binary = source.subarray(28 + jsonLength);
    const resized = new Map();
    // Facade/window atlases need their original 2K detail at street distance.
    // Keep only building color/emissive maps larger; utility maps remain 1K.
    const facadeImages = new Set();
    if (name === 'city-building-pack' || name === 'night-city-building-pack') {
      for (const material of json.materials ?? []) {
        for (const texture of [material.pbrMetallicRoughness?.baseColorTexture, material.emissiveTexture]) {
          if (texture) facadeImages.add(json.textures[texture.index].source);
        }
      }
    }
    for (const [imageIndex, image] of (json.images ?? []).entries()) {
      if (image.bufferView === undefined) continue;
      const view = json.bufferViews[image.bufferView];
      const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const encoded = await page.evaluate(async ({ data, mime, maximum }) => {
        const blob = await fetch(`data:${mime};base64,${data}`).then(r => r.blob());
        const image = await createImageBitmap(blob);
        const factor = Math.min(1, maximum / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * factor));
        canvas.height = Math.max(1, Math.round(image.height * factor));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close();
        return canvas.toDataURL('image/webp', .9).split(',')[1];
      }, { data: bytes.toString('base64'), mime: image.mimeType, maximum: facadeImages.has(imageIndex) ? 2048 : 1024 });
      resized.set(image.bufferView, Buffer.from(encoded, 'base64'));
      image.mimeType = 'image/webp';
    }
    if (json.images?.length) {
      json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])];
      json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])];
      for (const texture of json.textures ?? []) {
        if (texture.source === undefined) continue;
        texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: texture.source } };
        delete texture.source;
      }
    }
    const parts = []; let length = 0, compressedViews = 0;
    const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    for (const [i, view] of json.bufferViews.entries()) {
      let bytes = resized.get(i) ?? binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      const accessor = json.accessors?.find(accessor => accessor.bufferView === i);
      const stride = accessor ? view.byteStride ?? componentBytes[accessor.componentType] * components[accessor.type] : 0;
      const indices = view.target === 34963;
      const canCompress = !resized.has(i) && stride > 0 && bytes.length % stride === 0
        && (indices ? stride === 2 || stride === 4 : stride % 4 === 0 && stride <= 256);
      if (canCompress) {
        const mode = indices ? 'INDICES' : 'ATTRIBUTES', count = bytes.length / stride;
        const packed = MeshoptEncoder.encodeGltfBuffer(bytes, count, stride, mode);
        if (packed.length < bytes.length) {
          view.extensions = { ...view.extensions, EXT_meshopt_compression: { buffer: 0, byteOffset: length,
            byteLength: packed.length, byteStride: stride, count, mode } };
          view.buffer = 1;
          bytes = packed; compressedViews++;
        } else { view.byteOffset = length; }
      } else { view.byteOffset = length; view.byteLength = bytes.length; }
      parts.push(bytes); length += bytes.length;
      const padding = (4 - length % 4) % 4;
      if (padding) { parts.push(Buffer.alloc(padding)); length += padding; }
    }
    json.buffers[0].byteLength = length;
    if (compressedViews) {
      json.buffers.push({ byteLength: binary.length, extensions: { EXT_meshopt_compression: { fallback: true } } });
      json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_meshopt_compression'])];
      json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression'])];
    }
    const encoded = Buffer.from(JSON.stringify(json));
    const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32); encoded.copy(padded);
    const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + padded.length + length, 8);
    header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    binHeader.writeUInt32LE(length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
    const result = Buffer.concat([header, padded, binHeader, ...parts]);
    await writeFile(join(folder, `${name}.glb`), result);
    report.push({ name, kind, originalBytes: source.length, runtimeBytes: result.length, compressedViews });
  }
  // Reconstruct all existing entries even if an earlier partial run replaced the
  // report. Unselected models are read for metadata, never re-encoded.
  const inventory = [...report];
  if (only) {
    for (const name of allFiles.filter(name => !files.includes(name))) {
      const kind = kindOf(name);
      try {
        const [original, runtime] = await Promise.all([stat(`assets/glb-files/${name}.glb`), readFile(join(output, kind, `${name}.glb`))]);
        const json = JSON.parse(runtime.subarray(20, 20 + runtime.readUInt32LE(12)).toString());
        inventory.push({ name, kind, originalBytes: original.size, runtimeBytes: runtime.length,
          compressedViews: json.bufferViews.filter(view => view.extensions?.EXT_meshopt_compression).length });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(join(output, 'report.json'), JSON.stringify(inventory, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
