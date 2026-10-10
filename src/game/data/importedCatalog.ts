/** Dimensions and handling are game tuning values, not manufacturer specifications. */
export const EXTRA_CARS = [
  { id: 'lambo_lp670', name: 'Lamborghini LP670', file: 'lambo.glb', length: 4.70, width: 2.05, height: 1.24, radius: .33, wheelbase: 2.70, mass: 1600, speed: 250, engine: 'v8', yaw: .242 },
  { id: 'black_huracan', name: 'Black Lamborghini Huracán', file: 'black-lambo.glb', length: 4.65, width: 2.33, height: 1.13, radius: .33, wheelbase: 2.62, mass: 1550, speed: 250, engine: 'v8' },
  { id: 'mclaren_p1', name: 'McLaren P1 GTR', file: 'mclaren.glb', length: 4.73, width: 2.00, height: 1.43, radius: .33, wheelbase: 2.68, mass: 1500, speed: 260, engine: 'v8' },
  { id: 'mustang_rtr', name: 'Ford Mustang RTR', file: 'mustang.glb', length: 4.82, width: 2.08, height: 1.39, radius: .34, wheelbase: 2.72, mass: 1750, speed: 230, engine: 'v8' },
  { id: 'rolls_spectre', name: 'Rolls-Royce Spectre', file: 'rr-spectr.glb', length: 5.45, width: 2.15, height: 1.59, radius: .40, wheelbase: 3.21, mass: 2800, speed: 220, engine: 'petrol' },
  { id: 'porsche_718', name: 'Porsche 718 Spyder', file: '2020_porsche_718_spyder.glb', length: 4.43, width: 1.80, height: 1.28, radius: .34, wheelbase: 2.47, mass: 1450, speed: 210, engine: 'flat6' },
  { id: 'supra_a80', name: 'Toyota Supra A80', file: 'toyota_supra_a80_1993.glb', length: 4.52, width: 1.81, height: 1.27, radius: .33, wheelbase: 2.55, mass: 1550, speed: 205, engine: 'inline6' },
  { id: 'western_star', name: 'Western Star 4900', file: 'western_star_4900.glb', length: 9.05, width: 2.65, height: 3.65, radius: .50, wheelbase: 6.13, mass: 7000, speed: 95, engine: 'diesel' },
  { id: 'fast_72', name: 'Fast 72', file: 'ergoninane-fast-72.glb', length: 4.94, width: 2.38, height: 1.70, radius: .395, wheelbase: 2.87, mass: 1650, speed: 175, engine: 'v8' },
  { id: 'police_car', name: 'Police Cruiser', file: 'arunangshubanerjee-police-car-2064.glb', length: 4.65, width: 2.15, height: 1.8, radius: .36, wheelbase: 2.8, mass: 1650, speed: 100, engine: 'v8' },
  { id: 'classic_sport', name: 'Classic Sport', file: 'sputnikjfkennedy-car-4473.glb', length: 4.45, width: 1.85, height: 1.35, radius: .33, wheelbase: 2.65, mass: 1150, speed: 155, engine: 'petrol', yaw: -Math.PI / 2 },
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
export type ImportedModelId = 'bmw_i8' | 'bmw_m4_gt3' | ExtraVehicleId;
export const EXTRA_BY_ID = new Map<string, typeof EXTRA_CARS[number]>(EXTRA_CARS.map((car) => [car.id, car]));
