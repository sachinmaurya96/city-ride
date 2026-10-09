import * as THREE from 'three';
import type { VehicleSpec } from '../data/vehicles';
import { cabinLayout, doorPivot } from '../vehicles/cabin';

/** Cut door rectangles from long merged triangles, interpolating every texture/normal attribute. */
export function splitGeometryBox(geometry: THREE.BufferGeometry, min: THREE.Vector3, max: THREE.Vector3) {
  const names = Object.keys(geometry.attributes);
  const sizes = names.map((name) => geometry.getAttribute(name).itemSize);
  const offsets = sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));
  const pOffset = offsets[names.indexOf('position')];
  type Vertex = number[];
  const inside: Vertex[] = [], outside: Vertex[] = [];
  const triangulate = (polygon: Vertex[], output: Vertex[]) => { for (let i = 1; i < polygon.length - 1; i++) output.push(polygon[0], polygon[i], polygon[i + 1]); };
  const planes = [[0, min.x, 1], [0, max.x, -1], [1, min.y, 1], [1, max.y, -1], [2, min.z, 1], [2, max.z, -1]];
  const count = geometry.index?.count ?? geometry.getAttribute('position').count;
  for (let i = 0; i < count; i += 3) {
    let polygon: Vertex[] = [0, 1, 2].map((j) => { const index = geometry.index ? geometry.index.getX(i + j) : i + j; return names.flatMap((name) => { const a = geometry.getAttribute(name); return Array.from({ length: a.itemSize }, (_, c) => a.getComponent(index, c)); }); });
    for (const [axis, limit, sign] of planes) {
      if (!polygon.length) break;
      const kept: Vertex[] = [], discarded: Vertex[] = [];
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j], b = polygon[(j + 1) % polygon.length];
        const da = (a[pOffset + axis] - limit) * sign, db = (b[pOffset + axis] - limit) * sign;
        (da >= 0 ? kept : discarded).push(a);
        if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); const vertex = a.map((value, k) => value + (b[k] - value) * t); kept.push(vertex); discarded.push(vertex); }
      }
      triangulate(discarded, outside); polygon = kept;
    }
    triangulate(polygon, inside);
  }
  const make = (vertices: Vertex[]) => {
    const result = new THREE.BufferGeometry();
    names.forEach((name, j) => { const values = new Float32Array(vertices.length * sizes[j]); vertices.forEach((vertex, i) => values.set(vertex.slice(offsets[j], offsets[j] + sizes[j]), i * sizes[j])); result.setAttribute(name, new THREE.BufferAttribute(values, sizes[j])); });
    result.normalizeNormals(); return result;
  };
  return { inside: make(inside), outside: make(outside) };
}

export function addCutDoors(body: THREE.Group, spec: VehicleSpec, width: number) {
  const c = cabinLayout(spec);
  for (const side of [1, -1]) {
    let door = body.getObjectByName(`vehicle-door-${side}`) as THREE.Group | undefined;
    if (!door) { door = new THREE.Group(); door.name = `vehicle-door-${side}`; door.position.copy(doorPivot(spec, side)); body.add(door); }
    const min = new THREE.Vector3(side > 0 ? width * .32 : -width, c.sill, c.back);
    const max = new THREE.Vector3(side > 0 ? width : -width * .32, spec.height * .94, c.front);
    const meshes = body.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    for (const mesh of meshes) {
      const pieces = splitGeometryBox(mesh.geometry, min, max); mesh.geometry.dispose(); mesh.geometry = pieces.outside;
      if (pieces.inside.getAttribute('position').count) {
        pieces.inside.translate(-door.position.x, -door.position.y, -door.position.z);
        const leaf = new THREE.Mesh(pieces.inside, mesh.material); leaf.castShadow = mesh.castShadow; leaf.receiveShadow = true; door.add(leaf);
      } else pieces.inside.dispose();
    }
  }
}
