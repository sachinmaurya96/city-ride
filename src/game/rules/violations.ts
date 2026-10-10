import { runtime } from '../core/runtime';
import { events } from '../core/events';
import { enforcement } from './enforcementState';

export type Offense = 'speeding' | 'redLight' | 'wrongWay' | 'blockingCrossing' | 'crash' | 'pedestrian';

/** Free driving: contact sounds remain, while traffic offenses never charge or restrict the player. */
class ViolationSystem {
  pendingContact: { traffic: boolean } | null = null;
  private history: number[] = [];
  private cooldown = 0;
  reset() {
    this.pendingContact = null; this.history = []; this.cooldown = 0;
    enforcement.heat = 0; enforcement.pursuit = false; enforcement.jobIncidents = 0;
  }
  record(_offense: Offense, _options: { heat: number; fine: number; satisfaction: number; forceFine?: boolean; minHeat?: number }) {}
  step(dt: number) {
    enforcement.heat = 0; enforcement.pursuit = false;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const speed = Math.abs(runtime.telemetry.speed);
    if (this.pendingContact && this.cooldown === 0) {
      const impulse = Math.max(0, ...this.history) - speed;
      events.emit({ type: 'COLLISION', impulse: Math.max(0, impulse), withTraffic: this.pendingContact.traffic });
      this.cooldown = .8;
    }
    this.pendingContact = null;
    this.history.push(speed); if (this.history.length > 12) this.history.shift();
  }
  get lastViolationTime() { return -Infinity; }
}
export const violations = new ViolationSystem();
