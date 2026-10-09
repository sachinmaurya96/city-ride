import { beforeEach, describe, expect, it } from 'vitest';
import { BAY_BY_ID, DIR_VEC, INTERSECTIONS, SEGMENTS, laneOffset, segmentPoint, type Segment } from '../src/game/data/cityMap';
import { VEHICLES } from '../src/game/data/vehicles';
import { runtime } from '../src/game/core/runtime';
import { events, type GameEvent } from '../src/game/core/events';
import { projectToRoad } from '../src/game/navigation/roadGraph';
import { playerRoad } from '../src/game/rules/recovery';
import { violations } from '../src/game/rules/violations';
import { enforcement } from '../src/game/rules/enforcementState';
import { lightFor } from '../src/game/traffic/signals';
import { checkStop } from '../src/game/missions/rides';
import { useGame } from '../src/app/store';
import { applyFine } from '../src/game/progression/progression';

const DT = 1 / 60;
const recorded: GameEvent[] = [];
events.on((e) => {
  if (e.type === 'VIOLATION_RECORDED') recorded.push(e);
});

function place(seg: Segment, s: number, speed: number) {
  const [x, z] = segmentPoint(seg, s, laneOffset(seg, seg.lanes - 1));
  const [fx, fz] = DIR_VEC[seg.dir];
  runtime.pose = { x, y: 0.7, z, heading: Math.atan2(fx, fz), fx, fz };
  runtime.telemetry.speed = speed;
  runtime.telemetry.speedKmh = Math.abs(speed) * 3.6;
  playerRoad.proj = projectToRoad(x, z, fx, fz);
}

function step(seconds: number, update?: () => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    runtime.simTime += DT;
    update?.();
    violations.step(DT);
  }
}

beforeEach(() => {
  recorded.length = 0;
  violations.reset();
  enforcement.heat = 0;
  enforcement.pursuit = false;
  runtime.vehicleId = 'car_compact';
  // a stub controller: only spawnProtected/holdBrake are read by the rule systems
  runtime.vehicle = { spawnProtected: false, holdBrake: false } as unknown as typeof runtime.vehicle;
  const s = structuredClone(useGame.getState().save);
  s.lifetime.jobs = 5; // past tutorial protection
  s.wallet = 1000;
  useGame.getState().replaceSave(s);
});

describe('red light', () => {
  const seg = SEGMENTS.find((s) => INTERSECTIONS.find((n) => n.id === s.to)!.signal && s.cls === 'local')!;
  const j = INTERSECTIONS.find((n) => n.id === seg.to)!;
  const half = VEHICLES.car_compact.length / 2;

  function findTime(pred: (t: number) => boolean) {
    for (let t = 0; t < 200; t += 0.05) if (pred(t)) return t;
    throw new Error('no time');
  }

  it('entering on green then the light turning red does not fine', () => {
    // last moment of green, then red shortly after
    runtime.simTime = findTime((t) => lightFor(j, seg.dir, t) === 'G' && lightFor(j, seg.dir, t + 0.2) !== 'G');
    let s = seg.length - half - 1;
    place(seg, s, 8);
    step(0.4, () => {
      s += 8 * DT;
      place(seg, s, 8);
    });
    step(6, () => {
      s += 8 * DT;
      place(seg, Math.min(s, seg.length + 10), 8);
    });
    expect(recorded.filter((e) => e.type === 'VIOLATION_RECORDED' && e.offense === 'redLight')).toHaveLength(0);
  });

  it('crossing the stop line on red is recorded exactly once per approach crossing', () => {
    runtime.simTime = findTime((t) => lightFor(j, seg.dir, t) === 'R' && lightFor(j, seg.dir, t + 3) === 'R');
    let s = seg.length - half - 3;
    place(seg, s, 6);
    step(2, () => {
      s += 6 * DT;
      place(seg, s, 6);
    });
    const reds = recorded.filter((e) => e.type === 'VIOLATION_RECORDED' && e.offense === 'redLight');
    expect(reds).toHaveLength(1);
  });
});

describe('episodes and debounce', () => {
  const seg = SEGMENTS.find((s) => s.cls === 'local')!;
  it('continuous speeding is one episode; a new fine needs compliance + 15 s', () => {
    runtime.simTime = 1000;
    let s = 20;
    const fast = 70 / 3.6; // limit 40 → 70 km/h is > limit + 8
    const drive = (v: number, secs: number) =>
      step(secs, () => {
        s = (s + v * DT) % (seg.length - 30);
        place(seg, s + 10, v);
      });
    drive(fast, 4); // episode starts after 3 s → one record
    expect(recorded.filter((e) => e.type === 'VIOLATION_RECORDED' && e.offense === 'speeding')).toHaveLength(1);
    drive(8, 6); // compliant ≥5 s ends the episode
    drive(fast, 4); // new episode, but < 15 s since the previous fine
    expect(recorded.filter((e) => e.type === 'VIOLATION_RECORDED' && e.offense === 'speeding')).toHaveLength(1);
    drive(8, 6);
    drive(fast, 4); // ≥15 s since the previous fine and a fresh episode
    const sp = recorded.filter((e) => e.type === 'VIOLATION_RECORDED' && e.offense === 'speeding');
    expect(sp).toHaveLength(2);
    // first episode is a warning, the second actually fines
    expect(sp[0].type === 'VIOLATION_RECORDED' && sp[0].warning).toBe(true);
    expect(sp[1].type === 'VIOLATION_RECORDED' && sp[1].fine).toBe(40);
  });

  it('a stationary player hit by traffic is not fined; repeated contact frames count once', () => {
    runtime.simTime = 2000;
    place(seg, 50, 0);
    step(0.5);
    for (let i = 0; i < 30; i++) {
      violations.pendingContact = { traffic: true };
      step(DT);
    }
    expect(recorded).toHaveLength(0);
  });

  it('a player-caused crash with traffic is one incident despite many contact frames', () => {
    runtime.simTime = 3000;
    let v = 10;
    place(seg, 40, v);
    step(0.5, () => place(seg, 40, v));
    for (let i = 0; i < 20; i++) {
      v = 1;
      violations.pendingContact = { traffic: true };
      step(DT, () => place(seg, 45, v));
    }
    expect(recorded.filter((e) => e.type === 'VIOLATION_RECORDED' && e.offense === 'crash')).toHaveLength(1);
  });
});

describe('pickup stop rule', () => {
  const bay = BAY_BY_ID.get('cafe_corner_bay1')!;
  const spec = VEHICLES.car_compact;
  const at = (dx: number, dl: number, headingOffset: number, speed: number) => {
    const fx = Math.sin(bay.heading);
    const fz = Math.cos(bay.heading);
    const lx = fz;
    const lz = -fx;
    const h = bay.heading + headingOffset;
    runtime.pose = { x: bay.x + fx * dx + lx * dl, y: 0.7, z: bay.z + fz * dx + lz * dl, heading: h, fx: Math.sin(h), fz: Math.cos(h) };
    runtime.telemetry.speed = speed;
    return checkStop(bay, spec, true);
  };
  it('requires being in the bay, nearly stopped, aligned, and on the correct side', () => {
    expect(at(0, 0, 0, 0).ok).toBe(true);
    expect(at(0, 0, 0, 1).ok).toBe(false); // too fast
    expect(at(0, 0, 0.9, 0).ok).toBe(false); // > 35°
    expect(at(0, 0, Math.PI, 0).ok).toBe(false); // facing the wrong way
    expect(at(14, 0, 0, 0).ok).toBe(false); // past the bay
    expect(at(0, -7, 0, 0).ok).toBe(false); // across the road
    expect(checkStop(bay, VEHICLES.bike_basic, false).ok).toBe(false); // capacity
  });
});

describe('fines at zero cash', () => {
  it('capture/impound at ₹0 never makes the wallet negative', () => {
    const s = structuredClone(useGame.getState().save);
    s.wallet = 0;
    const r = applyFine(s, 'impound:test', 100, Date.now());
    expect(r.paid).toBe(0);
    expect(r.save.wallet).toBe(0);
  });
});
