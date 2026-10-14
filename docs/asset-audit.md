# Asset audit

The original 8 Oct 2026 files were **reference images only** (AI-style concept renders, 1672×941 PNG, ~1.6–2 MB each).
The 14 concept PNGs were removed from the codebase on 11 Oct 2026 during unused-file cleanup;
they were never imported by the game, tests or build tools. The table below records their historical design purpose.
Thirteen GLB files (eight standalone cars, a 17-vehicle pack and four characters) were supplied on 9 Oct 2026 and
are now imported as lazy-loaded runtime assets; their credits and embedded licenses are recorded below.

| File | Purpose | Runtime asset? | Used to guide |
| --- | --- | --- | --- |
| Cozy Toy Town City Ride.png | Elevated city overview, wordmark | No (reference) | City palette, landmark silhouettes (hospital, offices, mall, café, garage, bus stop), traffic lights, rounded trees |
| Cozy Toy-Town Bike Ride.png | Bike gameplay HUD | No | Bike + rider proportions, route arrows, pickup marker, top-center instruction pill, minimap circle, left joystick |
| Cozy Toy Town Ride Request.png | Ride request card | No | Request card layout (avatar, pickup/drop-off chips, passengers, distance, fare, Accept/Decline) |
| Cozy Toy-Town Cafe Pickup.png | Pickup in bay | No | Glowing bay rectangle, "Hold still" circular progress, waiting passenger on sidewalk |
| Cozy Toy Car Ride to the Mall.png | Car gameplay HUD | No | Speed + limit badge, passenger-on-board chip, level bar, drop-off sign |
| City Ride Completion at City Mall.png | Ride receipt | No | Receipt card: stars, fare lines, XP chip, next-vehicle progress, Next ride + optional ad bonus |
| Cozy City Ride Daily Challenges.png | Daily tasks | No | Three task cards, reset countdown, lifetime strip |
| Cozy Toy-Town Riding Controls.png | Controls tutorial | No | LEFT: DRIVE / RIGHT: LOOK AROUND overlay, horn/brake/camera buttons |
| Cozy toy vehicle collection.png | Vehicle lineup | No | Shapes/colors of all 9 vehicles |
| Pastel City Ride toy garage.png | Garage vehicles tab | No | Garage panel, stat bars, vehicle selector strip with Owned/price/locked chips |
| Metro Compact Garage Upgrades.png | Upgrades tab | No | Upgrade rows (Engine/Brakes/Handling/Comfort), current vs upgraded bars |
| Friendly traffic notice in a toy town.png | Police notice | No | Traffic Notice card: reason, fine, police attention meter, Continue driving |
| Neighborhood Link bus boarding.png | Bus service | No | Stop list, boarding progress, bus stop shelter, CITY RIDE bus livery |
| Stop for pedestrians at the red light.png | Red light | No | Signal hint card, speed/limit pill, "Safe driving" chip, camera drag hint |

**Conflict noted:** several references depict right-hand traffic. `plan.md` §1.2 requires left-hand driving; the plan wins.
Text inside images (fares, names, levels) is illustrative only; numbers come from `plan.md`.

## Extracted visual direction

- **Palette:** sky `#bfe6f5`→`#e9f6fb`; asphalt blue-grey `#6f7b8a`; warm cream sidewalks `#efe3cf`/curbs `#f6efe2`;
  buildings in peach `#f4b183`, butter `#f6d77a`, mint `#9ad8c6`, coral `#ef8a6f`, sky blue `#9cc8ec`, cream `#f3ead2`;
  foliage `#7cc35a` / `#5fae48`; UI navy `#14212B`, cream `#F7F5EF`, teal `#13A89E`, amber `#F4B544`, danger `#D94B4B`.
- **Buildings:** 2–6 storey toy blocks, chunky balconies, rounded parapets, striped awnings, big readable signs, glass as tinted opaque blue.
- **Vehicles:** soft rounded "toy" bodies, oversized wheels with light hubs, big round lights, simple windows.
- **Trees/props:** lollipop trees (sphere clusters on short trunks), round hedges in cream planters, globe street lamps.
- **People:** chunky capsule bodies with big round heads, simple colored clothes.
- **Lighting:** bright warm daylight, soft shadows, light haze toward the horizon.
- **UI:** cream rounded cards (14–20 px radius), navy bold headings, teal pill buttons, amber pickup accents.

## Runtime assets

City geometry, original vehicles and sign textures are procedural. Imported models and recorded engine/door audio are third-party runtime assets. Horns, music and UI tones remain procedural.

## Supplied BMW models (9 October 2026)

Metadata is taken directly from each supplied GLB's `asset.extras`. Source GLBs are retained unchanged.
Runtime adaptations center/ground/uniformly scale the meshes, batch meshes by material, separate the
i8's combined rear-wheel mesh, straighten its posed front wheels and animate wheel steering/spin/suspension.
Original materials and embedded textures are retained. Attribution is also shown in the game's Credits.

| File | Author / source | Embedded license | Bytes | Triangles |
| --- | --- | --- | --- | --- |
| `assets/glb-files/bmw_i8.glb` | [iSteven — BMW i8](https://sketchfab.com/3d-models/bmw-i8-4b143b95aec045bf8912d99662f8d580) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) | 2,747,524 | 39,933 |
| `assets/glb-files/2025_bmw_m4_gt3_evo_g82.glb` | [Ddiaz Design — BMW M4 GT3 EVO](https://sketchfab.com/3d-models/2025-bmw-m4-gt3-evo-g82-113f83dd87064697a5ec2511d280b9d5) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) | 7,462,116 | 107,980 |

The supplied licenses specify noncommercial use; the M4 additionally specifies ShareAlike.
These models are included for the requested local game preview. No publication or deployment was performed.

## Phase 9 additions (all procedural, no new files shipped)

- Characters: skinned meshes generated from primitives at runtime (`src/game/render/characters.ts`); no GLB/FBX,
  no textures. Animation is procedural (`charAnim.ts`); no motion-capture clips.
- Vehicles: extruded/lathed procedural geometry (`src/game/render/models.ts`).
- Shop banners and street boards: drawn with Canvas 2D at load time into one 2048×1024 atlas (vector icons, system
  font text); nothing is downloaded. Business names are fictional/generic.

## Additional supplied models

| File | Embedded author | Embedded license | Bytes |
| --- | --- | --- | --- |
| `cartethyia_wuthering_waves.glb` | [ilyakardailskiy](https://sketchfab.com/3d-models/cartethyia-wuthering-waves-190c6f977eaf4b038b51e0d20459da7f) | CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/) | 7,936,748 |
| `toyota_supra_a80_1993.glb` | [Lexyc16](https://sketchfab.com/3d-models/toyota-supra-a80-1993-dd897d7823784bc5893c183c1328e8cb) | CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/) | 3,291,204 |
| `arunangshubanerjee-police-car-2064.glb` | Not embedded | Not embedded | 4,830,144 |
| `lynae_from_wuthering_waves.glb` | [keqingkuki](https://sketchfab.com/3d-models/lynae-from-wuthering-waves-e59593637d424294a7361d428d9147bc) | CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/) | 15,329,904 |
| `male-rover.glb` | [ilyakardailskiy](https://sketchfab.com/3d-models/male-rover1-02-wuthering-waves-9990a963a5da4cceaee55d062a8d5439) | CC-BY-4.0 | 6,473,480 |
| `female-rover.glb` | [ilyakardailskiy](https://sketchfab.com/3d-models/female-rover1-01-wuthering-waves-094c99a017a442f1bb20b6e948264fe5) | CC-BY-4.0 | 8,310,000 |
| `2020_porsche_718_spyder.glb` | [007](https://sketchfab.com/3d-models/2020-porsche-718-spyder-433c9de37b8a46e18fccfa1c90b5ac27) | CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/) | 9,304,984 |
| `traffic_racer_npc_vehicles_pack.glb` | [Mason](https://sketchfab.com/3d-models/traffic-racer-npc-vehicles-pack-8825234a326d4c219fe79af52608d62d) | CC-BY-NC-4.0 (http://creativecommons.org/licenses/by-nc/4.0/) | 2,130,580 |

Source GLBs are unchanged. The Traffic Racer pack and Police Cruiser are used only as batched NPC traffic; their closed geometry stays intact and they cannot be purchased or equipped. Player cars are normalized and split into animated wheel and hinged door groups. Tire bounds determine wheel pivots; brake calipers stay with the steering group and body/suspension fragments stay with the chassis. Physics support points are calibrated to the imported tires. Each visual wheel follows its own support axle rather than the average suspension of the entire car. Legacy specular/gloss materials are converted before loading so original diffuse textures survive.

Lynae retains her supplied 406-bone skeleton. Cartethyia and both Rover files have no skeleton, so runtime skin weights and an articulated rig are generated around their original textured geometry. Rover rigs match their lowered-arm bind poses; long ponytails stay attached to the head. Male and Female now select Rover by default, including existing saved selections. Cartethyia's hanging sleeves follow the arms, fold into the lap when seated, and lower clothing follows the legs. Walking uses distinct alternating strides, stronger knee bends, flat soles and grounded hip height. None of these files contains animation clips; walking, reaching, crouching and seating are procedural poses, not motion capture. Imported riders use vehicle-specific seating and arm IK for moving steering grips. Legs extend into the car footwell. The seated fit adjusts hip height and width separately, retaining character height while keeping hair, clothes and feet within the cabin. Bounds are measured in actor coordinates so driving, turning and re-rendering cannot cause progressive shrinking. The fit applies to both the driver and lead passenger. Doors open before crossing the sill and close after seating; opening doors have Rapier colliders and throttle/reverse are locked during entry. Drivers can tap a stopped car's door to get out, walk outside with collision sweeps, and return to enter.

Carlotta, Chisa, Zani and Mint keep their supplied skeletons (MMD-style for Carlotta and Zani, Kuro Bip001 for Chisa, NTE's dashed Bip001 for Mint); limb bones are matched by name, and Kuro's auxiliary hip/shoulder deform bones (Leg_/Shoulder_ M/F/B, also on Lynae) take half of their limb's turn so hips and shoulders do not tear. Loose chains are posed kinematically instead of by cloth physics: waist skirt panels drape over the thighs (front most, back least), coats, capes, sashes, ribbons and wide sleeves keep hanging when the body leans, long cloth lies along the seat when sitting, and tails hang when standing and curl behind the hips when seated (Zani's horizontal bind-pose tail droops into a J). Shorekeeper and Phoebe have no skeleton: their joints were measured from orthographic renders and slice centrelines (wrists where the hand starts, as on Carlotta's native skeleton in the same A pose; spine pivot just above the pelvis like Kuro's Bip001Spine) and skinned with continuous torso/arm, pelvis/thigh and left/right blends; head meshes (hair, hood, hat) follow the head, and Phoebe's sash and tassel hang from the waist. Mint's unlit NTE materials are converted to lit ones. New characters are scaled so their eyes sit at 1.525 m like the original female characters, so horns, hats and bows add height instead of shrinking the body. Seat fitting ignores loose cloth (it rests on the seat), and drivers who cannot reach the wheel fully leaned slide the seat forward up to 7 cm.

Embedded licenses are preserved, including the noncommercial/share-alike models. The Police Cruiser file has no embedded author/license metadata. This integration does not establish redistribution rights for those files or change the existing release size gate. No release/upload is performed.

## Recorded audio

Recordings are stored locally and fetched lazily. The owner's `supercarsound.mp3` is 37.872 seconds, stereo, 48 kHz. Light player cars use its start (.55–2.25 s), idle (3–4.4 s), pickup (11.9–12.8 s), acceleration (16.05–16.95 s) and peak-rev (30.45–31.6 s) sections. These are cut in memory, with overlapping loop seams and matched layer loudness. Equal-power blends follow actual speed relative to each car's top speed, with throttle affecting load, pitch and low-speed revs; braking reduces load. Startup plays once when the engine becomes active, and stopping at a light does not replay it. Muting/pausing suspend the mixer normally. Heavy diesel and bike/auto profiles retain their separate recordings. Profile-specific pitch/RPM ranges distinguish the cars; recordings are engine-type approximations.

Audio unlock now captures pointer, touch and keyboard gestures before control buttons can stop propagation. A silent buffer primes the context even when a Play/menu tap has not yet cleared the pause state. Focus and visibility restoration resume suspended or Safari `interrupted` contexts. Supported Safari versions use `navigator.audioSession.type = 'playback'`, with a silent media-element bridge for older iOS; this addresses the speaker/ringer behavior described in [WebKit's audio issue](https://bugs.webkit.org/show_bug.cgi?id=237322). User mute, platform mute and pause continue to gate output. Browser tests verify decoding and lifecycle behavior; physical iPhone/iPad speaker output still needs device validation.

| Local file | Creator / source | License |
| --- | --- | --- |
| `supercarsound.mp3` | Supplied by the project owner | Not embedded; source file preserved |
| `petrol-loop.wav` | [domasx2](https://opengameart.org/content/racing-car-engine-sound-loops) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `engine-start.wav` | [looneybits](https://opengameart.org/content/car-engine-start-01) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `door-open.wav / door-close.wav` | [looneybits](https://opengameart.org/content/cardoorsfx) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `flat6-recording.mp3` | [mharo](https://freesound.org/people/mharo/sounds/55727/) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `truck-recording.mp3` | [qubodup](https://freesound.org/people/qubodup/sounds/187564/) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `bike-recording.mp3` | [lmbubec](https://freesound.org/people/lmbubec/sounds/119455/) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |

Freesound assets use the public high-quality MP3 previews. Loop regions are selected and seam-crossfaded in memory; source files are preserved. Car-door opening/closing and engine-start sounds come from real recordings.


### Uploaded city resources and October 9 additions

Generic street buildings, forest trees, palms, banana trees and road/junction modules use the
supplied city GLBs with shared original materials, instancing and distance culling. The supplied
HP petrol-pump GLB is placed once per undirected street section (40 stations). Its actual mesh
provides wall/post collisions, while each marked filling area remains off the road. Station
frontages are reserved during generation so buildings and street trees leave clear entrances.

The LP670, Black Huracán, McLaren P1 GTR and Mustang RTR are lazy-loaded
player garage cars. Export offsets and units are normalized; the LP670 export's rotated axles
are straightened. Wheel geometry, physics support points, cabin fit and texture preservation
are covered by the real-asset audit. Attribution is copied from embedded GLB metadata into
`src/game/data/assetCredits.ts`. Source files remain unchanged.

The McLaren's rear wing is taller than its cockpit roof. Its shared cabin layout therefore
uses measured cockpit headroom and adjusted seat positions for driver and passenger, rather
than deriving headroom from the whole-model height. A real-geometry regression checks head
and hair vertices against the curved roof for both Rovers, Lynae and Cartethyia in both seats.

### Optimized runtime copies — 10 October 2026

All 25 source GLBs remain unchanged in `assets/glb-files`. The runtime loads
`assets/optimized/{world,characters,vehicles}` copies generated by `npm run optimize:assets`.
The script uses Chromium to encode textures as WebP at quality 0.9, at most 1024 pixels on either
axis, with alpha retained. Building color/emissive atlases retain 2048 pixels for facade detail;
their solid walls render in the opaque depth pass. Meshopt compresses the original geometry buffers losslessly; positions,
normals, UVs, skin weights, joints and animation data are verified after decompression against
source bytes. Embedded credits/licenses, nodes, materials and skeleton metadata are preserved.

The generated `assets/optimized/report.json` lists each source/runtime size. Total model bytes fell
from 185,309,876 to 62,858,136 (66%). This trades texture resolution/encoding for lower transfer and
GPU texture memory; it does not lower triangle counts. Source assets are kept for future quality
variants. Browser checks load all 30 catalog models, the newer garage previews, city packs and all
four McLaren driver profiles using the optimized copies.

### October 10 cars and billboard pack

The Rolls-Royce Spectre, Western Star 4900, Fast 72 and Classic Sport were withdrawn at the owner's request; their
source and runtime GLBs, thumbnails and credits are removed. Saves migrate before validation: Spectre owners receive
the Ghost (or a refund if they already own one); the other three are refunded what the journal shows was paid, else
their last listed price. Equipped cars and in-progress rides move to a valid car.

| File | Author / source | Embedded license | Bytes | Runtime bytes |
| --- | --- | --- | --- | --- |
| `2016_mansory_mercedes-amg_gt_s.glb` | [Ddiaz Design](https://sketchfab.com/3d-models/2016-mansory-mercedes-amg-gt-s-7c9588bf4838471bb1814a80450c0773) | CC-BY-NC-SA-4.0 | 7,377,956 | 3,255,000 |
| `2020_naran_hyper_coupe.glb` | [Ddiaz Design](https://sketchfab.com/3d-models/2020-naran-hyper-coupe-70d0d11e85a4451997b4bc5a8b64cf9d) | CC-BY-NC-SA-4.0 | 6,651,004 | 3,012,432 |
| `aston-martin.glb` | [_Sheep19 — 2011 Aston Martin One-77](https://sketchfab.com/3d-models/2011-aston-martin-one-77-57d0b9062aab4e079fbb8d06bf39baf4) | CC-BY-4.0 | 2,343,492 | 1,083,048 |
| `audi.glb` | [Ddiaz Design — 2011 Audi R8 GT](https://sketchfab.com/3d-models/2011-audi-r8-gt-82a564b96dde47a78925d9e45b78aaa1) | CC-BY-NC-SA-4.0 | 11,848,772 | 6,303,860 |
| `bmw_m4_widebody__www.vecarz.com.glb` | [vecarz](https://sketchfab.com/3d-models/bmw-m4-widebody-wwwvecarzcom-a5687befab084efdba9a5c99a9a8ad4c) | CC-BY-NC-SA-4.0 | 22,503,452 | 12,524,608 |
| `m3gtr.glb` | [kevin (ケビン) — 2001 BMW M3 GTR (E46)](https://sketchfab.com/3d-models/2001-bmw-m3-gtr-e46-nfsmw-7deca432dbda4298893988813528b9c8) | CC-BY-4.0 | 9,173,452 | 4,683,104 |
| `rolls-royce_ghost.glb` | [Black Snow](https://sketchfab.com/3d-models/rolls-royce-ghost-4a590f4afa094fa8b407a14db77a63a8) | CC-BY-4.0 | 37,357,368 | 17,077,136 |
| `billboard.glb` | [staticcc — Low-poly Billboard Pack](https://sketchfab.com/3d-models/low-poly-billboard-pack-f5da73b8050a4e7d9fce53b6171ccbc7) | CC-BY-4.0 | 9,239,940 | 502,680 |

Each car is scaled so its measured wheelbase matches the real car (AMG GT 2.63 m, Naran on the BMW M8's 2.83 m —
no published length —, One-77 2.79 m, R8 2.65 m, M4 2.86 m, E46 M3 2.73 m, Ghost 3.30 m; all within 4 mm). Cabins
are measured from the geometry: the steering-wheel rim by a ring fit on its connected component, the hip on the
ray-cast cushion ahead of the backrest, the headliner and footwell by vertical rays, and door seams traced on 300–800
px/m blueprints. Window glass leaning inward above the beltline is followed by a measured glass line, so frameless
windows and frames open with the door while headliners, pillars, seats and the M3's roll cage stay put. The Ghost
is right-hand drive as supplied; the others are left-hand drive and get the usual mirrored cockpit. The AMG's brake
calipers use a `Tire_Brake` material; brake parts no longer count as tyre when locating wheel hubs.

The billboard pack contains three identical double-faced structures (6.62 × 6.85 × 2.02 m) in one frame mesh; they
are split by nearest ad panel and placed beyond the Ring Road hedge, square to the road so each traffic direction reads one face. Their ad artwork
(Pepsi, BMW and a car-dealer poster) is part of the supplied model and shows real brands.
