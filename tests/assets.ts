/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { upgradeLegacyMaterials } from '../src/game/render/glbAssets';
import type { CharacterId } from '../src/game/data/characters';

/** Source GLB (assets/glb-files) of every imported character. */
export const CHARACTER_FILES: Record<CharacterId, string> = {
  male: 'male-rover.glb', female: 'female-rover.glb', lynae: 'lynae_from_wuthering_waves.glb', cartethyia: 'cartethyia_wuthering_waves.glb',
  carlotta: 'Carlotta.glb', chisa: 'chisa.glb', zani: 'zani.glb', shorekeeper: 'shoerkeeper.glb', mint: 'mint.glb', phoebe: 'phoebe.glb',
};

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
