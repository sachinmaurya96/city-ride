## Touch controls, navigation, performance and UI audit — 10 October 2026

- Both touch presets use left/right steering only on the left and independent Speed up / Reverse buttons on the right. Three fingers can steer, accelerate and use Power Brake together. Reverse brakes before backing up; canceled touches and pause clear inputs.
- Fuel driving range is four times longer (24/20/18/16 km for bike/auto/car/bus), with 12/24/80/180 L tanks and compatible saved percentages. Free pump-only filling is retained.
- Ride, bus and fuel routes end at the actual stopping area. Turn instruction distances use route curves, recovery can find progress after large jumps, and fuel rerouting preserves the selected pump.
- Main-menu startup defers WebGL/physics/world until Play or Garage. Play loads world assets and simulation code concurrently; one renderer/physics world persists across menus. NPC preparation is reused and imported city instances are culled by view and distance.
- All 25 supplied GLBs have reproducible runtime copies: 185.3 MB to 62.9 MB (66% smaller), with reduced WebP textures and lossless Meshopt geometry. Original assets, UVs, rigs, materials and credits are retained. Removed the dynamic URL glob that also bundled source models.
- UI surfaces use black/navy translucency, white text, neon-blue accents and SVG controls, including menu, HUD, garage and dialogs. Updated mobile utility/pedal positions and short-screen layout.
- Fixed contact impulses nudging a car while only Power Brake is held: the stop now applies after physics as well, while throttle-driven drifting remains active.
- Audit details and validation are recorded in [the code audit](code-audit-2026-10-10.md) and [performance report](performance.md). Production build, typecheck, lint and all 203 unit/integration tests pass. Browser checks cover responsive screens, imported cars/characters, free fuel, cabin clearance, controls, GPS and deferred loading. Physical-device speaker/FPS/memory checks remain unmeasured; the original 5 MB release budget is still exceeded.

## McLaren head clearance — 9 October 2026

- Corrected cockpit headroom: the exported rear wing is taller than the actual roof, so whole-model height allowed heads to protrude. Lowered and repositioned the shared driver/passenger seats beneath the curved cockpit.
- Added a real-geometry regression that checks head/hair clearance for both Rovers, Lynae and Cartethyia in both seats, retaining more than 75% of original character scale.
- Validation: production build, lint and 196 unit tests pass. A focused browser regression passes for all four drivers and a boarded Cartethyia passenger, measuring head clearance against the original roof mesh. Seated screenshots inspected locally.

## Supplied city, free petrol pumps, new cars and traffic fixes — 9 October 2026

- City buildings, forest trees, palms, banana trees and road/junction modules use the uploaded packs, with shared materials and distance culling. Corrected rotated junction footprints.
- Added the supplied HP petrol-station model to every street section (40 stations), with paved off-road forecourts, green filling areas and original mesh collisions. Reserved building and street-furniture space around each entrance.
- Refueling offers a free full tank with confirmation. Canceling changes nothing; wallet values never change, including when cash is zero. Filling cannot open on traffic lanes. Removed roadside emergency refilling; empty tanks offer a map/road-arrow route and optional free towing to a real pump.
- Added LP670, Black Huracán, McLaren P1 GTR, Mustang RTR and Rolls-Royce Spectre as free garage test drives. Original materials, rotating tires, physics wheel positions and seated character fit pass the real-asset audit. Traffic-pack vehicles and police remain NPC-only.
- Fixed duplicated movement in NPC physics that added acceleration while drivers tried braking. NPCs now stop behind parked players and red stop lines, reserve junction turns, yield to pedestrians, follow road speed limits and stop chasing the player. Normal lane correction is bounded; turn progress follows actual body position. Crashes still move NPCs in the impact direction, while the player does not recoil backward.
- Validation: production build, typecheck, lint and 195 unit tests pass. A two-minute traffic simulation records no spontaneous NPC crashes. Seven focused browser flows cover city/pump rendering, free filling and saved fuel, empty-tank routing/towing, all 30 imported vehicle models and the five new previews, desktop drifting and tracks, crash recoil, mobile sound/drift/doors, and zero-cash mobile refueling with the newly added McLaren. Screenshots inspected locally. Physical-device speaker output and hardware performance remain unmeasured.

## Free driving, smooth drifting and character fit — 9 October 2026

- Removed all player traffic warnings, fines, heat, pursuits and capture. Signals continue organizing NPC traffic; police cars remain ambient NPC assets.
- Player cars reach 100 km/h in roughly 2–3 seconds at full throttle and have higher top speeds. Increased car engine gain while retaining sound settings, mute and pause behavior.
- Power Brake gradually reduces rear grip and limits oversteer. Throttle preserves the slide while countersteering through center; holding only Power Brake stops immediately. Space and either Shift are desktop shortcuts, shown on the button.
- Rear tires leave bounded skid ribbons that fade during their last two seconds and disappear after ten unpaused seconds. Browser screenshots confirm both visible tracks and the restored road.
- NPCs use dynamic Rapier bodies, accept collision momentum and brake while lane AI pauses. Head-on and rear impacts move them in the physical impact direction, without snapping back to a path.
- Imported walking has clearer strides, knee bends and grounded feet. Car seating extends feet into the footwell, adjusts hip position, and fits width separately from height. Cartethyia sleeves fold into the lap. Actor-space measurements prevent further shrinking after a car moves or turns.
- Validation: production build, typecheck, lint and 152 unit/integration tests pass. Five browser flows pass for desktop drift/countersteering/instant stop/ten-second tracks/Cartethyia walking and size; real NPC impact without fines; Rover appearance/seating/save/steering reach; uploaded engine recording phases/mute; and mobile sound/two-finger drift/door entry. Screenshots inspected; physical phone/tablet speaker output and performance remain unmeasured.

## Rover defaults and supplied Supercar recording — 9 October 2026

- Male/Female driver selections now use the supplied Rover GLBs, preserving existing saves. Their original textures and UVs remain intact; runtime rigs match the lowered-arm bind poses and keep ponytails attached to the head.
- Rover drivers walk, enter/exit cars and fit every playable car's cabin. Bikes, autos and buses use vehicle-specific poses and arm IK for steering grips, with the original procedural character available while a model loads.
- Car audio uses the supplied `supercarsound.mp3`, cut in memory into start, idle, pickup, acceleration and peak-rev sections. Matched loudness, overlapping loop seams and equal-power blends track actual speed, throttle and braking. Startup plays once per engine activation; stopping or muting does not restart it.
- Validation: production build, lint and 135 unit tests pass. Three browser flows pass: Rover appearance/walking/seating/save and bike/auto/bus steering reach; real recording decode/cuts/start/speed/braking/mute; mobile audio/drift/instant stop/door entry.

## Additional supplied cars, characters and door physics — 9 October 2026

- Added six more standalone vehicles and all 17 vehicles in the traffic pack to the free garage catalog. The pack also supplies instanced ambient traffic.
- Preserved original textures, converted legacy spec/gloss materials, split merged wheels and cut hinged doors while retaining UVs. Corrected Western Star export transforms and included its six visual wheels.
- Added Lynae and Cartethyia as selectable drivers and passengers. Lynae uses her original skeleton; Cartethyia receives runtime skin weights. Character entry, sitting and exit use shared procedural animation phases.
- Driver and passenger doors open before entering and close after sitting. Door colliders track the hinges in Rapier; throttle/reverse remain braked during entry/open doors. Camera shows the relevant side.
- Sign backings now block camera queries, preventing curbside signs from hiding passengers. The camera snaps to recovered vehicles instead of sweeping across the city.
- Added local recorded engine/start/door audio. Separate bike, petrol, flat-six and diesel recordings plus tuned vehicle profiles react to throttle, RPM and virtual gears. These are engine-type approximations, not exact recordings for every garage vehicle.
- Recorded all embedded model credits/licenses and real audio sources in Credits and the asset audit. Existing release size gate is unchanged; no publishing.
- Paused menus render the world on demand instead of continuously, while the garage preview remains animated. Active driving retains the continuous render loop.
- Validation: build/typecheck/lint and 104 unit tests pass. Browser checks pass for all 25 imported vehicles and responsive menus/HUD. Final focused browser regressions pass for BMW previews/driving/save persistence, failed-download retry/mobile garage, native character door entry/exit and unobstructed passenger view, physics brake lock/audio decoding, fuel/refueling/reload, horn, live phone graphics settings and phone/tablet settings layout (7 flows).

# City Ride — progress log

Owner instructions take priority, then `plan.md`, then the cozy reference images for appearance.

## Status summary

| Phase | Status |
| --- | --- |
| 0 — Inspect, scaffold, feasibility | ✅ Complete |
| 1 — Driving and camera prototype | ✅ Complete |
| 2 — One complete ride | ✅ Complete |
| 3 — Full city and traffic | ✅ Complete |
| 4 — Road rules and police | ✅ Complete |
| 5 — Vehicle shop and upgrades | ✅ Implemented; e2e flow running (see checkpoint) |
| 6 — Buses and supercar | ✅ Implemented; per-tier e2e running (see checkpoint) |
| 7 — Daily tasks, weather, polished UI | ✅ Implemented |
| 8 — Platform integration and release | ⏳ Release script written; final run pending |

## Supplied BMW cars — 9 October 2026

- Integrated `assets/glb-files/bmw_i8.glb` and `2025_bmw_m4_gt3_evo_g82.glb` as BMW i8 and
  BMW M4 GT3 EVO in the garage. Both are free to preview/equip at level 1 using “Try car · free”.
  Ownership and equipment persist; the active-job vehicle-switch restriction remains enforced.
- Retained original finishes/textures and added shared studio reflections. Normalized export units,
  orientation and ground height, batched meshes by material, split the i8's combined rear wheels and
  straightened its posed front wheels. Wheels steer/spin/follow suspension while the body rolls/pitches.
  Pooled traffic continues to use procedural LODs.
- Assets and GLTFLoader load on demand and are shared between the one-renderer garage preview and
  player car. Previews rotate/drag, show loading/retry states and return to view when selected on mobile.
  The preview timer now actually limits readbacks to about 12.5 frames/second, matching its intended
  throttle. Imported cars use their original finish rather than charging for unsupported paint changes.
- Recorded the embedded author/source/license metadata in Credits and the asset audit. The source
  GLBs remain unchanged. The two models add 10.2 MB before compression, exceeding the original release
  size target; the existing release gate was retained and no publication was performed.
- Validation: TypeScript/production build, ESLint and all 76 Vitest tests passed. Two Playwright
  scenarios checked both real model triangle counts/materials, animated steering/spin, free selection,
  saved equipment/direct-load reflections, failed-download retry, active-ride protection and garage
  layout at 667×375, 568×320, 320×568 and 1024×768. A separate production smoke check loaded both
  hashed GLBs on demand, previewed/equipped both and entered driving with no page errors and no dev
  hooks. Screenshots were inspected. Physical-device frame rates remain unmeasured.

## Graphics controls — 9 October 2026

- Removed the rule that made every mobile user agent start on Low. New profiles use Medium on
  phones, tablets and desktops, while saved preset choices remain available.
- Graphics is now the first Settings section: Low/Medium/High/Ultra, independent image sharpness,
  shadows and viewing distance, plus a graphics-only reset. Native screen uses full display density
  without a mobile cap. High/Ultra keep city and traffic detail visible farther away.
- Fixed live application: Canvas reads the selected pixel density directly; fog follows draw distance;
  existing shadow render targets resize/dispose as needed. MSAA is requested from startup, including
  Low, so upgrading quality works without replacing the renderer or restarting a ride. Settings persist
  with backward-compatible defaults for the new fields.
- Validation: TypeScript, ESLint, production build and all 71 Vitest tests passed. Three Playwright
  scenarios passed across final verification runs: actual renderer density/shadows/fog changes on a
  3× Android-style viewport (including Low→High→Ultra→High, Native, overrides, reload, reset and active
  ride preservation), the Graphics panel at phone/tablet sizes in EN/RU with larger text, and the
  existing touch HUD overlap/gesture/map checks. Screenshots were inspected. Physical-device frame
  rates remain unmeasured.

## Responsive UI — 9 October 2026

- Replaced the scattered gameplay panels with compact edge layouts. Cash, navigation, offers and
  stop progress share the left stack. The minimap stays in the top-right corner, opens the full map
  when tapped, and has Pause beside it. Horn, brake, camera and recovery sit at the bottom right.
- Joystick and steering controls shrink to fit short landscape screens. The active joystick stays
  anchored to its home position and uses its measured size for input. Utility buttons retain 44px
  touch targets; recovery uses two columns on very short joystick layouts. Speed and fuel sit beside
  the driving control, with reserved room for emergency fuel.
- Offer details, tutorial help and bus stop lists expand on demand. Route distance and timed-ride
  countdowns remain visible. HUD text respects the existing UI scale setting.
- Layout uses dynamic viewport height and safe-area insets. Menus, settings, tasks, statistics and
  garage fit narrow or short screens with scrolling and adaptive columns. Portrait permits menus;
  the rotate prompt appears during driving. The full map redraws on viewport resize.
- Validation: TypeScript, ESLint, production build and all 63 Vitest tests passed. Seven focused
  Playwright scenarios passed across final verification runs, including the gameplay regressions.
  HUD checks covered 568×280, 667×375, 800×300, 844×390, 1024×768, 1366×768 and 1920×1080; menus also
  covered 320×568 and 390×844 portrait. Both touch presets, recovery, empty fuel, a timed ride,
  EN/RU at 130% text scale, simulated safe-area insets, real touch drag/release, corner map opening
  and map resizing were checked. Screenshots were inspected; physical devices remain untested.

## Gameplay fixes — 9 October 2026

- All curb stops display their authored destination name. Secondary pickup/dropoff sides now have
  matching landmark frontages. Airport grounds use terminals, control towers, an apron, an airliner
  and a runway instead of random office frontage and interior buildings.
- Added West and South petrol stations, curb pumps and map markers. The compact bottom-left fuel
  bar tracks distance-based consumption, low fuel and free automatic refills. Tanks persist per
  vehicle with backward-compatible save defaults. Empty tanks prevent powered forward/reverse
  movement and offer free emergency fuel, so drivers can still reach a station.
- Fixed the missing walking passengers: effect cleanup removed React Three Fiber primitives during
  StrictMode's development re-setup. Walkers now remain in the scene, board/exit over 3.2/3.6 seconds,
  retain their appearance and walk away from a frozen dropoff position after the receipt is closed.
  The curb camera and unobstructed boarding HUD make these movements visible.
- Horn playback unlocks/resumes audio before scheduling a sustained vehicle-specific horn. Mute and
  pause still apply. Passive speed UI cannot intercept clicks on the horn; touch controls have space
  around the fuel gauge.
- Validation: TypeScript, ESLint, all 63 Vitest tests and the production build passed. Four focused
  Playwright scenarios passed across final verification runs: passenger boarding/airport exit and
  departure, driving/refill/reload/emergency fuel (including empty-tank reverse prevention), keyboard
  and button horn with suspended/muted audio, and a 667×375 touch HUD overlap check. Screenshots were
  inspected. Physical-device performance and sound by ear remain unverified.

## Phase 0 — Inspect, scaffold and prove feasibility ✅

**Findings:** empty project except `plan.md` and 14 cozy reference PNGs (no models/audio). See `docs/asset-audit.md`.

**Pinned stack** (`package-lock.json` committed): Node 24.13 (`.nvmrc`), Vite 8.3.4, React/React DOM 19.2.8,
three 0.180.0, @react-three/fiber 9.8.1, @react-three/rapier 2.2.0 (→ @dimforge/rapier3d-compat 0.19.2, single runtime copy),
zustand 5.0.15, zod 4.6.5, @playgama/bridge 2.3.1, TypeScript 5.9.3 (typescript-eslint requires <6.1), Vitest 5, Playwright 1.64.
`@types/three` depends on rapier3d-compat 0.12 **for types only**; it is never imported at runtime (verified in bundle: one embedded WASM).

**Feasibility measurements (production build, `vite build`):**

| Item | Bytes |
| --- | --- |
| Rapier compat JS (WASM embedded as base64) | 2,238,467 source (raw WASM 1,569,397) |
| Phase 0 bundle (React + R3F + three + Rapier + test scene) | 3,342,840 unpacked JS, 1,149,410 gzip |
| Playgama Bridge local runtime (to be added in Phase 8) | ~307,640 |

The dependency baseline is ~3.34 MB of the 5.0 MB unpacked budget (the plan's JS sub-allocation of 3.2 MB is exceeded by ~0.14 MB
by the libraries alone). Because all models/textures/audio are procedural, the total budget remains feasible
(projected ≈3.65 MB + game code). Fallback option if needed: alias Rapier to the non-compat build with a separate `.wasm`
file (saves ~0.55 MB unpacked by avoiding base64).

**Driving feasibility** (`tests/vehicle-physics.test.ts`, headless Rapier, fixed 1/60 s):
- Rapier `DynamicRayCastVehicleController`: up axis 1, forward axis 2 (setter is named `setIndexForwardAxis`), wheel ray dir −Y, axle −X.
- Positive wheel steering angle turns left; game steer +1 = right is mapped to a negative angle (test verified).
- `currentVehicleSpeed()` returns the full velocity magnitude (includes vertical motion) — we compute signed forward speed ourselves.
- Player chassis must have `canSleep=false` (sleeping body + controller produced phantom velocity).
- Roll/pitch rotations locked on chassis (`enabledRotations(false,true,false)`) → no tipping; lean/roll are visual only.
- All 9 vehicles hit 0–40 km/h targets (3.0–10.0 s) and top speeds within 1%. Car stops from 40 km/h in 7–20 m, reverse engages after a 0.4 s hold and caps at 10 km/h, released stick auto-holds.

**Browser check:** production build served by `vite preview`, opened in headless Chromium (SwiftShader software WebGL):
scene renders, chassis drives forward and turns with W+D, chase camera follows. Console: only Rapier's init-parameter deprecation warning.
SwiftShader frame rates are not representative; real-device performance is not yet measured.

## Phase 1 — Driving and camera ✅

- Procedural toy models for all 9 vehicles, rider/passengers, lollipop trees, lamps (`src/game/render/models.ts`).
- Bike: invisible 4-ray support footprint, 2 visual wheels, speed/steer-based lean clamped ±18°; car body roll/pitch is visual only.
- Left joystick (dead zone 0.12, circle→square mapping so diagonals keep full throttle), right-side camera drag, pointer ownership by
  start region, pointer capture/cancel/lost-capture/blur/orientation reset; utility buttons (horn, brake override, camera, recover) on the left.
- Chase / high chase / handlebar cameras (C), auto re-center after 1.5 s, building + tree-canopy obstruction (camera-only colliders), FOV 60 (+5 at speed, off in reduced motion).
- Recovery (R / button) after 3 s stuck or off-road, to the last safe lane pose, with 2 s spawn protection; garage fallback.
- **Verified** (scripted Chromium, `scripts/dev`): W accelerates, S brakes then reverses (cap ≈8 km/h), release auto-holds; blur zeroes held keys;
  joystick throttle + camera drag simultaneously; `touchcancel` releases both; pushing into a parked car → Recover appears after 3 s; R relocates.
- StrictMode dev double-mount used to panic Rapier (stale world handles). Fixed by binding the controller lazily inside the physics step and
  only tearing down colliders/controllers in the world instance that created them.

## Phase 2 — One complete ride ✅

- City generator (`src/game/data/cityMap.ts` single source → roads, lanes, bays, minimap): 5×5 grid, 25 junctions, 16 blocks, 14 landmarks, 36 curb/bus bays.
- Lane graph with A* routing, turn penalties, road projection (wrong-side detection), off-route reroute (15 m / 1.5 s, ≥1 s debounce).
- Ride state machine IDLE→OFFERED→TO_PICKUP→BOARDING→TO_DROPOFF→ALIGHTING→COMPLETED, 1.2 s stop rule (bay envelope, ≤1 km/h, no throttle, ≤35°, capacity, no pursuit).
- Fixed ₹120 guided first ride (Homes West → Central Park, ~220 m); general fare formula afterwards; XP/levels; daily board; statistics.
- Versioned zod save (local mirror + backup + quarantine of corrupt data), atomic/idempotent settlement (transaction keys), mission checkpoints.
- HUD (cash/level, instruction, minimap, speed/limit, request card, stop progress, passenger chip), receipt, main menu, pause, cancel, city map,
  controls tutorial, settings, daily tasks, statistics, garage (buy/equip/upgrades/paint) — garage preview uses the shared renderer.
- **Verified:** `tests/progression.test.ts` (13 domain tests) and `tests/e2e/ride-flow.spec.ts` — guided ride + 4 ordinary rides, reload while
  heading to pickup, with passenger aboard, and with the receipt open: same job restored, wallet exact, no duplicate reward, no page errors (12.7 min on SwiftShader).

### Performance measurements (SwiftShader software WebGL, 960×540 — not device evidence)

| Step | Visible triangles | Draw calls |
| --- | --- | --- |
| First city build | 3.27 M | 81 |
| After low-poly primitives, parked-car proximity instancing, detail culling, sphere LOD | low 185 k / medium 237 k (incl. shadow pass) | 70 / 80 |

Low preset is still above the plan's ~100 k starting goal; to be tuned against real device measurements in Phase 8.

## Phase 3 — Full city and traffic ✅

- Signals: one authoritative phase function (`traffic/signals.ts`, 56 s cycle incl. 8 s pedestrian phase, offset per junction) read by lamp meshes, AI, pedestrians and red-light detection.
- Traffic: pooled kinematic cars (quality caps 8/14/22) following lane paths, headway control, stop lines (no creeping over without permission), junction reservations with protected crossing turns, player/pedestrian avoidance, off-screen spawn ≥75 m and recycle >250 m; near/far LOD.
- Pedestrians: sidewalk loops around blocks, zebra crossings only in the pedestrian phase after a time-to-contact check.
- Junction paths are fillet arcs (straight + largest tangent arc); the tightest turn now fits every vehicle's turning radius. Routing still accepts a per-vehicle minimum radius (bus routes pass it).
- **Verified:** `tests/map.test.ts` — unique ids, ≥3 approaches per signal, bays in the correct strip and clear of every building/tree/lamp/parked car (SAT test), >400 landmark pairs route legally, bus bays connect, turn radii per vehicle, no conflicting greens. Browser soak: 14 cars for 50 sim-s, longest non-signal stop 1.6 s (no deadlock).

## Phase 4 — Road rules and police ✅

- Episodes + cooldowns: speeding (limit+8 for 3 s; new fine needs 5 s compliance and 15 s), red light (front bumper crossing on red, once per approach crossing), wrong way (3 s), crossing blockage (hint first), crashes classified by measured speed loss (one incident per 1.5 s; traffic-caused contact never fines), pedestrian safety volume (serious incident, pedestrian steps aside, no repeat).
- First episode of each offense is a warning; first two jobs are tutorial-protected (no debt). Fines capped by wallet. Heat meter with decay after 15 s calm; ≥60 → pursuit by a lane-following police car that switches to direct interception; escape needs 20 s out of range after acquisition; capture after 2 s within ~6 m (bumper gap) or 60 s timeout.
- Capture: job ends, separate ₹100 impound capped by wallet, return to garage, heat cleared, game continues.
- **Verified:** `tests/rules.test.ts` (green-entry not fined, red crossing once, speeding episode debounce, traffic-caused contact not fined, crash frames counted once, pickup stop rule, ₹0 capture). Browser: forced heat 70 → police approached from 142 m → capture: wallet ₹60 → ₹0 (impound capped), capture card, job cleared.

## Phase 5 — Vehicles, shop, upgrades ✅ (implementation)

- 9 distinct procedural vehicles with their own handling (0–40 and top speed verified per vehicle), garage with shared-renderer turntable preview, buy (confirm) / equip / upgrade (4 categories × 3 tiers, cost formula) / paint; equip blocked during jobs; bike always kept.
- Ride types: standard, office rush (deadline bonus), family (2–6, capacity-checked), airport, VIP, rain; capacity filtering before offers.
- **Verified:** unit tests (double purchase, insufficient funds/level, upgrade max, derived stats after reload). e2e `shop-bus.spec.ts` buy→equip passes (purchase, no double-buy, equip, wallet ₹700); the ride part is pending a successful long run (see checkpoint).

## Phase 6 — Buses and supercar ✅ (implementation)

- Neighborhood Link (small+), Commuter Link (medium+), City Connector (long). Seeded passenger schedule never exceeds capacity; stops served once, in order; doors animate; missed stops reroute (no fail); single settlement `round(200 + 0.6·m + 35·riders)` + ≤10 % clean + ≤10 % tip.
- **Verified:** `tests/bus.test.ts` (eligibility, drivability per bus radius, occupancy ≤ capacity for 199 seeds × 3 routes × 3 buses, quote formula, pays once). Browser: small bus served stop 1 (6 riders boarded) — full e2e per tier still running.

## Phase 7 — Daily, weather, audio, polish ✅

- Daily board (deterministic per UTC day/profile), claims, carryover settlement, statistics today/lifetime; EN/RU strings; settings persist (audio buses, quality, sensitivity, control preset, camera follow, language, UI scale, reduced motion, speed limiter).
- Procedural Web Audio: engine per vehicle family, horn, chimes, warning, collision, siren, ambience, rain, optional music; unlocked on first gesture; suspended with pause; mute always wins.
- Light rain between jobs after basic mastery (grip ×0.87, visible quote modifier, streak field by quality).

## Phase 8 — Platform and release ⏳

- `src/platform/playgama.ts` uses the installed Bridge 2.3.1 API: `initialize`, `platform.sendMessage(game_ready)` once, gameplay start/stop, `storage.get/set`, `advertisement.showInterstitial/showRewarded` resolved from `*_STATE_CHANGED` events (reward only on the `rewarded` state, once), pause/visibility/audio events into the pause manager.
- Bridge runtime bundled locally (`--mode playgama`) — no external transfer. `public/playgama-bridge-config.json` is an **ID-free placeholder** (runtime falls back to defaults); it must be replaced with the official config editor output before submission.
- **Size (measured, playgama build):** 4,011,894 B unpacked (JS 3.99 MB incl. 307,640 B Bridge runtime), gzip ≈1.34 MB, ZIP ≈1.41 MB, external transfer 0 → within the 5,000,000 B budget.
- Persistence fix found by tests: a late older snapshot could replace a newer pending remote write — fixed (`tests/platform.test.ts`).

## Phase 9 — Characters, vehicles and city naming (visual upgrade, user request) ✅

Request: better-looking characters and vehicles, drivers holding the steering with driving animation, realistic
walking, separate male/female characters, named places (café, restaurant, …) with banners.

- **Skinned characters** (`src/game/render/characters.ts`): 13-bone skeleton, every rigid body part bound to one bone,
  so one build gives a live `SkinnedMesh` or a static mesh baked in any pose. Separate **male** and **female** builds
  (shoulder/hip width, height, torso shape, lashes, lips), 8 hair styles, tee/polo/jacket/long-sleeve/dress, pants/
  shorts/skirt, shoes, backpack/bag/glasses/cap, helmet for riders, faces with eyes, highlights, brows, nose, smile.
  Passenger gender follows the name on the ride card. Settings → "Your driver" switches the player's driver (male/female).
- **Animation** (`src/game/render/charAnim.ts`): gait cycle advanced by distance walked (no foot sliding); hip height
  from the planted leg so the stance foot stays on the ground (unit-tested within 2.5 cm); pelvis yaw/roll and weight
  shift (stronger hip sway for female walk), counter-rotating shoulders, arm swing with elbow bend, stabilised head,
  breathing idle with look-around, per-person walking pace, smooth turning at corners. Waiting passengers wave to hail
  the approaching vehicle, walk to the door, sit on the pillion/passenger seat, and walk away after drop-off.
- **Driving animation:** seated poses per vehicle (bike straddle, auto, car, bus, pillion, café chair); body leans back
  on throttle and forward on braking, sways in corners, head looks into turns and stays level when the bike leans,
  torso twists with the handlebar, the rider puts a foot down when the bike stops. Two-bone arm IK keeps both hands on
  the grips of a steering wheel / handlebar that actually turns with the front wheels (unit-tested: hand within 6 cm of
  the grip for bike, auto, car and bus, also with the bars turned 23°).
- **Vehicles redesigned** (`src/game/render/models.ts`): extruded side-profile bodies with soft bevels and real wheel
  arches; hollow cabins (pillars, roof, translucent glass on the player car, dashboard, seats) so the driver is visible;
  motorbike with tank, engine fins, exhaust, fork, headlight nacelle, mirrors, curved fenders; tuk-tuk style auto with
  canopy, cowl and handlebar; buses with window band, seats, destination board, opening doors; rounded tyres with
  rims/spokes. Traffic uses near LOD (with baked driver) and far LOD (no driver).
- **Named city:** 22 businesses (Sunny Café, Chai Point, Spice Route restaurant, Pizza Corner, Golden Bakery, City
  Pharmacy, Book Nook, Bloom Florist, Scoops ice cream, Fresh Mart, Style Barber, Fit Gym, City Bank, Burger Barn,
  Noodle House, Bike Repair, Toy Town, Fashion Hub, Juice Bar, Mobile Zone, Sweet Treats, Dosa Diner) on 166 storefronts,
  with banners drawn procedurally (vector icons, no image/emoji assets) into one atlas → one draw call; matching awning
  colours, A-frame menu boards, café terraces with tables, chairs, cups and 280 seated guests (instanced near the
  camera only). Green street-name boards at every junction (10 street names).
- **Budgets (unit-tested, `tests/models.test.ts`):** live character < 7 k triangles, crowd character < 3.2 k, traffic
  near LOD < 8 k incl. driver, far LOD < 3.2 k, player vehicle < 24 k.
- Dev helpers: `scripts/dev/showcase.mjs` (every vehicle + driver), `peds.mjs` (walk close-ups), `shops.mjs`
  (storefronts/street boards), `render-load.mjs` (triangles/draw calls per preset).

## Decisions

- Traffic keeps **left** (plan) even though some references show right-hand traffic.
- Each road has a 2.8 m curb strip between the outer travel lane and the sidewalk; pickup bays and parked cars live there, so stopped players never block traffic lanes and block sidewalks stay convex colliders.
- Local street lane width 3.3 m (plan 3.2 m) for comfortable bus clearance.
- All 3- and 4-arm junctions are signalized with offset cycles (no unsignalized 4-way junctions).

## Checkpoint / next actions

1. Bus-tier e2e (`npx playwright test tests/e2e/shop-bus.spec.ts`) — record results here.
2. Run `npm run release` (checks → playgama build → root + nested smoke tests → size gate → ZIP + report); record output sizes.
3. Run the full `npm run test:e2e` (ride-flow + shop-bus) on the final build.
4. Device/browser checks still to be done by a person with hardware (see below).

## Not yet verified (honest list)

- Real-device performance (Android Chrome, iOS Safari, GPU desktop Chrome/Edge/Firefox/Safari): only SwiftShader measurements exist.
- Real multi-touch on hardware (emulated CDP touch events were used), haptics/feel of the joystick, safe-area insets on notched phones.
- Audio by ear (the procedural mix has not been listened to on speakers by the agent).
- Playgama Bridge inside the actual Playgama environment (only the installed SDK API + mocked events were tested); real project config IDs are not set.
- 20-minute memory/leak soak on a device.
