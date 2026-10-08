// Config file (JSON) definitions and validation. See README.md for the format.
import { COMMANDS } from './transport.js';

export const PARAMS = [
  // oscillators and mixer
  'osc1Wave', 'osc1Level', 'brightness', 'osc2Wave', 'osc2Level', 'osc2Octave', 'osc2Semi', 'osc2Detune',
  'pulseWidth', 'noise', 'chorus', 'detune', 'unison', 'unisonDetune', 'unisonWidth',
  // filter and its envelope
  'filterType', 'cutoff', 'resonance', 'keyTrack', 'velFilter', 'filterEnv', 'fAttack', 'fDecay', 'fSustain', 'fRelease',
  // amp envelope
  'attack', 'decay', 'sustain', 'release', 'velocity',
  // voice mode and pitch envelope
  'mono', 'glide', 'pitchEnv', 'pitchDecay',
  // LFO
  'lfoWave', 'vibratoRate', 'vibrato', 'lfoFilter', 'lfoAmp', 'lfoPwm',
  // effects and master
  'delay', 'delayTime', 'delayFeedback', 'reverb', 'reverbSize', 'reverbDamp', 'volume', 'transpose', 'bend',
  'modWheel',
];

/** Performance state: kept when switching presets and never saved into a preset. */
export const PERFORMANCE = new Set(['volume', 'transpose', 'bend', 'modWheel']);

/**
 * Oscillator wave shapes.
 * "harmonics" plays the preset's partials recipe (oscillator 1 only; oscillator 2 plays a sine instead).
 */
export const WAVES = ['sine', 'triangle', 'saw', 'square', 'pulse', 'harmonics'];
export const LFO_WAVES = ['sine', 'triangle', 'square', 'saw', 'random'];
export const FILTER_TYPES = ['low-pass', 'band-pass', 'high-pass'];

/** Parameters whose values are choices: the number is an index, and the config may use the name instead. */
export const CHOICES = {
  osc1Wave: WAVES,
  osc2Wave: WAVES,
  lfoWave: LFO_WAVES,
  filterType: FILTER_TYPES,
  mono: ['poly', 'mono'],
};

export const DEFAULT_PARAMS = {
  osc1Wave: 5,       // harmonics
  osc1Level: 1,
  brightness: 1,     // multiplier for partials whose ratio is not 1 (harmonics wave)
  osc2Wave: 2,       // saw
  osc2Level: 0,      // off
  osc2Octave: 0,     // octaves relative to the note
  osc2Semi: 0,       // semitones relative to the note
  osc2Detune: 0,     // cents
  pulseWidth: 0.5,   // pulse wave duty cycle 0.05...0.95
  noise: 0,          // white noise level
  chorus: 0.5,       // level of a detuned sine copy of the fundamental
  detune: 4,         // cents for that copy
  unison: 1,         // copies of each oscillator per note (1...7; basic waves only)
  unisonDetune: 15,  // total spread of the copies in cents
  unisonWidth: 0.6,  // stereo spread of the copies 0...1
  filterType: 0,     // low-pass (removes highs), band-pass (keeps a band), high-pass (removes lows)
  cutoff: 20000,     // cutoff in Hz (low-pass at 20000 = fully open, filter bypassed)
  resonance: 0,      // 0...1, emphasis at the cutoff
  keyTrack: 0,       // 0...1, how much the cutoff follows the note (1 = moves with pitch)
  velFilter: 0,      // octaves added to the cutoff at full velocity
  filterEnv: 0,      // octaves the filter envelope adds to the cutoff (negative = closes)
  fAttack: 0.005,    // filter envelope, seconds
  fDecay: 0.5,
  fSustain: 0,
  fRelease: 0.3,
  attack: 0.008,     // amp envelope, seconds
  decay: 1.6,        // seconds (time constant toward the sustain level)
  sustain: 0.3,      // 0...1
  release: 0.28,     // seconds
  velocity: 0.8,     // velocity sensitivity 0...1
  mono: 0,           // 0 = poly, 1 = mono (legato: overlapping notes glide without retriggering)
  glide: 0,          // portamento time in seconds (0 = off)
  pitchEnv: 0,       // semitones the pitch starts above the note (negative = below), then falls back
  pitchDecay: 0.05,  // seconds (time constant) for the pitch envelope to return to the note
  lfoWave: 0,        // sine
  vibratoRate: 5,    // LFO speed in Hz
  vibrato: 0,        // LFO → pitch, semitones
  lfoFilter: 0,      // LFO → cutoff, octaves
  lfoAmp: 0,         // LFO → volume (tremolo) 0...1
  lfoPwm: 0,         // LFO → pulse width 0...0.45
  delay: 0,          // delay wet level
  delayTime: 0.35,   // seconds between echoes
  delayFeedback: 0.35, // 0...0.9, how long the echoes last
  reverb: 0.22,      // wet level
  reverbSize: 0.8,   // feedback 0...0.97
  reverbDamp: 0.65,  // darkness of the tail 0...1
  volume: 0.8,
  transpose: 0,      // semitones
  bend: 0,           // semitones (pitch bend)
  modWheel: 0,       // mod wheel: extra vibrato depth in semitones, on top of `vibrato` (performance only)
};

/**
 * The "init patch" a new sound starts from, as on hardware synths: one plain saw, filter open,
 * organ-style envelope (full level while held), no modulation or effects. Its harmonics recipe
 * is just the fundamental, so switching OSC 1 to harmonics starts from a pure sine.
 */
export const INIT_PARAMS = {
  ...DEFAULT_PARAMS,
  osc1Wave: 2, osc1Level: 1, brightness: 1, osc2Level: 0, unison: 1, noise: 0, chorus: 0,
  cutoff: 20000, resonance: 0, keyTrack: 0, velFilter: 0, filterEnv: 0,
  attack: 0.005, decay: 1, sustain: 1, release: 0.2,
  mono: 0, glide: 0, vibrato: 0, lfoFilter: 0, lfoAmp: 0, lfoPwm: 0, delay: 0, reverb: 0,
};
export const INIT_PARTIALS = [{ ratio: 1, level: 1, velocity: 0, decay: 0 }];

export const MAX_PARTIALS = 8;
export const MAX_SLOTS = 16;

/** How many preset slots the Play screen uses: the highest "slot" assignment, or 8 with a Mackie surface (tracks 1-8). */
export const slotCount = (config) =>
  Math.max(config.mackie ? 8 : 0, ...config.play.filter((c) => c.target.kind === 'slot').map((c) => c.target.slot));
export const PARTIAL_FIELDS = ['ratio', 'level', 'velocity', 'decay'];

export const DEFAULT_PARTIALS = [
  { ratio: 1, level: 1, velocity: 0, decay: 0 },
  { ratio: 2, level: 0.1, velocity: 0.25, decay: 0.5 },
  { ratio: 3, level: 0, velocity: 0.08, decay: 0.18 },
];

/**
 * The sound a preset stands for: defaults ← config params ← preset, with the performance state at rest.
 * Used wherever a preset plays on its own (the Play screen's parts).
 */
export function presetSound(config, name) {
  const preset = config.presets.find((p) => p.name === name) ?? config.presets[0];
  // an FM preset (see src/fm): its DX7 voice, plus the subtractive defaults so knobs have values to show
  if (preset.engine === 'fm') return { engine: 'fm', voice: preset.voice, params: { ...DEFAULT_PARAMS, ...config.params, transpose: 0, bend: 0, modWheel: 0 } };
  return {
    params: { ...DEFAULT_PARAMS, ...config.params, ...preset.values, transpose: 0, bend: 0, modWheel: 0 },
    partials: preset.partials ?? DEFAULT_PARTIALS,
  };
}

/** A partial added by editing one that the preset does not define yet: a silent harmonic. */
export const newPartial = (index) => ({ ratio: index + 1, level: 0, velocity: 0, decay: 0 });

/**
 * Splits a partial parameter name such as "partial2.level" into { index: 1, field: 'level' }.
 * Returns null for ordinary parameters.
 */
export function partialParam(name) {
  const m = /^partial([1-8])\.(ratio|level|velocity|decay)$/.exec(name);
  return m ? { index: Number(m[1]) - 1, field: m[2] } : null;
}

export const isParamName = (name) => PARAMS.includes(name) || partialParam(name) !== null;

/**
 * Defaults used when no config is available. Pads and sliders do nothing until a config assigns them;
 * the knobs always follow the Edit screen's page.
 */
export const BUILTIN = {
  params: {},
  presets: [{ name: 'default', group: null, values: {}, partials: null }],
  initialPreset: null,
  kits: [],
  logMIDI: false,
  pickup: true,
  inputs: [],
  edit: [],
  play: [],
};

class ConfigError extends Error {}
const fail = (msg) => { throw new ConfigError(msg); };

function number(v, path) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}: must be a number`);
  return v;
}

function param(v, path) {
  if (!isParamName(v)) {
    fail(`${path}: must be one of ${PARAMS.join(', ')}, or partialN.(ratio|level|velocity|decay) with N = 1...8`);
  }
  return v;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseValues(obj, path) {
  if (!isObject(obj)) fail(`${path}: must be an object`);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!PARAMS.includes(k)) fail(`${path}: unknown parameter "${k}" (use "partials" for harmonics)`);
    if (CHOICES[k] && typeof v === 'string') {
      if (!CHOICES[k].includes(v)) fail(`${path}.${k}: must be one of ${CHOICES[k].join(', ')}`);
      out[k] = CHOICES[k].indexOf(v);
    } else {
      out[k] = number(v, `${path}.${k}`);
    }
  }
  return out;
}

function parsePreset(d, path) {
  if (typeof d.name !== 'string') fail(`${path}.name: required`);
  const { name, partials, group, ...rest } = d;
  if (group !== undefined && typeof group !== 'string') fail(`${path}.group: must be a name, e.g. "drums"`);
  let parsed = null;
  if (partials !== undefined) {
    if (!Array.isArray(partials) || partials.length < 1 || partials.length > MAX_PARTIALS) {
      fail(`${path}.partials: must be 1...${MAX_PARTIALS} objects`);
    }
    parsed = partials.map((p, i) => {
      const at = `${path}.partials[${i}]`;
      if (!isObject(p)) fail(`${at}: must be an object`);
      return {
        ratio: number(p.ratio, `${at}.ratio`),
        level: number(p.level ?? 0, `${at}.level`),
        velocity: number(p.velocity ?? 0, `${at}.velocity`),
        decay: number(p.decay ?? 0, `${at}.decay`),
      };
    });
  }
  return { name, group: group ?? null, values: parseValues(rest, path), partials: parsed };
}

/**
 * One entry of "edit" / "play": what a virtual pad or slider of the controller surface does on that screen.
 * Pads are "row-column" (1-based, "2-3"), sliders 1, 2, ...
 */
function parseAssignment(d, path) {
  if (!isObject(d)) fail(`${path}: must be an object`);
  let source;
  if (d.pad !== undefined) {
    const m = typeof d.pad === 'string' ? /^(\d+)-(\d+)$/.exec(d.pad) : null;
    if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) fail(`${path}.pad: must be "row-column", e.g. "1-3"`);
    source = { type: 'pad', row: Number(m[1]) - 1, col: Number(m[2]) - 1 };
  } else if (d.slider !== undefined) {
    const n = number(d.slider, `${path}.slider`);
    if (!Number.isInteger(n) || n < 1) fail(`${path}.slider: must be 1, 2, ...`);
    source = { type: 'slider', index: n - 1 };
  } else {
    fail(`${path}: needs "pad" ("row-column") or "slider" (number); knobs always follow the page`);
  }

  let target;
  switch (d.action) {
    case undefined: {
      const lo = number(d.min ?? 0, `${path}.min`);
      const hi = number(d.max ?? 1, `${path}.max`);
      const exponential = d.curve === 'exp';
      if (exponential && (lo <= 0 || hi <= 0)) fail(`${path}: curve "exp" needs min and max > 0`);
      if (d.pickup !== undefined && typeof d.pickup !== 'boolean') fail(`${path}.pickup: must be true or false`);
      if (source.type === 'pad') fail(`${path}: a pad needs an "action" (a parameter needs a slider)`);
      target = {
        kind: 'param', param: param(d.param, `${path}.param`), min: lo, max: hi, exponential,
        step: number(d.step ?? 0, `${path}.step`),
        // soft takeover only when asked: strips and wheels usually spring back or are meant to jump
        pickup: d.pickup === true && !(d.step > 0),
      };
      break;
    }
    case 'preset':
      if (typeof d.preset !== 'string') fail(`${path}.preset: required`);
      target = { kind: 'preset', preset: d.preset };
      break;
    case 'slot': {
      // a numbered preset slot: which preset it plays is chosen on the Play screen, not in the config
      const n = number(d.slot, `${path}.slot`);
      if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) fail(`${path}.slot: must be 1...${MAX_SLOTS}`);
      target = { kind: 'slot', slot: n };
      break;
    }
    case 'page':
      if (typeof d.page !== 'string') fail(`${path}.page: required`);
      // for this action "page" names the page to switch to, not the page the control lives on
      target = { kind: 'page', page: d.page };
      break;
    case 'nextPreset':
    case 'prevPreset':
    case 'nextPage':
    case 'prevPage':
    case 'pageKnob':
    case 'savePreset':
    case 'undo':
    case 'panic':
    case 'record':
    case 'play':
    case 'stop':
    case 'loop':
    case 'undoNote':
      target = { kind: d.action };
      break;
    case 'set':
      target = { kind: 'set', param: param(d.param, `${path}.param`), value: number(d.value, `${path}.value`) };
      break;
    case 'add':
      target = {
        kind: 'add', param: param(d.param, `${path}.param`), value: number(d.value, `${path}.value`),
        min: number(d.min ?? -Infinity, `${path}.min`), max: number(d.max ?? Infinity, `${path}.max`),
      };
      break;
    case 'toggle':
      if (!Array.isArray(d.values) || d.values.length !== 2) fail(`${path}.values: must be [off, on]`);
      target = {
        kind: 'toggle', param: param(d.param, `${path}.param`),
        off: number(d.values[0], `${path}.values[0]`), on: number(d.values[1], `${path}.values[1]`),
      };
      break;
    default:
      fail(`${path}.action: unknown action "${d.action}"`);
  }
  return { source, target };
}

function channelNumber(v, path) {
  const n = number(v, path);
  if (!Number.isInteger(n) || n < 1 || n > 16) fail(`${path}: must be 1...16`);
  return n - 1;
}

/** One entry of "inputs" (see input-rules.js). */
function parseInputRule(d, path) {
  if (!isObject(d)) fail(`${path}: must be an object`);
  if (d.port !== undefined && typeof d.port !== 'string') fail(`${path}.port: must be part of an input name`);
  const rule = {
    port: d.port ?? null,
    sysexNote: null,
    channel: d.channel !== undefined ? channelNumber(d.channel, `${path}.channel`) : null,
    note: d.note !== undefined ? number(d.note, `${path}.note`) : null,
    toChannel: d.toChannel !== undefined ? channelNumber(d.toChannel, `${path}.toChannel`) : null,
    drop: d.drop === true,
  };
  if (d.sysexNote !== undefined) {
    const bytes = typeof d.sysexNote === 'string' ? d.sysexNote.trim().split(/\s+/).map((h) => parseInt(h, 16)) : [];
    if (bytes.length === 0 || bytes[0] !== 0xf0 || bytes.some((b) => !(b >= 0 && b <= 0xff))) {
      fail(`${path}.sysexNote: must be hex bytes starting with F0, e.g. "F0 35 59 10"`);
    }
    if (rule.toChannel === null) fail(`${path}: sysexNote needs "toChannel"`);
    if (rule.channel !== null || rule.note !== null || rule.drop) fail(`${path}: sysexNote only takes "port" and "toChannel"`);
    rule.sysexNote = bytes;
  } else if (rule.drop === (rule.toChannel !== null)) {
    fail(`${path}: needs either "toChannel" or "drop": true`);
  }
  return rule;
}

/** Validates JSON text into a config object. Throws with a message that points at the problem. */
export function parseControllerSettings(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (e) {
    fail(`invalid JSON: ${e.message}`);
  }
  if (!isObject(root)) fail('top level must be an object');
  if (root.pickup !== undefined && typeof root.pickup !== 'boolean') fail('pickup: must be true or false');
  if (root.controls !== undefined || root.pages !== undefined) {
    fail('"controls" and "pages" are gone: learn your controller on the Setup screen, then assign its pads and sliders in "edit" and "play"');
  }
  for (const key of ['presets', 'params', 'preset', 'performances', 'kits']) {
    if (root[key] !== undefined) fail(`"${key}" belongs to the sound library, not the controller settings (build it on screen)`);
  }
  const c = { logMIDI: root.logMIDI === true, pickup: root.pickup ?? true, inputs: [], edit: [], play: [], mackie: null };
  if (root.mackie !== undefined) c.mackie = parseMackie(root.mackie);
  if (root.inputs !== undefined) {
    if (!Array.isArray(root.inputs)) fail('inputs: must be an array of objects');
    c.inputs = root.inputs.map((d, i) => parseInputRule(d, `inputs[${i}]`));
  }
  for (const screen of ['edit', 'play']) {
    if (root[screen] === undefined) continue;
    if (!Array.isArray(root[screen])) fail(`${screen}: must be an array of objects`);
    c[screen] = root[screen].map((d, i) => parseAssignment(d, `${screen}[${i}]`));
  }
  return c;
}

/**
 * "mackie": the input that is a Mackie Control surface. port: part of its input name, or a list (the name may be
 * localized, "Port 3" / "ポート3"); its output of the same name gets the LEDs; sysexNote: optional SysEx prefix a controller wraps the button notes in (e.g. over
 * Bluetooth); buttons: optional { "note": command } overrides of the standard button map.
 */
function parseMackie(d) {
  const ports = typeof d?.port === 'string' ? [d.port] : d?.port;
  if (!isObject(d) || !Array.isArray(ports) || !ports.length || !ports.every((p) => typeof p === 'string' && p)) {
    fail('mackie.port: required: part of the input name (e.g. "Port 3"), or a list of them');
  }
  const m = { ports, sysexNote: null, buttons: {} };
  if (d.sysexNote !== undefined) {
    const bytes = typeof d.sysexNote === 'string' ? d.sysexNote.trim().split(/\s+/).map((h) => parseInt(h, 16)) : [];
    if (!bytes.length || bytes[0] !== 0xf0 || bytes.some((b) => !(b >= 0 && b <= 0xff))) fail('mackie.sysexNote: must be hex bytes starting with F0');
    m.sysexNote = bytes;
  }
  if (d.buttons !== undefined) {
    if (!isObject(d.buttons)) fail('mackie.buttons: must be an object of note → command');
    for (const [note, cmd] of Object.entries(d.buttons)) {
      const n = Number(note);
      if (!Number.isInteger(n) || n < 0 || n > 127) fail(`mackie.buttons: "${note}" is not a note number`);
      if (!COMMANDS.includes(cmd)) fail(`mackie.buttons.${note}: must be one of ${COMMANDS.join(', ')}`);
      m.buttons[n] = cmd;
    }
  }
  return m;
}

/**
 * Validates the sound library (plain JSON: { params, preset, presets, kits }) into
 * { params, initialPreset, presets, kits }. A kit is a pad layout: { name, cols, rows, items: [{ preset, note, volume }] }.
 */
export function parseLibrary(root) {
  if (!isObject(root)) fail('library: must be an object');
  const lib = {
    params: root.params !== undefined ? parseValues(root.params, 'params') : {},
    initialPreset: typeof root.preset === 'string' ? root.preset : null,
    presets: BUILTIN.presets,
    kits: [],
  };
  if (root.presets !== undefined) {
    if (!Array.isArray(root.presets) || root.presets.length === 0) fail('presets: must be a non-empty array of objects');
    // FM presets ("engine": "fm") belong to the FM page (src/fm), which reads them from the raw library
    lib.presets = root.presets.map((p, i) => {
      if (!isObject(p)) fail(`presets[${i}]: must be an object`);
      return p.engine === 'fm' ? null : parsePreset(p, `presets[${i}]`);
    }).filter(Boolean);
    if (!lib.presets.length) lib.presets = BUILTIN.presets;
  }
  const names = new Set(lib.presets.map((p) => p.name));
  if (lib.initialPreset !== null && !names.has(lib.initialPreset)) lib.initialPreset = null;
  if (root.kits !== undefined) {
    if (!Array.isArray(root.kits)) fail('kits: must be an array of objects');
    lib.kits = root.kits.map((k, i) => parseKit(k, `kits[${i}]`, names));
  }
  return lib;
}

function parseKit(k, path, names) {
  if (!isObject(k) || typeof k.name !== 'string') fail(`${path}.name: required`);
  const size = (v, what) => {
    const n = number(v, `${path}.${what}`);
    if (!Number.isInteger(n) || n < 1 || n > 8) fail(`${path}.${what}: must be 1...8`);
    return n;
  };
  const cols = size(k.cols, 'cols'), rows = size(k.rows, 'rows');
  if (!Array.isArray(k.items)) fail(`${path}.items: must be an array`);
  const items = Array.from({ length: cols * rows }, (_, i) => {
    const it = k.items[i] ?? {};
    // a kit may name a preset the library no longer has: that pad stays empty
    const preset = typeof it.preset === 'string' && names.has(it.preset) ? it.preset : null;
    return { preset, note: Math.min(Math.max(Math.round(it.note ?? 60), 0), 127), volume: Math.min(Math.max(it.volume ?? 1, 0), 1) };
  });
  return { name: k.name, cols, rows, items };
}

/** The config the screens run on: the library and the controller settings side by side. */
export const combine = (library, settings) => ({ ...library, ...settings });

/**
 * Formats a config object as JSON, keeping small objects (controls, partials, value maps)
 * on one line so the file stays readable after the app rewrites it.
 */
export function formatConfig(value, indent = '') {
  const flat = (v) => v === null || typeof v !== 'object'
    || Object.values(v).every((x) => x === null || typeof x !== 'object'
      || (Array.isArray(x) && x.every((y) => y === null || typeof y !== 'object')));
  if (Array.isArray(value) && value.some((x) => x !== null && typeof x === 'object')) {
    const inner = indent + '  ';
    return `[\n${value.map((x) => inner + formatConfig(x, inner)).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !flat(value)) {
    const inner = indent + '  ';
    const body = Object.entries(value).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatConfig(x, inner)}`);
    return `{\n${body.join(',\n')}\n${indent}}`;
  }
  return spaced(JSON.stringify(value));
}

/** Adds a space after "," and ":" outside of strings: {"a":1,"b":2} → {"a": 1, "b": 2} */
function spaced(json) {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    out += ch;
    if (inString) {
      if (ch === '\\') out += json[++i];
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === ',' || ch === ':') {
      out += ' ';
    }
  }
  return out;
}
