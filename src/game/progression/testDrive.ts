import { useGame } from '../../app/store';
import { VEHICLES, type VehicleId } from '../data/vehicles';
import { fmt, money } from '../../i18n/strings';

export const TEST_DRIVE_SECONDS = 60;
let remaining = 0;

/** Any purchasable car can be driven free for one minute; nothing is bought or saved. */
export function canTestDrive(id: VehicleId) {
  const st = useGame.getState(), spec = VEHICLES[id];
  return !spec.npcOnly && !st.save.ownedVehicleIds.includes(id) && !st.save.mission && !st.testDrive;
}

export function startTestDrive(id: VehicleId) {
  if (!canTestDrive(id)) return false;
  remaining = TEST_DRIVE_SECONDS;
  useGame.getState().setTestDrive({ vehicleId: id, secondsLeft: TEST_DRIVE_SECONDS });
  return true;
}

/** Counts simulation time only, so pauses and menus do not eat into the minute. */
export function stepTestDrive(dt: number) {
  const st = useGame.getState(), drive = st.testDrive;
  if (!drive || st.appState !== 'PLAYING') return;
  remaining -= dt;
  if (remaining <= 0) { endTestDrive(); return; }
  const secondsLeft = Math.ceil(remaining);
  if (secondsLeft !== drive.secondsLeft) st.setTestDrive({ ...drive, secondsLeft });
}

export function endTestDrive() {
  const st = useGame.getState(), drive = st.testDrive;
  if (!drive) return;
  st.setTestDrive(null);
  const spec = VEHICLES[drive.vehicleId];
  st.toast(fmt(st.t.testDriveOver, { name: spec.name, price: money(spec.price) }), 'info');
}
