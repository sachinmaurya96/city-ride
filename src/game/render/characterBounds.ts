import * as THREE from 'three';

/**
 * Deformed geometry in actor coordinates, independent of the car's position, yaw and scale. Loose cloth — skirt and
 * waist-hung meshes of generated rigs (userData.role), and vertices weighted mostly to a native rig's loose chains
 * (userData.chains: skirts, coats, sashes, tails) — is left out: seated it rests on the seat and floor, so it never decides
 * how high or how small the body sits.
 */
export function characterBounds(root: THREE.Object3D) {
  root.updateWorldMatrix(true, false);
  // SkinnedMesh updates its attached bind inverse in updateMatrixWorld, not updateWorldMatrix.
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), transform = new THREE.Matrix4();
  const bounds = new THREE.Box3(), vertex = new THREE.Vector3();
  const loose = new Set<THREE.Object3D>();
  for (const chain of (root.userData.chains ?? []) as { root: string }[]) root.getObjectByName(chain.root)?.traverse((bone) => loose.add(bone));
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.role === 'skirt' || object.userData.role === 'hang') return;
    const skinned = object instanceof THREE.SkinnedMesh ? object : null;
    if (skinned) skinned.skeleton.update();
    const looseIndex = skinned && loose.size ? skinned.skeleton.bones.map((bone) => loose.has(bone)) : null;
    const skinIndex = object.geometry.getAttribute('skinIndex'), skinWeight = object.geometry.getAttribute('skinWeight');
    transform.multiplyMatrices(inverse, object.matrixWorld);
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      if (looseIndex?.some(Boolean)) {
        let share = 0;
        for (let k = 0; k < 4; k++) if (looseIndex[skinIndex.getComponent(i, k)]) share += skinWeight.getComponent(i, k);
        if (share > .5) continue;
      }
      bounds.expandByPoint(object.getVertexPosition(i, vertex).applyMatrix4(transform));
    }
  });
  return bounds;
}
