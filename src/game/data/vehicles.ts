import { EXTRA_CARS, type ExtraVehicleId, type ImportedModelId } from './importedCatalog';
// Vehicle catalog. All values are tunable design parameters from plan.md §7.3 and §11.2.
// Units: meters, kilograms, seconds. Local +Z is forward, +Y is up.

export type VehicleId =
  | 'bike_basic'
  | 'auto_city'
  | 'car_compact'
  | 'car_coupe'
  | 'mpv_seven'
  | 'bus_small'
  | 'bus_medium'
  | 'bus_long'
  | 'supercar'
  | 'bmw_i8'
  | 'bmw_m4_gt3'
  | 'ducati_v4r'
  | ExtraVehicleId;

export type VehicleKind = 'bike' | 'auto' | 'car' | 'bus';
export type JobKind = 'standard' | 'office' | 'family' | 'airport' | 'vip' | 'rain' | 'bus';

export interface WheelLayout {
  /** Physics support wheels (local chassis coordinates, connection point). */
  physics: { x: number; z: number; steer: boolean }[];
  /** Visual wheels (may differ from physics, e.g. bike shows 2, auto shows 3). */
  visual: { x: number; z: number; steer: boolean; radius: number; width: number }[];
}

export interface VehicleSpec {
  id: VehicleId;
  name: string;
  nameRu: string;
  kind: VehicleKind;
  /** Supplied model, available for a free garage test drive. */
  importedModel?: ImportedModelId;
  /** Traffic/police assets never appear in the garage or become player vehicles. */
  npcOnly?: boolean;
  totalSeats: number;
  passengerSeats: number;
  unlockLevel: number;
  price: number;
  /** Price used by the upgrade-cost formula (starter bike uses ₹1,000). */
  upgradeReferencePrice: number;
  /** Fare multiplier for point-to-point rides; null for buses (bus formula). */
  serviceMultiplier: number | null;
  jobs: JobKind[];
  topSpeedKmh: number;
  /** Seconds from 0 to 40 km/h on dry road. */
  accel0to40: number;
  /** Target service braking deceleration m/s². */
  brakeDecel: number;
  maxSteerDeg: number;
  /** Fraction of max steer remaining at top speed. */
  highSpeedSteer: number;
  steerResponse: number;
  mass: number;
  width: number;
  length: number;
  height: number;
  /** Actual model roof height, when shorter than its nominal catalog height. */
  cabinHeight?: number;
  wheelRadius: number;
  /** Suspension rest length. */
  suspension: number;
  /** Chassis collider half-height and offset above wheel connection plane. */
  chassisHalfHeight: number;
  wheels: WheelLayout;
  defaultColor: string;
  accentColor: string;
  camera: { distance: number; height: number; highDistance: number; highHeight: number; eyeHeight: number; eyeForward: number };
  /** Shop comparison stats on a 0–100 scale. */
  display: { speed: number; handling: number; brakes: number; comfort: number };
}

function fourWheels(track: number, wheelbase: number, radius: number, width = 0.28, axleOffset = 0): WheelLayout {
  const hx = track / 2;
  const hz = wheelbase / 2;
  const physics = [
    { x: hx, z: hz + axleOffset, steer: true },
    { x: -hx, z: hz + axleOffset, steer: true },
    { x: hx, z: -hz + axleOffset, steer: false },
    { x: -hx, z: -hz + axleOffset, steer: false },
  ];
  return { physics, visual: physics.map((w) => ({ ...w, radius, width })) };
}

function busWheels(track: number, wheelbase: number, radius: number, extraRearAxle = false): WheelLayout {
  const base = fourWheels(track, wheelbase, radius, 0.36);
  if (extraRearAxle) {
    const z = -wheelbase / 2 + 1.25;
    base.visual.push({ x: track / 2, z, steer: false, radius, width: 0.36 }, { x: -track / 2, z, steer: false, radius, width: 0.36 });
  }
  return base;
}

const BASE_VEHICLES = {
  bike_basic: {
    id: 'bike_basic',
    name: 'Ninja Bike',
    nameRu: 'Ninja Bike',
    kind: 'bike',
    importedModel: 'bike_basic',
    totalSeats: 2,
    passengerSeats: 1,
    unlockLevel: 1,
    price: 0,
    upgradeReferencePrice: 1000,
    serviceMultiplier: 1.0,
    jobs: ['standard', 'office', 'rain'],
    topSpeedKmh: 290,
    accel0to40: .95,
    brakeDecel: 6.4,
    maxSteerDeg: 34,
    highSpeedSteer: 0.32,
    steerResponse: 0.14,
    mass: 260,
    width: 0.75,
    length: 2.05,
    height: 1.15,
    wheelRadius: 0.3,
    suspension: 0.25,
    chassisHalfHeight: 0.25,
    // Invisible stable support footprint (plan §7.2); two visual wheels.
    wheels: {
      physics: [
        { x: 0.36, z: 0.62, steer: true },
        { x: -0.36, z: 0.62, steer: true },
        { x: 0.36, z: -0.62, steer: false },
        { x: -0.36, z: -0.62, steer: false },
      ],
      visual: [
        { x: 0, z: 0.66, steer: true, radius: 0.3, width: 0.14 },
        { x: 0, z: -0.62, steer: false, radius: 0.3, width: 0.16 },
      ],
    },
    defaultColor: '#2fc4a8',
    accentColor: '#1d2b36',
    camera: { distance: 5.2, height: 2.4, highDistance: 9, highHeight: 6, eyeHeight: 1.45, eyeForward: 0.1 },
    display: { speed: 88, handling: 86, brakes: 84, comfort: 48 },
  },
  ducati_v4r: {
    id: 'ducati_v4r',
    name: 'Ducati V4 R',
    nameRu: 'Ducati V4 R',
    kind: 'bike',
    importedModel: 'ducati_v4r',
    totalSeats: 2,
    passengerSeats: 1,
    unlockLevel: 1,
    price: 5000,
    upgradeReferencePrice: 5000,
    serviceMultiplier: 1.0,
    jobs: ['standard', 'office', 'rain'],
    topSpeedKmh: 310,
    accel0to40: .85,
    brakeDecel: 6.4,
    maxSteerDeg: 34,
    highSpeedSteer: 0.32,
    steerResponse: 0.14,
    mass: 260,
    width: 0.75,
    length: 2.1,
    height: 1.15,
    wheelRadius: 0.3,
    suspension: 0.25,
    chassisHalfHeight: 0.25,
    // Invisible stable support footprint (plan §7.2); two visual wheels.
    wheels: {
      physics: [
        { x: 0.36, z: 0.62, steer: true },
        { x: -0.36, z: 0.62, steer: true },
        { x: 0.36, z: -0.62, steer: false },
        { x: -0.36, z: -0.62, steer: false },
      ],
      visual: [
        { x: 0, z: 0.66, steer: true, radius: 0.3, width: 0.14 },
        { x: 0, z: -0.62, steer: false, radius: 0.3, width: 0.16 },
      ],
    },
    defaultColor: '#2fc4a8',
    accentColor: '#1d2b36',
    camera: { distance: 5.2, height: 2.4, highDistance: 9, highHeight: 6, eyeHeight: 1.45, eyeForward: 0.1 },
    display: { speed: 95, handling: 92, brakes: 90, comfort: 50 },
  },
  auto_city: {
    id: 'auto_city',
    name: 'City Auto',
    nameRu: 'Сити-авто',
    kind: 'auto',
    totalSeats: 4,
    passengerSeats: 3,
    unlockLevel: 3,
    price: 1500,
    upgradeReferencePrice: 1800,
    serviceMultiplier: 1.4,
    jobs: ['standard', 'office', 'family', 'rain'],
    topSpeedKmh: 50,
    accel0to40: 7,
    brakeDecel: 4.8,
    maxSteerDeg: 32,
    highSpeedSteer: 0.4,
    steerResponse: 0.16,
    mass: 480,
    width: 1.35,
    length: 2.7,
    height: 1.75,
    wheelRadius: 0.26,
    suspension: 0.24,
    chassisHalfHeight: 0.35,
    wheels: {
      physics: [
        { x: 0.5, z: 0.85, steer: true },
        { x: -0.5, z: 0.85, steer: true },
        { x: 0.55, z: -0.75, steer: false },
        { x: -0.55, z: -0.75, steer: false },
      ],
      visual: [
        { x: 0, z: 0.95, steer: true, radius: 0.26, width: 0.16 },
        { x: 0.58, z: -0.75, steer: false, radius: 0.26, width: 0.18 },
        { x: -0.58, z: -0.75, steer: false, radius: 0.26, width: 0.18 },
      ],
    },
    defaultColor: '#f4c430',
    accentColor: '#27a35a',
    camera: { distance: 6, height: 2.8, highDistance: 10, highHeight: 6.5, eyeHeight: 1.5, eyeForward: 0.5 },
    display: { speed: 40, handling: 62, brakes: 58, comfort: 55 },
  },
  car_compact: {
    id: 'car_compact',
    name: 'Metro Compact',
    nameRu: 'Метро Компакт',
    kind: 'car',
    totalSeats: 4,
    passengerSeats: 3,
    unlockLevel: 5,
    price: 2500,
    upgradeReferencePrice: 6500,
    serviceMultiplier: 2.0,
    jobs: ['standard', 'office', 'family', 'airport', 'rain'],
    topSpeedKmh: 220,
    accel0to40: .95,
    brakeDecel: 5.6,
    maxSteerDeg: 33,
    highSpeedSteer: 0.3,
    steerResponse: 0.15,
    mass: 1050,
    width: 1.7,
    length: 3.8,
    height: 1.55,
    wheelRadius: 0.33,
    suspension: 0.28,
    chassisHalfHeight: 0.4,
    wheels: fourWheels(1.45, 2.4, 0.33),
    defaultColor: '#3cc9b0',
    accentColor: '#f6efe0',
    camera: { distance: 7, height: 3.2, highDistance: 11.5, highHeight: 7, eyeHeight: 1.35, eyeForward: 0.9 },
    display: { speed: 68, handling: 76, brakes: 70, comfort: 72 },
  },
  car_coupe: {
    id: 'car_coupe',
    name: 'City Coupe',
    nameRu: 'Сити Купе',
    kind: 'car',
    totalSeats: 2,
    passengerSeats: 1,
    unlockLevel: 7,
    price: 3500,
    upgradeReferencePrice: 11000,
    serviceMultiplier: 2.4,
    jobs: ['standard', 'office', 'airport', 'vip', 'rain'],
    topSpeedKmh: 250,
    accel0to40: .85,
    brakeDecel: 6,
    maxSteerDeg: 32,
    highSpeedSteer: 0.28,
    steerResponse: 0.13,
    mass: 1150,
    width: 1.8,
    length: 4.2,
    height: 1.3,
    wheelRadius: 0.34,
    suspension: 0.25,
    chassisHalfHeight: 0.35,
    wheels: fourWheels(1.55, 2.55, 0.34, 0.3),
    defaultColor: '#ee5a52',
    accentColor: '#1d2b36',
    camera: { distance: 7.2, height: 3, highDistance: 12, highHeight: 7, eyeHeight: 1.1, eyeForward: 0.8 },
    display: { speed: 82, handling: 84, brakes: 78, comfort: 70 },
  },
  mpv_seven: {
    id: 'mpv_seven',
    name: 'Family Seven',
    nameRu: 'Семейный Семь',
    kind: 'car',
    totalSeats: 7,
    passengerSeats: 6,
    unlockLevel: 10,
    price: 4500,
    upgradeReferencePrice: 22000,
    serviceMultiplier: 3.0,
    jobs: ['standard', 'office', 'family', 'airport', 'vip', 'rain'],
    topSpeedKmh: 210,
    accel0to40: 1.05,
    brakeDecel: 5.2,
    maxSteerDeg: 31,
    highSpeedSteer: 0.32,
    steerResponse: 0.17,
    mass: 1700,
    width: 1.9,
    length: 4.7,
    height: 1.85,
    wheelRadius: 0.36,
    suspension: 0.3,
    chassisHalfHeight: 0.5,
    wheels: fourWheels(1.6, 2.85, 0.36, 0.3),
    defaultColor: '#3f7fd8',
    accentColor: '#f6efe0',
    camera: { distance: 8, height: 3.6, highDistance: 13, highHeight: 8, eyeHeight: 1.6, eyeForward: 1 },
    display: { speed: 68, handling: 64, brakes: 66, comfort: 88 },
  },
  bus_small: {
    id: 'bus_small',
    name: 'Mini Shuttle',
    nameRu: 'Мини-шаттл',
    kind: 'bus',
    totalSeats: 13,
    passengerSeats: 12,
    unlockLevel: 12,
    price: 5000,
    upgradeReferencePrice: 32000,
    serviceMultiplier: null,
    jobs: ['bus'],
    topSpeedKmh: 60,
    accel0to40: 8,
    brakeDecel: 4.4,
    maxSteerDeg: 36,
    highSpeedSteer: 0.4,
    steerResponse: 0.2,
    mass: 4200,
    width: 2.3,
    length: 7,
    height: 2.8,
    wheelRadius: 0.45,
    suspension: 0.32,
    chassisHalfHeight: 0.85,
    wheels: busWheels(1.95, 4.2, 0.45),
    defaultColor: '#f3ead2',
    accentColor: '#16a597',
    camera: { distance: 11, height: 4.8, highDistance: 17, highHeight: 10, eyeHeight: 2.4, eyeForward: 3 },
    display: { speed: 52, handling: 50, brakes: 52, comfort: 80 },
  },
  bus_medium: {
    id: 'bus_medium',
    name: 'City Shuttle',
    nameRu: 'Сити-шаттл',
    kind: 'bus',
    totalSeats: 25,
    passengerSeats: 24,
    unlockLevel: 16,
    price: 6500,
    upgradeReferencePrice: 52000,
    serviceMultiplier: null,
    jobs: ['bus'],
    topSpeedKmh: 65,
    accel0to40: 9,
    brakeDecel: 4.1,
    maxSteerDeg: 38,
    highSpeedSteer: 0.42,
    steerResponse: 0.22,
    mass: 7000,
    width: 2.45,
    length: 9.5,
    height: 3,
    wheelRadius: 0.48,
    suspension: 0.32,
    chassisHalfHeight: 0.95,
    wheels: busWheels(2.05, 5.6, 0.48),
    defaultColor: '#f3ead2',
    accentColor: '#2b8fd6',
    camera: { distance: 13.5, height: 5.5, highDistance: 20, highHeight: 11.5, eyeHeight: 2.6, eyeForward: 4.2 },
    display: { speed: 55, handling: 42, brakes: 48, comfort: 84 },
  },
  bus_long: {
    id: 'bus_long',
    name: 'Metro Liner',
    nameRu: 'Метро Лайнер',
    kind: 'bus',
    totalSeats: 41,
    passengerSeats: 40,
    unlockLevel: 20,
    price: 8000,
    upgradeReferencePrice: 85000,
    serviceMultiplier: null,
    jobs: ['bus'],
    topSpeedKmh: 65,
    accel0to40: 10,
    brakeDecel: 3.9,
    maxSteerDeg: 40,
    highSpeedSteer: 0.45,
    steerResponse: 0.24,
    mass: 11000,
    width: 2.55,
    length: 12,
    height: 3.1,
    wheelRadius: 0.5,
    suspension: 0.32,
    chassisHalfHeight: 1,
    wheels: busWheels(2.1, 6.4, 0.5, true),
    defaultColor: '#f3ead2',
    accentColor: '#e0863a',
    camera: { distance: 16, height: 6.2, highDistance: 23, highHeight: 13, eyeHeight: 2.7, eyeForward: 5.4 },
    display: { speed: 55, handling: 36, brakes: 44, comfort: 86 },
  },
  supercar: {
    id: 'supercar',
    name: 'Aurora Sport',
    nameRu: 'Аврора Спорт',
    kind: 'car',
    totalSeats: 2,
    passengerSeats: 1,
    unlockLevel: 25,
    price: 9500,
    upgradeReferencePrice: 140000,
    serviceMultiplier: 5.5,
    jobs: ['standard', 'office', 'vip', 'airport', 'rain'],
    topSpeedKmh: 300,
    accel0to40: .75,
    brakeDecel: 6.8,
    maxSteerDeg: 30,
    highSpeedSteer: 0.24,
    steerResponse: 0.12,
    mass: 1350,
    width: 1.95,
    length: 4.4,
    height: 1.15,
    wheelRadius: 0.35,
    suspension: 0.22,
    chassisHalfHeight: 0.3,
    wheels: fourWheels(1.65, 2.65, 0.35, 0.34),
    defaultColor: '#f5c428',
    accentColor: '#1d2b36',
    camera: { distance: 7.4, height: 2.9, highDistance: 12, highHeight: 7, eyeHeight: 1, eyeForward: 0.7 },
    display: { speed: 98, handling: 92, brakes: 90, comfort: 74 },
  },
  bmw_i8: {
    id: 'bmw_i8', name: 'BMW i8', nameRu: 'BMW i8', kind: 'car', importedModel: 'bmw_i8',
    totalSeats: 4, passengerSeats: 3, unlockLevel: 1, price: 6000, upgradeReferencePrice: 11000,
    serviceMultiplier: 2.4, jobs: ['standard', 'office', 'airport', 'vip', 'rain'],
    topSpeedKmh: 270, accel0to40: .85, brakeDecel: 6.5, maxSteerDeg: 32,
    highSpeedSteer: 0.28, steerResponse: 0.13, mass: 1500,
    width: 1.9, length: 4.7, height: 1.36, wheelRadius: 0.374, suspension: 0.25,
    chassisHalfHeight: 0.35, wheels: fourWheels(1.6, 2.86, 0.374, 0.27),
    defaultColor: '#ffffff', accentColor: '#287fd8',
    camera: { distance: 8, height: 3.1, highDistance: 13, highHeight: 7, eyeHeight: 1.08, eyeForward: 0.65 },
    display: { speed: 90, handling: 84, brakes: 84, comfort: 80 },
  },
  bmw_m4_gt3: {
    id: 'bmw_m4_gt3', name: 'BMW M4 GT3 EVO', nameRu: 'BMW M4 GT3 EVO', kind: 'car', importedModel: 'bmw_m4_gt3',
    totalSeats: 2, passengerSeats: 1, unlockLevel: 1, price: 7500, upgradeReferencePrice: 14000,
    serviceMultiplier: 2.4, jobs: ['standard', 'office', 'airport', 'vip', 'rain'],
    topSpeedKmh: 320, accel0to40: .75, brakeDecel: 6.8, maxSteerDeg: 30,
    highSpeedSteer: 0.24, steerResponse: 0.12, mass: 1350,
    width: 2.06, length: 5.02, height: 1.39, wheelRadius: 0.347, suspension: 0.22,
    chassisHalfHeight: 0.33, wheels: fourWheels(1.7, 2.907, 0.347, 0.34, 0.113),
    defaultColor: '#141414', accentColor: '#287fd8',
    camera: { distance: 8.5, height: 3.2, highDistance: 13.5, highHeight: 7.5, eyeHeight: 1.1, eyeForward: 0.65 },
    display: { speed: 98, handling: 92, brakes: 90, comfort: 70 },
  },
} satisfies Record<Exclude<VehicleId, ExtraVehicleId>, VehicleSpec>;

/** Showroom prices (₹, all under 10,000) for the imported cars; NPC-only models are never sold. */
const EXTRA_PRICES: Partial<Record<ExtraVehicleId, number>> = {
  bmw_m3_gtr: 4000, supra_a80: 4500, mustang_rtr: 5500, audi_r8_gt: 6000, porsche_718: 6500, amg_gt_mansory: 7000,
  bmw_m4_widebody: 7800, lambo_lp670: 8000, black_huracan: 8500, aston_one77: 8800, mclaren_p1: 9000, naran_hyper: 9200,
  mercedes_maybach: 9500, rolls_ghost: 9900,
};

function extraSpec(car: typeof EXTRA_CARS[number]): VehicleSpec {
  const heavy = car.height > 2.4;
  const wheels = fourWheels(car.width * .8, car.wheelbase, car.radius, heavy ? .4 : .28);
  return {
    id: car.id, name: car.name, nameRu: car.name, kind: 'car', importedModel: car.id,
    npcOnly: car.id === 'police_car' || car.id.startsWith('pack_'),
    totalSeats: heavy || car.id === 'porsche_718' ? 2 : 4, passengerSeats: heavy || car.id === 'porsche_718' ? 1 : 3, unlockLevel: 1, price: EXTRA_PRICES[car.id] ?? 0, upgradeReferencePrice: 12000,
    serviceMultiplier: 2.4, jobs: ['standard', 'office', 'airport', 'rain'],
    topSpeedKmh: heavy ? 160 : Math.max(230, car.speed * 1.3), accel0to40: heavy ? .85 : .95, brakeDecel: heavy ? 4.8 : 6, maxSteerDeg: 32,
    highSpeedSteer: .28, steerResponse: .14, mass: car.mass, width: car.width, length: car.length, height: car.height,
    wheelRadius: car.radius, suspension: heavy ? .32 : .25, chassisHalfHeight: heavy ? .7 : .34, wheels,
    defaultColor: '#eeeeee', accentColor: '#283c4a',
    camera: { distance: car.length + 3, height: car.height + 1.8, highDistance: car.length + 7, highHeight: 8, eyeHeight: car.height * .73, eyeForward: heavy ? car.length * .25 : .65 },
    display: { speed: Math.min(100, Math.round(car.speed * .45)), handling: heavy ? 50 : 82, brakes: heavy ? 62 : 80, comfort: 76 },
  };
}
export const VEHICLES: Record<VehicleId, VehicleSpec> = { ...BASE_VEHICLES, ...Object.fromEntries(EXTRA_CARS.map((car) => [car.id, extraSpec(car)])) as Record<ExtraVehicleId, VehicleSpec> };

export const VEHICLE_ORDER: VehicleId[] = [
  'bike_basic',
  'bmw_i8',
  'bmw_m4_gt3',
  'ducati_v4r',
  ...EXTRA_CARS.filter((car) => !VEHICLES[car.id].npcOnly).map((car) => car.id),
  'auto_city',
  'car_compact',
  'car_coupe',
  'mpv_seven',
  'bus_small',
  'bus_medium',
  'bus_long',
  'supercar',
];

/** The showroom: vehicles with a real 3D model, plus the free starter bike. Older procedural ones stay drivable when already owned. */
export function inGarage(id: VehicleId, owned: readonly string[] = []) {
  return id === 'bike_basic' || !!VEHICLES[id].importedModel || owned.includes(id);
}

export function isVehicleId(id: string): id is VehicleId {
  return Object.hasOwn(VEHICLES, id);
}

export function isPlayableVehicleId(id: string): id is VehicleId {
  return isVehicleId(id) && !VEHICLES[id].npcOnly;
}
