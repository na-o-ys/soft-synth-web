// Turns incoming MIDI messages into parameter changes, actions, and notes according to the config's controls.
import {
  BUILTIN, CHOICES, DEFAULT_PARAMS, DEFAULT_PARTIALS, INIT_PARAMS, INIT_PARTIALS, PARAMS, PERFORMANCE,
  newPartial, partialParam,
} from './config.js';

const round = (v) => Number(v.toFixed(4));

export class Controller {
  /**
   * @param {object} hooks
   * @param {(msg: object) => void} hooks.send   message to the synth (AudioWorklet)
   * @param {(line: string) => void} hooks.log
   * @param {() => void} hooks.onChange          parameters, preset, or page changed (for the UI)
   * @param {(index: number, preset: object) => void} hooks.onSavePreset  a preset was overwritten (JSON form)
   * @param {import('./recorder.js').Recorder} [hooks.recorder]  records what is played, for the record / play actions
   */
  constructor({ send, log, onChange, onSavePreset, recorder = null }) {
    this.send = send;
    this.recorder = recorder;
    this.log = log;
    this.onChange = onChange;
    this.onSavePreset = onSavePreset;
    this.config = BUILTIN;
    this.params = { ...DEFAULT_PARAMS };
    this.partials = DEFAULT_PARTIALS;
    this.presetIndex = 0;
    this.edited = false; // the sound differs from the saved preset
    this.page = null;
    this.pickupState = new Map(); // control → { lastIn, lastSent } for soft takeover
    this.history = [];            // earlier sounds, newest last, for undo
    this.lastEdit = { key: null, time: 0 };
  }

  get presetName() {
    return this.config.presets[this.presetIndex]?.name;
  }

  load(config) {
    const current = this.presetName;
    this.config = config;
    this.pickupState.clear();
    this.page = config.pages.includes(this.page) ? this.page : config.pages[0] ?? null;
    this.params = { ...DEFAULT_PARAMS, ...config.params };
    // on reload, stay on the preset with the same name if it still exists
    const name = config.presets.some((p) => p.name === current) ? current : config.initialPreset;
    this.selectPreset(Math.max(0, config.presets.findIndex((p) => p.name === name)));
    this.history = [];
  }

  /** Sends the whole state to the synth again (e.g. right after audio starts). */
  sync() {
    this.send({ type: 'params', params: this.params, partials: this.partials });
  }

  /** Controls that respond on the current page. */
  get activeControls() {
    return this.config.controls.filter((c) => c.page === null || c.page === this.page);
  }

  /** Handles one MIDI 1.0 channel message. */
  handle(status, d1, d2) {
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (this.config.logMIDI) this.log(`midi: ${describeMIDI(status, d1, d2)}`);

    let type, number, value, pressed;
    switch (kind) {
      case 0x90:
      case 0x80:
        type = 'note';
        number = d1;
        pressed = kind === 0x90 && d2 > 0;
        value = pressed ? 1 : 0;
        break;
      case 0xb0:
        type = 'cc';
        number = d1;
        value = d2 / 127;
        pressed = d2 > 0;
        break;
      case 0xe0:
        type = 'pitchBend';
        value = ((d2 << 7) | d1) / 16383;
        pressed = false;
        break;
      default:
        return;
    }

    let matched = false;
    for (const c of this.activeControls) {
      if (c.source.type !== type || c.source.number !== number) continue;
      if (c.channel !== null && c.channel !== channel) continue;
      matched = true;
      this.apply(c, value, pressed);
    }
    if (matched) return;

    // messages without a mapping are treated as standard MIDI
    if (kind === 0x90 && d2 > 0) this.play({ type: 'noteOn', key: d1, velocity: d2 });
    else if (kind === 0x90 || kind === 0x80) this.play({ type: 'noteOff', key: d1 });
    else if (kind === 0xb0 && d1 === 64) this.play({ type: 'sustain', down: d2 >= 64 });
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) this.send({ type: 'allNotesOff' });
  }

  /** A note or pedal message played live: to the synth, and into the recording if one is running. */
  play(msg) {
    this.send(msg);
    this.recorder?.capture(msg);
  }

  apply(control, value, pressed) {
    const t = control.target;
    const presets = this.config.presets;
    const pages = this.config.pages;
    switch (t.kind) {
      case 'param':
        this.applyParam(control, value);
        break;
      case 'preset':
        if (pressed) this.selectPreset(presets.findIndex((p) => p.name === t.preset));
        break;
      case 'nextPreset':
        if (pressed) this.selectPreset((this.presetIndex + 1) % presets.length);
        break;
      case 'prevPreset':
        if (pressed) this.selectPreset(((this.presetIndex < 0 ? 0 : this.presetIndex) + presets.length - 1) % presets.length);
        break;
      case 'page':
        if (pressed) this.selectPage(t.page);
        break;
      case 'pageKnob':
        // a knob choosing the page by its position: the range is split evenly between the pages
        if (pages.length > 0) this.selectPage(pages[Math.min(pages.length - 1, Math.floor(value * pages.length))]);
        break;
      case 'undo':
        if (pressed) this.undo();
        break;
      case 'nextPage':
      case 'prevPage':
        if (pressed && pages.length > 0) {
          const step = t.kind === 'nextPage' ? 1 : pages.length - 1;
          this.selectPage(pages[(pages.indexOf(this.page) + step) % pages.length]);
        }
        break;
      case 'savePreset':
        if (pressed) this.savePreset();
        break;
      case 'set':
        if (pressed) this.setParam(t.param, t.value, true);
        break;
      case 'add':
        if (pressed) this.setParam(t.param, Math.min(Math.max(this.getParam(t.param) + t.value, t.min), t.max), true);
        break;
      case 'toggle':
        if (pressed) this.setParam(t.param, this.getParam(t.param) === t.on ? t.off : t.on, true);
        break;
      case 'panic':
        if (pressed) this.panic();
        break;
      case 'record':
        if (pressed) this.recorder?.record();
        break;
      case 'play':
        if (pressed) this.recorder?.play();
        break;
      case 'stop':
        if (pressed) this.recorder?.stop();
        break;
      case 'loop':
        if (pressed) this.recorder?.toggleLoop();
        break;
      case 'slot':
        // preset slots are filled in on the Play screen and only work there
        if (pressed) this.log(`slot ${t.slot}: preset slots work on the Play screen`);
        break;
    }
  }

  applyParam(control, value) {
    const t = control.target;
    if (t.pickup) {
      // Soft takeover by value scaling: after a preset or page change the knob's physical position no
      // longer matches the value. Until they meet, turning the knob moves the value in the same
      // direction, scaled so both reach the end of their range together; once they meet, the knob
      // drives the value directly. No jumps, and the knob always responds.
      const st = this.pickupState.get(control) ?? {};
      this.pickupState.set(control, st);
      const current = this.getParam(t.param);
      // something else (a preset, the screen, another control) changed the value: catch up again
      if (st.lastSent !== current) st.synced = false;
      const pos = Math.min(Math.max(normalize(t, current), 0), 1);
      let target = value;
      if (!st.synced && Math.abs(value - pos) < 0.02) st.synced = true;
      if (!st.synced) {
        const last = st.lastIn;
        st.lastIn = value;
        if (last === undefined || value === last) return; // need one movement to know the direction
        target = value > last
          ? pos + ((value - last) * (1 - pos)) / Math.max(1 - last, 1e-6)
          : pos - ((last - value) * pos) / Math.max(last, 1e-6);
        target = Math.min(Math.max(target, 0), 1);
        if (Math.abs(target - value) < 0.02) st.synced = true;
      }
      st.lastIn = value;
      this.setParam(t.param, denormalize(t, target), t.step > 0);
      st.lastSent = this.getParam(t.param);
      return;
    }
    this.setParam(t.param, denormalize(t, value), t.step > 0); // stepped values (transpose etc.) are logged
  }

  getParam(name) {
    const pp = partialParam(name);
    if (!pp) return this.params[name];
    return (this.partials[pp.index] ?? newPartial(pp.index))[pp.field];
  }

  setParam(name, v, announce = false) {
    v += 0; // turn -0 into 0
    if (this.getParam(name) === v) return;
    if (!PERFORMANCE.has(name)) this.remember(name);
    const pp = partialParam(name);
    if (pp) {
      // editing a partial the preset does not have yet adds silent harmonics up to it
      const partials = this.partials.map((p) => ({ ...p }));
      while (partials.length <= pp.index) partials.push(newPartial(partials.length));
      partials[pp.index][pp.field] = v;
      this.partials = partials;
    } else {
      this.params[name] = v;
    }
    if (!PERFORMANCE.has(name)) this.edited = true; // performance state is never saved into a preset
    this.sync();
    if (announce) this.log(`${name} = ${round(v)}`);
    this.onChange();
  }

  selectPreset(i) {
    if (i < 0) return;
    this.remember(null);
    this.presetIndex = i;
    const preset = this.config.presets[i];
    // sound parameters come from defaults ← params ← preset; performance state carries over
    const next = { ...DEFAULT_PARAMS, ...this.config.params, ...preset.values };
    for (const p of PARAMS) if (PERFORMANCE.has(p)) next[p] = this.params[p];
    this.params = next;
    this.partials = preset.partials ?? DEFAULT_PARTIALS;
    this.edited = false;
    this.sync();
    this.log(`preset: ${preset.name}`);
    this.onChange();
  }

  selectPage(page) {
    if (page === this.page) return;
    this.page = page;
    this.log(`page: ${page}`);
    this.onChange();
  }

  /**
   * Loads the init patch without adding it anywhere: presetIndex becomes -1 ("unsaved") until
   * savePreset() gives it a name.
   */
  newPatch() {
    this.remember(null);
    const next = { ...INIT_PARAMS };
    for (const p of PARAMS) if (PERFORMANCE.has(p)) next[p] = this.params[p];
    this.params = next;
    this.partials = INIT_PARTIALS;
    this.presetIndex = -1;
    this.edited = false;
    this.sync();
    this.log('init patch (not saved; Write to keep it)');
    this.onChange();
  }

  /**
   * Sets several values at once as one undo step (used by the lessons). values: { param: number }.
   * With init, it first resets everything to the init patch, including the performance state
   * except volume (transpose, bend, mod), so the result is the same whatever came before.
   */
  loadSound(values, { init = false } = {}) {
    this.remember(null);
    this.batching = true;
    try {
      if (init) {
        const next = { ...INIT_PARAMS, volume: this.params.volume };
        this.params = next;
        this.partials = INIT_PARTIALS;
        this.presetIndex = -1;
      }
      for (const [name, v] of Object.entries(values)) this.setParam(name, v);
    } finally {
      this.batching = false;
    }
    this.edited = this.presetIndex >= 0 || Object.keys(values).length > 0;
    this.sync();
    this.onChange();
  }

  /**
   * Writes the current sound into the preset called `name` (the UI turns it back into config JSON):
   * the current preset by default, a new preset if no preset has that name yet.
   * An unsaved init patch without a name gets a unique "init" name.
   */
  savePreset(name) {
    if (name === undefined) {
      name = this.presetName;
      const names = new Set(this.config.presets.map((p) => p.name));
      if (name === undefined) {
        name = 'init';
        for (let i = 2; names.has(name); i++) name = `init-${i}`;
      }
    }
    let index = this.config.presets.findIndex((p) => p.name === name);
    if (index < 0) index = this.config.presets.length;

    const base = { ...DEFAULT_PARAMS, ...this.config.params };
    const values = {};
    const json = {}; // the same values as the config file writes them: choices by name ("saw")
    for (const p of PARAMS) {
      if (PERFORMANCE.has(p) || this.params[p] === base[p]) continue;
      values[p] = round(this.params[p]); // the synth needs numbers (the wave's index)
      json[p] = CHOICES[p] ? CHOICES[p][Math.round(this.params[p])] : values[p];
    }
    // drop trailing partials that are silent (e.g. added by turning a knob and back)
    const partials = this.partials.map((p) => ({
      ratio: round(p.ratio), level: round(p.level), velocity: round(p.velocity), decay: round(p.decay),
    }));
    while (partials.length > 1 && partials.at(-1).level === 0 && partials.at(-1).velocity === 0) partials.pop();

    const presets = [...this.config.presets];
    presets[index] = { name, values, partials };
    this.config = { ...this.config, presets };
    this.presetIndex = index;
    this.edited = false;
    this.onSavePreset(index, { name, ...json, partials: partials.map(compactPartial) });
    this.log(`saved preset: ${name}`);
    this.onChange();
  }

  /**
   * Saves the current sound for undo before it changes. Continuous changes to the same control
   * (a knob being turned) within a second count as one step; key = null always starts a new step.
   */
  remember(key) {
    if (this.batching) return; // a batch (loadSound) is one undo step, remembered once up front
    const now = Date.now();
    const same = key !== null && key === this.lastEdit.key && now - this.lastEdit.time < 1000;
    this.lastEdit = { key, time: now };
    if (same) return;
    this.history.push({ presetIndex: this.presetIndex, params: { ...this.params }, partials: this.partials, edited: this.edited });
    if (this.history.length > 100) this.history.shift();
  }

  /** Goes back one step: a knob gesture, a preset change, or New. Performance state (volume etc.) stays. */
  undo() {
    const prev = this.history.pop();
    if (!prev) {
      this.log('nothing to undo');
      return;
    }
    const params = { ...prev.params };
    for (const p of PERFORMANCE) params[p] = this.params[p];
    this.presetIndex = prev.presetIndex;
    this.params = params;
    this.partials = prev.partials;
    this.edited = prev.edited;
    this.lastEdit = { key: null, time: 0 };
    this.sync();
    this.log(`undo → ${this.presetName ?? 'init patch'}${this.edited ? ' (edited)' : ''}`);
    this.onChange();
  }

  /** The working state, for keeping unsaved edits across a page reload. */
  snapshot() {
    return {
      preset: this.presetIndex < 0 ? null : this.presetName, // null = unsaved init patch
      edited: this.edited,
      params: this.params,
      partials: this.partials,
      page: this.page,
    };
  }

  /**
   * Puts back a snapshot taken before a reload, on top of the loaded config. Returns false (and changes
   * nothing) if it no longer fits: its preset was removed, or the stored data is damaged.
   */
  restore(state) {
    if (!state || typeof state !== 'object') return false;
    const index = state.preset === null ? -1 : this.config.presets.findIndex((p) => p.name === state.preset);
    if (state.preset !== null && index < 0) return false;
    const params = { ...DEFAULT_PARAMS };
    for (const p of PARAMS) {
      const v = state.params?.[p];
      if (typeof v === 'number' && Number.isFinite(v)) params[p] = v;
    }
    const partials = Array.isArray(state.partials) ? state.partials.slice(0, 8).map((q) => ({
      ratio: Number(q?.ratio) || 1, level: Number(q?.level) || 0,
      velocity: Number(q?.velocity) || 0, decay: Number(q?.decay) || 0,
    })) : [];
    if (partials.length === 0) return false;
    params.modWheel = 0; // the mod wheel is released on reload, like the physical strip
    this.presetIndex = index;
    this.params = params;
    this.partials = partials;
    this.edited = state.edited === true;
    if (this.config.pages.includes(state.page)) this.page = state.page;
    this.pickupState.clear();
    this.history = [];
    this.sync();
    this.onChange();
    return true;
  }

  panic() {
    this.send({ type: 'allNotesOff' });
    this.log('panic');
  }
}

const normalize = (t, v) => (t.exponential ? Math.log(v / t.min) / Math.log(t.max / t.min) : (v - t.min) / (t.max - t.min));

function denormalize(t, x) {
  let v = t.exponential ? t.min * (t.max / t.min) ** x : t.min + (t.max - t.min) * x;
  if (t.step > 0) v = Math.round(v / t.step) * t.step;
  return v;
}

/** Leaves out partial fields that are 0 (their default in the config format). */
function compactPartial(p) {
  const out = { ratio: p.ratio, level: p.level };
  if (p.velocity) out.velocity = p.velocity;
  if (p.decay) out.decay = p.decay;
  return out;
}

export function describeMIDI(status, d1, d2) {
  const ch = `ch${(status & 0x0f) + 1}`;
  switch (status & 0xf0) {
    case 0x90: if (d2 > 0) return `${ch} note ${d1} on (velocity ${d2})`;
    // fallthrough
    case 0x80: return `${ch} note ${d1} off`;
    case 0xb0: return `${ch} cc ${d1} = ${d2}`;
    case 0xe0: return `${ch} pitchBend = ${(d2 << 7) | d1}`;
    case 0xc0: return `${ch} program ${d1}`;
    case 0xd0: return `${ch} aftertouch ${d1}`;
    default: return [status, d1, d2].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }
}

/** Short label for a control's source, e.g. "cc 30", "ch10 note 36", "pitch bend". */
export function describeSource(c) {
  const ch = c.channel === null ? '' : `ch${c.channel + 1} `;
  if (c.source.type === 'pitchBend') return `${ch}pitch bend`;
  return `${ch}${c.source.type} ${c.source.number}`;
}
