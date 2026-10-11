/** Dimensions and handling are game tuning values, not manufacturer specifications. */
export const EXTRA_CARS = [
  { id: 'lambo_lp670', name: 'Lamborghini LP670', file: 'lambo.glb', length: 4.70, width: 2.05, height: 1.24, radius: .33, wheelbase: 2.70, mass: 1600, speed: 250, engine: 'v8', yaw: .242 },
  { id: 'black_huracan', name: 'Black Lamborghini Huracán', file: 'black-lambo.glb', length: 4.65, width: 2.33, height: 1.13, radius: .33, wheelbase: 2.62, mass: 1550, speed: 250, engine: 'v8' },
  { id: 'mclaren_p1', name: 'McLaren P1 GTR', file: 'mclaren.glb', length: 4.73, width: 2.00, height: 1.43, radius: .33, wheelbase: 2.68, mass: 1500, speed: 260, engine: 'v8' },
  { id: 'mustang_rtr', name: 'Ford Mustang RTR', file: 'mustang.glb', length: 4.82, width: 2.08, height: 1.39, radius: .34, wheelbase: 2.72, mass: 1750, speed: 230, engine: 'v8' },
  { id: 'porsche_718', name: 'Porsche 718 Spyder', file: '2020_porsche_718_spyder.glb', length: 4.43, width: 1.80, height: 1.28, radius: .34, wheelbase: 2.47, mass: 1450, speed: 210, engine: 'flat6' },
  { id: 'supra_a80', name: 'Toyota Supra A80', file: 'toyota_supra_a80_1993.glb', length: 4.52, width: 1.81, height: 1.27, radius: .33, wheelbase: 2.55, mass: 1550, speed: 205, engine: 'inline6' },
  { id: 'police_car', name: 'Police Cruiser', file: 'arunangshubanerjee-police-car-2064.glb', length: 4.65, width: 2.15, height: 1.8, radius: .36, wheelbase: 2.8, mass: 1650, speed: 100, engine: 'v8' },
  { id: 'mercedes_maybach', name: 'Mercedes-Maybach', file: 'maercedes.glb', length: 5.47, width: 2.12, height: 1.52, radius: .39, wheelbase: 3.40, mass: 2700, speed: 250, engine: 'v8' },
  { id: 'amg_gt_mansory', name: 'Mansory Mercedes-AMG GT S', file: '2016_mansory_mercedes-amg_gt_s.glb', length: 4.68, width: 2.08, height: 1.28, radius: .33, wheelbase: 2.63, mass: 1570, speed: 250, engine: 'v8' },
  { id: 'naran_hyper', name: 'Naran Hyper Coupe', file: '2020_naran_hyper_coupe.glb', length: 5.21, width: 2.31, height: 1.36, radius: .37, wheelbase: 2.83, mass: 1620, speed: 265, engine: 'v8' },
  { id: 'aston_one77', name: 'Aston Martin One-77', file: 'aston-martin.glb', length: 4.58, width: 2.20, height: 1.23, radius: .344, wheelbase: 2.79, mass: 1630, speed: 255, engine: 'v12', yaw: Math.PI / 2 },
  { id: 'audi_r8_gt', name: 'Audi R8 GT', file: 'audi.glb', length: 4.42, width: 2.03, height: 1.26, radius: .339, wheelbase: 2.65, mass: 1520, speed: 250, engine: 'v10' },
  { id: 'bmw_m4_widebody', name: 'BMW M4 Widebody', file: 'bmw_m4_widebody__www.vecarz.com.glb', length: 4.92, width: 2.09, height: 1.39, radius: .33, wheelbase: 2.86, mass: 1725, speed: 245, engine: 'inline6' },
  { id: 'bmw_m3_gtr', name: 'BMW M3 GTR (E46)', file: 'm3gtr.glb', length: 4.63, width: 1.90, height: 1.30, radius: .327, wheelbase: 2.73, mass: 1350, speed: 240, engine: 'v8' },
  { id: 'rolls_ghost', name: 'Rolls-Royce Ghost', file: 'rolls-royce_ghost.glb', length: 5.49, width: 2.13, height: 1.57, radius: .397, wheelbase: 3.30, mass: 2435, speed: 220, engine: 'v12lux' },
  ...([
    ['hummer', 'Hummer', 'hummer_0', 4.9, 2.0, 1.9],
    ['jeep', 'Jeep Commander', 'jeep_commander_1', 4.8, 1.9, 1.8],
    ['lada_combi', 'Lada Combi', 'lada_combi_2', 4.2, 1.65, 1.5],
    ['lada_coupe', 'Lada Coupe', 'lada_coupe_3', 4.1, 1.65, 1.45],
    ['lada_kalina', 'Lada Kalina', 'lada_kalina_4', 4.0, 1.7, 1.5],
    ['lancer', 'Lancer Evo', 'lancer_evo_5', 4.5, 1.8, 1.5],
    ['gazelle', 'Gazelle Minibus', 'gazel_bus_6', 5.5, 2.0, 2.5],
    ['ambulance', 'Ambulance', 'ambulans_yeni_7', 5.8, 2.1, 2.6],
    ['scania', 'Scania Coach', 'scania_bus_8', 10.5, 2.5, 3.2],
    ['hiace', 'Toyota Hiace', 'toyota_hiace_9', 5.0, 1.9, 2.2],
    ['volvo', 'Volvo XC90', 'volvo_xc90_10', 4.8, 1.95, 1.8],
    ['truck3', 'Cargo Truck', 'truck3_14', 7.6, 2.4, 3.2],
    ['truck2', 'Box Truck', 'truck2_18', 7.1, 2.4, 3.1],
    ['truck1', 'City Truck', 'truck1_21', 6.5, 2.3, 3.0],
    ['pickup', 'Pickup', 'pickup_new_24', 5.4, 2.0, 1.8],
    ['isuzu', 'Isuzu Delivery', 'isuzu001_25', 6.0, 2.1, 2.9],
    ['tir', 'Highway Truck', 'tir_31', 11.5, 2.5, 3.6],
  ] as const).map(([id, name, node, length, width, height]) => ({
    id: `pack_${id}` as const, name: name as string, file: 'traffic_racer_npc_vehicles_pack.glb', node: node as string,
    length: length as number, width: width as number, height: height as number,
    radius: (height as number) > 2.4 ? .45 : .34,
    wheelbase: (length as number) * .62, mass: (height as number) > 2.4 ? 3800 : 1550,
    speed: (height as number) > 2.4 ? 70 : 90, engine: (height as number) > 2.4 ? 'diesel' : 'petrol', yaw: -Math.PI / 2,
  })),
] as const;
export type ExtraVehicleId = typeof EXTRA_CARS[number]['id'];

type P3 = readonly [number, number, number];
/**
 * Cabins measured from each model (model space after normalisation, metres, +X = the car's left), by ray-casting
 * seat cushions/backrests and fitting the steering-wheel rim:
 * - wheel: rim centre, face normal (toward the driver) and rim radius; hip: the driver's hip point on the seat
 *   (moved forward where the measured seat leaves the wheel out of reach, as a driver would adjust it);
 *   roof: headliner height over the seat (null = open top); floor: footwell floor.
 * - lhd: the supplied model is left-hand drive. Traffic keeps left here, so at load the dashboard and steering
 *   wheel are mirrored to the right-hand side (the exterior, with its badges and text, is untouched); values are
 *   given as measured, before that mirror. copySeat: z-range of a single race seat that is mirrored as a copy,
 *   so the passenger side gets one too.
 */
/**
 * Door panel: side-view outline (z, y) traced on the panel seams, the outer skin and the inner trim (|x|), and how it
 * opens: 'swing' (hinged at the front edge), 'coach' (rear-hinged), 'scissor' (up about the front edge), 'dihedral'
 * (up and out from the A-pillar) or 'gullwing' (up from the roof edge).
 */
export type DoorStyle = 'swing' | 'coach' | 'scissor' | 'dihedral' | 'gullwing';
/**
 * glass: window glass and frames lean inward above the beltline (tumblehome), so from `from` up to `top` the trim
 * depth eases linearly to `inner`, measured just inside the glass and outside the headliner, pillars and seats.
 */
export interface CarDoor { outline: readonly (readonly [number, number])[]; skin: number; inner: number; style?: DoorStyle; glass?: { from: number; top: number; inner: number } }
export interface CarCabin { /** Only the doors are measured (no interior to sit in or steer). */ doorOnly?: boolean; lhd?: boolean; wheel: { centre: P3; normal: P3; radius: number }; hip: P3; roof: number | null; floor: number; swapFrom?: number; copySeat?: readonly [number, number]; door?: CarDoor }
export const CAR_CABINS: Partial<Record<string, CarCabin>> = {
  bmw_m4_gt3: { lhd: true, wheel: { centre: [.367, .675, .014], normal: [0, .16, -.99], radius: .154 }, hip: [.367, .392, -.326], roof: 1.26, floor: .14, swapFrom: -.06, copySeat: [-.85, -.06] , door: { outline: [[.815, .2], [.815, .92], [.37, 1.2], [-.54, 1.17], [-.48, .2]], skin: .925, inner: .82 } },
  lambo_lp670: { lhd: true, wheel: { centre: [.379, .714, .551], normal: [0, .31, -.95], radius: .167 }, hip: [.379, .435, .132], roof: 1.104, floor: .19 , door: { outline: [[.74, .3], [.74, .82], [.46, 1.08], [-.41, 1.08], [-.3, .82], [-.26, .3]], skin: .925, inner: .7, style: 'scissor' } },
  black_huracan: { lhd: true, wheel: { centre: [.367, .662, .363], normal: [0, .31, -.95], radius: .145 }, hip: [.367, .415, -.11], roof: 1.106, floor: .26 , door: { outline: [[.75, .17], [.75, .7], [.24, 1.03], [-.57, 1.0], [-.64, .8], [-.39, .2]], skin: .965, inner: .7 } },
  mclaren_p1: { lhd: true, wheel: { centre: [.331, .706, .468], normal: [0, .23, -.97], radius: .143 }, hip: [.331, .301, .046], roof: 1.019, floor: .12 , door: { outline: [[.64, .3], [.6, .93], [.15, 1.02], [-.55, .95], [-.62, .6], [-.5, .3]], skin: .912, inner: .74, style: 'dihedral' } },
  mustang_rtr: { lhd: true, wheel: { centre: [.371, .893, .227], normal: [0, .42, -.91], radius: .157 }, hip: [.371, .534, -.144], roof: 1.339, floor: .27 , door: { outline: [[.77, .27], [.77, .93], [.15, 1.27], [-.66, 1.2], [-.62, .92], [-.47, .27]], skin: .906, inner: .65 } },
  porsche_718: { lhd: true, wheel: { centre: [.347, .844, .192], normal: [0, .15, -.99], radius: .141 }, hip: [.347, .377, -.234], roof: null, floor: .23 , door: { outline: [[.65, .37], [.65, .81], [.29, 1.12], [-.45, .95], [-.56, .83], [-.5, .41]], skin: .872, inner: .66 } },
  supra_a80: { wheel: { centre: [-.381, .798, .148], normal: [0, .21, -.98], radius: .172 }, hip: [-.381, .524, -.249], roof: 1.237, floor: .3 , door: { outline: [[.62, .38], [.66, .83], [.24, 1.16], [-.79, 1.11], [-.7, .82], [-.68, .39]], skin: .908, inner: .7 } },
  mercedes_maybach: { lhd: true, wheel: { centre: [.36, .725, .116], normal: [0, .225, -.974], radius: .142 }, hip: [.36, .519, -.29], roof: 1.174, floor: .17 , door: { outline: [[.55, .48], [.52, .96], [.08, 1.08], [-.9, .97], [-.62, .46]], skin: .991, inner: .69, style: 'gullwing' } },
  amg_gt_mansory: { lhd: true, wheel: { centre: [.421, .734, -.046], normal: [.027, .314, -.949], radius: .167 }, hip: [.421, .43, -.48], roof: 1.197, floor: .27, door: { outline: [[.42, .28], [.43, .85], [.13, .88], [-.05, 1.14], [-.77, 1.12], [-.8, .88], [-.73, .45], [-.58, .28]], skin: .947, inner: .72, glass: { from: .9, top: 1.14, inner: .6 } } },
  naran_hyper: { lhd: true, wheel: { centre: [.395, .859, .207], normal: [0, .35, -.937], radius: .151 }, hip: [.395, .42, -.15], roof: 1.27, floor: .13, door: { outline: [[.48, .24], [.64, .29], [.71, .41], [.73, .45], [.72, .88], [.6, .95], [.37, .98], [0, 1.23], [-.62, 1.24], [-.57, .98], [-.8, .87], [-.68, .48], [-.4, .29]], skin: .966, inner: .67, glass: { from: 1.1, top: 1.24, inner: .62 } } },
  aston_one77: { lhd: true, wheel: { centre: [.383, .745, -.138], normal: [0, .342, -.94], radius: .154 }, hip: [.383, .46, -.59], roof: 1.155, floor: .18, door: { outline: [[.57, .33], [.65, .62], [.57, .85], [.3, .88], [-.03, 1.13], [-.88, 1.12], [-.9, .92], [-.8, .62], [-.67, .47], [-.53, .35]], skin: .908, inner: .66, glass: { from: .95, top: 1.13, inner: .6 } } },
  audi_r8_gt: { lhd: true, wheel: { centre: [.349, .764, .35], normal: [0, .297, -.955], radius: .157 }, hip: [.349, .44, .01], roof: 1.17, floor: .197, door: { outline: [[.78, .25], [.8, .83], [.75, .87], [.4, 1.16], [-.62, 1.12], [-.57, .88], [-.27, .27]], skin: .903, inner: .69, glass: { from: .88, top: 1.16, inner: .53 } } },
  bmw_m4_widebody: { lhd: true, wheel: { centre: [.376, .847, .312], normal: [.004, .38, -.925], radius: .17 }, hip: [.376, .45, -.06], roof: 1.31, floor: .278, door: { outline: [[.82, .3], [.83, .9], [.72, .94], [.37, 1.28], [-.5, 1.3], [-.52, .97], [-.57, .73], [-.5, .45], [-.38, .3]], skin: .919, inner: .7, glass: { from: .95, top: 1.3, inner: .6 } } },
  bmw_m3_gtr: { lhd: true, wheel: { centre: [.334, .769, .373], normal: [0, .397, -.918], radius: .17 }, hip: [.334, .37, -.03], roof: 1.22, floor: .129, door: { outline: [[.82, .24], [.83, .82], [.77, .84], [.25, 1.2], [-.48, 1.22], [-.45, .83], [-.44, .52], [-.32, .25]], skin: .855, inner: .65, glass: { from: .84, top: 1.22, inner: .53 } } },
  // Right-hand drive as supplied. Four doors: the driver uses the front one (the rear coach doors stay shut).
  rolls_ghost: { wheel: { centre: [-.399, .929, .558], normal: [0, .253, -.967], radius: .166 }, hip: [-.399, .68, .07], roof: 1.51, floor: .26, door: { outline: [[1.012, .3], [1.035, .45], [1.048, .65], [1.048, .8], [1.04, .95], [1.03, 1.04], [.5, 1.44], [-.06, 1.44], [-.09, 1], [-.08, .3]], skin: .97, inner: .7, glass: { from: 1.1, top: 1.44, inner: .64 } } },
};
/** Trim depth (|x|) inside which nothing belongs to the door panel at height y. */
export function doorInner(door: CarDoor, y: number) {
  const g = door.glass;
  return !g || y <= g.from ? door.inner : door.inner + (g.inner - door.inner) * Math.min(1, (y - g.from) / (g.top - g.from));
}
/** The measured door panel of a car, if any (driver side; the passenger door mirrors it). */
export function carDoor(id: string) { return CAR_CABINS[id]?.door ?? null; }
/** Driver-side (right-hand drive, -X) cabin values, after any left-hand-drive mirror. */
export function driverCabin(id: string) {
  const c = CAR_CABINS[id]; if (!c || c.doorOnly) return null;
  const flip = (p: P3) => [-Math.abs(p[0]), p[1], p[2]] as const;
  return { ...c, hip: flip(c.hip), wheel: { ...c.wheel, centre: flip(c.wheel.centre), normal: [c.lhd ? -c.wheel.normal[0] : c.wheel.normal[0], c.wheel.normal[1], c.wheel.normal[2]] as const } };
}
/** Imported motorcycles (2 wheels). yaw turns the supplied file so its front faces +Z. */
/**
 * rig: rider contact points measured from each model's blueprint (model space after normalisation, metres):
 * hip joint above the seat dip, hand centre on the left grip (+x) and the left footpeg; right side mirrors.
 */
export const BIKE_MODELS = {
  bike_basic: { file: 'ninjabike.glb', yaw: Math.PI / 2, rig: { hip: [0, .90, -.24], grip: [.33, .80, .35], peg: [.24, .38, -.255] } },
  ducati_v4r: { file: 'ducativ4r.glb', yaw: Math.PI / 2, rig: { hip: [0, .94, -.21], grip: [.31, .86, .40], peg: [.24, .41, -.30] } },
} as const;
export type BikeModelId = keyof typeof BIKE_MODELS;
export type ImportedModelId = 'bmw_i8' | 'bmw_m4_gt3' | BikeModelId | ExtraVehicleId;
export const EXTRA_BY_ID = new Map<string, typeof EXTRA_CARS[number]>(EXTRA_CARS.map((car) => [car.id, car]));
