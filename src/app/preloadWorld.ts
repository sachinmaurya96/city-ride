/** Starts the world download (core packs + scene/physics chunk) once; safe to call from the menu or Play. */
let preload: Promise<typeof import('./WorldScene')> | null = null;
export function preloadWorld() {
  preload ??= Promise.all([import('../game/world/worldAssets').then(m => m.loadWorldAssets()), import('./WorldScene')])
    .then(([, scene]) => scene)
    .catch(error => { preload = null; throw error; });
  return preload;
}
