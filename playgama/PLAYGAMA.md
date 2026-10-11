# City Ride — Playgama publishing information

## Game name

City Ride

## Short description

Explore a 3D city, pick up passengers, earn cash and drive a collection of supercars. Cruise, drift and build your dream garage.

## Game description

Take the wheel in City Ride, a 3D driving game set in a lively city. Start with a motorcycle, accept passenger jobs and follow the GPS to earn cash and XP. Discover detailed sports cars, supercars and luxury cars in the garage, try vehicles for free, and upgrade your favorites.

Cruise past city landmarks, weave through left-hand traffic or practice drifting with Power Brake. Animated doors and passengers bring each pickup to life. Choose your driver, switch camera views and explore at your own pace. Stop at petrol stations for free refueling, complete daily challenges and keep growing your collection. Progress saves automatically so you can return to your next ride.

## How to play

1. Press **Play** to enter the city with your equipped vehicle.
2. Accept a passenger offer, follow the GPS to the pickup, and stop in the marked area for boarding. Drive to the destination and stop again to complete the trip and collect your reward.
3. Use earnings in **Garage** to purchase vehicles, paint and upgrades. Use **Try car · free** to take an unowned showroom vehicle for a one-minute test drive.
4. To drift, accelerate and steer while holding **Power Brake**. Release Power Brake to regain grip. Hold Power Brake by itself to stop.
5. Watch the fuel gauge. Stop at a petrol station's filling area and confirm a free refill. Navigation and a free tow help when your tank runs empty.

### Desktop controls

| Action | Control |
| --- | --- |
| Accelerate | W / ↑ |
| Brake, then reverse | S / ↓ |
| Steer | A / D or ← / → |
| Power Brake / drift | Space or Shift |
| Look around | Mouse drag |
| Switch camera | C |
| Horn | H |
| Accept ride | E / Enter |
| Enter or leave a stopped car | F, or click its door |
| Open city map | M, or click the minimap |
| Pause | Esc / P |
| Recover when stuck | R, when available |

### Mobile and tablet controls

Steer with the left joystick or steering pad. Hold **Speed up** on the right to accelerate; **Reverse** brakes before reversing. Use **Power Brake** for stopping and drifting. Drag the free camera area to look around. On-screen buttons provide the horn, camera, sound, door and recovery actions. Tap the minimap for the city map. An alternative steering-and-pedals layout is available in Settings.

## Screen orientation

**Landscape.** Driving uses landscape orientation on phones and tablets. Menus and settings can be opened in portrait, but players rotate their device to drive. The portrait cover is a promotional image; it does not indicate portrait gameplay.

## Game features

- Single-player 3D city driving with traffic, signals, pedestrians, landmarks and petrol stations.
- Sixteen detailed imported sports, supercar and luxury car models, alongside motorcycle and other vehicle progression.
- Passenger pickups, GPS routes, trip rewards, cash, XP and daily challenges.
- Free one-minute showroom test drives, vehicle upgrades and paint customization.
- Drifting with fading tire tracks and collision momentum for traffic and roadside parked vehicles.
- Animated doors, driver entry and passenger boarding and exit.
- Selectable drivers, camera views, keyboard and touch controls.
- Per-vehicle fuel, free station refills and free towing when empty.
- English and Russian interface, saved progress, adjustable graphics and sound.

## Suggested listing categories and tags

Driving, Simulation, Casual, 3D, Cars, Supercars, Drifting, City, Single Player.

## Cover uploads

These dimensions come from your supplied publishing screen. Use the corresponding PNG in each slot.

| Publishing slot | Dimensions | File |
| --- | --- | --- |
| Square 1:1 | 800 × 800 | [city-ride-square-800x800.png](assets/covers/city-ride-square-800x800.png) |
| Portrait 9:16 | 1080 × 1920 | [city-ride-portrait-1080x1920.png](assets/covers/city-ride-portrait-1080x1920.png) |
| Landscape 16:9 | 1920 × 1080 | [city-ride-landscape-1920x1080.png](assets/covers/city-ride-landscape-1920x1080.png) |

The covers are promotional key art created with the built-in image generation tool using the actual game's Lamborghini and McLaren screenshots as visual references. The prompts are recorded in [cover-prompts.md](cover-prompts.md). The files in `assets/screenshots/` are real captures from the game, not generated gameplay.

## Other resources / screenshots

All screenshots are PNG at **1920 × 1080**. The `assets/screenshots/supercars/` directory contains front and rear views of all 16 imported player cars and the original Aurora Sport supercar. Sports and luxury cars are included so the complete model collection is represented. Each car keeps its actual model, paint and city surroundings; the HUD is hidden for these car portraits.

Start with the gameplay images and a few car portraits; the remaining car images provide more choices for the resource gallery. Filenames, captions, car names and image sizes are in [the screenshot manifest](assets/screenshots/manifest.json).

The [asset inventory](assets/ASSETS.md) links to both views of every car. `city-ride-publishing-kit.zip` packages this listing text, the three exact-size covers and all upload screenshots together; it is a resource kit, separate from the game build ZIP.

| Gameplay screenshot | File |
| --- | --- |
| City driving and controls | [city-driving.png](assets/screenshots/gameplay/city-driving.png) |
| Passenger job and GPS | [passenger-gps.png](assets/screenshots/gameplay/passenger-gps.png) |
| Garage and collection | [garage.png](assets/screenshots/gameplay/garage.png) |

## Build and upload files

- **Game ZIP:** run `npm run release` and upload `release/city-ride-playgama.zip` as the game build. The publishing images are uploaded separately.
- **Listing:** copy the game name, description, how-to-play text, orientation and features above into the corresponding publishing fields.
- **Images:** upload the three covers to their matching slots and selected screenshots as other resources.
- **Game configuration:** the repository's Bridge configuration is currently an ID-free placeholder. Use the configuration generated for your game before submitting the final build.

The `playgama/` directory is a publishing kit and is outside the game’s runtime assets. It is not included in the game ZIP. No build or images have been submitted to Playgama by this workflow.

## Refresh the screenshot kit

```bash
npm run build:e2e
npx vite preview --outDir dist-e2e --host 127.0.0.1 --port 4190 --strictPort
# In another terminal:
E2E_URL=http://127.0.0.1:4190/ node scripts/publishing-shots.mjs
```

Existing car images are kept by default. Use `FORCE=1` to recapture them, or `CARS=bmw_i8,mclaren_p1` to select specific cars. The e2e build provides capture helpers; the release build excludes those helpers.

After capturing, validate the complete inventory and rebuild the resource ZIP:

```bash
node scripts/package-publishing.mjs
```
