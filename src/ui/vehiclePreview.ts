import * as THREE from 'three';
import { VEHICLES, type VehicleId } from '../game/data/vehicles';
import { buildStaticVehicleGeometry } from '../game/render/models';
import { MATERIALS } from '../game/render/materials';
import { runtime } from '../game/core/runtime';

// Garage previews rendered with the ONE shared WebGLRenderer into a small render target,
// then copied to a 2D canvas (no second renderer or physics world).

let scene: THREE.Scene | null = null;
let cam: THREE.PerspectiveCamera;
let rt: THREE.WebGLRenderTarget | null = null;
let mesh: THREE.Mesh | null = null;
const geoCache = new Map<string, THREE.BufferGeometry>();
let pixels = new Uint8Array(0);

function ensure(w: number, h: number) {
  if (!scene) {
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#d9c9ad', 2.2));
    const d = new THREE.DirectionalLight('#fff3dc', 2.2);
    d.position.set(4, 8, 6);
    scene.add(d);
    const turntable = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.2, 48), new THREE.MeshStandardMaterial({ color: '#efe3cf', roughness: 0.9 }));
    turntable.position.y = -0.1;
    turntable.name = 'turntable';
    scene.add(turntable);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 64), new THREE.MeshBasicMaterial({ color: '#f4b544' }));
    ring.rotation.x = Math.PI / 2;
    ring.name = 'ring';
    scene.add(ring);
    cam = new THREE.PerspectiveCamera(32, w / h, 0.1, 200);
  }
  if (!rt || rt.width !== w || rt.height !== h) {
    rt?.dispose();
    rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    pixels = new Uint8Array(w * h * 4);
  }
}

export function renderVehiclePreview(canvas: HTMLCanvasElement, id: VehicleId, paint: string, yaw: number, bg = '#f7efe1') {
  const renderer = runtime.renderer;
  if (!renderer) return false;
  const w = canvas.width;
  const h = canvas.height;
  ensure(w, h);
  const spec = VEHICLES[id];
  const key = id;
  let geo = geoCache.get(key);
  if (!geo) {
    geo = buildStaticVehicleGeometry(spec, '#ffffff', false);
    geoCache.set(key, geo);
  }
  if (!mesh) {
    mesh = new THREE.Mesh(geo, MATERIALS.world);
    scene!.add(mesh);
  }
  mesh.geometry = paintGeometry(id, paint, geo);
  mesh.rotation.y = yaw;
  const L = Math.max(spec.length, 1.8);
  const table = scene!.getObjectByName('turntable')!;
  const ring = scene!.getObjectByName('ring')!;
  table.scale.set(L * 0.65, 1, L * 0.65);
  ring.scale.set(L * 0.65, L * 0.65, 1);
  const dist = L * 1.55 + spec.height * 1.2 + 1.2;
  cam.aspect = w / h;
  cam.position.set(dist * 0.75, spec.height * 0.9 + dist * 0.32, dist * 0.75);
  cam.lookAt(0, spec.height * 0.42, 0);
  cam.updateProjectionMatrix();
  scene!.background = new THREE.Color(bg);
  const prevTarget = renderer.getRenderTarget();
  const prevShadow = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(rt);
  renderer.render(scene!, cam);
  renderer.readRenderTargetPixels(rt!, 0, 0, w, h, pixels);
  renderer.setRenderTarget(prevTarget);
  renderer.shadowMap.enabled = prevShadow;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
  return true;
}

const painted = new Map<string, THREE.BufferGeometry>();
/** Bake paint into tinted vertices (cached per vehicle+paint). */
function paintGeometry(id: VehicleId, paint: string, base: THREE.BufferGeometry) {
  const key = `${id}|${paint}`;
  let g = painted.get(key);
  if (g) return g;
  g = base.clone();
  const col = g.getAttribute('color') as THREE.BufferAttribute;
  const mask = g.getAttribute('tintMask') as THREE.BufferAttribute;
  const c = new THREE.Color(paint);
  for (let i = 0; i < col.count; i++) {
    if (mask.getX(i) > 0.5) col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
  }
  painted.set(key, g);
  if (painted.size > 24) {
    const first = painted.keys().next().value as string;
    painted.get(first)?.dispose();
    painted.delete(first);
  }
  return g;
}
