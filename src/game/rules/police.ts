import type { Car } from '../traffic/traffic';
import { enforcement } from './enforcementState';

/** Police models remain ambient NPCs; free driving has no pursuit, capture or impound. */
class PoliceSystem {
  car: Car | null = null;
  reset() { if (this.car) { this.car.chase = null; this.car.homing = false; } this.car = null; enforcement.pursuit = false; enforcement.heat = 0; }
  step(_dt: number) { this.reset(); }
}
export const police = new PoliceSystem();
