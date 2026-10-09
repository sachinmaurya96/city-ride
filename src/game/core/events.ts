/** Typed game events (plan §4.4). Listeners must unsubscribe on disposal (StrictMode safe). */
export type GameEvent =
  | { type: 'RIDE_OFFERED' }
  | { type: 'RIDE_ACCEPTED'; id: string }
  | { type: 'PASSENGER_BOARDED'; id: string }
  | { type: 'RIDE_COMPLETED'; id: string; net: number }
  | { type: 'RIDE_FAILED'; id: string; reason: string }
  | { type: 'RIDE_CANCELLED'; id: string }
  | { type: 'VIOLATION_RECORDED'; offense: string; fine: number; warning: boolean }
  | { type: 'POLICE_PURSUIT' }
  | { type: 'POLICE_ESCAPED' }
  | { type: 'POLICE_CAPTURED' }
  | { type: 'COLLISION'; impulse: number; withTraffic: boolean }
  | { type: 'VEHICLE_PURCHASED'; id: string }
  | { type: 'UPGRADE_PURCHASED'; id: string }
  | { type: 'DAILY_CLAIMED'; id: string }
  | { type: 'DAY_ROLLED_OVER' }
  | { type: 'BUS_STOP_SERVED'; stop: number }
  | { type: 'HORN' }
  | { type: 'CAR_DOOR'; side: number; open: boolean }
  | { type: 'LEVEL_UP'; level: number };

type Listener = (e: GameEvent) => void;
const listeners = new Set<Listener>();

export const events = {
  on(fn: Listener) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  emit(e: GameEvent) {
    for (const fn of [...listeners]) fn(e);
  },
};
