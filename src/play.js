// The Play screen: perform with several sounds at once. A performance puts one preset on the keyboard,
// presets on a grid of virtual pads, and parameters on a row of virtual knobs. Physical pads and knobs
// are linked to the virtual ones by MIDI learn, so any controller works.
//
// Each distinct preset in use runs as its own synth ("part"): the keys part plus one part per preset
// on the pads. Pads sharing a preset share its part.
import { CHOICES, MAX_SLOTS, presetSound, slotCount } from './config.js';
import { Knob, MODULES, SPECS } from './panel.js';

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

function newPerformance(name, keysPreset) {
  return {
    name,
    keys: { preset: keysPreset },
    pads: { cols: 4, rows: 4, items: [] },
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

const sameSource = (a, b) => a && b && a.type === b.type && a.number === b.number && a.channel === b.channel;
const describe = (s) => (s ? `${s.type === 'note' ? noteName(s.number) : `cc ${s.number}`} ch${s.channel + 1}` : '');

// MARK: parts (one synth per preset in use)

class Part {
  constructor(context, destination) {
    this.node = new AudioWorkletNode(context, 'soft-synth', { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(destination);
    this.sound = null;
    this.overrides = {};
  }

  load(sound) {
    this.sound = sound;
    this.push();
  }

  set(param, value) {
    this.overrides[param] = value;
    this.push();
  }

  push() {
    if (!this.sound) return;
    this.node.port.postMessage({ type: 'params', params: { ...this.sound.params, ...this.overrides }, partials: this.sound.partials });
  }

  send(msg) {
    this.node.port.postMessage(msg);
  }

  dispose() {
    this.send({ type: 'allNotesOff' });
    this.node.disconnect();
  }
}

// MARK: the screen

/**
 * Mounts the Play screen into `root`.
 * hooks.getConfig(): the current config (presets); hooks.save(performances, links): persist;
 * hooks.onKeysNote(note, on): light the on-screen keyboard; hooks.startAudio(); hooks.log().
 */
export function mountPlay(root, { stored, links: storedLinks, getConfig, save, onKeysNote, midiInputs, startAudio, log }) {
  let config = getConfig();
  let presetNames = config.presets.map((p) => p.name);
  let performances = (Array.isArray(stored) && stored.length ? stored : [newPerformance('performance 1', presetNames[0])])
    .map((p) => sanitize(p, presetNames, presetNames[0]));
  // which physical control drives each virtual pad / knob (shared by all performances)
  let links = { pads: [...(storedLinks?.pads ?? [])], knobs: [...(storedLinks?.knobs ?? [])] };
  let current = 0;
  let selected = { kind: 'pad', index: 0 };
  let learning = false;
  // while learning: the virtual pad and knob the next new physical pad / knob will link to.
  // forced = chosen by clicking it, so it may take over a control that is already linked elsewhere
  let learnNext = { pads: null, knobs: null };
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

  function keysNote(note, on, velocity = 100) {
    parts.get('keys')?.send(on ? { type: 'noteOn', key: note, velocity } : { type: 'noteOff', key: note });
    onKeysNote(note, on);
  }

  function padNote(i, on, velocity = 100) {
    const pad = perf().pads.items[i];
    if (!pad?.preset) return;
    const part = parts.get(`preset:${pad.preset}`);
    part?.send(on ? { type: 'noteOn', key: pad.note, velocity: Math.max(1, Math.round(velocity * pad.volume)) }
      : { type: 'noteOff', key: pad.note });
    const el = root.querySelectorAll('.pad')[i];
    el?.classList.toggle('hit', on);
  }

  // MARK: MIDI

  /** Handles one MIDI message while the Play screen is active. */
  function handle(status, d1, d2) {
    const kind = status & 0xf0, channel = status & 0x0f;
    if (learning) showLastMidi(status, d1, d2);
    const noteOn = kind === 0x90 && d2 > 0, noteOff = kind === 0x80 || (kind === 0x90 && d2 === 0);

    // controls the config maps to preset slots switch the keys sound (never learned or played)
    const slot = slotFor(kind, channel, d1);
    if (slot) {
      if (noteOn || (kind === 0xb0 && d2 > 0)) selectSlot(slot);
      return;
    }
    const source = kind === 0xb0 ? { type: 'cc', number: d1, channel } : noteOn || noteOff ? { type: 'note', number: d1, channel } : null;

    // learning: a new physical pad or knob links to the next virtual one. A control that is already
    // linked is not moved (a knob sends many messages while turning, a pad may be hit twice): it just
    // plays below, so you can check what is where
    if (learning && source && (noteOn || kind === 0xb0)) {
      const key = source.type === 'note' ? 'pads' : 'knobs';
      const next = learnNext[key];
      const linked = links[key].some((s) => sameSource(s, source));
      if (next && (!linked || next.forced)) {
        link(key, next.index, source);
        if (key === 'pads') padNote(next.index, true, d2);
        return;
      }
    }
    if (source?.type === 'note') {
      const pad = links.pads.findIndex((s) => sameSource(s, source));
      if (pad >= 0 && pad < perf().pads.items.length) return padNote(pad, noteOn, d2);
    }
    if (source?.type === 'cc') {
      const knob = links.knobs.findIndex((s) => sameSource(s, source));
      if (knob >= 0 && knob < perf().knobs.length && perf().knobs[knob].param) {
        setKnob(knob, d2 / 127);
        return;
      }
    }
    // everything else goes to the keys part as normal MIDI
    const keys = parts.get('keys');
    if (noteOn) keysNote(d1, true, d2);
    else if (noteOff) keysNote(d1, false);
    else if (kind === 0xb0 && d1 === 64) keys?.send({ type: 'sustain', down: d2 >= 64 });
    else if (kind === 0xb0 && d1 === 1) keys?.set('modWheel', (d2 / 127) * 0.5);
    else if (kind === 0xe0) keys?.set('bend', ((((d2 << 7) | d1) / 16383) * 2 - 1) * 2);
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) panic();
  }

  const slotCount = (key) => (key === 'pads' ? perf().pads.items.length : perf().knobs.length);

  /** The first virtual pad / knob without a physical control, searching from `from` and wrapping. */
  function firstUnlinked(key, from = 0) {
    const n = slotCount(key);
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (!links[key][i]) return { index: i, forced: false };
    }
    return null;
  }

  function link(key, index, source) {
    // a physical control drives one virtual control: unlink it anywhere else first
    links[key] = links[key].map((s) => (sameSource(s, source) ? null : s));
    links[key][index] = source;
    log(`linked ${describe(source)} → ${key === 'pads' ? 'pad' : 'knob'} ${index + 1}`);
    // on to the next free one, so a whole row links by pressing its controls in order
    learnNext[key] = firstUnlinked(key, index + 1);
    persist();
    render();
  }

  function setLearning(on) {
    learning = on;
    learnNext = on ? { pads: firstUnlinked('pads'), knobs: firstUnlinked('knobs') } : { pads: null, knobs: null };
    render();
  }

  function clearLinks(key) {
    links[key] = [];
    learnNext[key] = firstUnlinked(key);
    log(`cleared ${key === 'pads' ? 'pad' : 'knob'} links`);
    persist();
    render();
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
    for (const part of parts.values()) part.send({ type: 'allNotesOff' });
  }

  /** The slot a message is mapped to by a "slot" control in the config, or 0. */
  function slotFor(kind, channel, number) {
    const type = kind === 0xb0 ? 'cc' : kind === 0x90 || kind === 0x80 ? 'note' : null;
    const c = config.controls.find((c) => c.target.kind === 'slot' && c.source.type === type
      && c.source.number === number && (c.channel === null || c.channel === channel));
    return c ? c.target.slot : 0;
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
  }

  // MARK: saving

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(performances, links), 300);
  }

  // MARK: view

  const el = (tag, props = {}, ...children) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...children);
    return e;
  };
  const presetSelect = (value, onchange, { allowNone = false } = {}) => {
    const s = el('select', { onchange: (e) => onchange(e.target.value || null) });
    if (allowNone) s.append(new Option('— none —', ''));
    for (const n of presetNames) s.append(new Option(n, n));
    s.value = value ?? '';
    return s;
  };

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
          performances.push(newPerformance(`performance ${performances.length + 1}`, perf().keys.preset));
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
        el('button', { type: 'button', className: learning ? 'on' : '', textContent: learning ? 'Done learning' : 'Learn',
          title: 'Link your controller: while learning, hit your pads in order and turn your knobs one by one — each new one links to the next virtual pad or knob.',
          onclick: () => setLearning(!learning) }),
        el('button', { type: 'button', textContent: 'All notes off', onclick: panic })),
      el('div', { className: 'play-row' },
        el('span', { className: 'strip-note', textContent: 'KEYS' }),
        presetSelect(perf().keys.preset, (v) => { perf().keys.preset = v ?? presetNames[0]; rebuild(); persist(); render(); }),
        size('pads', perf().pads.cols, 1, 8, (v) => resizePads(v, perf().pads.rows)),
        el('span', { className: 'strip-note', textContent: '×' }),
        size('', perf().pads.rows, 1, 8, (v) => resizePads(perf().pads.cols, v)),
        size('knobs', perf().knobs.length, 1, 16, resizeKnobs)),
      renderSlots(),
      learning ? renderLearnBar() : '');
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

  /** While learning, show what just arrived, so "nothing happens" can be told apart from "nothing arrives". */
  let lastMidi = 'nothing yet';
  function showLastMidi(status, d1, d2) {
    const kind = status & 0xf0, ch = `ch${(status & 0x0f) + 1}`;
    lastMidi = kind === 0x90 || kind === 0x80 ? `${noteName(d1)} (note ${d1}) ${ch}`
      : kind === 0xb0 ? `cc ${d1} = ${d2} ${ch}` : kind === 0xe0 ? `pitch bend ${ch}` : `status ${status.toString(16)}`;
    const out = root.querySelector('.play-last-midi');
    if (out) out.textContent = lastMidi;
  }

  function renderLearnBar() {
    const inputs = midiInputs();
    const status = inputs === null ? 'MIDI is not available (allow MIDI access in the browser)'
      : inputs.length ? `MIDI in: ${inputs.join(', ')}` : 'No MIDI input connected (see Setup)';
    const next = (key, noun, verb) => (learnNext[key]
      ? `${verb} → ${noun} ${learnNext[key].index + 1}`
      : `all ${noun}s linked`);
    return el('div', { className: 'play-learn' },
      el('p', { textContent: `Learning — ${next('pads', 'pad', 'hit a new pad')} · ${next('knobs', 'knob', 'turn a new knob')}. `
        + 'Linked controls just play, so you can check them; click a pad or knob here to link it again.' }),
      el('p', { className: 'strip-note' }, `${status} · last received: `,
        el('span', { className: 'play-last-midi', textContent: lastMidi })),
      el('div', { className: 'play-row' },
        el('button', { type: 'button', textContent: 'Clear pad links', disabled: !links.pads.some(Boolean), onclick: () => clearLinks('pads') }),
        el('button', { type: 'button', textContent: 'Clear knob links', disabled: !links.knobs.some(Boolean), onclick: () => clearLinks('knobs') })));
  }

  function resizePads(cols, rows) {
    const items = perf().pads.items;
    perf().pads = { cols, rows, items: Array.from({ length: cols * rows }, (_, i) => items[i] ?? { preset: null, note: 60, volume: 1 }) };
    selected = { kind: 'pad', index: 0 };
    if (learning) learnNext.pads = firstUnlinked('pads');
    rebuild(); persist(); render();
  }

  function resizeKnobs(n) {
    const knobs = perf().knobs;
    perf().knobs = Array.from({ length: n }, (_, i) => knobs[i] ?? { target: 'keys', param: null, value: null });
    selected = { kind: 'knob', index: 0 };
    if (learning) learnNext.knobs = firstUnlinked('knobs');
    persist(); render();
  }

  function renderPads() {
    const { cols, items } = perf().pads;
    const grid = el('div', { className: 'pad-grid' });
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    items.forEach((pad, i) => {
      const b = el('button', { type: 'button', className: 'pad' },
        el('span', { className: 'pad-name', textContent: pad.preset ?? '—' }),
        el('span', { className: 'pad-note', textContent: pad.preset ? noteName(pad.note) : '' }),
        links.pads[i] ? el('span', { className: 'pad-link', textContent: describe(links.pads[i]) }) : '');
      b.classList.toggle('selected', selected.kind === 'pad' && selected.index === i);
      b.classList.toggle('empty', !pad.preset);
      b.classList.toggle('learn-next', learning && learnNext.pads?.index === i);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startAudio();
        selected = { kind: 'pad', index: i };
        if (learning) learnNext.pads = { index: i, forced: true };
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
      el('label', {}, 'sound ', presetSelect(pad.preset, (v) => { pad.preset = v; rebuild(); persist(); render(); }, { allowNone: true })),
      el('label', {}, 'note ',
        el('button', { type: 'button', textContent: '−', onclick: () => { pad.note = Math.max(0, pad.note - 1); persist(); render(); } }),
        el('span', { className: 'play-note', textContent: `${noteName(pad.note)} (${pad.note})` }),
        el('button', { type: 'button', textContent: '+', onclick: () => { pad.note = Math.min(127, pad.note + 1); persist(); render(); } })),
      el('label', {}, 'volume ', el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: pad.volume,
        oninput: (e) => { pad.volume = Number(e.target.value); persist(); } })),
      el('span', { className: 'strip-note', textContent: links.pads[selected.index] ? `linked to ${describe(links.pads[selected.index])}` : 'not linked (use Learn)' }))
      : '';
    return el('section', { className: 'module play-pads' },
      el('h3', { textContent: 'PADS', title: 'Click a pad to hear and edit it. Each pad plays a preset at a fixed note; pads with the same preset share one synth.' }),
      grid, editor);
  }

  function renderKnobs() {
    knobControls.length = 0;
    const row = el('div', { className: 'play-knobs' });
    perf().knobs.forEach((k, i) => {
      const wrap = el('div', { className: 'play-knob' });
      wrap.classList.toggle('selected', selected.kind === 'knob' && selected.index === i);
      wrap.classList.toggle('learn-next', learning && learnNext.knobs?.index === i);
      if (k.param) {
        const knob = new Knob(`knob${i}`, SPECS[k.param], `${LABELS[k.param]}`, {
          get: () => knobValue(k),
          set: (_, v) => { k.value = v; applyKnob(i, v); knob.update(v); persist(); },
          reset: () => { k.value = null; rebuild(); persist(); render(); },
        });
        knob.update(knobValue(k));
        if (links.knobs[i]) knob.badge(String(i + 1));
        knobControls[i] = knob;
        wrap.append(knob.el);
      } else {
        wrap.append(el('div', { className: 'play-knob-empty', textContent: '—' }));
      }
      wrap.append(el('button', { type: 'button', className: 'play-knob-target', textContent: `${i + 1} · ${k.param ? TARGETS[k.target] : 'unassigned'}`,
        onclick: () => {
          selected = { kind: 'knob', index: i };
          if (learning) learnNext.knobs = { index: i, forced: true };
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
        el('span', { className: 'strip-note', textContent: links.knobs[selected.index] ? `linked to ${describe(links.knobs[selected.index])}` : 'not linked (use Learn)' }));
    }
    return el('section', { className: 'module play-knobs-module' },
      el('h3', { textContent: 'KNOBS', title: 'Each knob moves one parameter of the keys sound, the pad sounds, or both, on top of their presets (not saved into the presets). Double-click a knob to go back to the preset value.' }),
      row, editor);
  }

  function render() {
    root.replaceChildren(renderHeader(), renderPads(), renderKnobs());
  }

  render();

  return {
    handle,
    keysNote,
    panic,
    /** Called when audio starts: parts can now be created. */
    attachAudio(context, destination) {
      audio = { context, destination };
      rebuild();
    },
    /** Stops and removes every part (before a new config replaces this screen). */
    dispose() {
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
