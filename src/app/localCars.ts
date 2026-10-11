import { VEHICLES, VEHICLE_ORDER, isPlayableVehicleId } from '../game/data/vehicles';
import type { SaveData } from '../storage/schema';

/** Local development access, applied after loading either a new or existing profile. */
export function ownLocalCars(save: SaveData, hostname: string): SaveData {
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) return save;
  const missing = VEHICLE_ORDER.filter(id => isPlayableVehicleId(id) && VEHICLES[id].kind === 'car' && !save.ownedVehicleIds.includes(id));
  if (!missing.length) return save;
  return { ...save, ownedVehicleIds: [...save.ownedVehicleIds, ...missing], revision: save.revision + 1, updatedAt: Date.now() };
}
