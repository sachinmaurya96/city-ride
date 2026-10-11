import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { reportAssetProgress } from './assetLoading';

const assets = new Map<string, Promise<GLTF>>();

/** Convert the retired spec/gloss extension before Three parses the GLB, retaining diffuse textures. */
export function upgradeLegacyMaterials(buffer: ArrayBuffer): ArrayBuffer {
  const header = new DataView(buffer);
  const jsonLength = header.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  if (!json.extensionsUsed?.includes('KHR_materials_pbrSpecularGlossiness')) return buffer;
  for (const material of json.materials ?? []) {
    const legacy = material.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (!legacy) continue;
    material.pbrMetallicRoughness = {
      baseColorFactor: legacy.diffuseFactor ?? [1, 1, 1, 1],
      ...(legacy.diffuseTexture ? { baseColorTexture: legacy.diffuseTexture } : {}),
      metallicFactor: 0,
      roughnessFactor: Math.max(0.12, 1 - (legacy.glossinessFactor ?? 1)),
    };
    delete material.extensions.KHR_materials_pbrSpecularGlossiness;
  }
  json.extensionsUsed = json.extensionsUsed.filter((e: string) => e !== 'KHR_materials_pbrSpecularGlossiness');
  if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e: string) => e !== 'KHR_materials_pbrSpecularGlossiness');
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const tail = new Uint8Array(buffer, 20 + jsonLength);
  const result = new ArrayBuffer(20 + paddedLength + tail.length);
  const bytes = new Uint8Array(result);
  bytes.set(new Uint8Array(buffer, 0, 20));
  bytes.fill(32, 20, 20 + paddedLength);
  bytes.set(encoded, 20);
  bytes.set(tail, 20 + paddedLength);
  const view = new DataView(result);
  view.setUint32(8, result.byteLength, true);
  view.setUint32(12, paddedLength, true);
  return result;
}

export function loadGlb(url: string, retry = false): Promise<GLTF> {
  if (retry) assets.delete(url);
  const cached = assets.get(url);
  if (cached) return cached;
  reportAssetProgress(url, 0);
  const task = Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
    fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Model download failed (${response.status})`);
      const reader = response.body?.getReader();
      if (!reader) return response.arrayBuffer();
      const total = Number(response.headers.get('content-length'));
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        reportAssetProgress(url, total > 0 ? Math.min(.9, received / total * .9) : .1);
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      reportAssetProgress(url, .9);
      return bytes.buffer;
    }),
  ]).then(([{ GLTFLoader }, { MeshoptDecoder }, buffer]) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(upgradeLegacyMaterials(buffer), new URL('.', url).href)).then(asset => {
    reportAssetProgress(url, 1);
    return asset;
  }).catch(error => {
    if (assets.get(url) === task) assets.delete(url);
    throw error;
  });
  assets.set(url, task);
  return task;
}

/** Drop parsed source meshes once their prepared geometry is cached elsewhere. */
export function releaseGlb(url: string) { assets.delete(url); }
