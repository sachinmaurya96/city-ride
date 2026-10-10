import * as THREE from 'three';

/**
 * Walking gait, in avatar space (+X left, +Y up, +Z forward). Phase 0 = this foot's heel strike; stance
 * lasts `duty` of the cycle. The foot rolls like a real one: it lands on the heel with the toes up, rolls
 * flat, then the heel rises over the ball of the foot until toe-off; whichever point carries the weight
 * stays fixed on the ground (no sliding). The swing leaves and lands at ground speed, lifting early.
 */
export const WALK = { duty: .6, heel: .05, ball: .13, heelPitch: .24, toePitch: .62, lift: .085 };
export const smooth = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
/** Ankle offset from its flat-foot position while rocking on the heel (a < 0: toes up) or the ball (a > 0). */
function rocker(a: number, h: number, out: THREE.Vector2) {
  const { heel, ball } = WALK;
  if (a < 0) return out.set(heel * Math.cos(-a) - h * Math.sin(-a) - heel, heel * Math.sin(-a) + h * Math.cos(-a) - h);
  return out.set(-ball * Math.cos(a) + h * Math.sin(a) + ball, ball * Math.sin(a) + h * Math.cos(a) - h);
}
const rockA = new THREE.Vector2(), rockB = new THREE.Vector2();
export function footAt(phase: number, step: number, w: number, h: number, out: THREE.Vector3) {
  const { duty, heelPitch, toePitch, lift } = WALK, travel = 2 * step * duty;
  const strike = -heelPitch * w, toeOff = toePitch * w;
  rocker(strike, h, rockA); const strikeZ = rockA.x, strikeY = rockA.y;
  rocker(toeOff, h, rockB); const offZ = rockB.x, offY = rockB.y;
  // Centre the stance under the hip: equal reach forward at heel strike and back at toe-off.
  const centre = travel / 2 - (strikeZ + offZ) / 2;
  if (phase < duty) {
    const s = phase / duty, a = s < .5 ? strike * (1 - smooth(s / .14)) : toeOff * smooth((s - .55) / .45);
    rocker(a, h, rockA);
    out.set(0, h + rockA.y, centre - s * travel + rockA.x);
    return a;
  }
  const u = (phase - duty) / (1 - duty);
  const z0 = centre - travel + offZ, z1 = centre + strikeZ, y0 = h + offY, y1 = h + strikeY;
  // Cubic Hermite with the ground speed as end tangents: the foot leaves and lands without a jolt.
  const m = -travel * (1 - duty) / duty, u2 = u * u, u3 = u2 * u;
  const z = (2 * u3 - 3 * u2 + 1) * z0 + (u3 - 2 * u2 + u) * m + (-2 * u3 + 3 * u2) * z1 + (u3 - u2) * m;
  out.set(0, y0 + (y1 - y0) * smooth(u) + lift * w * Math.sin(Math.PI * Math.pow(u, .6)), z);
  return toeOff * (1 - smooth(u / .4)) + strike * smooth((u - .6) / .4);
}
