import * as THREE from 'three';

/**
 * Vertex-colored standard material. With InstancedMesh + instanceColor, only vertices whose
 * `tintMask` attribute is 1 take the instance color (car bodies, shirts), the rest keep their own color.
 */
function makeTintMaterial(opts: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, ...opts });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tintMask;')
      .replace('vColor.xyz *= instanceColor.xyz;', 'vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, tintMask);');
  };
  m.customProgramCacheKey = () => 'tint-v1';
  return m;
}

export const MATERIALS = {
  /** Static merged city geometry and props. */
  world: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
  /** Instanced primitive batches: color comes from instanceColor only. */
  inst: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.86, metalness: 0 }),
  /** Instanced tintable models (traffic, people). */
  tint: makeTintMaterial(),
  markings: new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }),
};

const cache = new Map<string, THREE.MeshStandardMaterial>();
/** Shared solid-color material for the few individually rendered meshes (player vehicle, passengers). */
export function solid(color: THREE.ColorRepresentation, opts: { rough?: number; emissive?: string; metal?: number } = {}) {
  const key = `${new THREE.Color(color).getHexString()}|${opts.rough ?? 0.7}|${opts.emissive ?? ''}|${opts.metal ?? 0}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.7,
      metalness: opts.metal ?? 0,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
      emissiveIntensity: opts.emissive ? 0.6 : 0,
    });
    cache.set(key, m);
  }
  return m;
}
