import { useEffect, useSyncExternalStore } from 'react';
import type { VehicleSpec } from '../data/vehicles';
import { loadImportedModel, modelState, subscribeModels } from './importedVehicles';

export function useImportedModel(spec: VehicleSpec) {
  const id = spec.importedModel;
  const state = useSyncExternalStore(subscribeModels, () => id ? modelState(id) : null);
  useEffect(() => {
    if (id) void loadImportedModel(spec).catch(() => { /* Status supplies a visible retry/error message. */ });
  }, [id, spec]);
  return state;
}
