// Turns incoming MIDI messages into parameter changes, actions, and notes according to the config's controls.
import {
  BUILTIN, DEFAULT_PARAMS, DEFAULT_PARTIALS, PARAMS, PERFORMANCE, newPartial, partialParam,
} from './config.js';

const round = (v) => Number(v.toFixed(4));

export class Controller {
  /**
   * @param {object} hooks
   * @param {(msg: object) => void} hooks.send   message to the synth (AudioWorklet)
   * @param {(line: string) => void} hooks.log
   * @param {() => void} hooks.onChange          parameters, preset, or page changed (for the UI)
   * @param {(index: number, preset: object) => void} hooks.onSavePreset  a preset was overwritten (JSON form)
   */
  constructor({ send, log, onChange, onSavePreset }) {
    this.send = send;
    this.log = log;
    this.onChange = onChange;
    this.onSavePreset = onSavePreset;
    this.config = BUILTIN;
    this.params = { ...DEFAULT_PARAMS };
    this.partials = DEFAULT_PARTIALS;
    this.presetIndex = 0;
    this.page = null;
    this.pickupState = new Map(); // control → { lastIn, lastSent } for soft takeover
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
    if (kind === 0x90 && d2 > 0) this.send({ type: 'noteOn', key: d1, velocity: d2 });
    else if (kind === 0x90 || kind === 0x80) this.send({ type: 'noteOff', key: d1 });
    else if (kind === 0xb0 && d1 === 64) this.send({ type: 'sustain', down: d2 >= 64 });
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) this.send({ type: 'allNotesOff' });
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
        if (pressed) this.selectPreset((this.presetIndex + presets.length - 1) % presets.length);
        break;
      case 'page':
        if (pressed) this.selectPage(t.page);
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
    }
  }

  applyParam(control, value) {
    const t = control.target;
    if (t.pickup) {
      // Soft takeover: after a preset or page change the knob's physical position no longer
      // matches the value, so ignore it until it reaches (or crosses) the current value.
      const st = this.pickupState.get(control) ?? {};
      this.pickupState.set(control, st);
      const current = this.getParam(t.param);
      let engaged = st.lastSent === current; // this control set the value last, so it is in sync
      if (!engaged) {
        const pos = Math.min(Math.max(normalize(t, current), 0), 1);
        engaged = Math.abs(value - pos) < 0.03 || (st.lastIn !== undefined && (st.lastIn - pos) * (value - pos) <= 0);
      }
      st.lastIn = value;
      if (!engaged) return;
      this.setParam(t.param, denormalize(t, value), t.step > 0);
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
    this.sync();
    if (announce) this.log(`${name} = ${round(v)}`);
    this.onChange();
  }

  selectPreset(i) {
    if (i < 0) return;
    this.presetIndex = i;
    const preset = this.config.presets[i];
    // sound parameters come from defaults ← params ← preset; performance state carries over
    const next = { ...DEFAULT_PARAMS, ...this.config.params, ...preset.values };
    for (const p of PARAMS) if (PERFORMANCE.has(p)) next[p] = this.params[p];
    this.params = next;
    this.partials = preset.partials ?? DEFAULT_PARTIALS;
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

  /** Writes the current sound into the current preset (the UI turns it back into config JSON). */
  savePreset() {
    const base = { ...DEFAULT_PARAMS, ...this.config.params };
    const values = {};
    for (const p of PARAMS) {
      if (!PERFORMANCE.has(p) && this.params[p] !== base[p]) values[p] = round(this.params[p]);
    }
    // drop trailing partials that are silent (e.g. added by turning a knob and back)
    const partials = this.partials.map((p) => ({
      ratio: round(p.ratio), level: round(p.level), velocity: round(p.velocity), decay: round(p.decay),
    }));
    while (partials.length > 1 && partials.at(-1).level === 0 && partials.at(-1).velocity === 0) partials.pop();

    const name = this.presetName;
    const presets = [...this.config.presets];
    presets[this.presetIndex] = { name, values, partials };
    this.config = { ...this.config, presets };
    this.onSavePreset(this.presetIndex, { name, ...values, partials: partials.map(compactPartial) });
    this.log(`saved preset: ${name}`);
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
