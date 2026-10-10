# Controls

| Input | Action |
| --- | --- |
| Left joystick (touch, default) | Steer left/right only; vertical movement never accelerates or reverses. Horizontal dead zone 0.12. |
| Right Speed up / Reverse pedals (both touch presets) | Hold Speed up to accelerate. Hold Reverse to brake, then reverse near standstill. Release Speed up to coast. Steering and each pedal keep independent pointer ownership. |
| Right-side drag (touch) / mouse drag | Orbit camera (yaw free, pitch clamped); auto re-centers after 1.5 s while moving (toggle in Settings) |
| Right utility buttons | Horn · Camera mode · Sound on/off · Enter/Get out · Recover (appears when stuck) |
| Power Brake (right side, both presets) | Hold alone to stop immediately, including sideways motion. Hold Speed up and Power Brake together while steering to drift; release Speed up while keeping Power Brake held to stop. |
| Steering + pedals (Settings alternative) | Left steering pad, right gas/brake pedals, camera drag on the remaining area |
| W/↑, S/↓, A/D | Accelerate, brake/reverse, steer |
| Space / either Shift | Power Brake; combine with steering to drift |
| Car door tap / F / Enter–Get out button | Open the driver door and enter/get out of a stopped car. Outside, the left control turns the character and right pedals move forward/back; WASD also works. Walk back to the door to enter. Passenger boarding and refueling finish before driver exit. |
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

Fuel is shown at the bottom left, beside the touch joystick and below speed. A full tank lasts about 24 km on bikes,
20 km on autos, 18 km on cars and 16 km on buses. Capacities are 12/24/80/180 litres respectively.
Fuel does not drain while parked. Each vehicle's
tank is saved independently; existing saves start with full tanks.

Every street section has an HP petrol pump model with an off-road paved forecourt and green filling
area. Stop below 1 km/h and release the accelerator; a confirmation offers a free full tank.
Canceling changes nothing, and money is never required or deducted. Filling is available only at
pumps. When empty, acceleration stops: tap **Navigate to petrol pump** for the map route and
road arrows, then optionally **Tow to petrol pump · Free** to reach it without roadside refilling.
Ride, bus and petrol routes finish at the actual stopping-area center. Turn distances use measured
route curves, and a petrol detour keeps the selected station as its destination.

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
