(() => {
  const { scene, camera, THREE } = window.__cr.debug.extra;
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const out = {};
  scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    let t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (o.isInstancedMesh) t *= o.count;
    if (o.frustumCulled) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      const s = g.boundingSphere.clone().applyMatrix4(o.matrixWorld);
      if (!fr.intersectsSphere(s)) return;
    }
    const k = (o.name || o.type) + ':' + (o.userData.kind === 'sphereLow' ? 'LOW' : '') + (o.isInstancedMesh ? 'I' : '') + (g.attributes.position.count > 5000 ? 'big' : '');
    out[k] = (out[k] || 0) + Math.round(t);
  });
  return out;
})()
