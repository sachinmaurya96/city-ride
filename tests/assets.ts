/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { upgradeLegacyMaterials } from '../src/game/render/glbAssets';

/** Parse the real vertex/skeleton data without a DOM or GPU; textures do not affect geometry. */
export async function readAsset(file: string) {
  const bytes = await readFile(new URL(`../assets/glb-files/${file}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.loadTexture = async () => new THREE.Texture();
    return { name: 'headless-textures' };
  });
  return loader.parseAsync(upgradeLegacyMaterials(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), '');
}
