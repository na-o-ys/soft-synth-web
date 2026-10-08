// DX7 lookup tables and curves (after msfa / Dexed), shared by the engine (fm-worklet.js) and the page's graphs.

/**
 * Seconds a DX7 EG segment takes to move `delta` level units at `rate` (an approximation of the real curve,
 * good enough to show the shape: rate 99 is instant, rate 0 takes tens of seconds).
 */
export function segmentTime(rate, delta) {
  const q = Math.min(63, (rate * 41) >> 6);
  const unitsPerSec = 0.28 * (4 + (q & 3)) * 2 ** (q >> 2);
  return Math.abs(delta) * 32 / unitsPerSec / 99;
}

// msfa's pitch EG: level 0–99 → 1/32 octaves, rate 0–99 → steps of 1/21.3 octave per second
export const PITCH_LEVELS = [-128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43, -41, -39, -37, -35, -33, -32, -31,
  -30, -29, -28, -27, -26, -25, -24, -23, -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3,
  -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  33, 34, 35, 38, 40, 43, 46, 49, 53, 58, 65, 73, 82, 92, 103, 115, 127];
export const PITCH_RATES = [1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 16, 16, 17,
  18, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 33, 34, 36, 37, 38, 39, 41, 42, 44, 46, 47, 49, 51, 53, 54, 56, 58, 60,
  62, 64, 66, 68, 70, 72, 74, 76, 79, 82, 85, 88, 91, 94, 98, 102, 106, 110, 115, 120, 125, 130, 135, 141, 147, 153, 159, 165,
  171, 178, 185, 193, 202, 211, 232, 243, 254, 255];
// msfa's ScaleLevel: how many output-level units the keyboard scaling adds (+) or removes (−) at `note`
const EXP_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 19, 23, 27, 33, 39, 47, 56, 66, 80, 94, 110, 126, 142, 158, 174, 190, 206, 222, 238, 250];
export function scaleCurve(group, depth, curve) {
  const scale = curve === 0 || curve === 3 ? (group * depth * 329) >> 12 : (EXP_SCALE[Math.min(group, EXP_SCALE.length - 1)] * depth * 329) >> 15;
  return curve < 2 ? -scale : scale;
}
export function levelScaling(op, note) {
  const offset = note - (op.breakPoint + 21); // break point 0 = A-1 = MIDI 21; the graph and the sound split there
  if (offset >= 0) return scaleCurve(Math.floor((offset + 1) / 3), op.rightDepth, op.rightCurve);
  return scaleCurve(Math.floor(-(offset - 1) / 3), op.leftDepth, op.leftCurve);
}


/** Output level 0–99 → the DX7's internal 0–127 scale (≈0.75 dB per step). */
const OUT_LOW = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46];
export const scaleOutLevel = (l) => (l >= 20 ? 28 + l : OUT_LOW[l]);

/** Velocity sensitivity: level units (×32 internal) added for `velocity` 0–127 at sensitivity 0–7. */
const VELOCITY = [0, 70, 86, 97, 106, 114, 121, 126, 132, 138, 142, 148, 152, 156, 160, 163, 166, 170, 173, 174, 178, 181, 184,
  186, 189, 190, 194, 196, 198, 200, 202, 205, 206, 208, 210, 212, 213, 215, 217, 218, 220, 221, 223, 224, 226, 227, 228, 230, 231,
  232, 233, 235, 236, 237, 238, 239, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254];
export const scaleVelocity = (velocity, sens) => (((sens * (VELOCITY[Math.max(0, Math.min(127, velocity)) >> 1] - 239) + 7) >> 3) << 4);

/** Rate scaling: qrate steps added for `note` at sensitivity 0–7. */
export const scaleRate = (note, sens) => (sens * Math.min(31, Math.max(0, Math.floor(note / 3) - 7))) >> 3;

/** LFO delay 0–99 in seconds (the time until the LFO starts fading in; it then fades in over the same time). */
export function lfoDelaySeconds(delay) {
  if (delay === 0) return 0;
  const a = 99 - delay;
  const n = (16 + (a & 15)) << (1 + (a >> 4));
  return 170.5 / n / 2;
}

/** Pitch mod sensitivity 0–7 → fraction of the full depth; amp mod sensitivity 0–3 likewise. */
export const PMS = [0, 0.0264, 0.0534, 0.0889, 0.1612, 0.2769, 0.4967, 1];
export const AMS = [0, 0.259, 0.427, 1];
