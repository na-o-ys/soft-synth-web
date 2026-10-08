// The DX7 voice model: the 32 algorithms, every voice parameter with its range, the INIT VOICE, and
// conversions between the editor's flat parameter names ("op3.level", "lfoSpeed") and the stored voice.

// MARK: algorithms

/**
 * The DX7's 32 algorithms. edges: [from, to] = operator `from` modulates operator `to` (always from a higher
 * number to a lower one, so computing 6 → 1 sees every modulator first). carriers: the ops heard.
 * fb: [from, to] = the feedback loop (from === to for the usual self-feedback; algorithms 4 and 6 loop
 * through several ops).
 */
const A = (edges, carriers, fb) => ({ edges, carriers, fb: Array.isArray(fb) ? fb : [fb, fb] });
export const ALGORITHMS = [
  A([[6, 5], [5, 4], [4, 3], [2, 1]], [1, 3], 6), // 1
  A([[6, 5], [5, 4], [4, 3], [2, 1]], [1, 3], 2), // 2
  A([[6, 5], [5, 4], [3, 2], [2, 1]], [1, 4], 6), // 3
  A([[6, 5], [5, 4], [3, 2], [2, 1]], [1, 4], [4, 6]), // 4
  A([[2, 1], [4, 3], [6, 5]], [1, 3, 5], 6), // 5
  A([[2, 1], [4, 3], [6, 5]], [1, 3, 5], [5, 6]), // 6
  A([[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], 6), // 7
  A([[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], 4), // 8
  A([[2, 1], [4, 3], [5, 3], [6, 5]], [1, 3], 2), // 9
  A([[3, 2], [2, 1], [5, 4], [6, 4]], [1, 4], 3), // 10
  A([[3, 2], [2, 1], [5, 4], [6, 4]], [1, 4], 6), // 11
  A([[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], 2), // 12
  A([[2, 1], [4, 3], [5, 3], [6, 3]], [1, 3], 6), // 13
  A([[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], 6), // 14
  A([[2, 1], [4, 3], [5, 4], [6, 4]], [1, 3], 2), // 15
  A([[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], 6), // 16
  A([[2, 1], [3, 1], [4, 3], [5, 1], [6, 5]], [1], 2), // 17
  A([[2, 1], [3, 1], [4, 1], [5, 4], [6, 5]], [1], 3), // 18
  A([[2, 1], [3, 2], [6, 4], [6, 5]], [1, 4, 5], 6), // 19
  A([[3, 1], [3, 2], [5, 4], [6, 4]], [1, 2, 4], 3), // 20
  A([[3, 1], [3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], 3), // 21
  A([[2, 1], [6, 3], [6, 4], [6, 5]], [1, 3, 4, 5], 6), // 22
  A([[3, 2], [6, 4], [6, 5]], [1, 2, 4, 5], 6), // 23
  A([[6, 3], [6, 4], [6, 5]], [1, 2, 3, 4, 5], 6), // 24
  A([[6, 4], [6, 5]], [1, 2, 3, 4, 5], 6), // 25
  A([[3, 2], [5, 4], [6, 4]], [1, 2, 4], 6), // 26
  A([[3, 2], [5, 4], [6, 4]], [1, 2, 4], 3), // 27
  A([[2, 1], [5, 4], [4, 3]], [1, 3, 6], 5), // 28
  A([[4, 3], [6, 5]], [1, 2, 3, 5], 6), // 29
  A([[5, 4], [4, 3]], [1, 2, 3, 6], 5), // 30
  A([[6, 5]], [1, 2, 3, 4, 5], 6), // 31
  A([], [1, 2, 3, 4, 5, 6], 6), // 32
];

/**
 * Where to draw each operator of an algorithm: { [op]: { x, y } } in grid units, carriers on row 0 (bottom),
 * modulators stacked above what they modulate, side by side when several feed one op.
 */
export function algorithmLayout(n) {
  const alg = ALGORITHMS[n - 1];
  const mods = (op) => alg.edges.filter(([, to]) => to === op).map(([from]) => from).sort((a, b) => a - b);
  const targets = (op) => alg.edges.filter(([from]) => from === op).map(([, to]) => to);
  const pos = {};
  const placed = new Set();
  let next = 0;
  const place = (op) => {
    placed.add(op);
    const own = mods(op).filter((m) => !placed.has(m));
    if (!own.length) { pos[op] = { x: next++ }; return; }
    for (const m of own) place(m);
    pos[op] = { x: own.reduce((s, m) => s + pos[m].x, 0) / own.length };
  };
  for (const c of alg.carriers) place(c);
  // depth: carriers 0, a modulator one above the highest op it modulates
  const depth = (op) => (alg.carriers.includes(op) && !targets(op).length ? 0 : Math.max(0, ...targets(op).map((t) => depth(t) + 1)));
  for (let op = 1; op <= 6; op++) {
    pos[op].y = depth(op);
    const ts = targets(op);
    if (ts.length > 1) pos[op].x = ts.reduce((s, t) => s + pos[t].x, 0) / ts.length; // shared modulator: centred
  }
  return { pos, width: next, height: Math.max(...Object.values(pos).map((p) => p.y)) + 1 };
}

// MARK: parameters

export const LFO_WAVES = ['triangle', 'saw down', 'saw up', 'square', 'sine', 'sample & hold'];
export const CURVES = ['-lin', '-exp', '+exp', '+lin'];
export const OSC_MODES = ['ratio', 'fixed'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n) => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

/** Range of every operator parameter (all integers, as on the DX7). */
export const OP_PARAMS = {
  on: { min: 0, max: 1, label: 'on' }, // operator mute: a page switch, kept in the performance values, not the voice
  mode: { min: 0, max: 1, label: 'mode', choices: OSC_MODES },
  coarse: { min: 0, max: 31, label: 'coarse' },
  fine: { min: 0, max: 99, label: 'fine' },
  detune: { min: -7, max: 7, label: 'detune' },
  level: { min: 0, max: 99, label: 'level' },
  r1: { min: 0, max: 99, label: 'R1' }, r2: { min: 0, max: 99, label: 'R2' },
  r3: { min: 0, max: 99, label: 'R3' }, r4: { min: 0, max: 99, label: 'R4' },
  l1: { min: 0, max: 99, label: 'L1' }, l2: { min: 0, max: 99, label: 'L2' },
  l3: { min: 0, max: 99, label: 'L3' }, l4: { min: 0, max: 99, label: 'L4' },
  rateScale: { min: 0, max: 7, label: 'rate scl' },
  breakPoint: { min: 0, max: 99, label: 'break pt' },
  leftDepth: { min: 0, max: 99, label: 'L depth' },
  rightDepth: { min: 0, max: 99, label: 'R depth' },
  leftCurve: { min: 0, max: 3, label: 'L curve', choices: CURVES },
  rightCurve: { min: 0, max: 3, label: 'R curve', choices: CURVES },
  velocity: { min: 0, max: 7, label: 'velocity' },
  ams: { min: 0, max: 3, label: 'amp mod' },
};

/** Range of every voice-wide parameter. */
export const GLOBAL_PARAMS = {
  algorithm: { min: 1, max: 32, label: 'algorithm' },
  feedback: { min: 0, max: 7, label: 'feedback' },
  oscSync: { min: 0, max: 1, label: 'osc sync' },
  transpose: { min: 0, max: 48, label: 'transpose' },
  pr1: { min: 0, max: 99, label: 'R1' }, pr2: { min: 0, max: 99, label: 'R2' },
  pr3: { min: 0, max: 99, label: 'R3' }, pr4: { min: 0, max: 99, label: 'R4' },
  pl1: { min: 0, max: 99, label: 'L1' }, pl2: { min: 0, max: 99, label: 'L2' },
  pl3: { min: 0, max: 99, label: 'L3' }, pl4: { min: 0, max: 99, label: 'L4' },
  lfoWave: { min: 0, max: 5, label: 'wave', choices: LFO_WAVES },
  lfoSpeed: { min: 0, max: 99, label: 'speed' },
  lfoDelay: { min: 0, max: 99, label: 'delay' },
  lfoPmd: { min: 0, max: 99, label: 'pitch mod' },
  lfoAmd: { min: 0, max: 99, label: 'amp mod' },
  lfoSync: { min: 0, max: 1, label: 'key sync' },
  lfoPms: { min: 0, max: 7, label: 'pitch sens' },
};

/** Performance controls of the FM page: not part of the voice, kept across voice changes. */
export const PERF_PARAMS = {
  volume: { min: 0, max: 1, label: 'volume' },
  modWheel: { min: 0, max: 1, label: 'mod wheel' },
  aftertouch: { min: 0, max: 1, label: 'aftertouch' },
  bendRange: { min: 0, max: 12, label: 'bend range' },
  reverb: { min: 0, max: 1, label: 'reverb' },
  // the DX7 function parameters: where the mod wheel and aftertouch go (0–99 each), mono and portamento
  wheelPitch: { min: 0, max: 99, label: 'wheel→pitch' },
  wheelAmp: { min: 0, max: 99, label: 'wheel→amp' },
  atPitch: { min: 0, max: 99, label: 'touch→pitch' },
  atAmp: { min: 0, max: 99, label: 'touch→amp' },
  mono: { min: 0, max: 1, label: 'mono' },
  portamento: { min: 0, max: 99, label: 'porta time' },
};
export const PERF_DEFAULTS = {
  volume: 0.8, modWheel: 0, aftertouch: 0, bendRange: 2, reverb: 0.15, bend: 0,
  wheelPitch: 50, wheelAmp: 0, atPitch: 0, atAmp: 0, mono: 0, portamento: 0,
};
/** Performance values that are continuous (not 0–99 steps). */
export const CONTINUOUS = new Set(['volume', 'modWheel', 'aftertouch', 'reverb', 'bend']);
export const initOpOn = () => [1, 1, 1, 1, 1, 1];

/** The spec of a flat parameter name: "op3.level", "lfoSpeed", "volume". */
export function paramSpec(name) {
  const m = /^op([1-6])\.(\w+)$/.exec(name);
  if (m) return OP_PARAMS[m[2]] ?? null;
  return GLOBAL_PARAMS[name] ?? PERF_PARAMS[name] ?? null;
}

export const initOp = (n) => ({
  mode: 0, coarse: 1, fine: 0, detune: 0, level: n === 1 ? 99 : 0,
  r1: 99, r2: 99, r3: 99, r4: 99, l1: 99, l2: 99, l3: 99, l4: 0,
  rateScale: 0, breakPoint: 39, leftDepth: 0, rightDepth: 0, leftCurve: 0, rightCurve: 0,
  velocity: 0, ams: 0,
});

/** The DX7's INIT VOICE: algorithm 1, only op 1 sounding, a plain sine. */
export const initVoice = () => ({
  name: 'INIT VOICE',
  algorithm: 1, feedback: 0, oscSync: 1, transpose: 24,
  pr1: 99, pr2: 99, pr3: 99, pr4: 99, pl1: 50, pl2: 50, pl3: 50, pl4: 50,
  lfoWave: 0, lfoSpeed: 35, lfoDelay: 0, lfoPmd: 0, lfoAmd: 0, lfoSync: 1, lfoPms: 3,
  ops: [1, 2, 3, 4, 5, 6].map(initOp),
});

/** Reads a flat parameter from a voice (or the performance values). */
export function getParam(voice, perf, name) {
  const m = /^op([1-6])\.(\w+)$/.exec(name);
  if (m) return m[2] === 'on' ? perf.opOn?.[m[1] - 1] ?? 1 : voice.ops[m[1] - 1][m[2]];
  if (name in GLOBAL_PARAMS) return voice[name];
  return perf[name];
}

/** True for parameters that are not part of the voice (performance values, operator mutes). */
export const isPerfParam = (name) => name in PERF_PARAMS || /^op[1-6]\.on$/.test(name);

/** Writes a flat parameter into a voice (or the performance values), clamped to its range. */
export function setParam(voice, perf, name, v) {
  const spec = paramSpec(name);
  if (!spec) return;
  v = CONTINUOUS.has(name) ? Math.min(Math.max(v, spec.min), spec.max) : Math.round(Math.min(Math.max(v, spec.min), spec.max));
  const m = /^op([1-6])\.(\w+)$/.exec(name);
  if (m && m[2] === 'on') (perf.opOn ??= initOpOn())[m[1] - 1] = v;
  else if (m) voice.ops[m[1] - 1][m[2]] = v;
  else if (name in GLOBAL_PARAMS) voice[name] = v;
  else perf[name] = v;
}

/** A voice made safe to use: every field present and in range (from storage, or a .syx with junk bits). */
export function sanitizeVoice(v) {
  const out = initVoice();
  if (!v || typeof v !== 'object') return out;
  if (typeof v.name === 'string') out.name = cleanName(v.name);
  const fix = (spec, x, d) => (Number.isFinite(x) ? Math.round(Math.min(Math.max(x, spec.min), spec.max)) : d);
  for (const [k, spec] of Object.entries(GLOBAL_PARAMS)) out[k] = fix(spec, v[k], out[k]);
  for (let i = 0; i < 6; i++) {
    const src = Array.isArray(v.ops) ? v.ops[i] : null;
    if (!src || typeof src !== 'object') continue;
    for (const [k, spec] of Object.entries(OP_PARAMS)) if (k !== 'on') out.ops[i][k] = fix(spec, src[k], out.ops[i][k]);
  }
  return out;
}

/** A voice name as the DX7 can hold it: 10 characters of printable ASCII (and ¥ → ←). */
export const cleanName = (s) => [...String(s)].map((c) => (/[ -~¥→←]/.test(c) ? c : ' ')).join('').slice(0, 10);

// MARK: readouts

/** LFO speed 0–99 in Hz (msfa's mapping of the DX7 LFO). */
export function lfoHz(speed) {
  let sr = speed === 0 ? 1 : (165 * speed) >> 6;
  sr *= sr < 160 ? 11 : 11 + ((sr - 160) >> 4);
  return (sr * 25190424) / 2 ** 32;
}

/** An operator's frequency as the DX7 shows it: "×1.41" (ratio) or "100 Hz" (fixed). */
export function opFrequencyText(op) {
  if (op.mode === 1) {
    const hz = 10 ** (op.coarse & 3) * 10 ** (op.fine / 100);
    return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${hz.toFixed(hz >= 100 ? 0 : hz >= 10 ? 1 : 2)} Hz`;
  }
  return `×${opRatio(op).toFixed(2)}`;
}

export const opRatio = (op) => (op.coarse === 0 ? 0.5 : op.coarse) * (1 + op.fine / 100);

/** A note named the Yamaha way, middle C (MIDI 60) = C3. */
const yamahaName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 2}`;

/** The break point as a note name: 0 = A-1, 39 = C3. */
export const breakPointName = (bp) => yamahaName(bp + 21);

/** Transpose as the DX7 shows it: 0 = C1, 24 = C3 (no shift), 48 = C5. */
export const transposeName = (t) => yamahaName(t + 36);

/** Text for any parameter value, for knob readouts (`voice` gives context: coarse reads differently in fixed mode). */
export function formatParam(name, v, voice) {
  const spec = paramSpec(name);
  if (!spec) return String(v);
  if (spec.choices) return spec.choices[v] ?? String(v);
  const field = name.replace(/^op[1-6]\./, '');
  const op = voice && /^op[1-6]\./.test(name) ? voice.ops[name[2] - 1] : null;
  if (field === 'coarse' && op) return op.mode === 1 ? `${10 ** (v & 3)} Hz` : v === 0 ? '0.50' : String(v);
  if (field === 'fine' && op) return op.mode === 1 ? `×${(10 ** (v / 100)).toFixed(2)}` : `+${v}%`;
  if (name === 'lfoSpeed') return `${lfoHz(v).toFixed(lfoHz(v) < 10 ? 2 : 1)} Hz`;
  if (name === 'mono') return v ? 'mono' : 'poly';
  if (field === 'on' || name === 'oscSync' || name === 'lfoSync') return v ? 'on' : 'off';
  if (field === 'detune') return v > 0 ? `+${v}` : String(v);
  if (field === 'breakPoint') return breakPointName(v);
  if (name === 'transpose') return transposeName(v);
  if (CONTINUOUS.has(name)) return v.toFixed(2);
  if (name === 'bendRange') return `${Math.round(v)} st`;
  return String(v);
}
