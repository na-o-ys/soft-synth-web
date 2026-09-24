// Config file (JSON) definitions and validation. See README.md for the format.

export const PARAMS = [
  'volume', 'attack', 'decay', 'sustain', 'release', 'brightness', 'chorus', 'detune',
  'reverb', 'reverbSize', 'reverbDamp', 'vibrato', 'vibratoRate', 'transpose', 'bend', 'velocity',
];

/** Performance state: kept when switching presets and never saved into a preset. */
export const PERFORMANCE = new Set(['volume', 'transpose', 'bend']);

export const DEFAULT_PARAMS = {
  volume: 0.8,
  attack: 0.008,     // seconds
  decay: 1.6,        // seconds (time constant toward the sustain level)
  sustain: 0.3,      // 0...1
  release: 0.28,     // seconds
  brightness: 1,     // multiplier for partials whose ratio is not 1
  chorus: 0.5,       // level of the detuned copy of the fundamental
  detune: 4,         // cents
  reverb: 0.22,      // wet level
  reverbSize: 0.8,   // feedback 0...0.97
  reverbDamp: 0.65,  // darkness of the tail 0...1
  vibrato: 0,        // depth in semitones
  vibratoRate: 5,    // Hz
  transpose: 0,      // semitones
  bend: 0,           // semitones (pitch bend)
  velocity: 0.8,     // velocity sensitivity 0...1
};

export const MAX_PARTIALS = 8;
export const PARTIAL_FIELDS = ['ratio', 'level', 'velocity', 'decay'];

export const DEFAULT_PARTIALS = [
  { ratio: 1, level: 1, velocity: 0, decay: 0 },
  { ratio: 2, level: 0.1, velocity: 0.25, decay: 0.5 },
  { ratio: 3, level: 0, velocity: 0.08, decay: 0.18 },
];

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

const paramControl = (param, min, max) =>
  ({ kind: 'param', param, min, max, exponential: false, step: 0, pickup: false });

/** Defaults used when no config is available (suits a generic MIDI keyboard). */
export const BUILTIN = {
  params: {},
  presets: [{ name: 'default', values: {}, partials: null }],
  initialPreset: null,
  pages: [],
  logMIDI: false,
  controls: [
    { source: { type: 'pitchBend' }, channel: null, page: null, target: paramControl('bend', -2, 2) },
    { source: { type: 'cc', number: 1 }, channel: null, page: null, target: paramControl('vibrato', 0, 0.5) },
    { source: { type: 'cc', number: 7 }, channel: null, page: null, target: paramControl('volume', 0, 1) },
  ],
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
    out[k] = number(v, `${path}.${k}`);
  }
  return out;
}

function parsePreset(d, path) {
  if (typeof d.name !== 'string') fail(`${path}.name: required`);
  const { name, partials, ...rest } = d;
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
  return { name, values: parseValues(rest, path), partials: parsed };
}

function parseControl(d, path, pickupDefault) {
  if (!isObject(d)) fail(`${path}: must be an object`);
  let source;
  if (d.cc !== undefined) source = { type: 'cc', number: number(d.cc, `${path}.cc`) };
  else if (d.note !== undefined) source = { type: 'note', number: number(d.note, `${path}.note`) };
  else if (d.pitchBend === true) source = { type: 'pitchBend' };
  else fail(`${path}: needs one of "cc", "note", "pitchBend": true`);

  let channel = null;
  if (d.channel !== undefined) {
    const n = number(d.channel, `${path}.channel`);
    if (n < 1 || n > 16) fail(`${path}.channel: must be 1...16`);
    channel = n - 1;
  }
  if (d.page !== undefined && typeof d.page !== 'string') fail(`${path}.page: must be a page name`);

  let target;
  switch (d.action) {
    case undefined: {
      const lo = number(d.min ?? 0, `${path}.min`);
      const hi = number(d.max ?? 1, `${path}.max`);
      const exponential = d.curve === 'exp';
      if (exponential && (lo <= 0 || hi <= 0)) fail(`${path}: curve "exp" needs min and max > 0`);
      if (d.pickup !== undefined && typeof d.pickup !== 'boolean') fail(`${path}.pickup: must be true or false`);
      target = {
        kind: 'param', param: param(d.param, `${path}.param`), min: lo, max: hi, exponential,
        step: number(d.step ?? 0, `${path}.step`),
        // pickup only makes sense for knobs and sliders, not for notes
        pickup: source.type !== 'note' && (d.pickup ?? pickupDefault),
      };
      break;
    }
    case 'preset':
      if (typeof d.preset !== 'string') fail(`${path}.preset: required`);
      target = { kind: 'preset', preset: d.preset };
      break;
    case 'page':
      if (typeof d.page !== 'string') fail(`${path}.page: required`);
      // for this action "page" names the page to switch to, not the page the control lives on
      target = { kind: 'page', page: d.page };
      break;
    case 'nextPreset':
    case 'prevPreset':
    case 'nextPage':
    case 'prevPage':
    case 'savePreset':
    case 'panic':
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
  const page = d.action === 'page' ? null : d.page ?? null;
  return { source, channel, page, target };
}

/** Validates JSON text into a config object. Throws with a message that points at the problem. */
export function parseConfig(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (e) {
    fail(`invalid JSON: ${e.message}`);
  }
  if (!isObject(root)) fail('top level must be an object');
  if (root.pickup !== undefined && typeof root.pickup !== 'boolean') fail('pickup: must be true or false');
  if (root.pages !== undefined && (!Array.isArray(root.pages) || !root.pages.every((p) => typeof p === 'string'))) {
    fail('pages: must be an array of page names');
  }

  const c = {
    params: root.params !== undefined ? parseValues(root.params, 'params') : {},
    presets: BUILTIN.presets,
    initialPreset: typeof root.preset === 'string' ? root.preset : null,
    pages: root.pages ?? [],
    logMIDI: root.logMIDI === true,
    controls: BUILTIN.controls,
  };
  if (root.presets !== undefined) {
    if (!Array.isArray(root.presets) || root.presets.length === 0) {
      fail('presets: must be a non-empty array of objects');
    }
    c.presets = root.presets.map((p, i) => {
      if (!isObject(p)) fail(`presets[${i}]: must be an object`);
      return parsePreset(p, `presets[${i}]`);
    });
  }
  if (root.controls !== undefined) {
    if (!Array.isArray(root.controls)) fail('controls: must be an array of objects');
    c.controls = root.controls.map((d, i) => parseControl(d, `controls[${i}]`, root.pickup === true));
  }

  const names = new Set(c.presets.map((p) => p.name));
  if (c.initialPreset !== null && !names.has(c.initialPreset)) fail(`preset: unknown preset "${c.initialPreset}"`);
  const pages = new Set(c.pages);
  c.controls.forEach((ctl, i) => {
    if (ctl.target.kind === 'preset' && !names.has(ctl.target.preset)) {
      fail(`controls[${i}]: unknown preset "${ctl.target.preset}"`);
    }
    const page = ctl.target.kind === 'page' ? ctl.target.page : ctl.page;
    if (page !== null && !pages.has(page)) fail(`controls[${i}]: page "${page}" is not listed in "pages"`);
  });
  return c;
}

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
