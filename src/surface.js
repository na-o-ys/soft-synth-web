// The controller surface: virtual knobs, a grid of virtual pads, and virtual sliders (strips, wheels),
// and which physical control (MIDI message) drives each one. It is learned once on the Controller screen
// and stored apart from the config, so the Edit and Play screens and the config speak of "knob 3",
// "pad 1-2", or "slider 1" instead of a particular controller's note and CC numbers.

const STORAGE_KEY = 'soft-synth-web:surface';
export const LIMITS = { knobs: 16, rows: 8, cols: 8, sliders: 4 };
const DEFAULT_LAYOUT = { knobs: 8, rows: 2, cols: 8, sliders: 2 };

/** The physical source of a MIDI 1.0 channel message, or null (note-offs count as their note). */
export function sourceOf(status, d1) {
  const kind = status & 0xf0, channel = status & 0x0f;
  if (kind === 0x90 || kind === 0x80) return { type: 'note', number: d1, channel };
  if (kind === 0xb0) return { type: 'cc', number: d1, channel };
  if (kind === 0xe0) return { type: 'pitchBend', number: null, channel };
  return null;
}

const keyOf = (s) => `${s.type}:${s.channel}:${s.number ?? ''}`;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function describeSource(s) {
  if (!s) return '';
  const ch = `ch${s.channel + 1}`;
  if (s.type === 'note') return `${NOTE_NAMES[s.number % 12]}${Math.floor(s.number / 12) - 1} ${ch}`;
  if (s.type === 'cc') return `cc${s.number} ${ch}`;
  return `bend ${ch}`;
}

export class Surface {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.layout = { ...DEFAULT_LAYOUT };
    // bindings per widget: knobs[i], pads[row * cols + col], sliders[i] → source or null
    this.knobs = [];
    this.pads = [];
    this.sliders = [];
    this.load();
  }

  load() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { /* start empty */ }
    const n = (v, d, max) => (Number.isInteger(v) && v >= 1 && v <= max ? v : d);
    const l = stored?.layout ?? {};
    this.layout = {
      knobs: n(l.knobs, DEFAULT_LAYOUT.knobs, LIMITS.knobs), rows: n(l.rows, DEFAULT_LAYOUT.rows, LIMITS.rows),
      cols: n(l.cols, DEFAULT_LAYOUT.cols, LIMITS.cols), sliders: n(l.sliders, DEFAULT_LAYOUT.sliders, LIMITS.sliders),
    };
    const valid = (s) => (s && ['note', 'cc', 'pitchBend'].includes(s.type) && Number.isInteger(s.channel) ? s : null);
    this.knobs = Array.from({ length: this.layout.knobs }, (_, i) => valid(stored?.knobs?.[i]));
    this.pads = Array.from({ length: this.layout.rows * this.layout.cols }, (_, i) => valid(stored?.pads?.[i]));
    this.sliders = Array.from({ length: this.layout.sliders }, (_, i) => valid(stored?.sliders?.[i]));
    this.index();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ layout: this.layout, knobs: this.knobs, pads: this.pads, sliders: this.sliders }));
    } catch { /* not essential */ }
    this.onChange();
  }

  /** source key → { kind, index } */
  index() {
    this.lookup = new Map();
    for (const kind of ['knobs', 'pads', 'sliders']) {
      this[kind].forEach((s, index) => { if (s) this.lookup.set(keyOf(s), { kind, index }); });
    }
  }

  /** Changes the number of widgets; pads keep their row and column. */
  resize(layout) {
    const old = this.layout;
    const next = { ...old, ...layout };
    const pads = Array.from({ length: next.rows * next.cols }, (_, i) => {
      const row = Math.floor(i / next.cols), col = i % next.cols;
      return row < old.rows && col < old.cols ? this.pads[row * old.cols + col] : null;
    });
    this.layout = next;
    this.knobs = Array.from({ length: next.knobs }, (_, i) => this.knobs[i] ?? null);
    this.sliders = Array.from({ length: next.sliders }, (_, i) => this.sliders[i] ?? null);
    this.pads = pads;
    this.index();
    this.save();
  }

  /** Binds a physical source to a widget: it leaves any other widget, and the widget's old source is dropped. */
  bind(kind, index, source) {
    const clean = { type: source.type, number: source.number, channel: source.channel };
    for (const k of ['knobs', 'pads', 'sliders']) this[k] = this[k].map((s) => (s && keyOf(s) === keyOf(clean) ? null : s));
    this[kind][index] = clean;
    this.index();
    this.save();
  }

  unbind(kind, index) {
    this[kind][index] = null;
    this.index();
    this.save();
  }

  clear() {
    this.knobs = this.knobs.map(() => null);
    this.pads = this.pads.map(() => null);
    this.sliders = this.sliders.map(() => null);
    this.index();
    this.save();
  }

  /** The widget a source is bound to, or null. */
  find(source) {
    return source ? this.lookup.get(keyOf(source)) ?? null : null;
  }

  /**
   * Turns a MIDI message into a widget event, or null when no widget has its source:
   * { kind: 'knobs' | 'pads' | 'sliders', index, row, col, value (0...1), pressed, velocity }.
   * Pads react to notes (note-off = release) or to CCs (0 = release); knobs and sliders to CCs and pitch bend.
   */
  resolve(status, d1, d2) {
    const hit = this.find(sourceOf(status, d1));
    if (!hit) return null;
    const kind = status & 0xf0;
    const e = { kind: hit.kind, index: hit.index };
    if (hit.kind === 'pads') {
      e.row = Math.floor(hit.index / this.layout.cols);
      e.col = hit.index % this.layout.cols;
      e.pressed = (kind === 0x90 || kind === 0xb0) && d2 > 0;
      e.velocity = d2;
      e.value = e.pressed ? 1 : 0;
    } else {
      e.value = kind === 0xe0 ? ((d2 << 7) | d1) / 16383 : d2 / 127;
    }
    return e;
  }

  /** The next widget without a source for this kind of message (notes → pads, CCs → knobs, pitch bend → sliders). */
  nextFree(source) {
    const kind = source.type === 'note' ? 'pads' : source.type === 'cc' ? 'knobs' : 'sliders';
    const index = this[kind].findIndex((s) => !s);
    return index < 0 ? null : { kind, index };
  }
}

/** "2-3" for the pad in row 2, column 3 (1-based), from its index. */
export const padName = (index, cols) => `${Math.floor(index / cols) + 1}-${(index % cols) + 1}`;
