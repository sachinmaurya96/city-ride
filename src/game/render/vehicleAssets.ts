import type { VehicleSpec } from '../data/vehicles';
import { EXTRA_CARS } from '../data/importedCatalog';

const urls: Record<string, string> = {
  lambo_lp670: new URL('../../../assets/optimized/vehicles/lambo.glb', import.meta.url).href,
  black_huracan: new URL('../../../assets/optimized/vehicles/black-lambo.glb', import.meta.url).href,
  mclaren_p1: new URL('../../../assets/optimized/vehicles/mclaren.glb', import.meta.url).href,
  mustang_rtr: new URL('../../../assets/optimized/vehicles/mustang.glb', import.meta.url).href,
  porsche_718: new URL('../../../assets/optimized/vehicles/2020_porsche_718_spyder.glb', import.meta.url).href,
  supra_a80: new URL('../../../assets/optimized/vehicles/toyota_supra_a80_1993.glb', import.meta.url).href,
  police_car: new URL('../../../assets/optimized/vehicles/arunangshubanerjee-police-car-2064.glb', import.meta.url).href,
  amg_gt_mansory: new URL('../../../assets/optimized/vehicles/2016_mansory_mercedes-amg_gt_s.glb', import.meta.url).href,
  naran_hyper: new URL('../../../assets/optimized/vehicles/2020_naran_hyper_coupe.glb', import.meta.url).href,
  aston_one77: new URL('../../../assets/optimized/vehicles/aston-martin.glb', import.meta.url).href,
  audi_r8_gt: new URL('../../../assets/optimized/vehicles/audi.glb', import.meta.url).href,
  bmw_m4_widebody: new URL('../../../assets/optimized/vehicles/bmw_m4_widebody__www.vecarz.com.glb', import.meta.url).href,
  bmw_m3_gtr: new URL('../../../assets/optimized/vehicles/m3gtr.glb', import.meta.url).href,
  rolls_ghost: new URL('../../../assets/optimized/vehicles/rolls-royce_ghost.glb', import.meta.url).href,
  ...Object.fromEntries(EXTRA_CARS.filter(car => car.id.startsWith('pack_')).map(car => [car.id, new URL('../../../assets/optimized/vehicles/traffic_racer_npc_vehicles_pack.glb', import.meta.url).href])),
  bmw_i8: new URL('../../../assets/optimized/vehicles/bmw_i8.glb', import.meta.url).href,
  bmw_m4_gt3: new URL('../../../assets/optimized/vehicles/2025_bmw_m4_gt3_evo_g82.glb', import.meta.url).href,
  mercedes_maybach: new URL('../../../assets/optimized/vehicles/maercedes.glb', import.meta.url).href,
  bike_basic: new URL('../../../assets/optimized/vehicles/ninjabike.glb', import.meta.url).href,
  ducati_v4r: new URL('../../../assets/optimized/vehicles/ducativ4r.glb', import.meta.url).href,
};

/** Lightweight URL catalog: importing it starts no downloads and creates no renderer. */
export function importedVehicleUrl(spec: VehicleSpec) {
  return spec.importedModel ? urls[spec.importedModel] : undefined;
}
