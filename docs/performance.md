# Performance and size measurements

All browser numbers below come from **headless Chromium with SwiftShader (software WebGL) on the development
Mac**. They are useful for *relative* comparisons (triangles, draw calls) but are **not** device performance
evidence. No physical Android/iOS device or GPU-accelerated desktop browser measurement has been performed yet.

## Graphics controls (9 October 2026)

All device categories now default to Medium for new profiles. Saved choices are respected. The earlier
mobile-user-agent rule forced every phone/tablet to Low regardless of its capability and has been removed.

| Preset | Render density cap | Shadow map | Draw distance | Prop / tree / traffic detail distance |
| --- | --- | --- | --- | --- |
| Low | 1× | Off | 210 m | 100 / 70 / 35 m |
| Medium | 1.5× | 1024 | 320 m | 170 / 90 / 45 m |
| High | 2× | 2048 | 420 m | 230 / 140 / 65 m |
| Ultra | 3× | 4096 | 560 m | 300 / 190 / 90 m |

Preset density is capped by display density. The separate Native screen control uses the full device
pixel ratio, including 3×/4× screens; Standard is 1× and Sharper is up to 2×. Shadows and view distance
have independent overrides. Enabling shadows on Low uses at least a 1024 map. Props are also limited by
the chosen viewing distance. Traffic/pedestrian limits stay within the existing pools (Ultra uses High's
22/20 limits). No automatic performance adjustment replaces a manually selected quality setting.

Canvas density comes directly from React settings, while scene systems share the resolved preset.
Fog updates with draw distance; shadow render targets are disposed/reallocated when quality changes.
MSAA is requested when the one renderer is created, so starting on Low cannot permanently disable it
when switching to High. Graphics changes preserve the renderer, physics world and active ride.

The measurements below are historical; High/Ultra detail ranges and density caps have since changed.
Browser checks verify application of settings, not frame rates on physical phones or tablets.

## Size (production `--mode playgama` build)

The table below predates the two supplied BMW models. Their GLBs add 10,209,640 unpacked bytes,
plus a lazy GLTFLoader chunk. They are fetched only when selected, and are used for the player's car and
garage preview. Traffic at that checkpoint used procedural LODs; the additional pack integration is described below. The requested asset integration
exceeds the original 5 MB release-size target. The existing release size gate remains in place.

| Item | Bytes |
| --- | --- |
| Unpacked total | 4,011,894 |
| — JavaScript (React, three, R3F, Rapier with embedded WASM, game) | ≈3,680,000 |
| — Playgama Bridge runtime (local copy) | 307,640 |
| — CSS / HTML / config | ≈26,000 |
| gzip estimate | ≈1,337,000 |
| ZIP (level 9) | ≈1,412,000 |
| External transfer at runtime | 0 |
| Budget (unpacked and ZIP) | 5,000,000 |

Rapier's compat build embeds its 1.57 MB WASM as base64 (2.24 MB JS). Option if headroom is needed: alias to
the non-compat build with a separate `.wasm` file (≈0.55 MB unpacked saving).

## Rendering load (960×540, garage street, after optimisation)

| Preset | Visible triangles (incl. shadow pass) | Draw calls |
| --- | --- | --- |
| Low (no shadows, 210 m draw distance) | ≈185 k | 70 |
| Medium (1024 shadow map, 320 m) | ≈237 k | 80 |
| High (2048 shadow map, 420 m) | ≈294 k | 87 |

Optimisations applied after the first measurement (3.27 M triangles): low-poly instanced primitives, per-block
chunk culling with a small-detail distance, sphere-canopy LOD twins sharing instance buffers, distance-limited
parked-car instancing, boxy far LOD and rounded near LOD for traffic, perimeter hedge as long boxes.

The low preset is still above the plan's ~100 k starting goal. Next candidates if real devices need it: merge
window quads per block, fewer interior trees on Low, lower Low draw distance to 170 m.

### After the character / vehicle / storefront upgrade (Phase 9, same spawn, SwiftShader)

| Preset | Triangles (incl. shadow pass) | Draw calls | Active pedestrians / cars |
| --- | --- | --- | --- |
| Low | ≈252 k | 85 | 7 / 8 |
| Medium | ≈335 k | 98 | 11 / 14 |
| High | ≈368 k | 106 | 15 / 17 |

Measured with `node scripts/dev/render-load.mjs`. The increase (+≈65 k on Low) comes from skinned pedestrians
(≈2.6 k triangles each), the player's live driver (≈6 k) and vehicle (≈3–20 k), near-LOD traffic with baked drivers
(≈5–7 k) and storefront props. Mitigations already applied: far-LOD vehicles ≈0.9–1.4 k triangles without drivers,
crowd characters at low detail, pedestrians beyond 45/90 m animated at ½ / ¼ rate, café guests instanced only within
a quality-scaled radius (≈52 m Low – 105 m High), all banners in one atlas + one draw call. Per-model budgets are
enforced by `tests/models.test.ts`. City batches (boxes/spheres/quads/trees) remain the largest share (≈200 k).

## Frame timing

SwiftShader frame rates (≈2–5 FPS) only show that frame work scales with preset; real FPS, p95 frame time, memory
over a 20-minute session and loading transfer must be recorded on actual devices (see untested list in
`docs/progress.md`).

## Simulation cost

Fixed 1/60 s Rapier step; traffic decisions every step for ≤22 pooled cars (O(n²) gap checks, n ≤ 26), pedestrians
≤20, HUD polled at 5–10 Hz (no per-frame React updates). City generation ≈80 ms on the dev machine (Node).

Traffic now uses pooled dynamic bodies with constrained vertical motion and roll/pitch. Lane AI sets bounded
velocity targets; impact pauses those targets while Rapier resolves collision momentum and braking. This replaces
kinematic path teleports. Tire marks use one dynamic geometry and a 2,048-segment ring buffer, with shader-driven
ten-second expiry; no per-mark React objects or unbounded allocation are created.

## Additional models and recorded audio (9 October 2026)

The final build includes all 11 supplied GLBs (71.16 MB unpacked) and approximately 2.1 MB of selected engine/door recordings. Files are lazy-loaded, not transferred together on startup. Only the selected garage/player model and character instances load; the 2.1 MB low-poly traffic pack loads when driving begins. No large standalone car is instantiated throughout traffic.

Imported car geometry is grouped by material **and attribute layout**; that distinction also applies to NPC batches. Prepared model instances share geometry/textures, native character instances have independent skeletons, and parsed car source geometry is released once prepared. Garage previews reuse the game's single renderer at 12.5 frames/sec. Selected high-poly characters and cars still add substantial geometry/texture cost; the earlier procedural-only FPS tables are not measurements of this build. Real phone/tablet FPS and memory need device measurement. Graphics controls remain available on all device types.

The world renders on demand in the main menu and while paused, including character/graphics settings and garage browsing. Continuous rendering resumes when driving; boot also renders continuously. This avoids competing with the animated garage preview while menus are open.

The existing 5 MB publication gate remains unchanged and is exceeded by these supplied preview assets; no release/upload was performed.
