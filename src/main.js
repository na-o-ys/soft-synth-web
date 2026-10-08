// Wires the page together: audio start, MIDI input, the instrument panel, config editing and saving.
import {
  BUILTIN, DEFAULT_PARAMS, DEFAULT_PARTIALS, INIT_PARAMS, INIT_PARTIALS, combine, newPartial, parseControllerSettings, parseLibrary,
  partialParam,
} from './config.js';
import { Controller, describeMIDI } from './controller.js';
import { BluetoothMIDIInput, WebMIDIInput } from './midi.js';
import { routeInput } from './input-rules.js';
import { Recorder } from './recorder.js';
import { mountLessons } from './lessons-ui.js';
import { Keyboard, buildPanel } from './panel.js';
import { mountPlay } from './play.js';
import { mountFm } from './fm/fm-app.js';
import { FM_INTRO, FM_LESSONS } from './fm/fm-lessons.js';
import { sanitizeVoice } from './fm/voice.js';
import { PAGE_GROUPS, checkPages } from './pages.js';
import { Surface, describeSource } from './surface.js';
import { mountSurface } from './surface-ui.js';
import { migrateOldConfig, store } from './store.js';
import { MackieLights, mackieCommand, standardCommand } from './transport.js';
import { LiveView, drawEnvelope, drawFilter, drawWaveform } from './visuals.js';

const $ = (id) => document.getElementById(id);
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
let fmNode = null; // the FM page's synth
let audioOut = null; // where every synth connects (the master volume, then the analyser in front of the speakers)
let masterGain = null;
const MASTER_KEY = 'soft-synth-web:master';

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
  // every synth → master volume → analyser (so the screens show what you hear) → speakers
  masterGain = new GainNode(audioContext, { gain: masterCurve(Number($('master').value)) });
  synthNode.connect(masterGain).connect(analyser).connect(audioContext.destination);
  new LiveView(analyser, $('scope'), $('spectrum'));
  audioOut = masterGain;
  // the FM page's engine: its own node beside the Analog page's
  await audioContext.audioWorklet.addModule('src/fm/fm-worklet.js');
  fmNode = new AudioWorkletNode(audioContext, 'fm-synth', { numberOfInputs: 0, outputChannelCount: [2] });
  fmNode.connect(masterGain);
  fm?.attachAudio(fmNode);
  play?.attachAudio(audioContext, masterGain);
  controller.sync();
  audioContext.onstatechange = renderAudioStatus;
  renderAudioStatus();
  log(`audio started (${audioContext.sampleRate} Hz)`);
}

/** Master volume 0–100 → gain: squared, so the slider's middle sounds like half as loud rather than barely quieter. */
const masterCurve = (v) => (v / 100) ** 2;

function setMaster(v, save = true) {
  v = Math.min(Math.max(Math.round(v), 0), 100);
  $('master').value = String(v);
  $('master-value').textContent = String(v);
  masterGain?.gain.setTargetAtTime(masterCurve(v), masterGain.context.currentTime, 0.02); // no zipper noise
  if (save) try { localStorage.setItem(MASTER_KEY, String(v)); } catch { /* not essential */ }
}
$('master').addEventListener('input', (e) => setMaster(Number(e.target.value)));
$('master').addEventListener('dblclick', () => setMaster(100));
try { const v = Number(localStorage.getItem(MASTER_KEY)); if (localStorage.getItem(MASTER_KEY) !== null && Number.isFinite(v)) setMaster(v, false); } catch { /* start at 100 */ }

function renderAudioStatus() {
  const running = audioContext?.state === 'running';
  $('audio-led').classList.toggle('on', running);
  $('start-label').textContent = running ? 'On' : 'Start';
  $('audio-status').textContent = running ? `${audioContext.sampleRate / 1000} kHz` : 'audio off';
}

// MARK: controller

// the sound library as plain JSON (what the store keeps) and parsed, and the parsed controller settings;
// the screens run on the two combined (see store.js)
let rawLibrary = null;
let library = parseLibrary({});
let settings = { logMIDI: false, pickup: true, inputs: [], edit: [], play: [], mackie: null };
const currentConfig = () => combine(library, settings);
let uiDirty = false;
const recorder = new Recorder({ send, log, onChange: () => updateLights() });

// the controller surface: learned once on the Controller screen, stored apart from the config
const surface = new Surface({
  onChange: () => {
    controller.setKnobCount(surface.layout.knobs); // the Edit pages are cut to the number of knobs
    fm?.setKnobCount();
    play?.refresh();
  },
});

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
    rawLibrary.presets = [...(rawLibrary.presets ?? [])];
    rawLibrary.presets[index] = preset;
    saveLibrary();
  },
});

/** Stores the library after a change (a preset written, a kit saved) and hands it to the screens. */
function saveLibrary() {
  store.saveLibrary(rawLibrary);
  library = parseLibrary(rawLibrary);
  controller.updateConfig(currentConfig());
  play?.refresh(); // the Play screen uses the presets and kits too
}

// MARK: Edit / Play

let mode = 'edit';
let play = null; // the Play screen, mounted once the config is loaded
let fm = null; // the FM page, mounted once the config is loaded
let fmLessons = null; // the FM course in the lessons drawer

/** Screens: 'edit' (sound design), 'play' (performances), 'controller' (learn the controller surface). */
function setMode(next) {
  const prev = mode;
  mode = (next === 'play' && !play) || (next === 'fm' && !fm) ? 'edit' : next;
  document.body.classList.toggle('mode-play', mode === 'play');
  document.body.classList.toggle('mode-fm', mode === 'fm');
  document.body.classList.toggle('mode-controller', mode === 'controller');
  $('mode-edit').classList.toggle('on', mode === 'edit');
  $('mode-fm').classList.toggle('on', mode === 'fm');
  $('mode-toggle').classList.toggle('on', mode === 'play');
  $('controller-toggle').classList.toggle('on', mode === 'controller');
  if (mode === prev) return;
  // hand the instruments over cleanly: nothing keeps sounding from the other screen
  recorder.stop(); // the recorder plays the Edit screen's synth
  if (prev === 'edit') controller.panic();
  if (prev === 'play') play?.panic();
  if (prev === 'fm') fm?.panic();
  // the drawer holds the course of the page it was opened on
  lessons.close();
  fmLessons?.close();
  if (mode === 'play') play.refresh();
  if (mode === 'fm') fm.render();
  if (mode === 'controller') surfaceScreen.render();
  updateLights();
  // the Controller screen is a detour: coming back goes to the screen it was opened from
  if (mode !== 'controller') try { localStorage.setItem(MODE_KEY, mode); } catch { /* not essential */ }
}

/** FM presets are library presets with "engine": "fm" and the DX7 voice under "fm". */
const fmPresets = () => (rawLibrary?.presets ?? []).filter((p) => p?.engine === 'fm' && typeof p.name === 'string').map((p) => ({ name: p.name, voice: sanitizeVoice(p.fm) }));

function mountFmPage() {
  const nameTaken = (name) => {
    const p = (rawLibrary?.presets ?? []).find((x) => x?.name === name);
    return p ? (p.engine === 'fm' ? 'fm' : 'synth') : null;
  };
  fm = mountFm($('fm'), {
    log,
    startAudio,
    onKeysNote: (note, on) => (note === null ? keyboard.clear() : keyboard.set(note, on)),
    presets: fmPresets,
    nameTaken,
    knobCount: () => surface.layout.knobs,
    knobBound: (k) => !!surface.knobs[k],
    editActions: () => settings.edit,
    savePreset: (name, voice) => {
      const entry = { name, engine: 'fm', fm: structuredClone(voice) };
      const list = [...(rawLibrary.presets ?? [])];
      const i = list.findIndex((p) => p?.name === name);
      if (i >= 0) list[i] = entry; else list.push(entry);
      rawLibrary.presets = list;
      saveLibrary();
    },
    // imported voices never replace a preset: a taken name gets " 2", " 3", ...
    importPresets: (items) => {
      const list = [...(rawLibrary.presets ?? [])];
      const names = [];
      for (const { name, voice } of items) {
        let n = name, k = 2;
        while (list.some((p) => p?.name === n)) n = `${name} ${k++}`;
        list.push({ name: n, engine: 'fm', fm: structuredClone(voice) });
        names.push(n);
      }
      rawLibrary.presets = list;
      saveLibrary();
      return names;
    },
  });
  if (fmNode) fm.attachAudio(fmNode);
  fmLessons = mountLessons({
    drawer: $('lessons'),
    toggle: $('fm-lessons-toggle'),
    controls: new Map([...fm.page.widgets].map(([name, ws]) => [name, ws[0]])),
    startAudio,
    play: (note, on, velocity) => fm.handle(on ? 0x90 : 0x80, note, velocity),
    lessons: FM_LESSONS,
    stateKey: 'soft-synth-web:fm-lesson',
    intro: FM_INTRO,
    load: (values) => fm.loadValues(values),
    value: (_name, v) => v,
    reveal: (name) => fm.page.reveal(name),
  });
}

function mountPlayScreen() {
  play = mountPlay($('play'), {
    stored: store.performances(),
    surface,
    // the Play screen plays FM presets too: they join the list with their voice
    getConfig: () => ({ ...controller.config, presets: [...controller.config.presets, ...fmPresets().map((p) => ({ name: p.name, group: null, engine: 'fm', voice: p.voice, values: {} }))] }),
    save: (performances) => store.savePerformances(performances),
    saveKit: (kit) => {
      rawLibrary.kits = [...(rawLibrary.kits ?? []).filter((k) => k.name !== kit.name), kit];
      saveLibrary();
      log(`saved kit: ${kit.name}`);
    },
    deleteKit: (name) => {
      rawLibrary.kits = (rawLibrary.kits ?? []).filter((k) => k.name !== name);
      saveLibrary();
      log(`deleted kit: ${name}`);
    },
    onKeysNote: (note, on) => keyboard.set(note, on),
    onTransportChange: () => updateLights(),
    startAudio,
    log,
  });
  if (audioContext) play.attachAudio(audioContext, audioOut);
  let saved = null;
  try { saved = localStorage.getItem(MODE_KEY); } catch { /* start in edit */ }
  setMode(saved === 'play' || saved === 'fm' ? saved : 'edit');
}

/** Notes from the on-screen or computer keyboard go to whichever screen is active. */
function playNote(note, on, velocity) {
  if (mode === 'play') play.keysNote(note, on, velocity);
  else if (mode === 'fm') fm.handle(on ? 0x90 : 0x80, note, on ? velocity : 0);
  else controller.handle(on ? 0x90 : 0x80, note, on ? velocity : 0);
}

let midiFlash = 0;
/** One complete message from a MIDI input (port = the input's name): input rules first, then the active screen. */
function onMIDI(bytes, port) {
  const monitor = $('monitor').checked;
  const incoming = () => (bytes[0] >= 0xf0 ? `${bytes[0] === 0xf0 ? 'sysex ' : ''}${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`
    : describeMIDI(bytes[0], bytes[1] ?? 0, bytes[2] ?? 0));
  const flash = () => {
    $('midi-led').classList.add('flash');
    clearTimeout(midiFlash);
    midiFlash = setTimeout(() => $('midi-led').classList.remove('flash'), 80);
  };

  // standard transport from any input (Start / Continue / Stop, MMC): no learning needed
  const std = standardCommand(bytes);
  if (std) {
    if (monitor) log(`midi: ${incoming()} → ${std}${port ? ` (${port})` : ''}`);
    transport(std);
    return flash();
  }
  // the Mackie Control port: its button notes are commands; nothing from it plays or reaches the surface
  const mk = settings.mackie;
  const fromMackie = mk && mk.ports.some((p) => (port ?? '').includes(p));
  const wrapped = mk?.sysexNote && bytes[0] === 0xf0 && mk.sysexNote.every((b, i) => bytes[i] === b);
  if (fromMackie || wrapped) {
    const [kind, note, velocity] = wrapped ? [0x90, bytes[mk.sysexNote.length], bytes[mk.sysexNote.length + 1]] : [bytes[0] & 0xf0, bytes[1], bytes[2]];
    const cmd = kind === 0x90 && velocity > 0 ? mackieCommand(note, mk.buttons) : null;
    if (monitor) log(`midi: ${incoming()} → mackie ${cmd ?? '(ignored)'}${port ? ` (${port})` : ''}`);
    if (cmd) transport(cmd);
    return flash();
  }

  const routed = routeInput(controller.config.inputs, port, bytes);
  if (monitor) {
    const result = !routed ? ' → dropped'
      : routed[0] !== bytes[0] || bytes[0] === 0xf0 ? ` → ${describeMIDI(...routed)}` : '';
    log(`midi: ${incoming()}${result}${port ? ` (${port})` : ''}`);
  }
  if (!routed) return;
  const [status, d1, d2] = routed;
  if (mode === 'controller') {
    surfaceScreen.handle(status, d1, d2);
  } else {
    // the controller surface first: its knobs, pads, and sliders; everything else is played as MIDI
    const e = surface.resolve(status, d1, d2);
    const screen = mode === 'play' ? play : mode === 'fm' ? fm : controller;
    if (e) screen.handleSurface(e, routed);
    else screen.handle(status, d1, d2);
  }
  flash();
}

// MARK: transport

/** A transport command (see transport.js) for the screen in front: the Play loop or the Edit recorder. */
function transport(cmd) {
  if (mode === 'controller' || mode === 'fm') return;
  (mode === 'play' ? play : controller).transport(cmd);
  updateLights();
}

// the Mackie surface's LEDs follow the transport of the screen in front (whether they light is up to the surface)
const lights = new MackieLights(null);
let lightsOutput = null;
function updateLights() {
  const out = settings.mackie ? settings.mackie.ports.map((p) => webMIDI?.output(p)).find(Boolean) ?? null : null;
  if (out !== lightsOutput) {
    lightsOutput = out;
    lights.send = out ? (bytes) => { try { out.send(bytes); } catch { /* output gone */ } } : null;
    lights.reset();
  }
  if (!lights.send || !play) return;
  lights.update(mode === 'play' ? play.transportState : controller.transportState);
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

// the knobs follow the module you touch: its section on screen shows the knob page
const moduleEls = new Map(); // page group id → module element
for (const mod of [...$('row-1').children, ...$('row-2').children]) {
  const id = mod.querySelector('h3')?.textContent.toLowerCase();
  if (id) moduleEls.set(id, mod);
}
for (const [name, c] of controls) c.el.addEventListener('pointerdown', () => controller.showParam(name));
for (const [id, mod] of moduleEls) mod.querySelector('h3').addEventListener('click', () => controller.selectGroup(id));

const surfaceScreen = mountSurface($('surface'), { surface, log });

const keyboard = new Keyboard($('keyboard'), {
  low: 48,
  high: 84,
  onNote: (note, on) => {
    if (on) startAudio();
    playNote(note, on, 90);
  },
});

const lessons = mountLessons({
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
  // badges: which controller knob moves each control on the current page, and which slider moves a parameter
  const badges = new Map();
  controller.page.params.forEach((name, k) => { if (surface.knobs[k]) badges.set(name, String(k + 1)); });
  for (const a of controller.config.edit) {
    if (a.source.type === 'slider' && a.target.kind === 'param' && surface.sliders[a.source.index]) {
      badges.set(a.target.param, `S${a.source.index + 1}`);
    }
  }
  for (const [name, c] of controls) c.badge(badges.get(name));
  for (const [id, mod] of moduleEls) mod.classList.toggle('paged', id === controller.page.group);
}

function renderProgram() {
  const presets = controller.config.presets;
  const select = $('preset-select');
  const unsaved = controller.presetIndex < 0;
  const names = (unsaved ? '\u0000' : '') + presets.map((p) => `${p.group ?? ''}:${p.name}`).join('\n');
  if (select.dataset.names !== names) {
    // sounds, then drums, each under its heading (the numbers stay the library order)
    const group = (label, drums) => {
      const og = document.createElement('optgroup');
      og.label = label;
      presets.forEach((p, i) => { if ((p.group === 'drums') === drums) og.append(new Option(p.name, String(i))); });
      return og;
    };
    const options = [group('sounds', false)];
    if (presets.some((p) => p.group === 'drums')) options.push(group('drums', true));
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
  const box = $('pages');
  if (!box.children.length) {
    box.replaceChildren(...PAGE_GROUPS.map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.group = g.id;
      b.onclick = () => controller.selectGroup(g.id);
      return b;
    }));
  }
  const page = controller.page;
  for (const b of box.children) {
    const on = b.dataset.group === page.group;
    b.textContent = on && page.subs > 1 ? `${b.dataset.group} ${page.sub + 1}/${page.subs}` : b.dataset.group;
    b.classList.toggle('on', on);
  }
  const items = page.params.map((name, k) =>
    `<li><span>K${k + 1} · ${surface.knobs[k] ? describeSource(surface.knobs[k]) : 'not learned'}</span>${name}</li>`);
  $('page-controls').innerHTML = items.join('');
}

function renderGraphs() {
  drawWaveform($('waveform'), controller.params, controller.partials);
  drawFilter($('filter'), controller.params, controller.partials);
  drawEnvelope($('envelope'), controller.params);
}

new ResizeObserver(() => renderGraphs()).observe($('envelope'));

// MARK: config

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(text, key) {
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

/** Applies controller settings (the JSON under Setup); the sound being edited and the library are untouched. */
function applyControllerText(text, { save }) {
  const err = $('config-error');
  try {
    const next = parseControllerSettings(text);
    checkPages(next);
    settings = next;
    controller.updateConfig(currentConfig());
    if (settings.inputs.length) log(`input rules: ${settings.inputs.length}`);
    if (settings.mackie) log(`Mackie Control on "${settings.mackie.ports.join('" / "')}"`);
    updateLights();
    play?.refresh();
    err.hidden = true;
    if (save) {
      store.saveControllerText(text);
      log('controller settings saved');
    }
    return true;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    log(`controller settings error: ${e.message}`);
    return false;
  }
}

/**
 * The built-in library (configs/library.json). A stored library gets the built-in presets and kits it does not
 * have yet whenever the built-in one has a newer version (e.g. when drum sounds were added), so nothing is lost.
 */
async function loadLibrary() {
  let builtin = null;
  try { builtin = JSON.parse(await fetchTemplate('configs/library.json')); } catch (e) { log(`library template not found (${e.message})`); }
  let raw = store.library();
  if (!raw) {
    raw = builtin ?? { presets: BUILTIN.presets.map((p) => ({ name: p.name })) };
  } else if (builtin && (raw.version ?? 0) < (builtin.version ?? 0)) {
    const names = new Set((raw.presets ?? []).map((p) => p.name));
    const added = (builtin.presets ?? []).filter((p) => !names.has(p.name));
    const kitNames = new Set((raw.kits ?? []).map((k) => k.name));
    const kits = (builtin.kits ?? []).filter((k) => !kitNames.has(k.name));
    raw = { ...raw, version: builtin.version, presets: [...(raw.presets ?? []), ...added], kits: [...(raw.kits ?? []), ...kits] };
    if (added.length || kits.length) log(`library: added ${added.length} built-in presets and ${kits.length} kits`);
  }
  try {
    library = parseLibrary(raw);
    rawLibrary = raw;
  } catch (e) {
    log(`library error: ${e.message} (using the built-in one)`);
    rawLibrary = builtin;
    library = parseLibrary(builtin ?? {});
  }
  store.saveLibrary(rawLibrary);
}

async function initConfig() {
  const moved = migrateOldConfig();
  if (moved?.length) log(`split the old config into library / performances / controller settings: ${moved.join(', ')}`);
  await loadLibrary();
  let text = store.controllerText();
  if (!text) {
    try {
      text = await fetchTemplate($('config-template').value);
    } catch (e) {
      text = '{}\n';
      log(`controller template not found (${e.message})`);
    }
  }
  $('config-text').value = text;
  applyControllerText(text, { save: false });
  controller.load(currentConfig());
}

// MARK: MIDI input

const webMIDI = new WebMIDIInput({ onMessage: onMIDI, onDevicesChange: () => { renderInputs(); updateLights(); }, log });
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
$('panic').onclick = () => (mode === 'play' ? play.panic() : mode === 'fm' ? fm.panic() : controller.panic());
$('undo').onclick = () => controller.undo();
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) {
    e.preventDefault();
    if (mode === 'fm') fm.undo();
    else controller.undo();
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
$('config-apply').onclick = () => applyControllerText($('config-text').value, { save: true });

// the library as a file: a backup, or to move it to another browser
$('library-export').onclick = () => {
  const blob = new Blob([JSON.stringify(rawLibrary, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'soft-synth-library.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('library-import').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    parseLibrary(raw); // check before replacing anything
    if (!confirm(`Replace the library (${(rawLibrary?.presets ?? []).length} presets) with ${file.name}?`)) return;
    rawLibrary = raw;
    saveLibrary();
    log(`library imported from ${file.name}`);
  } catch (err) {
    log(`library import failed: ${err.message}`);
  }
};
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

$('mode-edit').onclick = () => setMode('edit');
$('mode-fm').onclick = () => setMode('fm');
$('mode-toggle').onclick = () => setMode('play');
let beforeController = 'edit';
$('controller-toggle').onclick = () => {
  if (mode === 'controller') return setMode(beforeController);
  beforeController = mode;
  setMode('controller');
};

renderAudioStatus();
initConfig().then(() => {
  controller.setKnobCount(surface.layout.knobs); // the Edit pages follow the controller's number of knobs
  restoreSession();
  mountFmPage();
  mountPlayScreen();
  // MIDI needs no click (unlike audio), so listen right away: forgetting Start must not silence the keyboard
  startMIDI();
});
