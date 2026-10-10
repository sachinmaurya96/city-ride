import * as THREE from 'three';

/** Deformed geometry in actor coordinates, independent of the car's position, yaw and scale. */
export function characterBounds(root: THREE.Object3D) {
  root.updateWorldMatrix(true, false);
  // SkinnedMesh updates its attached bind inverse in updateMatrixWorld, not updateWorldMatrix.
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), transform = new THREE.Matrix4();
  const bounds = new THREE.Box3(), vertex = new THREE.Vector3();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
    transform.multiplyMatrices(inverse, object.matrixWorld);
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) bounds.expandByPoint(object.getVertexPosition(i, vertex).applyMatrix4(transform));
  });
  return bounds;
}
