// 設定ファイル（JSON）の定義と検証。形式はネイティブ版 soft-synth と同じ

export const PARAMS = [
  'volume', 'attack', 'decay', 'sustain', 'release', 'brightness', 'chorus', 'detune',
  'reverb', 'reverbSize', 'reverbDamp', 'vibrato', 'vibratoRate', 'transpose', 'bend', 'velocity',
];

/** 演奏中の状態。プリセットを切り替えても保持する */
export const PERFORMANCE = new Set(['volume', 'transpose', 'bend']);

export const DEFAULT_PARAMS = {
  volume: 0.8,
  attack: 0.008,     // 秒
  decay: 1.6,        // 秒（sustain レベルへ向かう時定数）
  sustain: 0.3,      // 0...1
  release: 0.28,     // 秒
  brightness: 1,     // 倍音（ratio != 1 の partial）の量の倍率
  chorus: 0.5,       // デチューンした基音の量
  detune: 4,         // cent
  reverb: 0.22,      // wet 量
  reverbSize: 0.8,   // フィードバック 0...0.97
  reverbDamp: 0.65,  // 残響の暗さ 0...1
  vibrato: 0,        // 深さ（半音）
  vibratoRate: 5,    // Hz
  transpose: 0,      // 半音
  bend: 0,           // 半音（ピッチベンド）
  velocity: 0.8,     // ベロシティ感度 0...1
};

export const MAX_PARTIALS = 8;

export const DEFAULT_PARTIALS = [
  { ratio: 1, level: 1, velocity: 0, decay: 0 },
  { ratio: 2, level: 0.1, velocity: 0.25, decay: 0.5 },
  { ratio: 3, level: 0, velocity: 0.08, decay: 0.18 },
];

const paramControl = (param, min, max) =>
  ({ kind: 'param', param, min, max, exponential: false, step: 0 });

/** 設定がないときの既定値（一般的な MIDI 鍵盤向け） */
export const BUILTIN = {
  params: {},
  presets: [{ name: 'default', values: {}, partials: null }],
  initialPreset: null,
  logMIDI: false,
  controls: [
    { source: { type: 'pitchBend' }, channel: null, target: paramControl('bend', -2, 2) },
    { source: { type: 'cc', number: 1 }, channel: null, target: paramControl('vibrato', 0, 0.5) },
    { source: { type: 'cc', number: 7 }, channel: null, target: paramControl('volume', 0, 1) },
  ],
};

class ConfigError extends Error {}
const fail = (msg) => { throw new ConfigError(msg); };

function number(v, path) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}: must be a number`);
  return v;
}

function param(v, path) {
  if (!PARAMS.includes(v)) fail(`${path}: must be one of ${PARAMS.join(', ')}`);
  return v;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function parseValues(obj, path) {
  if (!isObject(obj)) fail(`${path}: must be an object`);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[param(k, `${path} key`)] = number(v, `${path}.${k}`);
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

function parseControl(d, path) {
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

  let target;
  switch (d.action) {
    case undefined: {
      const lo = number(d.min ?? 0, `${path}.min`);
      const hi = number(d.max ?? 1, `${path}.max`);
      const exponential = d.curve === 'exp';
      if (exponential && (lo <= 0 || hi <= 0)) fail(`${path}: curve "exp" needs min and max > 0`);
      target = {
        kind: 'param', param: param(d.param, `${path}.param`), min: lo, max: hi, exponential,
        step: number(d.step ?? 0, `${path}.step`),
      };
      break;
    }
    case 'preset':
      if (typeof d.preset !== 'string') fail(`${path}.preset: required`);
      target = { kind: 'preset', preset: d.preset };
      break;
    case 'nextPreset':
    case 'prevPreset':
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
  return { source, channel, target };
}

/** JSON テキストを検証して設定オブジェクトにする。誤りがあれば場所を含むメッセージで例外を投げる */
export function parseConfig(text) {
  let root;
  try {
    root = JSON.parse(text);
  } catch (e) {
    fail(`invalid JSON: ${e.message}`);
  }
  if (!isObject(root)) fail('top level must be an object');

  const c = {
    params: root.params !== undefined ? parseValues(root.params, 'params') : {},
    presets: BUILTIN.presets,
    initialPreset: typeof root.preset === 'string' ? root.preset : null,
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
    c.controls = root.controls.map((d, i) => parseControl(d, `controls[${i}]`));
  }

  const names = new Set(c.presets.map((p) => p.name));
  if (c.initialPreset !== null && !names.has(c.initialPreset)) fail(`preset: unknown preset "${c.initialPreset}"`);
  c.controls.forEach((ctl, i) => {
    if (ctl.target.kind === 'preset' && !names.has(ctl.target.preset)) {
      fail(`controls[${i}]: unknown preset "${ctl.target.preset}"`);
    }
  });
  return c;
}
