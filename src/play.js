// The Play screen: perform with several sounds at once. A performance puts one preset on the keyboard,
// presets on a grid of virtual pads, and parameters on a row of virtual knobs. Physical pads and knobs
// follow the controller surface (see surface.js): virtual pad r-c plays the pad at row r, column c, and
// virtual knob k moves knob k. The config's "play" list gives pads and sliders other jobs (slots, the loop).
//
// Each distinct preset in use runs as its own synth ("part"): the keys part plus one part per preset
// on the pads. Pads sharing a preset share its part.
import { CHOICES, MAX_SLOTS, presetSound, slotCount } from './config.js';
import { Knob, MODULES, SPECS } from './panel.js';
import { Looper } from './looper.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

const TARGETS = { keys: 'keys', pads: 'pads', all: 'keys + pads' };
// knob parameters: every continuous panel knob, grouped by module (switches are left out)
const KNOB_PARAMS = MODULES.map((m) => ({
  title: m.title,
  params: m.items.filter((i) => i.knob && !CHOICES[i.knob]).map((i) => ({ name: i.knob, label: i.label })),
})).filter((g) => g.params.length > 0);
const LABELS = Object.fromEntries(KNOB_PARAMS.flatMap((g) => g.params.map((p) => [p.name, p.label])));

const DEFAULT_KNOBS = [
  ['keys', 'cutoff'], ['keys', 'resonance'], ['keys', 'attack'], ['keys', 'release'],
  ['all', 'delay'], ['all', 'reverb'], ['keys', 'volume'], ['pads', 'volume'],
];

function newPerformance(name, keysPreset, rows = 4, cols = 4) {
  return {
    name,
    keys: { preset: keysPreset },
    pads: { cols, rows, items: [] }, // new performances take the controller's pad grid
    knobs: DEFAULT_KNOBS.map(([target, param]) => ({ target, param, value: null })),
    slots: [],
  };
}

/** Makes stored data safe to use: right types, known presets and parameters, sensible sizes. */
function sanitize(perf, presetNames, fallbackPreset) {
  const known = (n) => (presetNames.includes(n) ? n : null);
  const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : d);
  const cols = Math.round(num(perf?.pads?.cols, 4, 1, 8)), rows = Math.round(num(perf?.pads?.rows, 4, 1, 8));
  const items = Array.from({ length: cols * rows }, (_, i) => {
    const p = perf?.pads?.items?.[i] ?? {};
    return { preset: known(p.preset), note: Math.round(num(p.note, 60, 0, 127)), volume: num(p.volume, 1, 0, 1) };
  });
  const knobs = (Array.isArray(perf?.knobs) ? perf.knobs : DEFAULT_KNOBS.map(([target, param]) => ({ target, param })))
    .slice(0, 16)
    .map((k) => ({
      target: TARGETS[k?.target] ? k.target : 'keys',
      param: LABELS[k?.param] ? k.param : null,
      value: typeof k?.value === 'number' && Number.isFinite(k.value) ? k.value : null,
    }));
  return {
    name: typeof perf?.name === 'string' && perf.name ? perf.name : 'performance',
    keys: { preset: known(perf?.keys?.preset) ?? fallbackPreset },
    pads: { cols, rows, items },
    knobs,
    // presets for the numbered slots that "slot" controls switch the keys to (null = empty)
    slots: (Array.isArray(perf?.slots) ? perf.slots : []).slice(0, MAX_SLOTS).map(known),
  };
}

const describe = (s) => (s ? `${s.type === 'note' ? noteName(s.number) : `cc ${s.number}`} ch${s.channel + 1}` : '');

// MARK: parts (one synth per preset in use)

class Part {
  constructor(context, destination) {
    this.context = context;
    this.destination = destination;
    this.engine = null;
    this.sound = null;
    this.overrides = {};
  }

  /** The part's synth follows its preset's engine: 'soft-synth' (subtractive) or 'fm-synth' (FM, src/fm). */
  load(sound) {
    const engine = sound.engine === 'fm' ? 'fm' : 'synth';
    if (engine !== this.engine) {
      this.node?.port.postMessage({ type: 'allNotesOff' });
      this.node?.disconnect();
      this.node = new AudioWorkletNode(this.context, engine === 'fm' ? 'fm-synth' : 'soft-synth', { numberOfInputs: 0, outputChannelCount: [2] });
      this.node.connect(this.destination);
      this.engine = engine;
    }
    this.sound = sound;
    this.push();
  }

  set(param, value) {
    this.overrides[param] = value;
    this.push();
  }

  push() {
    if (!this.sound) return;
    if (this.engine === 'fm') return this.node.port.postMessage({ type: 'voice', voice: this.sound.voice, perf: fmPerf({ ...this.sound.params, ...this.overrides }) });
    this.node.port.postMessage({ type: 'params', params: { ...this.sound.params, ...this.overrides }, partials: this.sound.partials });
  }

  send(msg) {
    this.node?.port.postMessage(msg);
  }

  dispose() {
    this.send({ type: 'allNotesOff' });
    this.node?.disconnect();
  }
}

/**
 * The Play knobs speak the subtractive panel's parameters; an FM part takes the ones that mean something to it:
 * volume, reverb, mod wheel, transpose, bend, and "brightness" (brightness and cutoff both turn the modulators
 * up or down, which is what makes an FM sound brighter or darker).
 */
function fmPerf(p) {
  const bright = ((p.brightness ?? 1) - 1) * 30 + Math.log2(Math.min(20000, p.cutoff ?? 20000) / 20000) * 5;
  return { volume: p.volume ?? 0.8, reverb: (p.reverb ?? 0.15) * 0.7, modWheel: Math.min(1, (p.modWheel ?? 0) * 2), shift: p.transpose ?? 0, bendSemis: p.bend ?? 0, brightness: Math.round(bright) };
}

// MARK: the screen

/**
 * Mounts the Play screen into `root`.
 * hooks.getConfig(): the current config (presets); hooks.save(performances): persist; surface: the controller surface;
 * hooks.onKeysNote(note, on): light the on-screen keyboard; hooks.startAudio(); hooks.log().
 */
export function mountPlay(root, { stored, surface, getConfig, save, saveKit, deleteKit, onKeysNote, onTransportChange = () => {}, startAudio, log }) {
  let config = getConfig();
  let presetNames = config.presets.map((p) => p.name);
  let performances = (Array.isArray(stored) && stored.length ? stored : [newPerformance('performance 1', presetNames[0], surface.layout.rows, surface.layout.cols)])
    .map((p) => sanitize(p, presetNames, presetNames[0]));
  let current = 0;
  let selected = { kind: 'pad', index: 0 };
  let audio = null; // { context, destination } once audio has started
  const parts = new Map(); // part id ('keys' or 'preset:<name>') → Part
  const knobControls = [];
  const perf = () => performances[current];

  // MARK: sound

  function wantedParts() {
    const want = new Map([['keys', perf().keys.preset]]);
    for (const pad of perf().pads.items) if (pad.preset) want.set(`preset:${pad.preset}`, pad.preset);
    return want;
  }

  /** Creates, reloads, or removes parts to match the performance, then re-applies the knobs. */
  function rebuild() {
    if (!audio) return;
    const want = wantedParts();
    for (const [id, part] of parts) {
      if (!want.has(id)) {
        part.dispose();
        parts.delete(id);
      }
    }
    for (const [id, preset] of want) {
      if (!parts.has(id)) parts.set(id, new Part(audio.context, audio.destination));
      parts.get(id).overrides = {};
      parts.get(id).load(presetSound(config, preset));
    }
    perf().knobs.forEach((k, i) => { if (k.param && k.value !== null) applyKnob(i, k.value); });
  }

  const targetParts = (target) => [...parts].filter(([id]) =>
    target === 'all' || (target === 'keys' ? id === 'keys' : id !== 'keys')).map(([, p]) => p);

  function applyKnob(i, value) {
    const k = perf().knobs[i];
    for (const part of targetParts(k.target)) part.set(k.param, value);
  }

  /** The value a knob shows: what it was set to, or the first target's preset value. */
  function knobValue(k) {
    if (k.value !== null) return k.value;
    const preset = k.target === 'pads' ? perf().pads.items.find((p) => p.preset)?.preset : perf().keys.preset;
    return presetSound(config, preset ?? perf().keys.preset).params[k.param];
  }

  /** A note played live on the keys: sounds, and goes into the loop if it is recording. */
  function keysNote(note, on, velocity = 100) {
    keysSound(note, on, velocity);
    recordNote(`keys:${note}`, () => loopSound('keys', null, perf().keys.preset, parts.get('keys')), note, on, velocity);
  }

  function padNote(i, on, velocity = 100) {
    const pad = perf().pads.items[i];
    if (!pad?.preset) return;
    padSound(i, on, velocity);
    recordNote(`pad:${i}`, () => loopSound('pad', i, pad.preset, parts.get(`preset:${pad.preset}`)),
      pad.note, on, on ? Math.max(1, Math.round(velocity * pad.volume)) : 0);
  }

  // A recorded note keeps the sound it was played with (preset and knob settings at that moment),
  // so changing the keys preset, a pad, or a knob later does not change the loop.
  const loopSounds = new Map(); // sound id → { kind: 'keys' | 'pad', pad, preset, overrides }
  const loopParts = new Map();  // sound id → Part that plays the loop's notes in that sound
  const liveSound = new Map();  // held live note → sound id it was recorded with (its note-off uses the same)

  function loopSound(kind, pad, preset, part) {
    const overrides = { ...(part?.overrides ?? {}) };
    const id = JSON.stringify([kind, pad, preset, overrides]);
    if (!loopSounds.has(id)) loopSounds.set(id, { kind, pad, preset, overrides });
    return id;
  }

  function recordNote(liveKey, sound, note, on, velocity) {
    if (!looper.recording) return;
    let id;
    if (on) {
      id = sound();
      liveSound.set(liveKey, id);
    } else {
      id = liveSound.get(liveKey);
      liveSound.delete(liveKey);
      if (id === undefined) return;
    }
    looper.capture(id, note, on, velocity);
  }

  function loopPart(id) {
    if (!audio) return null;
    let part = loopParts.get(id);
    if (!part) {
      const s = loopSounds.get(id);
      part = new Part(audio.context, audio.destination);
      part.overrides = { ...s.overrides };
      part.load(presetSound(config, s.preset));
      loopParts.set(id, part);
    }
    return part;
  }

  /** Plays a note from the loop in its recorded sound, lighting the key or pad it came from. */
  function loopTrigger(e, on) {
    const s = loopSounds.get(e.target);
    if (!s) return;
    loopPart(e.target)?.send(on ? { type: 'noteOn', key: e.note, velocity: e.velocity } : { type: 'noteOff', key: e.note });
    if (s.kind === 'keys') onKeysNote(e.note, on);
    else root.querySelectorAll('.pad')[s.pad]?.classList.toggle('hit', on);
  }

  /** Frees the synths of sounds no layer uses any more (after undo / clear). */
  function pruneLoopSounds() {
    const used = looper.targets;
    for (const [id, part] of loopParts) if (!used.has(id)) { part.dispose(); loopParts.delete(id); }
    for (const id of loopSounds.keys()) if (!used.has(id)) loopSounds.delete(id);
  }

  function keysSound(note, on, velocity) {
    parts.get('keys')?.send(on ? { type: 'noteOn', key: note, velocity } : { type: 'noteOff', key: note });
    onKeysNote(note, on);
  }

  function padSound(i, on, velocity) {
    const pad = perf().pads.items[i];
    if (!pad?.preset) return;
    const part = parts.get(`preset:${pad.preset}`);
    part?.send(on ? { type: 'noteOn', key: pad.note, velocity: Math.max(1, Math.round(velocity * pad.volume)) }
      : { type: 'noteOff', key: pad.note });
    const el = root.querySelectorAll('.pad')[i];
    el?.classList.toggle('hit', on);
  }

  // MARK: loop

  /** Metronome: a short blip straight to the output. */
  function clickSound(accent) {
    if (!audio) return;
    const { context } = audio;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    gain.gain.setValueAtTime(accent ? 0.25 : 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  const looper = new Looper({
    now: () => (audio ? audio.context.currentTime : performance.now() / 1000),
    trigger: loopTrigger,
    click: clickSound,
    onChange: () => {
      if (!looper.recording) pruneLoopSounds();
      root.querySelector('.play-loop')?.replaceWith(renderLoop());
      onTransportChange();
    },
    log,
  });

  // the loop position display follows the clock without redrawing the section
  let frame = 0;
  (function follow() {
    const pos = root.querySelector('.loop-pos');
    if (pos) {
      const d = looper.display;
      pos.textContent = `${d.bar}.${d.beat}`;
      root.querySelector('.loop-fill').style.width = `${(d.progress * 100).toFixed(1)}%`;
    }
    frame = requestAnimationFrame(follow);
  })();

  // MARK: MIDI

  /** An event from the controller surface (see surface.js); raw = the MIDI message, for unassigned sliders. */
  function handleSurface(e, raw) {
    const a = config.play.find((c) => (e.kind === 'pads'
      ? c.source.type === 'pad' && c.source.row === e.row && c.source.col === e.col
      : c.source.type === 'slider' && c.source.index === e.index));
    if (e.kind === 'pads') {
      if (a) {
        if (e.pressed) runAction(a.target);
        return;
      }
      // the virtual pad plays the Play pad in the same row and column
      const { cols, rows } = perf().pads;
      if (e.row < rows && e.col < cols) padNote(e.row * cols + e.col, e.pressed, e.velocity);
      return;
    }
    if (e.kind === 'knobs') {
      if (e.index < perf().knobs.length && perf().knobs[e.index].param) setKnob(e.index, e.value);
      return;
    }
    if (a?.target.kind === 'param') {
      const t = a.target;
      let v = t.exponential ? t.min * (t.max / t.min) ** e.value : t.min + (t.max - t.min) * e.value;
      if (t.step > 0) v = Math.round(v / t.step) * t.step;
      parts.get('keys')?.set(t.param, v);
    } else if (a) {
      if (e.value > 0) runAction(a.target);
    } else {
      handle(...raw); // an unassigned slider keeps its standard meaning (pitch bend, mod wheel)
    }
  }

  /** A MIDI message no surface widget has: it plays the keys part as normal MIDI. */
  function handle(status, d1, d2) {
    const kind = status & 0xf0;
    const noteOn = kind === 0x90 && d2 > 0, noteOff = kind === 0x80 || (kind === 0x90 && d2 === 0);
    // everything else goes to the keys part as normal MIDI
    const keys = parts.get('keys');
    if (noteOn) keysNote(d1, true, d2);
    else if (noteOff) keysNote(d1, false);
    else if (kind === 0xb0 && d1 === 64) keys?.send({ type: 'sustain', down: d2 >= 64 });
    else if (kind === 0xb0 && d1 === 1) keys?.set('modWheel', (d2 / 127) * 0.5);
    else if (kind === 0xe0) keys?.set('bend', ((((d2 << 7) | d1) / 16383) * 2 - 1) * 2);
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) panic();
  }

  function setKnob(i, norm) {
    const k = perf().knobs[i];
    const spec = SPECS[k.param];
    let v = spec.exp ? spec.min * (spec.max / spec.min) ** norm : spec.min + (spec.max - spec.min) * norm;
    if (spec.zero && norm < 0.005) v = 0;
    if (spec.step) v = Math.round(v / spec.step) * spec.step;
    k.value = v;
    applyKnob(i, v);
    knobControls[i]?.update(v);
    persist();
  }

  function panic() {
    looper.stop();
    for (const part of parts.values()) part.send({ type: 'allNotesOff' });
  }

  /** A transport command (Start / Stop, MMC, or a Mackie button; see transport.js): the loop and the slots. */
  function transport(cmd) {
    switch (cmd) {
      case 'play': startAudio(); looper.play(); break;
      case 'stop': looper.stop(); break;
      case 'record': startAudio(); looper.record(); break;
      case 'recordExit': if (looper.recording) looper.record(); break;
      case 'undo': looper.undo(); break;
      case 'click':
        looper.metronome = !looper.metronome;
        log(`click ${looper.metronome ? 'on' : 'off'}`);
        looper.onChange();
        break;
      default: {
        const n = /^track(\d)$/.exec(cmd)?.[1];
        if (n) selectSlot(Number(n));
      }
    }
  }

  /** The slot (1-based) whose preset the keys play now, or 0. */
  const activeSlot = () => perf().slots.findIndex((p) => p && p === perf().keys.preset) + 1;

  function runAction(t) {
    switch (t.kind) {
      case 'slot': selectSlot(t.slot); break;
      case 'record': startAudio(); looper.record(); break;
      case 'play': startAudio(); looper.play(); break;
      case 'stop': looper.stop(); break;
      case 'undoNote': looper.undo(); break;
    }
  }

  /** Switches the keys to the preset in slot n (1-based). */
  function selectSlot(n) {
    const preset = perf().slots[n - 1];
    if (!preset) {
      log(`slot ${n}: no preset (choose one under KEYS → slots)`);
      return;
    }
    if (perf().keys.preset !== preset) {
      parts.get('keys')?.send({ type: 'allNotesOff' });
      perf().keys.preset = preset;
      rebuild(); persist(); render();
    }
    log(`slot ${n}: ${preset}`);
    onTransportChange(); // the slot's track LED
  }

  // MARK: saving

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(performances), 300);
  }

  // MARK: view

  const el = (tag, props = {}, ...children) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...children);
    return e;
  };
  /** A preset choice, grouped: sounds and drums (drums first for pads). */
  const presetSelect = (value, onchange, { allowNone = false, drumsFirst = false } = {}) => {
    const s = el('select', { onchange: (e) => onchange(e.target.value || null) });
    if (allowNone) s.append(new Option('— none —', ''));
    const group = (label, presets) => {
      if (!presets.length) return;
      const og = el('optgroup', { label });
      for (const p of presets) og.append(new Option(p.name, p.name));
      s.append(og);
    };
    const drums = config.presets.filter((p) => p.group === 'drums');
    const sounds = config.presets.filter((p) => p.group !== 'drums' && p.engine !== 'fm');
    const fm = config.presets.filter((p) => p.engine === 'fm');
    if (drumsFirst) { group('drums', drums); group('sounds', sounds); group('FM', fm); } else { group('sounds', sounds); group('FM', fm); group('drums', drums); }
    s.value = value ?? '';
    return s;
  };

  // MARK: kits

  let kitChoice = '';

  /** Puts a kit on the pads of this performance (its grid size too). */
  function loadKit(name) {
    const kit = config.kits.find((k) => k.name === name);
    if (!kit) return;
    panic();
    perf().pads = { cols: kit.cols, rows: kit.rows, items: kit.items.map((it) => ({ ...it })) };
    selected = { kind: 'pad', index: 0 };
    rebuild(); persist(); render();
    log(`kit: ${name} on the pads`);
  }

  function renderKitRow() {
    const kits = config.kits;
    const select = el('select', { onchange: (e) => { kitChoice = e.target.value; render(); } });
    select.append(new Option(kits.length ? '— choose a kit —' : '— no kits —', ''));
    for (const k of kits) select.append(new Option(`${k.name} (${k.rows} × ${k.cols})`, k.name));
    if (!kits.some((k) => k.name === kitChoice)) kitChoice = '';
    select.value = kitChoice;
    return el('div', { className: 'play-row' },
      el('span', { className: 'strip-note', textContent: 'kit' }),
      select,
      el('button', { type: 'button', textContent: 'Load', disabled: !kitChoice, title: 'Replace these pads with the kit',
        onclick: () => {
          if (perf().pads.items.some((p) => p.preset) && !confirm(`Replace the pads with “${kitChoice}”?`)) return;
          loadKit(kitChoice);
        } }),
      el('button', { type: 'button', textContent: 'Save as kit', title: 'Keep these pads (sounds, notes, volumes) as a kit in the library',
        onclick: () => {
          const name = prompt('Kit name (an existing name is overwritten):', kitChoice || `${perf().name} kit`)?.trim();
          if (!name) return;
          const { cols, rows, items } = perf().pads;
          kitChoice = name;
          saveKit({ name, cols, rows, items: items.map((it) => ({ preset: it.preset, note: it.note, volume: it.volume })) });
        } }),
      el('button', { type: 'button', textContent: 'Delete kit', disabled: !kitChoice,
        onclick: () => { if (confirm(`Delete the kit “${kitChoice}” from the library?`)) { deleteKit(kitChoice); kitChoice = ''; } } }));
  }

  function renderHeader() {
    const perfSelect = el('select', { onchange: (e) => { current = Number(e.target.value); selected = { kind: 'pad', index: 0 }; rebuild(); persist(); render(); } });
    performances.forEach((p, i) => perfSelect.append(new Option(p.name, String(i))));
    perfSelect.value = String(current);
    const size = (label, value, lo, hi, onchange) => el('label', { className: 'play-size' }, label,
      el('input', { type: 'number', min: lo, max: hi, value, onchange: (e) => onchange(Math.min(Math.max(Math.round(Number(e.target.value) || lo), lo), hi)) }));
    return el('section', { className: 'module play-perf' },
      el('h3', { textContent: 'PERFORMANCE', title: 'A performance is a keyboard sound, a pad kit, and knob assignments. Everything here is saved as you go.' }),
      el('div', { className: 'play-row' },
        el('div', { className: 'lcd program-lcd' }, perfSelect),
        el('button', { type: 'button', textContent: 'New', onclick: () => {
          performances.push(newPerformance(`performance ${performances.length + 1}`, perf().keys.preset, surface.layout.rows, surface.layout.cols));
          performances[performances.length - 1] = sanitize(performances.at(-1), presetNames, presetNames[0]);
          current = performances.length - 1;
          rebuild(); persist(); render();
        } }),
        el('button', { type: 'button', textContent: 'Rename', onclick: () => {
          const name = prompt('Name for this performance:', perf().name)?.trim();
          if (name) { perf().name = name; persist(); render(); }
        } }),
        el('button', { type: 'button', textContent: 'Delete', disabled: performances.length < 2, onclick: () => {
          if (!confirm(`Delete the performance “${perf().name}”?`)) return;
          performances.splice(current, 1);
          current = 0;
          rebuild(); persist(); render();
        } }),
        el('button', { type: 'button', textContent: 'All notes off', onclick: panic })),
      el('div', { className: 'play-row' },
        el('span', { className: 'strip-note', textContent: 'KEYS' }),
        presetSelect(perf().keys.preset, (v) => { perf().keys.preset = v ?? presetNames[0]; rebuild(); persist(); render(); }),
        size('pads', perf().pads.cols, 1, 8, (v) => resizePads(v, perf().pads.rows)),
        el('span', { className: 'strip-note', textContent: '×' }),
        size('', perf().pads.rows, 1, 8, (v) => resizePads(perf().pads.cols, v)),
        size('knobs', perf().knobs.length, 1, 16, resizeKnobs)),
      renderSlots(),
      renderSlotsHint());
  }

  /** One preset choice per slot the config's "slot" controls use; the slot playing now is lit. */
  function renderSlots() {
    const count = slotCount(config);
    if (count === 0) return '';
    const slots = perf().slots;
    return el('div', { className: 'play-row play-slots' },
      el('span', { className: 'strip-note', textContent: 'slots',
        title: 'Presets for the controls mapped to preset slots (e.g. pads): hitting one switches the keys to its preset.' }),
      ...Array.from({ length: count }, (_, i) => {
        const select = presetSelect(slots[i] ?? null, (v) => {
          while (slots.length <= i) slots.push(null);
          slots[i] = v;
          persist(); render();
        }, { allowNone: true });
        return el('label', { className: `play-slot${slots[i] && slots[i] === perf().keys.preset ? ' on' : ''}` },
          String(i + 1), select);
      }));
  }

  /** Which virtual controls the Play screen follows (they are learned on the Controller screen). */
  function renderSlotsHint() {
    const { knobs, rows, cols } = surface.layout;
    return el('p', { className: 'strip-note', textContent: `Controller: pad r-c plays the pad in row r, column c (surface ${rows} × ${cols}); `
      + `knob k moves knob k (${knobs} knobs). Pads the config's "play" list assigns do that instead. Learn the controller on the Setup screen.` });
  }

  function resizePads(cols, rows) {
    const items = perf().pads.items;
    perf().pads = { cols, rows, items: Array.from({ length: cols * rows }, (_, i) => items[i] ?? { preset: null, note: 60, volume: 1 }) };
    selected = { kind: 'pad', index: 0 };
    rebuild(); persist(); render();
  }

  function resizeKnobs(n) {
    const knobs = perf().knobs;
    perf().knobs = Array.from({ length: n }, (_, i) => knobs[i] ?? { target: 'keys', param: null, value: null });
    selected = { kind: 'knob', index: 0 };
    persist(); render();
  }

  /** "r-c" of the controller pad that plays Play pad i (same row and column), if the surface has it bound. */
  function followed(i) {
    const { cols } = perf().pads;
    const row = Math.floor(i / cols), col = i % cols;
    if (row >= surface.layout.rows || col >= surface.layout.cols || !surface.pads[row * surface.layout.cols + col]) return '';
    if (config.play.some((c) => c.source.type === 'pad' && c.source.row === row && c.source.col === col)) return '';
    return `${row + 1}-${col + 1}`;
  }

  function renderPads() {
    const { cols, items } = perf().pads;
    const grid = el('div', { className: 'pad-grid' });
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    items.forEach((pad, i) => {
      const b = el('button', { type: 'button', className: 'pad' },
        el('span', { className: 'pad-name', textContent: pad.preset ?? '—' }),
        el('span', { className: 'pad-note', textContent: pad.preset ? noteName(pad.note) : '' }),
        followed(i) ? el('span', { className: 'pad-link', textContent: followed(i) }) : '');
      b.classList.toggle('selected', selected.kind === 'pad' && selected.index === i);
      b.classList.toggle('empty', !pad.preset);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startAudio();
        selected = { kind: 'pad', index: i };
        render();
        padNote(i, true, 100);
        const up = () => { padNote(i, false); removeEventListener('pointerup', up); };
        addEventListener('pointerup', up);
      });
      grid.append(b);
    });
    const pad = selected.kind === 'pad' ? items[selected.index] : null;
    const editor = pad ? el('div', { className: 'play-editor' },
      el('strong', { textContent: `Pad ${selected.index + 1}` }),
      el('label', {}, 'sound ', presetSelect(pad.preset, (v) => { pad.preset = v; rebuild(); persist(); render(); }, { allowNone: true, drumsFirst: true })),
      el('label', {}, 'note ',
        el('button', { type: 'button', textContent: '−', onclick: () => { pad.note = Math.max(0, pad.note - 1); persist(); render(); } }),
        el('span', { className: 'play-note', textContent: `${noteName(pad.note)} (${pad.note})` }),
        el('button', { type: 'button', textContent: '+', onclick: () => { pad.note = Math.min(127, pad.note + 1); persist(); render(); } })),
      el('label', {}, 'volume ', el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: pad.volume,
        oninput: (e) => { pad.volume = Number(e.target.value); persist(); } })),
      el('span', { className: 'strip-note', textContent: followed(selected.index) ? `played by controller pad ${followed(selected.index)}` : 'no controller pad in this position' }))
      : '';
    return el('section', { className: 'module play-pads' },
      el('h3', { textContent: 'PADS', title: 'Click a pad to hear and edit it. Each pad plays a preset at a fixed note; pads with the same preset share one synth. A kit fills them all at once.' }),
      renderKitRow(), grid, editor);
  }

  function renderKnobs() {
    knobControls.length = 0;
    const row = el('div', { className: 'play-knobs' });
    perf().knobs.forEach((k, i) => {
      const wrap = el('div', { className: 'play-knob' });
      wrap.classList.toggle('selected', selected.kind === 'knob' && selected.index === i);
      if (k.param) {
        const knob = new Knob(`knob${i}`, SPECS[k.param], `${LABELS[k.param]}`, {
          get: () => knobValue(k),
          set: (_, v) => { k.value = v; applyKnob(i, v); knob.update(v); persist(); },
          reset: () => { k.value = null; rebuild(); persist(); render(); },
        });
        knob.update(knobValue(k));
        if (i < surface.layout.knobs && surface.knobs[i]) knob.badge(String(i + 1));
        knobControls[i] = knob;
        wrap.append(knob.el);
      } else {
        wrap.append(el('div', { className: 'play-knob-empty', textContent: '—' }));
      }
      wrap.append(el('button', { type: 'button', className: 'play-knob-target', textContent: `${i + 1} · ${k.param ? TARGETS[k.target] : 'unassigned'}`,
        onclick: () => {
          selected = { kind: 'knob', index: i };
          render();
        } }));
      row.append(wrap);
    });
    const k = selected.kind === 'knob' ? perf().knobs[selected.index] : null;
    let editor = '';
    if (k) {
      const target = el('select', { onchange: (e) => { k.target = e.target.value; k.value = null; rebuild(); persist(); render(); } });
      for (const [v, label] of Object.entries(TARGETS)) target.append(new Option(label, v));
      target.value = k.target;
      const param = el('select', { onchange: (e) => { k.param = e.target.value || null; k.value = null; rebuild(); persist(); render(); } });
      param.append(new Option('— none —', ''));
      for (const g of KNOB_PARAMS) {
        const og = el('optgroup', { label: g.title });
        for (const p of g.params) og.append(new Option(p.label, p.name));
        param.append(og);
      }
      param.value = k.param ?? '';
      editor = el('div', { className: 'play-editor' },
        el('strong', { textContent: `Knob ${selected.index + 1}` }),
        el('label', {}, 'controls ', target),
        el('label', {}, 'parameter ', param),
        el('span', { className: 'strip-note', textContent: selected.index < surface.layout.knobs && surface.knobs[selected.index] ? `moved by controller knob ${selected.index + 1}` : 'no controller knob with this number' }));
    }
    return el('section', { className: 'module play-knobs-module' },
      el('h3', { textContent: 'KNOBS', title: 'Each knob moves one parameter of the keys sound, the pad sounds, or both, on top of their presets (not saved into the presets). Double-click a knob to go back to the preset value.' }),
      row, editor);
  }

  function renderLoop() {
    const L = looper;
    const button = (text, title, onclick, on = false) =>
      el('button', { type: 'button', textContent: text, title, className: on ? 'on' : '', onclick });
    const tempo = el('input', { type: 'number', min: 40, max: 240, value: L.bpm, disabled: L.locked,
      onchange: (e) => L.setTempo(Number(e.target.value) || 120, L.bars) });
    const bars = el('select', { disabled: L.locked, onchange: (e) => L.setTempo(L.bpm, Number(e.target.value)) });
    for (const n of [1, 2, 4, 8]) bars.append(new Option(`${n} bar${n > 1 ? 's' : ''}`, String(n)));
    bars.value = String(L.bars);
    const check = (label, value, onchange) => el('label', { className: 'play-size' },
      el('input', { type: 'checkbox', checked: value, onchange: (e) => onchange(e.target.checked) }), label);
    const layers = [...L.layers.map((layer, i) => el('button', {
      type: 'button', className: `loop-layer${layer.muted ? ' muted' : ''}`,
      textContent: `${i + 1} · ${layer.events.filter((e) => e.on).length}`,
      title: 'Layer: notes recorded in one take. Click to mute / unmute.',
      onclick: () => L.toggleMute(i),
    })), ...(L.recording ? [el('span', { className: 'loop-layer recording', textContent: `${L.layers.length + 1} · rec` })] : [])];
    return el('section', { className: 'module play-loop' },
      el('h3', { textContent: 'LOOP', title: 'Record what you play on the keys and pads into a loop, then keep adding layers while it plays. Each take (record → record) is one layer; undo takes back one note at a time.' }),
      el('div', { className: 'play-row' },
        button('● Rec', 'Start recording a layer (starts the loop if it is stopped); press again to keep the take', () => { startAudio(); L.record(); }, !!L.recording),
        button('▶ Play', 'Play the loop from the top', () => { startAudio(); L.play(); }, L.playing && !L.recording),
        button('■ Stop', 'Stop (keeps the layers)', () => L.stop()),
        button('↶ Undo', 'Remove the last recorded note', () => L.undo()),
        button('Clear', 'Remove every layer', () => L.clear()),
        el('div', { className: 'lcd loop-lcd' }, el('span', { className: 'loop-pos', textContent: '1.1' })),
        el('div', { className: 'loop-bar' }, el('div', { className: 'loop-fill' }))),
      el('div', { className: 'play-row' },
        el('label', { className: 'play-size' }, 'bpm', tempo),
        bars,
        check('quantize 1/16', L.quantize, (v) => { L.quantize = v; }),
        check('click', L.metronome, (v) => { L.metronome = v; }),
        el('span', { className: 'strip-note', textContent: L.locked ? 'layers:' : 'tempo and length are set until the first layer' }),
        ...layers));
  }

  function render() {
    root.replaceChildren(renderHeader(), renderLoop(), renderPads(), renderKnobs());
  }

  render();

  return {
    handle,
    handleSurface,
    transport,
    /** What the transport LEDs show on this screen. */
    get transportState() {
      return { playing: looper.playing, recording: !!looper.recording, cycle: false, track: activeSlot() };
    },
    keysNote,
    panic,
    /** Called when audio starts: parts can now be created. */
    attachAudio(context, destination) {
      audio = { context, destination };
      rebuild();
    },
    /** Stops and removes every part (before a new config replaces this screen). */
    dispose() {
      looper.stop();
      cancelAnimationFrame(frame);
      for (const part of loopParts.values()) part.dispose();
      loopParts.clear();
      for (const part of parts.values()) part.dispose();
      parts.clear();
    },
    /** Called when the presets change (a preset was written). */
    refresh() {
      config = getConfig();
      presetNames = config.presets.map((p) => p.name);
      performances = performances.map((p) => sanitize(p, presetNames, presetNames[0]));
      rebuild();
      render();
    },
  };
}
