# Code audit — 10 October 2026

This pass reviews startup and chunk loading, imported assets, rendering and simulation ownership,
input, navigation, fuel, responsive UI, and the existing save/audio/platform boundaries. The resulting
changes target the reported control difficulty and loading cost. Source models and saved profile
formats are retained. This report describes measured checks, not a certification that every possible
browser/device interaction is bug-free.

## Findings and changes

| Finding | Result |
| --- | --- |
| A single touch joystick mixed steering and acceleration | The left joystick accepts horizontal steering only. Independent right-side Speed up and Reverse buttons work in both saved control presets. Reverse brakes before backing up. Pointer capture and cancellation release each input separately; pause, blur and rotation clear held input. |
| Fuel exhausted too quickly | Driving range is four times longer: bike 24 km, auto 20 km, car 18 km, bus 16 km. Capacities are 12/24/80/180 L. Idle consumption stays zero. Fuel percentages remain compatible with existing saves. Free filling still requires stopping and confirming at an off-road pump. |
| GPS ended on a generic curb strip rather than the destination | Ride, bus and fuel routes now use exact stop coordinates and a smooth final approach. Shared turn instructions use measured curve distances. Route progress can recover after large jumps; fuel rerouting preserves the selected station. |
| The menu waited for world packs, physics and city generation | `App` loads persistence/platform state first. `GameCanvas` is deferred until Play or Garage. `WorldScene` and world downloads start concurrently only on Play; driving is enabled after physics/colliders mount. |
| Large textures and duplicated source assets increased downloads | All 25 GLBs have generated runtime copies. Textures use 1024-pixel maximum WebP copies; Meshopt compresses geometry losslessly. Literal vehicle URLs prevent Vite's dynamic URL glob from bundling originals. |
| Texture resizing and asset preparation added runtime work | Texture encoding happens in the reproducible build tool. Prepared world batches release source geometry; failed downloads leave no rejected promise in the GLB cache. NPC mesh preparation persists across menus. |
| Imported instances outside the view still rendered | Distance culling now includes camera frustum checks with overscan, shared scratch objects and bounded updates. Original low/high quality choices remain available. |
| Bright, rounded UI and emoji menu icons looked inconsistent | Menus, HUD, settings, dialogs and garage now share dark translucent surfaces, white text, neon-blue accents and SVG control/menu icons. Short-screen touch controls and utility positions were adjusted together. |
| Documentation described obsolete garage behavior | Removed the duplicated README title and old claim that traffic-pack/police cars are selectable. Added the asset regeneration command and current controls/performance documentation. |

## Reusable boundaries

- `src/app/App.tsx` owns application state, lifecycle, platform and persistence. `GameCanvas.tsx`
  owns the single renderer; `WorldScene.tsx` owns physics and simulation components. Pausing or
  browsing the garage after a drive does not create a second renderer or destroy the physics world.
- `src/game/input/input.ts` combines independent keyboard/steering/pedal channels into one drive
  input; UI controls do not implement vehicle acceleration or drift physics themselves.
- `src/game/navigation/roadGraph.ts` owns route geometry, progress and GPS instructions. Rides,
  buses and fuel share those functions while retaining their separate mission state machines.
- `src/game/render/glbAssets.ts` centralizes decoding/caching/retry; model preparation remains
  separate for characters, cars and world instances. `scripts/optimize-assets.mjs` owns reproducible
  texture/buffer conversion and writes a per-file report.
- CSS surface/text/accent tokens and `ControlIcon.tsx` provide shared visual primitives across
  screens. Existing saved language, UI scale, control preset and graphics settings remain valid.

Existing persistence retains schema validation, backup recovery and serialized revision-aware
remote writes. Wallet/receipt/mission behavior remains covered by the domain suite. Audio retains
gesture unlock, mute/pause/platform gating and the uploaded recording's speed-dependent layers.
The NPC/player distinction remains: NPCs follow lane/signals/pedestrian rules; the player has no
traffic penalties. Power Brake with throttle still supports drifting; Power Brake alone stops the
vehicle. The supplied McLaren cockpit fit remains shared by driver and passenger.

## Measurements

All supplied model files fell from **185,309,876 bytes to 62,858,136 bytes (66%)**. World packs fell
84%, characters 75%, and vehicles 49%. The source files remain available at original quality.
Geometry, UVs, weights, joints and animation buffers decompress byte-for-byte; textures have lower
resolution and lossy WebP encoding. This reduces transfer/texture cost, not polygon counts.

The local cold-start comparison was **4,862 ms before versus 61 ms in the final optimized run**.
The browser assertion verifies no GLB or WorldScene chunk loads before the menu. These timings
come from localhost/headless Chromium, not a phone network. First Play still loads the city and
physics, and selected cars/characters load on demand.

## Verification

- Production build, TypeScript validation, ESLint and whitespace checks.
- 203 unit/integration tests across 21 files, including exact endpoints for every stop/pump from
  all four road directions, turn distances, route recovery, fuel range/rerouting, input separation,
  asset buffer equivalence, cabin fit, traffic physics, saves, economy and mission logic.
- Browser regressions for all 30 imported vehicle catalog models and five new previews; city
  resources and free/zero-cash petrol filling; all four McLaren drivers and passenger roof clearance;
  native character door entry/exit, passenger visibility, recorded engines and saved selection.
- Focused browser checks cover phone/tablet touch acceleration, reverse, three-finger drifting,
  instant braking and canceled touches; GPS arrival at pickup/dropoff; responsive HUD/menus,
  desktop controls, mobile audio/drifting, cold menu loading and graphics settings.

## Remaining practical limits

Physical Android/iPhone/iPad speaker output, hardware FPS, thermal behavior and long-session GPU
memory have not been measured. SwiftShader checks establish browser behavior, not hardware speed.
Dense standalone car/character geometry is retained; the Rolls-Royce runtime file alone is about
10 MB. Further triangle reduction would need separate visual approval and per-model LOD work.

The complete production package is about **70.4 MB unpacked / 55.2 MB ZIP**, including every
selectable model and local recording. The original **5 MB publication gate still fails** and has
not been weakened. No release upload or publishing was performed. Removing supplied content or
moving model delivery outside the release archive would be a separate product/hosting choice.
