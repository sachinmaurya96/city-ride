# Asset audit

Audited 8 Oct 2026. All supplied files are **reference images only** (AI-style concept renders, 1672×941 PNG, ~1.6–2 MB each).
They are **not shipped** in the game (`assets/` is outside `public/` and is never imported by source code; the release
script verifies that no reference file is present in the ZIP). No 3D models, audio, or license files were supplied.

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

All runtime geometry, textures (signs), and audio are generated procedurally in code. There are no third-party
runtime assets, so there are no third-party license obligations for art/audio.

## Phase 9 additions (all procedural, no new files shipped)

- Characters: skinned meshes generated from primitives at runtime (`src/game/render/characters.ts`); no GLB/FBX,
  no textures. Animation is procedural (`charAnim.ts`); no motion-capture clips.
- Vehicles: extruded/lathed procedural geometry (`src/game/render/models.ts`).
- Shop banners and street boards: drawn with Canvas 2D at load time into one 2048×1024 atlas (vector icons, system
  font text); nothing is downloaded. Business names are fictional/generic.
