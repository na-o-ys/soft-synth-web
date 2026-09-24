// Graphs for sound design: live oscilloscope and spectrum of the output, plus previews of the
// waveform, harmonic recipe, and envelope computed from the current parameters.

// colors come from CSS custom properties on the canvas being drawn, so each screen can have its own palette
let styleSource = document.documentElement;
const css = (name) => getComputedStyle(styleSource).getPropertyValue(name).trim();

/** Sizes the canvas backing store to its CSS size × devicePixelRatio and returns a 2D context in CSS pixels. */
function prepare(canvas) {
  styleSource = canvas;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function gridLine(ctx, x0, y0, x1, y1) {
  ctx.strokeStyle = css('--border');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function label(ctx, text, x, y, align = 'left') {
  ctx.fillStyle = css('--muted');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function strokePath(ctx, points, color, width = 1.5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

// MARK: live (AnalyserNode)

/** Draws the output continuously while audio runs. */
export class LiveView {
  constructor(analyser, scopeCanvas, spectrumCanvas) {
    this.analyser = analyser;
    this.scope = scopeCanvas;
    this.spectrum = spectrumCanvas;
    this.time = new Float32Array(analyser.fftSize);
    this.freq = new Float32Array(analyser.frequencyBinCount);
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  frame() {
    if (!document.hidden) {
      this.analyser.getFloatTimeDomainData(this.time);
      this.analyser.getFloatFrequencyData(this.freq);
      this.drawScope();
      this.drawSpectrum();
    }
    requestAnimationFrame(this.frame);
  }

  drawScope() {
    const { ctx, w, h } = prepare(this.scope);
    gridLine(ctx, 0, h / 2, w, h / 2);
    const data = this.time;
    // trigger on the first rising zero crossing so a steady note stands still on screen
    const span = Math.floor(data.length / 2);
    let start = 0;
    for (let i = 1; i < span; i++) {
      if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
    }
    let peak = 0;
    for (let i = start; i < start + span; i++) peak = Math.max(peak, Math.abs(data[i]));
    const scale = peak > 0.001 ? 0.9 / peak : 1; // auto-gain so quiet notes are still readable
    const points = [];
    for (let i = 0; i < span; i++) {
      points.push([(i / (span - 1)) * w, h / 2 - data[start + i] * scale * (h / 2)]);
    }
    strokePath(ctx, points, css('--accent'));
    const ms = (span / this.analyser.context.sampleRate) * 1000;
    label(ctx, `${ms.toFixed(0)} ms`, w - 4, h - 4, 'right');
    if (peak <= 0.001) label(ctx, 'silent', 4, 14);
  }

  drawSpectrum() {
    const { ctx, w, h } = prepare(this.spectrum);
    const sr = this.analyser.context.sampleRate;
    const bins = this.freq;
    const fMin = 40, fMax = 12000;
    const x = (f) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
    for (const f of [100, 1000, 10000]) {
      gridLine(ctx, x(f), 0, x(f), h);
      const text = f >= 1000 ? `${f / 1000}k` : String(f);
      // keep the last label inside the canvas
      if (x(f) > w - 30) label(ctx, text, x(f) - 3, h - 4, 'right');
      else label(ctx, text, x(f) + 3, h - 4);
    }
    const dbMin = -100, dbMax = -10;
    const points = [];
    for (let i = 1; i < bins.length; i++) {
      const f = (i * sr) / (2 * bins.length);
      if (f < fMin || f > fMax) continue;
      const db = Math.min(Math.max(bins[i], dbMin), dbMax);
      points.push([x(f), h - ((db - dbMin) / (dbMax - dbMin)) * h]);
    }
    strokePath(ctx, points, css('--accent'), 1.2);
  }
}

// MARK: previews from parameters

const WAVE_GAIN = [1, 1, 0.6, 0.5, 0.5, 1]; // same as the synth, so previews match what you hear
const PREVIEW_HZ = 261.63;                  // previews show middle C (note 60)

/**
 * The oscillator section as a list of sine components { ratio, re, im } relative to the note:
 * each contributes |c| · sin(2π · ratio · t + arg c). Covers both oscillators, their wave shapes,
 * and the chorus sine, before the filter.
 */
function oscillatorSpectrum(params, partials, velocity) {
  const out = [];
  const add = (ratio, amp, phase = 0) => {
    if (amp !== 0 && ratio > 0) out.push({ ratio, re: amp * Math.cos(phase), im: amp * Math.sin(phase) });
  };
  const addWave = (shape, ratio, level) => {
    const gain = level * WAVE_GAIN[shape];
    if (gain === 0) return;
    const pw = Math.min(Math.max(params.pulseWidth, 0.05), 0.95);
    for (let n = 1; n <= 64 && n * ratio * PREVIEW_HZ < 20000; n++) {
      switch (shape) {
        case 1: if (n % 2) add(n * ratio, (-gain * 8) / (Math.PI ** 2 * n * n), Math.PI / 2); break; // triangle
        case 2: add(n * ratio, (-gain * 2) / (Math.PI * n)); break;                                  // saw
        case 3: if (n % 2) add(n * ratio, (gain * 4) / (Math.PI * n)); break;                         // square
        case 4: add(n * ratio, ((gain * 4) / (Math.PI * n)) * Math.sin(Math.PI * n * pw), Math.PI / 2 - Math.PI * n * pw); break;
        default: if (n === 1) add(ratio, gain);                                                         // sine
      }
    }
  };

  const osc1 = Math.round(params.osc1Wave);
  if (osc1 === 5) {
    for (const p of partials) {
      add(p.ratio, (p.level + p.velocity * velocity) * (p.ratio === 1 ? 1 : params.brightness) * params.osc1Level);
    }
  } else {
    addWave(osc1, 1, params.osc1Level);
  }
  const osc2 = Math.round(params.osc2Wave) === 5 ? 0 : Math.round(params.osc2Wave);
  const r2 = 2 ** (Math.round(params.osc2Octave) + Math.round(params.osc2Semi) / 12 + params.osc2Detune / 1200);
  addWave(osc2, r2, params.osc2Level);
  add(2 ** (params.detune / 1200), params.chorus * 0.5); // chorus sine (L/R average)
  return out;
}

const FILTER_NAMES = ['LP', 'BP', 'HP'];

/**
 * The filter as the preview sees it at a velocity: its type, cutoffs in Hz at rest and at the
 * envelope's peak, and damping k.
 */
function filterState(params, velocity) {
  const type = Math.round(params.filterType);
  const bypass = type === 0 && params.cutoff >= 19999 && params.filterEnv === 0 && params.lfoFilter === 0
    && params.keyTrack === 0 && params.velFilter === 0;
  const clamp = (f) => Math.min(Math.max(f, 20), 20000);
  const base = params.cutoff * 2 ** (params.velFilter * velocity);
  return {
    type,
    bypass,
    rest: clamp(base * 2 ** (params.filterEnv * params.fSustain)),
    peak: clamp(base * 2 ** params.filterEnv),
    k: 2 - 2 * Math.min(Math.max(params.resonance, 0), 0.97),
  };
}

/**
 * Response of the synth's filter at frequency f: { mag, phase }. With x = f / cutoff and
 * D = (1 − x²) + j·k·x: low-pass 1 / D, band-pass j·k·x / D (peak 1), high-pass −x² / D.
 */
function response(f, filter, cutoff) {
  const x = f / cutoff;
  const re = 1 - x * x, im = filter.k * x;
  const d = Math.hypot(re, im), arg = Math.atan2(im, re);
  if (filter.type === 1) return { mag: (filter.k * x) / d, phase: Math.PI / 2 - arg };
  if (filter.type === 2) return { mag: (x * x) / d, phase: Math.PI - arg };
  return { mag: 1 / d, phase: -arg };
}

/** Two cycles of middle C right after the attack (filter envelope at its peak). */
export function drawWaveform(canvas, params, partials, velocity = 0.7) {
  const { ctx, w, h } = prepare(canvas);
  gridLine(ctx, 0, h / 2, w, h / 2);
  gridLine(ctx, w / 2, 0, w / 2, h);
  const filter = filterState(params, velocity);
  const parts = oscillatorSpectrum(params, partials, velocity).map((c) => {
    let mag = Math.hypot(c.re, c.im), phase = Math.atan2(c.im, c.re);
    if (!filter.bypass) {
      const r = response(c.ratio * PREVIEW_HZ, filter, filter.peak);
      mag *= r.mag;
      phase += r.phase;
    }
    return { ratio: c.ratio, mag, phase };
  });
  const n = Math.max(2, Math.floor(w));
  const ys = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2; // in cycles of the fundamental
    let y = 0;
    for (const c of parts) y += c.mag * Math.sin(2 * Math.PI * c.ratio * t + c.phase);
    ys[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  const scale = peak > 0 ? 0.9 / peak : 0;
  const points = Array.from(ys, (y, i) => [(i / (n - 1)) * w, h / 2 - y * scale * (h / 2)]);
  strokePath(ctx, points, css('--accent'));
  label(ctx, 'C4 · 2 cycles', w - 4, h - 4, 'right');
}

/**
 * Oscillator harmonics of middle C (faint bars = before the filter, solid = after) with the
 * filter's response curve on top (solid = envelope peak, dashed = at rest), in dB on a log-Hz axis.
 */
export function drawFilter(canvas, params, partials, velocity = 0.7) {
  const { ctx, w, h } = prepare(canvas);
  const fMin = 40, fMax = 16000, dbMin = -48, dbMax = 12;
  const bottom = h - 14;
  const x = (f) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
  const y = (db) => ((dbMax - Math.min(Math.max(db, dbMin), dbMax)) / (dbMax - dbMin)) * bottom;
  for (const f of [100, 1000, 10000]) {
    gridLine(ctx, x(f), 0, x(f), bottom);
    label(ctx, f >= 1000 ? `${f / 1000}k` : String(f), x(f) + 3, h - 2);
  }
  gridLine(ctx, 0, y(0), w, y(0));

  const filter = filterState(params, velocity);
  const parts = oscillatorSpectrum(params, partials, velocity);
  const top = Math.max(1e-6, ...parts.map((c) => Math.hypot(c.re, c.im)));
  for (const c of parts) {
    const f = c.ratio * PREVIEW_HZ;
    if (f < fMin || f > fMax) continue;
    const before = 20 * Math.log10(Math.hypot(c.re, c.im) / top);
    const after = before + (filter.bypass ? 0 : 20 * Math.log10(response(f, filter, filter.peak).mag));
    ctx.fillStyle = css('--border');
    ctx.fillRect(x(f) - 2, y(before), 4, bottom - y(before));
    ctx.fillStyle = css('--accent');
    ctx.fillRect(x(f) - 2, y(after), 4, Math.max(0, bottom - y(after)));
  }

  if (filter.bypass) {
    label(ctx, 'filter open', 4, 12);
    return;
  }
  const curve = (cutoff) => {
    const pts = [];
    for (let i = 0; i <= w; i += 2) {
      const f = fMin * (fMax / fMin) ** (i / w);
      pts.push([i, y(20 * Math.log10(response(f, filter, cutoff).mag))]);
    }
    return pts;
  };
  ctx.setLineDash([4, 3]);
  strokePath(ctx, curve(filter.rest), css('--muted'), 1);
  ctx.setLineDash([]);
  strokePath(ctx, curve(filter.peak), css('--accent'), 1.5);
  label(ctx, `${FILTER_NAMES[filter.type] ?? 'LP'} ${Math.round(filter.peak)} Hz`, 4, 12);
}

/** Volume (solid) and filter envelope (dashed) over time: attack, decay, key held, release. */
export function drawEnvelope(canvas, params) {
  const { ctx, w, h } = prepare(canvas);
  const adsr = (a, d, s, r) => ({
    a: Math.max(a, 0.001), d: Math.max(d, 0.01), s: Math.min(Math.max(s, 0), 1), r: Math.max(r, 0.01),
  });
  const amp = adsr(params.attack, params.decay, params.sustain, params.release);
  const flt = adsr(params.fAttack, params.fDecay, params.fSustain, params.fRelease);
  const showFilter = params.filterEnv !== 0;
  const settle = (e) => e.a + e.d * 3;
  // show the key held long enough to see the decays settle (bounded so long pads still fit)
  const hold = Math.min(Math.max(settle(amp), showFilter ? settle(flt) : 0, 0.5), 8);
  const total = hold + Math.min(Math.max(amp.r, showFilter ? flt.r : 0) * 4, 8);
  const top = 8, bottom = h - 16;
  const x = (t) => (t / total) * w;
  const y = (v) => bottom - v * (bottom - top);
  const valueAt = (e, t) => {
    const held = (u) => (u < e.a ? u / e.a : e.s + (1 - e.s) * Math.exp(-(u - e.a) / e.d));
    return t < hold ? held(t) : held(hold) * Math.exp(-(t - hold) / e.r);
  };
  const path = (e) => {
    const pts = [];
    const steps = Math.max(2, Math.floor(w));
    for (let i = 0; i < steps; i++) {
      const t = (i / (steps - 1)) * total;
      pts.push([x(t), y(valueAt(e, t))]);
    }
    return pts;
  };

  gridLine(ctx, x(hold), top, x(hold), bottom);
  label(ctx, 'key up', x(hold) + 3, top + 10);
  gridLine(ctx, 0, bottom, w, bottom);
  label(ctx, `${total.toFixed(total < 10 ? 1 : 0)} s`, w - 4, h - 2, 'right');
  if (showFilter) {
    ctx.setLineDash([4, 3]);
    strokePath(ctx, path(flt), css('--muted'), 1.2);
    ctx.setLineDash([]);
    label(ctx, '— amp   - - filter', 4, h - 2);
  }
  strokePath(ctx, path(amp), css('--accent'));
}
