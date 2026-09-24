// The instrument panel: modules of rotary knobs and switches laid out like a hardware synth,
// organ-style drawbars for the additive harmonics, and an on-screen keyboard.
import { CHOICES, WAVES } from './config.js';

// MARK: parameter specs

/**
 * Range and display of every panel control. exp = logarithmic (times, frequencies, ratios);
 * zero = the lowest position means exactly 0 (off); step = quantized; unit = shown after the value.
 */
export const SPECS = {
  osc1Level: { min: 0, max: 1 },
  brightness: { min: 0, max: 2 },
  osc2Level: { min: 0, max: 1 },
  osc2Octave: { min: -2, max: 2, step: 1, unit: 'oct' },
  osc2Semi: { min: -12, max: 12, step: 1, unit: 'st' },
  osc2Detune: { min: -50, max: 50, unit: '¢' },
  pulseWidth: { min: 0.05, max: 0.95 },
  unison: { min: 1, max: 7, step: 1 },
  unisonDetune: { min: 0, max: 60, unit: '¢' },
  unisonWidth: { min: 0, max: 1 },
  noise: { min: 0, max: 1 },
  chorus: { min: 0, max: 1 },
  detune: { min: 0, max: 30, unit: '¢' },
  cutoff: { min: 40, max: 20000, exp: true, unit: 'Hz' },
  resonance: { min: 0, max: 0.97 },
  keyTrack: { min: 0, max: 1 },
  velFilter: { min: 0, max: 4, unit: 'oct' },
  filterEnv: { min: -2, max: 6, unit: 'oct' },
  fAttack: { min: 0.001, max: 5, exp: true, unit: 's' },
  fDecay: { min: 0.02, max: 5, exp: true, unit: 's' },
  fSustain: { min: 0, max: 1 },
  fRelease: { min: 0.02, max: 5, exp: true, unit: 's' },
  attack: { min: 0.001, max: 2, exp: true, unit: 's' },
  decay: { min: 0.005, max: 8, exp: true, unit: 's' },
  sustain: { min: 0, max: 1 },
  release: { min: 0.02, max: 5, exp: true, unit: 's' },
  velocity: { min: 0, max: 1 },
  glide: { min: 0.005, max: 2, exp: true, zero: true, unit: 's' },
  pitchEnv: { min: -48, max: 48, unit: 'st' },
  pitchDecay: { min: 0.005, max: 2, exp: true, unit: 's' },
  vibratoRate: { min: 0.1, max: 12, exp: true, unit: 'Hz' },
  vibrato: { min: 0, max: 1, unit: 'st' },
  lfoFilter: { min: 0, max: 3, unit: 'oct' },
  lfoAmp: { min: 0, max: 1 },
  lfoPwm: { min: 0, max: 0.45 },
  delay: { min: 0, max: 0.8 },
  delayTime: { min: 0.03, max: 1.5, exp: true, unit: 's' },
  delayFeedback: { min: 0, max: 0.9 },
  reverb: { min: 0, max: 0.8 },
  reverbSize: { min: 0, max: 0.97 },
  reverbDamp: { min: 0, max: 0.99 },
  volume: { min: 0, max: 1 },
  transpose: { min: -24, max: 24, step: 1, unit: 'st' },
  bend: { min: -2, max: 2, unit: 'st' },
  modWheel: { min: 0, max: 1, unit: 'st' },
};

export const PARTIAL_SPECS = {
  ratio: { min: 0.25, max: 16, exp: true },
  level: { min: 0, max: 1 },
  velocity: { min: 0, max: 0.5 },
  decay: { min: 0.02, max: 20, exp: true, zero: true, unit: 's' },
};

export const toNorm = (s, v) => {
  if (s.zero && v <= 0) return 0;
  const x = s.exp ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min);
  return Math.min(Math.max(x, 0), 1);
};

export const fromNorm = (s, x) => {
  if (s.zero && x < 0.005) return 0;
  let v = s.exp ? s.min * (s.max / s.min) ** x : s.min + (s.max - s.min) * x;
  if (s.step) v = Math.round(v / s.step) * s.step;
  return v;
};

/** Three significant digits, so small values keep their digits: 0.001, 0.0053, 0.28, 12.5, 440. */
const sig = (v) => (Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Number(v.toPrecision(3))));

export const format = (s, v) => {
  if (s.zero && v === 0) return 'off';
  if (s.step) return `${v > 0 && s.min < 0 ? '+' : ''}${v}${s.unit ? ` ${s.unit}` : ''}`;
  if (s.unit === 's' && Math.abs(v) < 1) return `${sig(v * 1000)} ms`; // times under a second read better in ms
  if (s.unit === 'Hz' && v >= 1000) return `${sig(v / 1000)}k Hz`;
  return s.unit ? `${sig(v)} ${s.unit}` : sig(v);
};

// MARK: layout

/**
 * Modules in signal order. Each item is a knob ({ knob, label }) or a switch ({ choice, label }).
 * hint explains the module to someone new to synths (shown on hover of the title).
 * Hardware knob pages are generated from this list (one page per module, knobs in the same order),
 * so keep each module at seven controls or fewer.
 */
export const MODULES = [
  {
    title: 'OSC 1', row: 1,
    hint: 'Oscillator 1, the raw sound. sine = pure, triangle = soft, saw = bright, square / pulse = hollow, harmonics = the additive recipe below.',
    items: [{ choice: 'osc1Wave' }, { knob: 'osc1Level', label: 'level' }, { knob: 'brightness', label: 'harm bright' }],
  },
  {
    title: 'OSC 2', row: 1,
    hint: 'A second oscillator. Detune it a few cents for a thicker sound or shift it by octaves for weight. PW sets the pulse wave shape for both.',
    items: [{ choice: 'osc2Wave' }, { knob: 'osc2Level', label: 'level' }, { knob: 'osc2Octave', label: 'octave' },
      { knob: 'osc2Semi', label: 'semi' }, { knob: 'osc2Detune', label: 'detune' }, { knob: 'pulseWidth', label: 'pw' }],
  },
  {
    title: 'MIXER', row: 1,
    hint: 'Noise adds breath. Chorus adds a slightly detuned sine for width.',
    items: [{ knob: 'noise', label: 'noise' }, { knob: 'chorus', label: 'chorus' }, { knob: 'detune', label: 'ch detune' }],
  },
  {
    title: 'FILTER', row: 1, big: 'cutoff',
    hint: 'Shapes the tone. LP (low-pass) removes harmonics above the cutoff (lower = darker); BP (band-pass) keeps only a band around it; HP (high-pass) removes everything below it (thin, airy). Resonance adds a peak at the cutoff; key track makes high notes brighter; velocity makes hard playing brighter.',
    items: [{ choice: 'filterType' }, { knob: 'cutoff', label: 'cutoff' }, { knob: 'resonance', label: 'reso' }, { knob: 'keyTrack', label: 'key trk' },
      { knob: 'velFilter', label: 'velocity' }],
  },
  {
    title: 'FILTER ENV', row: 1,
    hint: 'Moves the cutoff while a note plays: opens by AMOUNT octaves, then settles to SUSTAIN.',
    items: [{ knob: 'filterEnv', label: 'amount' }, { knob: 'fAttack', label: 'attack' }, { knob: 'fDecay', label: 'decay' },
      { knob: 'fSustain', label: 'sustain' }, { knob: 'fRelease', label: 'release' }],
  },
  {
    title: 'AMP ENV', row: 2,
    hint: 'Volume over time: fade in, fall to the sustain level while held, fade out after release.',
    items: [{ knob: 'attack', label: 'attack' }, { knob: 'decay', label: 'decay' }, { knob: 'sustain', label: 'sustain' },
      { knob: 'release', label: 'release' }, { knob: 'velocity', label: 'velocity' }],
  },
  {
    title: 'VOICE', row: 2,
    hint: 'How each key plays. Poly plays chords; mono plays one note, and pressing a key while holding another slides to it without restarting. Glide slides the pitch between notes. Unison stacks detuned copies of both oscillators for a thick, wide sound (basic waves only). Pitch env starts each note that many semitones away and returns within P DECAY: the drop of a kick drum or a laser zap.',
    items: [{ choice: 'mono' }, { knob: 'glide', label: 'glide' }, { knob: 'unison', label: 'unison' },
      { knob: 'unisonDetune', label: 'spread' }, { knob: 'unisonWidth', label: 'width' },
      { knob: 'pitchEnv', label: 'pitch env' }, { knob: 'pitchDecay', label: 'p decay' }],
  },
  {
    title: 'LFO', row: 2,
    hint: 'A slow repeating wobble sent to pitch (vibrato), cutoff (wah), volume (tremolo), or pulse width (PWM). random = a new value every cycle.',
    items: [{ choice: 'lfoWave' }, { knob: 'vibratoRate', label: 'rate' }, { knob: 'vibrato', label: '→ pitch' },
      { knob: 'lfoFilter', label: '→ cutoff' }, { knob: 'lfoAmp', label: '→ volume' }, { knob: 'lfoPwm', label: '→ pw' }],
  },
  {
    title: 'FX', row: 2,
    hint: 'Effects on everything that comes out. Delay repeats the sound, bouncing left and right and getting softer; reverb adds a room.',
    items: [{ knob: 'delay', label: 'delay' }, { knob: 'delayTime', label: 'time' }, { knob: 'delayFeedback', label: 'repeats' },
      { knob: 'reverb', label: 'reverb' }, { knob: 'reverbSize', label: 'size' }, { knob: 'reverbDamp', label: 'dark' }],
  },
  {
    title: 'MASTER', row: 2,
    hint: 'Performance controls, not saved in presets. MOD is the mod wheel: extra vibrato on top of LFO → pitch.',
    items: [{ knob: 'volume', label: 'volume' }, { knob: 'transpose', label: 'transpose' }, { knob: 'bend', label: 'bend' },
      { knob: 'modWheel', label: 'mod' }],
  },
];

// MARK: icons

const ICONS = {
  // filter types: the shape of the response (frequency to the right)
  'low-pass': 'M1 3H11C15 3 17 6 23 11',
  'band-pass': 'M1 11C7 11 8 3 12 3S17 11 23 11',
  'high-pass': 'M1 11C7 6 9 3 13 3H23',
  // wave shapes
  sine: 'M1 6C4 -1.5 8 -1.5 12 6S20 13.5 23 6',
  triangle: 'M1 6L4 2L10 10L16 2L22 10L23 8.7',
  saw: 'M1 10L11 2V10L21 2V10L23 8.4',
  square: 'M1 10V2H7V10H13V2H19V10H23',
  pulse: 'M1 10V2H4V10H12V2H15V10H23',
  harmonics: 'M3 10V2M7.5 10V5M12 10V7M16.5 10V8M21 10V9',
  random: 'M1 8H5V3H9V9H13V5H17V7H21V4H23',
};

function icon(name) {
  const path = ICONS[name];
  if (!path) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 12');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${path}"/>`;
  return svg;
}

// MARK: knob

const SWEEP = 135; // degrees either side of straight up

function polar(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [24 + r * Math.cos(a), 24 + r * Math.sin(a)];
}

function arc(r, from, to) {
  if (Math.abs(to - from) < 0.01) return '';
  const [x0, y0] = polar(r, Math.min(from, to));
  const [x1, y1] = polar(r, Math.max(from, to));
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * A rotary knob: drag up / down (Shift = fine), mouse wheel, or arrow keys to turn it;
 * double-click to return it to the preset's value.
 */
export class Knob {
  constructor(name, spec, label, api, { size = 'md' } = {}) {
    this.name = name;
    this.spec = spec;
    this.api = api;
    this.norm = 0;
    const el = document.createElement('div');
    el.className = `knob knob-${size}`;
    el.innerHTML = `
      <div class="knob-dial" role="slider" tabindex="0" aria-label="${label}">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path class="knob-track" d="${arc(20, -SWEEP, SWEEP)}"/>
          <path class="knob-arc"/>
          <circle class="knob-cap" cx="24" cy="24" r="15"/>
          <line class="knob-pointer" x1="24" y1="24" x2="24" y2="11"/>
        </svg>
        <span class="knob-badge" hidden></span>
      </div>
      <div class="knob-label">${label}</div>
      <output class="knob-value"></output>`;
    this.el = el;
    this.dial = el.querySelector('.knob-dial');
    this.arcEl = el.querySelector('.knob-arc');
    this.pointer = el.querySelector('.knob-pointer');
    this.badgeEl = el.querySelector('.knob-badge');
    this.valueEl = el.querySelector('.knob-value');
    // a knob whose range spans zero (e.g. detune) draws its arc from the center
    this.origin = spec.min < 0 && spec.max > 0 ? toNorm(spec, 0) : 0;
    this.bind();
  }

  bind() {
    const d = this.dial;
    let startY = 0, startNorm = 0;
    d.addEventListener('pointerdown', (e) => {
      d.setPointerCapture(e.pointerId);
      startY = e.clientY;
      startNorm = this.norm;
      d.classList.add('turning');
      e.preventDefault();
    });
    d.addEventListener('pointermove', (e) => {
      if (!d.hasPointerCapture(e.pointerId)) return;
      const travel = e.shiftKey ? 900 : 180; // pixels for the full range
      this.setNorm(startNorm + (startY - e.clientY) / travel, false);
    });
    const end = (e) => {
      if (d.hasPointerCapture(e.pointerId)) d.releasePointerCapture(e.pointerId);
      d.classList.remove('turning');
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.nudge(e.deltaY < 0 ? 1 : -1, e.shiftKey ? 0.001 : 0.01);
    }, { passive: false });
    d.addEventListener('keydown', (e) => {
      const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (steps) {
        this.nudge(steps, e.shiftKey ? 0.001 : 0.01); // Shift = fine: 1/1000 of the range per step
        e.preventDefault();
      } else if (e.key === 'Home' || e.key === 'End') {
        this.setNorm(e.key === 'Home' ? 0 : 1, true);
        e.preventDefault();
      }
    });
    d.addEventListener('dblclick', () => this.api.reset(this.name));
  }

  /** Moves by `steps`: one value per step for stepped knobs, otherwise `amount` of the range per step. */
  nudge(steps, amount) {
    const s = this.spec;
    if (s.step) {
      const v = this.api.get(this.name) + steps * s.step;
      this.api.set(this.name, Math.min(Math.max(v, s.min), s.max));
    } else {
      this.setNorm(this.norm + steps * amount, true);
    }
  }

  setNorm(x, snap) {
    x = Math.min(Math.max(x, 0), 1);
    if (!snap) this.dragNorm = x;
    this.api.set(this.name, fromNorm(this.spec, x));
  }

  update(v) {
    const n = toNorm(this.spec, v);
    // while dragging a stepped knob, keep the pointer where the mouse is rather than jumping between steps
    this.norm = this.dial.classList.contains('turning') && this.spec.step ? this.dragNorm ?? n : n;
    const deg = -SWEEP + n * 2 * SWEEP;
    const originDeg = -SWEEP + this.origin * 2 * SWEEP;
    this.arcEl.setAttribute('d', arc(20, originDeg, deg));
    this.pointer.setAttribute('transform', `rotate(${deg.toFixed(1)} 24 24)`);
    const text = format(this.spec, v);
    this.valueEl.textContent = text;
    this.dial.setAttribute('aria-valuetext', text);
  }

  badge(text) {
    this.badgeEl.hidden = !text;
    this.badgeEl.textContent = text ?? '';
  }
}

// MARK: switches and drawbars

/** A row of buttons choosing one value (wave shapes, poly / mono). */
class Switch {
  constructor(name, api) {
    this.name = name;
    const names = name === 'osc2Wave' ? WAVES.slice(0, 5) : CHOICES[name];
    const el = document.createElement('div');
    el.className = 'switch';
    el.setAttribute('role', 'radiogroup');
    el.setAttribute('aria-label', name);
    this.buttons = names.map((n, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = n;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', n);
      const svg = icon(n);
      if (svg) b.append(svg);
      else b.textContent = n;
      b.onclick = () => api.set(name, i);
      return b;
    });
    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'knob-badge switch-badge';
    this.badgeEl.hidden = true;
    el.append(...this.buttons, this.badgeEl);
    this.el = el;
  }

  update(v) {
    const i = Math.round(v);
    this.buttons.forEach((b, j) => {
      b.classList.toggle('on', i === j);
      b.setAttribute('aria-checked', String(i === j));
    });
  }

  badge(text) {
    this.badgeEl.hidden = !text;
    this.badgeEl.textContent = text ?? '';
  }
}

/** An organ-style drawbar for a harmonic's level (pull up = louder). */
class Drawbar {
  constructor(name, spec, label, api) {
    this.name = name;
    this.spec = spec;
    const el = document.createElement('label');
    el.className = 'drawbar';
    el.innerHTML = `<span class="knob-badge drawbar-badge" hidden></span>
      <input type="range" min="0" max="1000" step="1" aria-label="${label}"><output></output>`;
    this.input = el.querySelector('input');
    this.out = el.querySelector('output');
    this.badgeEl = el.querySelector('.drawbar-badge');
    this.input.addEventListener('input', () => api.set(name, fromNorm(spec, this.input.value / 1000)));
    this.input.addEventListener('dblclick', () => api.reset(name));
    this.el = el;
  }

  update(v) {
    if (document.activeElement !== this.input) this.input.value = Math.round(toNorm(this.spec, v) * 1000);
    this.out.textContent = format(this.spec, v);
  }

  badge(text) {
    this.badgeEl.hidden = !text;
    this.badgeEl.textContent = text ?? '';
  }
}

// MARK: building the panel

/**
 * Builds the modules into `rows` (one element per row) and the harmonics section into `additive`.
 * api: { get(name), set(name, value), reset(name) }. Returns the controls by parameter name.
 */
export function buildPanel({ rows, additive }, api) {
  const controls = new Map();
  for (const m of MODULES) {
    const mod = document.createElement('section');
    mod.className = 'module';
    const h = document.createElement('h3');
    h.textContent = m.title;
    if (m.hint) {
      h.title = m.hint;
      h.tabIndex = 0;
    }
    const body = document.createElement('div');
    body.className = 'module-body';
    for (const item of m.items) {
      const c = item.choice
        ? new Switch(item.choice, api)
        : new Knob(item.knob, SPECS[item.knob], item.label, api, { size: item.knob === m.big ? 'lg' : 'md' });
      if (item.choice) c.el.classList.add('module-switch');
      controls.set(item.choice ?? item.knob, c);
      body.append(c.el);
    }
    mod.append(h, body);
    rows[m.row - 1].append(mod);
  }

  // additive harmonics: a drawbar per partial for level, small knobs for ratio / velocity / decay
  for (let i = 1; i <= 8; i++) {
    const col = document.createElement('div');
    col.className = 'partial';
    col.dataset.index = String(i);
    const bar = new Drawbar(`partial${i}.level`, PARTIAL_SPECS.level, `partial ${i} level`, api);
    controls.set(bar.name, bar);
    const knobs = ['ratio', 'velocity', 'decay'].map((f) => {
      const k = new Knob(`partial${i}.${f}`, PARTIAL_SPECS[f], f === 'velocity' ? 'vel' : f, api, { size: 'sm' });
      controls.set(k.name, k);
      return k.el;
    });
    const title = document.createElement('div');
    title.className = 'partial-title';
    title.textContent = String(i);
    col.append(title, bar.el, ...knobs);
    additive.append(col);
  }
  return controls;
}

// MARK: keyboard

const BLACK = new Set([1, 3, 6, 8, 10]);

/** A clickable piano keyboard that also lights up the notes being played. */
export class Keyboard {
  constructor(el, { low, high, onNote }) {
    this.el = el;
    this.keys = new Map();
    this.onNote = onNote;
    const whites = [];
    for (let n = low; n <= high; n++) if (!BLACK.has(n % 12)) whites.push(n);
    const width = 100 / whites.length;
    let w = 0;
    for (let n = low; n <= high; n++) {
      const k = document.createElement('div');
      const black = BLACK.has(n % 12);
      k.className = black ? 'key black' : 'key white';
      k.dataset.note = String(n);
      if (black) {
        k.style.left = `${(w - 0.3) * width}%`;
        k.style.width = `${width * 0.6}%`;
      } else {
        k.style.left = `${w * width}%`;
        k.style.width = `${width}%`;
        if (n % 12 === 0) k.dataset.label = `C${n / 12 - 1}`;
        w++;
      }
      this.keys.set(n, k);
      el.append(k);
    }
    this.bind();
  }

  bind() {
    let down = null; // note held by the pointer
    const noteAt = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      return t?.classList.contains('key') && this.el.contains(t) ? Number(t.dataset.note) : null;
    };
    this.el.addEventListener('pointerdown', (e) => {
      this.el.setPointerCapture(e.pointerId);
      down = noteAt(e);
      if (down !== null) this.onNote(down, true);
      e.preventDefault();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (down === null || !this.el.hasPointerCapture(e.pointerId)) return;
      const n = noteAt(e);
      if (n !== null && n !== down) { // glissando
        this.onNote(down, false);
        down = n;
        this.onNote(n, true);
      }
    });
    const up = () => {
      if (down !== null) this.onNote(down, false);
      down = null;
    };
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  set(note, on) {
    this.keys.get(note)?.classList.toggle('down', on);
  }

  clear() {
    for (const k of this.keys.values()) k.classList.remove('down');
  }
}
