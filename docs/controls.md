# Controls

| Input | Action |
| --- | --- |
| Left joystick (touch, default) | Steer (x), accelerate (push up), brake (pull down); hold down ≥0.4 s near standstill = reverse (≤10 km/h). Release = gentle slow-down then auto-hold. Dead zone 0.12, circle→square mapping so diagonals keep full throttle. |
| Right-side drag (touch) / mouse drag | Orbit camera (yaw free, pitch clamped); auto re-centers after 1.5 s while moving (toggle in Settings) |
| Right utility buttons | Horn · Camera mode · Sound on/off · Enter/Get out · Recover (appears when stuck) |
| Power Brake (right side, both presets) | Hold alone to stop immediately, including sideways motion. Hold while steering with the joystick or A/D to drift. Keep accelerating while countersteering through center; release the joystick/accelerator and hold only Power Brake to stop. |
| Steering + pedals (Settings alternative) | Left steering pad, right gas/brake pedals, camera drag on the remaining area |
| W/↑, S/↓, A/D | Accelerate, brake/reverse, steer |
| Space / either Shift | Power Brake; combine with steering to drift |
| Car door tap / F / Enter–Get out button | Open the driver door and enter/get out of a stopped car. Joystick or WASD moves the character outside; walk back to the door to enter. Passenger boarding and refueling finish before driver exit. |
| C | Chase → high chase → handlebar/bonnet |
| H / R / E | Horn / recover (when available) / accept offer or next ride |
| Esc / P | Pause (closes dialogs) |
| M | City map (pauses) |
| Top-right minimap | Tap to open the city map; Pause is immediately beside it |

Pointer ownership is decided at pointer-down (left zone → driving, right zone → camera) and kept until release;
`pointercancel`, lost capture, window blur, tab hide and orientation change zero every held input.
UI buttons stop propagation so they never rotate the camera.
Audio unlock uses capture listeners so these buttons also activate audio on phones and tablets. Safari
interrupted audio resumes after returning to the game. The Sound button and saved mute setting always take priority.
All player traffic warnings, fines, heat, police pursuits and capture are disabled. Signals still organize NPC traffic.
Cars reach 100 km/h in approximately 2–3 seconds at full throttle, with higher top speeds and a louder engine mix.
Power Brake eases rear grip into a controlled slide; release it to recover grip gradually. Rear tires leave dark
skid marks while drifting; each segment fades away after ten seconds of unpaused gameplay.
NPC cars receive collision momentum, brake and pause their lane AI before resuming. Head-on hits push them backward;
rear and side impacts follow the direction of the impact.

## Fuel and passenger stops

Fuel is shown at the bottom left, beside the touch joystick and below speed. A full tank lasts about 6 km on bikes,
5 km on autos, 4.5 km on cars and 4 km on buses. Fuel does not drain while parked. Each vehicle's
tank is saved independently; existing saves start with full tanks.

West Petrol Station and South Petrol Station have orange canopies, pumps, curb refill bays and ⛽
map markers. Stop in a refill bay below 1 km/h and release the accelerator for one second. A full
refill takes up to five seconds and costs no money. Leaving the bay interrupts the refill. If the
tank empties, acceleration stops and the fuel panel offers free emergency fuel (15%) to reach a pump.

During boarding and exit, passengers walk visibly between the curb and the vehicle. The camera
turns toward the landmark unless the player is actively looking around. Passengers continue walking
away after closing the receipt and stay anchored to their destination when the player drives away.

Navigation, offers and stop progress share a compact left stack. Tap the ride type to expand the
quote details, “Driving tip” to read tutorial help, or the bus panel to expand its stop list. Utility
buttons retain 44px touch targets. Menus scroll on small screens, and the map resizes with the viewport.
Portrait mode permits menus and settings; rotate to landscape to drive.

## Graphics

Open Settings from the main menu or Pause, then use the Graphics section at the top. Low/Medium/High/Ultra
set the scene detail, population, resolution and shadow quality. Image sharpness can independently use
the preset, Standard, Sharper or Native screen. Native uses the display's full pixel density. Shadows can
follow the preset or be switched on/off, and viewing distance can follow the preset or use Nearby/Far/Maximum.
Changes apply immediately and survive reloads. Reset graphics restores Medium and the three preset-based
controls without changing progress, driver, audio or driving settings. Older saves keep their chosen preset.
