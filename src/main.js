// Wires the page together: audio start, MIDI input, config editing and saving, parameter display and control.
import { BUILTIN, MAX_PARTIALS, PARAMS, PARTIAL_FIELDS, formatConfig, parseConfig } from './config.js';
import { Controller, describeMIDI, describeSource } from './controller.js';
import { BluetoothMIDIInput, WebMIDIInput } from './midi.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'soft-synth-web:config';

// Slider ranges. exp = logarithmic (times and ratios); zero = the far left end means exactly 0.
const SLIDERS = {
  volume: { min: 0, max: 1 },
  attack: { min: 0.001, max: 2, exp: true, unit: 's' },
  decay: { min: 0.05, max: 8, exp: true, unit: 's' },
  sustain: { min: 0, max: 1 },
  release: { min: 0.02, max: 5, exp: true, unit: 's' },
  brightness: { min: 0, max: 2 },
  chorus: { min: 0, max: 1 },
  detune: { min: 0, max: 30, unit: 'cents' },
  reverb: { min: 0, max: 0.8 },
  reverbSize: { min: 0, max: 0.97 },
  reverbDamp: { min: 0, max: 0.99 },
  vibrato: { min: 0, max: 1, unit: 'st' },
  vibratoRate: { min: 0.5, max: 10, unit: 'Hz' },
  transpose: { min: -24, max: 24, step: 1, unit: 'st' },
  bend: { min: -2, max: 2, unit: 'st' },
  velocity: { min: 0, max: 1 },
};
const PARTIAL_SLIDERS = {
  ratio: { min: 0.25, max: 16, exp: true },
  level: { min: 0, max: 1 },
  velocity: { min: 0, max: 0.5 },
  decay: { min: 0.02, max: 20, exp: true, zero: true, unit: 's' },
};

// MARK: log

const logLines = [];
function log(line) {
  const t = new Date().toLocaleTimeString();
  logLines.push(`[${t}] ${line}`);
  if (logLines.length > 300) logLines.splice(0, logLines.length - 300);
  const el = $('log');
  el.textContent = logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

// MARK: synth (AudioWorklet)

let audioContext = null;
let synthNode = null;

function send(msg) {
  synthNode?.port.postMessage(msg);
}

async function startAudio() {
  if (audioContext) {
    await audioContext.resume();
    return;
  }
  audioContext = new AudioContext({ latencyHint: 'interactive' });
  await audioContext.audioWorklet.addModule('src/synth-worklet.js');
  synthNode = new AudioWorkletNode(audioContext, 'soft-synth', {
    numberOfInputs: 0,
    outputChannelCount: [2],
  });
  synthNode.connect(audioContext.destination);
  controller.sync();
  audioContext.onstatechange = renderAudioStatus;
  renderAudioStatus();
  log(`audio started (${audioContext.sampleRate} Hz)`);
}

function renderAudioStatus() {
  const running = audioContext?.state === 'running';
  $('audio-status').textContent = running ? `Playing · ${audioContext.sampleRate / 1000} kHz` : 'Stopped';
  $('audio-status').classList.toggle('on', running);
  $('start').textContent = running ? 'Sound is on' : 'Start sound';
  $('start').disabled = running;
}

// MARK: controller and UI updates

let rawConfig = null; // the config as plain JSON, so saving a preset can rewrite it
let uiDirty = false;
const controller = new Controller({
  send,
  log,
  onChange: () => {
    // knobs send many messages; redraw at most once per frame
    if (uiDirty) return;
    uiDirty = true;
    requestAnimationFrame(() => {
      uiDirty = false;
      renderPresets();
      renderPages();
      renderSliders();
    });
  },
  onSavePreset: (index, preset) => {
    if (!rawConfig?.presets) {
      log('nothing to save into: apply a config that has "presets" first');
      return;
    }
    rawConfig.presets[index] = preset;
    const text = formatConfig(rawConfig) + '\n';
    $('config-text').value = text;
    storageSet(text);
  },
});

function onMIDI(status, d1, d2) {
  if ($('monitor').checked) log(`midi: ${describeMIDI(status, d1, d2)}`);
  controller.handle(status, d1, d2);
}

function syncButtons(box, labels, onClick) {
  if (box.dataset.labels !== labels.join('\n')) {
    box.replaceChildren(...labels.map((label, i) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => onClick(i);
      return b;
    }));
    box.dataset.labels = labels.join('\n');
  }
  return [...box.children];
}

function renderPresets() {
  const presets = controller.config.presets;
  syncButtons($('presets'), presets.map((p) => p.name), (i) => controller.selectPreset(i))
    .forEach((b, i) => b.classList.toggle('active', i === controller.presetIndex));
}

function renderPages() {
  const pages = controller.config.pages;
  $('pages-card').hidden = pages.length === 0;
  if (pages.length === 0) return;
  syncButtons($('pages'), pages, (i) => controller.selectPage(pages[i]))
    .forEach((b, i) => b.classList.toggle('active', pages[i] === controller.page));
  // what each knob does on this page
  const items = controller.activeControls
    .filter((c) => c.page !== null && c.target.kind === 'param')
    .map((c) => `<li><span>${describeSource(c)}</span>${c.target.param}</li>`);
  $('page-controls').innerHTML = items.join('');
}

const toSlider = (s, v) => {
  if (s.zero && v <= 0) return 0;
  return s.exp ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min);
};
const fromSlider = (s, x) => {
  if (s.zero && x < 0.005) return 0;
  let v = s.exp ? s.min * (s.max / s.min) ** x : s.min + (s.max - s.min) * x;
  if (s.step) v = Math.round(v / s.step) * s.step;
  return v;
};
const format = (s, v) => {
  if (s.zero && v === 0) return 'off';
  const n = s.step ? String(v) : v.toFixed(v >= 10 ? 1 : v >= 1 ? 2 : 3);
  return s.unit ? `${n} ${s.unit}` : n;
};

/** name → { spec, input, output } for every slider on the page */
const sliders = new Map();

function makeSlider(name, label, spec) {
  const wrap = document.createElement('div');
  wrap.className = 'param';
  const id = `p-${name.replace('.', '-')}`;
  wrap.innerHTML = `<label for="${id}">${label}<output></output></label>
    <input type="range" id="${id}" min="0" max="1000" step="1">`;
  const input = wrap.querySelector('input');
  input.addEventListener('input', () => controller.setParam(name, fromSlider(spec, input.value / 1000)));
  sliders.set(name, { spec, input, output: wrap.querySelector('output') });
  return wrap;
}

function buildSliders() {
  $('params').replaceChildren(...PARAMS.map((p) => makeSlider(p, p, SLIDERS[p])));
  const rows = [];
  for (let i = 1; i <= MAX_PARTIALS; i++) {
    const row = document.createElement('div');
    row.className = 'partial-row';
    const head = document.createElement('div');
    head.className = 'partial-name';
    head.textContent = `partial ${i}`;
    row.append(head, ...PARTIAL_FIELDS.map((f) => makeSlider(`partial${i}.${f}`, f, PARTIAL_SLIDERS[f])));
    rows.push(row);
  }
  $('partials').replaceChildren(...rows);
}

function renderSliders() {
  for (const [name, { spec, input, output }] of sliders) {
    const v = controller.getParam(name);
    if (document.activeElement !== input) {
      input.value = Math.round(Math.min(Math.max(toSlider(spec, v), 0), 1) * 1000);
    }
    output.textContent = format(spec, v);
  }
  [...$('partials').children].forEach((row, i) => row.classList.toggle('unused', i >= controller.partials.length));
}

// MARK: config

function storageGet() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function storageSet(text) {
  try { localStorage.setItem(STORAGE_KEY, text); } catch { /* keep working even if it cannot be saved */ }
}

async function fetchTemplate(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

function applyConfigText(text, { save }) {
  const err = $('config-error');
  try {
    const config = parseConfig(text);
    rawConfig = JSON.parse(text);
    controller.load(config);
    err.hidden = true;
    if (save) {
      storageSet(text);
      log('config saved');
    }
    return true;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    log(`config error: ${e.message}`);
    return false;
  }
}

async function initConfig() {
  let text = storageGet();
  if (!text) {
    try {
      text = await fetchTemplate($('config-template').value);
    } catch (e) {
      log(`config template not found (${e.message}), using built-in defaults`);
      controller.load(BUILTIN);
      return;
    }
  }
  $('config-text').value = text;
  if (!applyConfigText(text, { save: false })) controller.load(BUILTIN);
}

// MARK: MIDI input

const webMIDI = new WebMIDIInput({ onMessage: onMIDI, onDevicesChange: renderInputs, log });
const bleMIDI = new BluetoothMIDIInput({
  onMessage: onMIDI,
  log,
  onStatus: (s) => {
    const labels = { connecting: 'connecting…', connected: 'connected', reconnecting: 'waiting to reconnect…', disconnected: '' };
    $('ble-status').textContent = bleMIDI.device ? `${bleMIDI.device.name}: ${labels[s]}` : labels[s];
    $('ble-connect').textContent = bleMIDI.device ? 'Disconnect' : 'Connect Bluetooth MIDI keyboard';
    renderInputs();
  },
});

function renderInputs() {
  const list = $('midi-inputs');
  if (!webMIDI.supported) {
    list.innerHTML = '<li class="muted">This browser has no Web MIDI (use Chrome, Edge, or Firefox)</li>';
    return;
  }
  if (!webMIDI.access) return;
  const inputs = webMIDI.inputs;
  if (inputs.length === 0) {
    list.innerHTML = '<li class="muted">No MIDI keyboard found (it will show up here when connected)</li>';
    return;
  }
  list.replaceChildren(...inputs.map((i) => {
    const li = document.createElement('li');
    li.textContent = i.name + (i.ignored ? ' (ignored: connected directly over Bluetooth)' : '');
    if (i.ignored) li.className = 'muted';
    return li;
  }));
}

async function startMIDI() {
  if (!webMIDI.supported || webMIDI.access) return;
  try {
    await webMIDI.start();
  } catch (e) {
    log(`MIDI access denied: ${e.message}`);
    $('midi-inputs').innerHTML = '<li class="muted">MIDI access was not allowed</li>';
  }
}

// MARK: playing from the computer keyboard

const KEYS = 'awsedftgyhujk';
let octave = 0;
const keyNotes = new Map(); // held key → note it started (so octave changes still stop the right note)

function isTyping(e) {
  return e.target.closest('textarea, input:not([type=range]), select');
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || isTyping(e)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'x') {
    octave = Math.min(Math.max(octave + (k === 'x' ? 12 : -12), -36), 36);
    log(`keyboard octave ${octave >= 0 ? '+' : ''}${octave / 12}`);
    return;
  }
  const i = KEYS.indexOf(k);
  if (i < 0) return;
  const note = 60 + octave + i;
  keyNotes.set(k, note);
  startAudio();
  controller.handle(0x90, note, 90);
});

addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (!keyNotes.has(k)) return;
  controller.handle(0x80, keyNotes.get(k), 0);
  keyNotes.delete(k);
});

// MARK: startup

buildSliders();
$('start').onclick = async () => {
  await startAudio();
  await startMIDI();
};
$('panic').onclick = () => controller.panic();
$('save-preset').onclick = () => controller.savePreset();
$('revert-preset').onclick = () => controller.selectPreset(controller.presetIndex);
$('config-apply').onclick = () => applyConfigText($('config-text').value, { save: true });
$('config-load').onclick = async () => {
  try {
    $('config-text').value = await fetchTemplate($('config-template').value);
    $('config-error').hidden = true;
  } catch (e) {
    log(`template load failed: ${e.message}`);
  }
};

if (!bleMIDI.supported) {
  $('ble-connect').disabled = true;
  $('ble-status').textContent = 'This browser has no Web Bluetooth (use Chrome or Edge)';
}
$('ble-connect').onclick = async () => {
  if (bleMIDI.device) {
    webMIDI.ignoredNames.delete(bleMIDI.device.name);
    bleMIDI.disconnect();
    return;
  }
  try {
    await bleMIDI.connect();
    // if the OS has the same keyboard connected too, ignore it on the Web MIDI side so notes don't play twice
    webMIDI.ignoredNames.add(bleMIDI.device.name);
    renderInputs();
  } catch (e) {
    if (e.name !== 'NotFoundError') log(`bluetooth: ${e.message}`); // NotFoundError = picker cancelled
    bleMIDI.device = null;
    bleMIDI.setStatus('disconnected');
  }
};

renderAudioStatus();
initConfig();
