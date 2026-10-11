import { useEffect, useSyncExternalStore } from 'react';
import type { VehicleSpec } from '../data/vehicles';
import { loadImportedModel, modelState, subscribeModels } from './importedVehicles';

export function useImportedModel(spec: VehicleSpec, delayMs = 0) {
  const id = spec.importedModel;
  const state = useSyncExternalStore(subscribeModels, () => id ? modelState(id) : null);
  useEffect(() => {
    if (!id) return;
    const load = () => void loadImportedModel(spec).catch(() => { /* Status supplies a visible retry/error message. */ });
    if (!delayMs) { load(); return; }
    // Rapid garage browsing cancels unneeded downloads. Play always loads immediately.
    const timer = setTimeout(load, delayMs);
    return () => clearTimeout(timer);
  }, [id, spec, delayMs]);
  return state;
}
