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
