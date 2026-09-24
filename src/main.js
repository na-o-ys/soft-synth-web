// Wires the page together: audio start, MIDI input, the instrument panel, config editing and saving.
import {
  BUILTIN, DEFAULT_PARAMS, DEFAULT_PARTIALS, INIT_PARAMS, INIT_PARTIALS, formatConfig, newPartial, parseConfig, partialParam,
} from './config.js';
import { Controller, describeMIDI, describeSource } from './controller.js';
import { BluetoothMIDIInput, WebMIDIInput } from './midi.js';
import { routeInput } from './input-rules.js';
import { Recorder } from './recorder.js';
import { mountLessons } from './lessons-ui.js';
import { Keyboard, buildPanel } from './panel.js';
import { mountPlay } from './play.js';
import { LiveView, drawEnvelope, drawFilter, drawWaveform } from './visuals.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'soft-synth-web:config';
const SESSION_KEY = 'soft-synth-web:session'; // unsaved edits, so a reload does not lose them
const MODE_KEY = 'soft-synth-web:mode';       // 'edit' or 'play'

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
let audioOut = null; // where every synth connects (the analyser in front of the speakers)

/** Sends a message to the synth, and lights the on-screen keyboard for the notes it plays. */
function send(msg) {
  synthNode?.port.postMessage(msg);
  if (msg.type === 'noteOn') keyboard.set(msg.key, true);
  else if (msg.type === 'noteOff') keyboard.set(msg.key, false);
  else if (msg.type === 'allNotesOff') keyboard.clear();
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
  // the analyser passes audio through unchanged and feeds the scope and spectrum screens
  const analyser = new AnalyserNode(audioContext, { fftSize: 4096, smoothingTimeConstant: 0.6 });
  synthNode.connect(analyser).connect(audioContext.destination);
  new LiveView(analyser, $('scope'), $('spectrum'));
  audioOut = analyser;
  play?.attachAudio(audioContext, analyser);
  controller.sync();
  audioContext.onstatechange = renderAudioStatus;
  renderAudioStatus();
  log(`audio started (${audioContext.sampleRate} Hz)`);
}

function renderAudioStatus() {
  const running = audioContext?.state === 'running';
  $('audio-led').classList.toggle('on', running);
  $('start-label').textContent = running ? 'On' : 'Start';
  $('audio-status').textContent = running ? `${audioContext.sampleRate / 1000} kHz` : 'audio off';
}

// MARK: controller

let rawConfig = null; // the config as plain JSON, so writing a preset can rewrite it
let uiDirty = false;
const recorder = new Recorder({ send, log });

const controller = new Controller({
  send,
  log,
  recorder,
  onChange: () => {
    // save first: frames do not run while the tab is hidden, so this must not wait for the redraw
    saveSession();
    // knobs send many messages; redraw at most once per frame
    if (uiDirty) return;
    uiDirty = true;
    requestAnimationFrame(() => {
      uiDirty = false;
      renderProgram();
      renderPages();
      renderControls();
      renderGraphs();
    });
  },
  onSavePreset: (index, preset) => {
    if (!rawConfig?.presets) {
      log('nothing to write into: apply a config that has "presets" first');
      return;
    }
    rawConfig.presets[index] = preset;
    writeConfig();
    play?.refresh(); // the Play screen uses the presets too
  },
});

/** Writes the in-memory config (presets, performances) back to the editor and to storage. */
function writeConfig() {
  const text = formatConfig(rawConfig) + '\n';
  $('config-text').value = text;
  storageSet(text);
}

// MARK: Edit / Play

let mode = 'edit';
let play = null; // the Play screen, mounted once the config is loaded

function setMode(next) {
  mode = next === 'play' && play ? 'play' : 'edit';
  document.body.classList.toggle('mode-play', mode === 'play');
  $('mode-toggle').textContent = mode === 'play' ? 'Edit' : 'Play';
  $('mode-toggle').classList.toggle('on', mode === 'play');
  // hand the instruments over cleanly: nothing keeps sounding from the other screen
  recorder.stop(); // the recorder plays the Edit screen's synth
  if (mode === 'play') {
    controller.panic();
    play.refresh();
    if ($('lessons').hidden === false) $('lessons-toggle').click();
  } else {
    play?.panic();
  }
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* not essential */ }
}

function mountPlayScreen() {
  play = mountPlay($('play'), {
    stored: rawConfig?.performances,
    links: rawConfig?.playLinks,
    getConfig: () => controller.config,
    save: (performances, links) => {
      if (!rawConfig) return;
      rawConfig.performances = performances;
      rawConfig.playLinks = links;
      writeConfig();
    },
    onKeysNote: (note, on) => keyboard.set(note, on),
    midiInputs: () => (webMIDI.access ? webMIDI.inputs.filter((i) => i.state === 'connected').map((i) => i.name) : null),
    startAudio,
    log,
  });
  if (audioContext) play.attachAudio(audioContext, audioOut);
  let saved = null;
  try { saved = localStorage.getItem(MODE_KEY); } catch { /* start in edit */ }
  setMode(saved === 'play' ? 'play' : 'edit');
}

/** Notes from the on-screen or computer keyboard go to whichever screen is active. */
function playNote(note, on, velocity) {
  if (mode === 'play') play.keysNote(note, on, velocity);
  else controller.handle(on ? 0x90 : 0x80, note, on ? velocity : 0);
}

let midiFlash = 0;
/** One complete message from a MIDI input (port = the input's name): input rules first, then the active screen. */
function onMIDI(bytes, port) {
  const routed = routeInput(controller.config.inputs, port, bytes);
  if ($('monitor').checked) {
    const incoming = bytes[0] === 0xf0 ? `sysex ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`
      : describeMIDI(bytes[0], bytes[1] ?? 0, bytes[2] ?? 0);
    const result = !routed ? ' → dropped'
      : routed[0] !== bytes[0] || bytes[0] === 0xf0 ? ` → ${describeMIDI(...routed)}` : '';
    log(`midi: ${incoming}${result}${port ? ` (${port})` : ''}`);
  }
  if (!routed) return;
  const [status, d1, d2] = routed;
  if (mode === 'play') play.handle(status, d1, d2);
  else controller.handle(status, d1, d2);
  $('midi-led').classList.add('flash');
  clearTimeout(midiFlash);
  midiFlash = setTimeout(() => $('midi-led').classList.remove('flash'), 80);
}

// MARK: panel

/** The value a control returns to on double-click: what the current preset (or the init patch) says. */
function presetValue(name) {
  const unsaved = controller.presetIndex < 0;
  const preset = controller.config.presets[controller.presetIndex];
  const pp = partialParam(name);
  if (pp) {
    const partials = unsaved ? INIT_PARTIALS : preset?.partials ?? DEFAULT_PARTIALS;
    return (partials[pp.index] ?? newPartial(pp.index))[pp.field];
  }
  if (unsaved) return INIT_PARAMS[name];
  return { ...DEFAULT_PARAMS, ...controller.config.params, ...preset?.values }[name];
}

const controls = buildPanel(
  { rows: [$('row-1'), $('row-2')], additive: $('additive') },
  {
    get: (name) => controller.getParam(name),
    set: (name, v) => controller.setParam(name, v),
    reset: (name) => controller.setParam(name, presetValue(name), true),
  },
);

const keyboard = new Keyboard($('keyboard'), {
  low: 48,
  high: 84,
  onNote: (note, on) => {
    if (on) startAudio();
    playNote(note, on, 90);
  },
});

mountLessons({
  drawer: $('lessons'),
  toggle: $('lessons-toggle'),
  controller,
  controls,
  startAudio,
  play: (note, on, velocity) => controller.handle(on ? 0x90 : 0x80, note, velocity),
});

function renderControls() {
  for (const [name, c] of controls) c.update(controller.getParam(name));
  [...$('additive').children].forEach((col, i) => col.classList.toggle('unused', i >= controller.partials.length));
  // badges: which hardware control moves each panel control (knob number on the current page, or its CC)
  const badges = new Map();
  let n = 0;
  for (const c of controller.activeControls) {
    if (c.target.kind !== 'param') continue;
    if (c.page !== null) badges.set(c.target.param, String(++n));
    else if (!badges.has(c.target.param)) badges.set(c.target.param, c.source.type === 'pitchBend' ? 'PB' : `cc${c.source.number}`);
  }
  for (const [name, c] of controls) c.badge(badges.get(name));
}

function renderProgram() {
  const presets = controller.config.presets;
  const select = $('preset-select');
  const unsaved = controller.presetIndex < 0;
  const names = (unsaved ? '\u0000' : '') + presets.map((p) => p.name).join('\n');
  if (select.dataset.names !== names) {
    const options = presets.map((p, i) => new Option(p.name, String(i)));
    // the init patch is not a preset yet: show it only while it is being edited
    if (unsaved) options.push(new Option('init (unsaved)', '-1'));
    select.replaceChildren(...options);
    select.dataset.names = names;
  }
  select.value = String(controller.presetIndex);
  // "*" = edited and not written yet
  $('preset-number').textContent = (unsaved ? '--' : String(controller.presetIndex + 1).padStart(2, '0'))
    + (controller.edited ? '*' : '');
}

function renderPages() {
  const pages = controller.config.pages;
  $('pages-box').hidden = pages.length === 0;
  const box = $('pages');
  if (box.dataset.pages !== pages.join('\n')) {
    box.replaceChildren(...pages.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p;
      b.onclick = () => controller.selectPage(p);
      return b;
    }));
    box.dataset.pages = pages.join('\n');
  }
  [...box.children].forEach((b, i) => b.classList.toggle('on', pages[i] === controller.page));
  const items = controller.activeControls
    .filter((c) => c.page !== null && c.target.kind === 'param')
    .map((c, i) => `<li><span>${i + 1} · ${describeSource(c)}</span>${c.target.param}</li>`);
  $('page-controls').innerHTML = items.length ? items.join('') : '<li class="muted">This config has no knob pages.</li>';
}

function renderGraphs() {
  drawWaveform($('waveform'), controller.params, controller.partials);
  drawFilter($('filter'), controller.params, controller.partials);
  drawEnvelope($('envelope'), controller.params);
}

new ResizeObserver(() => renderGraphs()).observe($('envelope'));

// MARK: config

function storageGet(key = STORAGE_KEY) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(text, key = STORAGE_KEY) {
  try { localStorage.setItem(key, text); } catch { /* keep working even if it cannot be saved */ }
}

// the working state is written shortly after each change (and when the page goes away),
// but only once the previous session has been put back, so loading does not overwrite it
let sessionReady = false;
let sessionTimer = 0;
function writeSession() {
  clearTimeout(sessionTimer);
  if (sessionReady) storageSet(JSON.stringify(controller.snapshot()), SESSION_KEY);
}
function saveSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(writeSession, 300);
}
addEventListener('pagehide', writeSession);

function restoreSession() {
  let state = null;
  try { state = JSON.parse(storageGet(SESSION_KEY)); } catch { /* damaged: start from the preset */ }
  if (controller.restore(state)) {
    log(`restored last session: ${state.preset ?? 'init patch'}${state.edited ? ' with unsaved edits' : ''}`);
  }
  sessionReady = true;
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
    if (config.inputs.length) log(`input rules: ${config.inputs.length}`);
    if (play) {
      // a new config may bring its own performances: rebuild the Play screen from it
      play.dispose();
      mountPlayScreen();
    }
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
  return e.target instanceof Element && e.target.closest('textarea, input:not([type=range]), select');
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || isTyping(e)) return;
  // arrow keys belong to a focused knob
  if (e.target instanceof Element && e.target.closest('.knob-dial')) return;
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
  playNote(note, true, 90);
});

addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (!keyNotes.has(k)) return;
  playNote(keyNotes.get(k), false, 0);
  keyNotes.delete(k);
});

// MARK: startup

$('start').onclick = async () => {
  await startAudio();
  await startMIDI();
};
$('panic').onclick = () => (mode === 'play' ? play.panic() : controller.panic());
$('undo').onclick = () => controller.undo();
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) {
    e.preventDefault();
    controller.undo();
  }
});
$('new-preset').onclick = () => controller.newPatch();
$('save-preset').onclick = () => {
  // keeping the name overwrites this preset; a new name saves a copy
  const current = controller.presetName;
  const name = prompt('Save this sound as:', current ?? 'init')?.trim();
  if (!name) return;
  const taken = controller.config.presets.some((p) => p.name === name);
  if (name !== current && taken && !confirm(`A preset called “${name}” exists. Overwrite it?`)) return;
  controller.savePreset(name);
};
$('revert-preset').onclick = () => {
  if (controller.presetIndex < 0) controller.newPatch();
  else controller.selectPreset(controller.presetIndex);
};
$('preset-select').onchange = (e) => controller.selectPreset(Number(e.target.value));
$('preset-prev').onclick = () => {
  const n = controller.config.presets.length;
  controller.selectPreset(((controller.presetIndex < 0 ? 0 : controller.presetIndex) + n - 1) % n);
};
$('preset-next').onclick = () => controller.selectPreset((controller.presetIndex + 1) % controller.config.presets.length);
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

$('mode-toggle').onclick = () => setMode(mode === 'play' ? 'edit' : 'play');

renderAudioStatus();
initConfig().then(() => {
  restoreSession();
  mountPlayScreen();
  // MIDI needs no click (unlike audio), so listen right away: forgetting Start must not silence the keyboard
  startMIDI();
});
