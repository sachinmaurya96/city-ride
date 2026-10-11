/** Fetch essential city packs and scene/physics code on Play; scenery streams after driving begins. */
let preload: Promise<typeof import('./WorldScene')> | null = null;
export function preloadWorld() {
  preload ??= Promise.all([import('../game/world/worldAssets').then(m => m.loadWorldAssets()), import('./WorldScene')])
    .then(([, scene]) => scene)
    .catch(error => { preload = null; throw error; });
  return preload;
}
