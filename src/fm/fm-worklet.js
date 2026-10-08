// The FM engine: a DX7-style 6-operator synth as an AudioWorklet ('fm-synth').
// Levels, envelopes, scaling, and modulation depths follow msfa / Dexed's model of the DX7 (in floating point).
//
//   ops 6 → 1 (each: sine + EG, phase modulated by the ops above it per the algorithm) → carriers summed
//   → (all voices) → reverb → limiter → out
import { ALGORITHMS, PERF_DEFAULTS, initOpOn, initVoice, sanitizeVoice } from './voice.js';
import {
  AMS, PITCH_LEVELS, PITCH_RATES, PMS, levelScaling, lfoDelaySeconds, scaleOutLevel, scaleRate, scaleVelocity,
} from './tables.js';

const MAX_VOICES = 16;
const BLOCK = 32; // envelopes, LFO, and pitch update every 32 samples; gains are interpolated in between
const SINE_SIZE = 4096;
const SINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE_SIZE);
const OUT_GAIN = 0.22; // fixed carrier gain, as on the DX7: the level does not depend on the algorithm
const MAX_LEVEL = 3584; // env level where an operator's output is 2.0 (modulation of 2 cycles = 4π rad)

/** sin(2π·x) by table, x in cycles (any real). */
function sin1(x) {
  x -= Math.floor(x);
  const p = x * SINE_SIZE;
  const i = p | 0;
  return SINE[i] + (SINE[i + 1] - SINE[i]) * (p - i);
}

const lfoHz = (speed) => {
  let sr = speed === 0 ? 1 : (165 * speed) >> 6;
  sr *= sr < 160 ? 11 : 11 + ((sr - 160) >> 4);
  return (sr * 25190424) / 2 ** 32;
};

// MARK: operator envelope (msfa's Env, in its level units: 256 = 6 dB)

class Env {
  constructor() {
    this.level = 0;
    this.stage = 4; // 0–2 attack / decays, 3 release, 4 idle
    this.down = false;
    this.rates = [99, 99, 99, 99];
    this.levels = [99, 99, 99, 0];
    this.outlevel = 0; // operator output level in ×32 units, with scaling and velocity
    this.rateAdd = 0;
    this.target = 0;
    this.inc = 0;
    this.rising = false;
  }

  configure(rates, levels, outlevel, rateAdd, sr) {
    this.rates = rates;
    this.levels = levels;
    this.outlevel = outlevel;
    this.rateAdd = rateAdd;
    this.srScale = 44100 / sr;
    if (this.stage < 4) this.advance(this.stage);
  }

  start() {
    this.down = true;
    this.advance(0); // from wherever it is (a retriggered voice glides on instead of clicking)
  }

  release() {
    this.down = false;
    this.advance(3);
  }

  advance(stage) {
    this.stage = stage;
    if (stage > 3) return;
    const l = this.levels[stage];
    this.target = Math.max(16, ((scaleOutLevel(l) >> 1) << 6) + this.outlevel - 4256);
    this.rising = this.target > this.level;
    const q = Math.min(63, ((this.rates[stage] * 41) >> 6) + this.rateAdd);
    this.inc = (4 + (q & 3)) * 2 ** (2 + (q >> 2)) / 65536 * this.srScale; // level units per sample
  }

  /** Moves `n` samples on; returns the level. */
  step(n) {
    if (this.stage < 3 || (this.stage === 3 && !this.down)) {
      if (this.rising) {
        if (this.level < 1716) this.level = 1716; // the DX7 attack starts with a jump
        this.level += Math.max(1, Math.floor((4352 - this.level) / 256)) * this.inc * n;
        if (this.level >= this.target) { this.level = this.target; this.advance(this.stage + 1); }
      } else {
        this.level -= this.inc * n;
        if (this.level <= this.target) { this.level = this.target; this.advance(this.stage + 1); }
      }
    }
    return this.level;
  }

  /** Released and below about −60 dB (a voice whose L4 stays high keeps sounding, as on the DX7). */
  get done() { return !this.down && this.stage >= 3 && this.level < 1100; }
}

// MARK: pitch envelope (linear in octaves)

class PitchEnv {
  constructor() { this.level = 0; this.stage = 4; this.down = false; }

  configure(rates, levels) {
    this.rates = rates;
    this.levels = levels.map((l) => PITCH_LEVELS[l] / 32);
  }

  start(fresh) {
    if (fresh) this.level = this.levels[3];
    this.down = true;
    this.stage = 0;
  }

  release() { this.down = false; this.stage = 3; }

  step(seconds) {
    if (this.stage < 3 || (this.stage === 3 && !this.down)) {
      const target = this.levels[this.stage];
      const d = (PITCH_RATES[this.rates[this.stage]] / 21.3) * seconds;
      if (Math.abs(target - this.level) <= d) {
        this.level = target;
        this.stage++;
      } else {
        this.level += Math.sign(target - this.level) * d;
      }
    }
    return this.level;
  }
}

// MARK: a voice

class Voice {
  constructor() {
    this.key = -1;
    this.active = false;
    this.held = false;     // key down
    this.sustained = false; // key up but the pedal holds it
    this.age = 0;
    this.envs = Array.from({ length: 6 }, () => new Env());
    this.pitchEnv = new PitchEnv();
    this.phase = new Float64Array(6);
    this.out = new Float64Array(6);
    this.fb = new Float64Array(2); // last two outputs of the feedback source
    this.gain = new Float64Array(6); // current linear gain per op (end of the last block)
    this.pitch = 0;  // octaves above A4 of the key (glides in mono mode)
    this.pitchTarget = 0;
  }
}

// MARK: the processor

class Reverb {
  constructor(sr) {
    this.lengths = [1557, 1617, 1491, 1422].map((n) => Math.floor((n * sr) / 44100));
    this.lines = this.lengths.map((n) => new Float32Array(n));
    this.pos = [0, 0, 0, 0];
    this.damp = new Float32Array(4);
    this.feedback = 0.8;
    this.dampCoef = 0.35;
    this.wet = 0.15;
  }

  process(L, R, frames) {
    const g = this.feedback * 0.5;
    const [l0, l1, l2, l3] = this.lines;
    const [n0, n1, n2, n3] = this.lengths;
    const damp = this.damp, dc = this.dampCoef, wet = this.wet;
    let [p0, p1, p2, p3] = this.pos;
    let energy = 0;
    for (let f = 0; f < frames; f++) {
      const input = (L[f] + R[f]) * 0.25;
      const a = l0[p0], b = l1[p1], c = l2[p2], d = l3[p3];
      damp[0] += dc * (a - damp[0]);
      damp[1] += dc * (b - damp[1]);
      damp[2] += dc * (c - damp[2]);
      damp[3] += dc * (d - damp[3]);
      const w = damp[0], x = damp[1], y = damp[2], z = damp[3];
      l0[p0] = input + g * (w + x + y + z);
      l1[p1] = input + g * (w - x + y - z);
      l2[p2] = input + g * (w + x - y - z);
      l3[p3] = input + g * (w - x - y + z);
      if (++p0 === n0) p0 = 0;
      if (++p1 === n1) p1 = 0;
      if (++p2 === n2) p2 = 0;
      if (++p3 === n3) p3 = 0;
      L[f] += wet * (a + c);
      R[f] += wet * (b + d);
      energy += Math.abs(a) + Math.abs(b);
    }
    this.pos[0] = p0; this.pos[1] = p1; this.pos[2] = p2; this.pos[3] = p3;
    return energy;
  }

  clear() {
    for (const line of this.lines) line.fill(0);
    this.damp.fill(0);
  }
}

class FmSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice());
    this.voice = initVoice();
    this.perf = { ...PERF_DEFAULTS, opOn: initOpOn() };
    this.reverb = new Reverb(this.sr);
    this.fxIdle = true;
    this.limGain = 1;
    this.limAttack = Math.exp(-1 / (0.0005 * this.sr));
    this.limRelease = Math.exp(-1 / (0.2 * this.sr));
    this.counter = 0;
    this.sustainDown = false;
    this.bend = 0;       // -1…1
    this.modWheel = 0;   // 0…1 (from MIDI; adds to perf.modWheel)
    this.aftertouch = 0; // 0…1
    this.heldKeys = [];  // mono mode: keys held, newest last
    // the LFO (one for all voices, as on the DX7)
    this.lfoPhase = 0;
    this.lfoValue = 0;
    this.lfoSH = 0;
    this.lfoDelayTime = 0; // seconds since the last key-down
    this.port.onmessage = (e) => this.message(e.data);
  }

  message(m) {
    switch (m.type) {
      case 'voice':
        this.voice = sanitizeVoice(m.voice); // whatever arrives, the engine only sees complete, in-range values
        if (m.perf) this.setPerf(m.perf);
        this.reconfigure();
        break;
      case 'perf':
        this.setPerf(m.perf);
        this.reconfigure();
        break;
      case 'noteOn': this.noteOn(m.key, m.velocity); break;
      case 'noteOff': this.noteOff(m.key); break;
      case 'sustain':
        this.sustainDown = m.on ?? m.down;
        if (!this.sustainDown) for (const v of this.voices) if (v.sustained) this.releaseVoice(v);
        break;
      case 'bend': this.bend = m.value; break;
      case 'modWheel': this.modWheel = m.value; break;
      case 'aftertouch': this.aftertouch = m.value; break;
      case 'allNotesOff':
        for (const v of this.voices) { v.active = false; v.held = false; v.sustained = false; for (const env of v.envs) { env.stage = 4; env.level = 0; } }
        this.heldKeys = [];
        break;
    }
  }

  setPerf(p) {
    this.perf = { ...PERF_DEFAULTS, ...p, opOn: Array.isArray(p.opOn) ? p.opOn : initOpOn() };
    this.reverb.wet = this.perf.reverb;
  }

  /** Recomputes what each sounding voice derives from the voice parameters (live edits reach held notes). */
  reconfigure() {
    for (const v of this.voices) if (v.active) this.configureVoice(v);
  }

  configureVoice(v) {
    const voice = this.voice;
    const alg = ALGORITHMS[voice.algorithm - 1];
    const bright = this.perf.brightness ?? 0;
    for (let i = 0; i < 6; i++) {
      const op = voice.ops[i];
      const carrier = alg.carriers.includes(i + 1);
      const level = Math.max(0, Math.min(99, op.level + (carrier ? 0 : bright)));
      let out = scaleOutLevel(level) + levelScaling(op, v.key);
      out = Math.min(127, Math.max(0, out)) << 5;
      out = Math.max(0, out + scaleVelocity(v.velocity, op.velocity));
      v.envs[i].configure([op.r1, op.r2, op.r3, op.r4], [op.l1, op.l2, op.l3, op.l4], out, scaleRate(v.key, op.rateScale), this.sr);
    }
    v.pitchEnv.configure([voice.pr1, voice.pr2, voice.pr3, voice.pr4], [voice.pl1, voice.pl2, voice.pl3, voice.pl4]);
  }

  keyPitch(key) {
    return (key + this.voice.transpose - 24 + (this.perf.shift ?? 0) - 69) / 12;
  }

  noteOn(key, velocity) {
    if (velocity === 0) return this.noteOff(key);
    this.lfoKeyDown();
    if (this.perf.mono) {
      this.heldKeys = this.heldKeys.filter((k) => k !== key);
      this.heldKeys.push(key);
      const v = this.voices[0];
      if (v.active && v.held) { // legato: glide to the new key without restarting the envelopes
        v.key = key;
        v.pitchTarget = this.keyPitch(key);
        if (!this.perf.portamento) v.pitch = v.pitchTarget;
        this.configureVoice(v);
        return;
      }
      for (const other of this.voices) if (other !== v) other.active = false;
      return this.startVoice(v, key, velocity, v.active);
    }
    // the same key again: retrigger its voice; otherwise a free voice, else the oldest released, else the oldest
    let v = this.voices.find((x) => x.active && x.key === key);
    const retrigger = !!v;
    if (!v) v = this.voices.find((x) => !x.active);
    if (!v) v = this.voices.filter((x) => !x.held).sort((a, b) => a.age - b.age)[0];
    if (!v) v = [...this.voices].sort((a, b) => a.age - b.age)[0];
    this.startVoice(v, key, velocity, retrigger || v.active);
  }

  startVoice(v, key, velocity, wasActive) {
    v.key = key;
    v.velocity = velocity;
    v.age = this.counter++;
    v.held = true;
    v.sustained = false;
    const glideFrom = wasActive ? v.pitch : this.lastPitch;
    v.pitchTarget = this.keyPitch(key);
    v.pitch = this.perf.mono && this.perf.portamento && glideFrom !== undefined ? glideFrom : v.pitchTarget;
    this.lastPitch = v.pitchTarget;
    if (!wasActive) {
      for (const env of v.envs) env.level = 0;
      v.fb.fill(0);
      v.gain.fill(0);
    }
    if (this.voice.oscSync || !wasActive) v.phase.fill(0); // key sync: every op starts at phase 0
    v.active = true;
    this.configureVoice(v);
    for (const env of v.envs) env.start();
    v.pitchEnv.start(!wasActive);
  }

  noteOff(key) {
    if (this.perf.mono) {
      this.heldKeys = this.heldKeys.filter((k) => k !== key);
      const v = this.voices[0];
      if (!v.active || v.key !== key) return;
      if (this.heldKeys.length) { // fall back to the previous held key, legato
        v.key = this.heldKeys[this.heldKeys.length - 1];
        v.pitchTarget = this.keyPitch(v.key);
        if (!this.perf.portamento) v.pitch = v.pitchTarget;
        this.configureVoice(v);
        return;
      }
    }
    for (const v of this.voices) {
      if (!v.active || v.key !== key || !v.held) continue;
      v.held = false;
      if (this.sustainDown) v.sustained = true;
      else this.releaseVoice(v);
    }
  }

  releaseVoice(v) {
    v.held = false;
    v.sustained = false;
    for (const env of v.envs) env.release();
    v.pitchEnv.release();
  }

  lfoKeyDown() {
    if (this.voice.lfoSync) this.lfoPhase = 0;
    this.lfoDelayTime = 0;
  }

  /** Advances the LFO by one block; returns { pitch (octaves), amp (0…1 depth) }. */
  lfoStep(seconds) {
    const voice = this.voice, perf = this.perf;
    const prev = this.lfoPhase;
    this.lfoPhase = (this.lfoPhase + lfoHz(voice.lfoSpeed) * seconds) % 1;
    const p = this.lfoPhase;
    if (p < prev) this.lfoSH = Math.random() * 2 - 1;
    let w;
    switch (voice.lfoWave) {
      case 0: w = p < 0.5 ? 4 * p - 1 : 3 - 4 * p; break;
      case 1: w = 1 - 2 * p; break;
      case 2: w = 2 * p - 1; break;
      case 3: w = p < 0.5 ? 1 : -1; break;
      case 4: w = sin1(p); break;
      default: w = this.lfoSH;
    }
    // delay: silent for the delay time, then fades in over the same time (wheel / aftertouch are not delayed)
    this.lfoDelayTime += seconds;
    const d = lfoDelaySeconds(voice.lfoDelay);
    const ramp = d === 0 ? 1 : Math.min(1, Math.max(0, (this.lfoDelayTime - d) / d));
    const wheel = Math.min(1, perf.modWheel + this.modWheel);
    const touch = Math.min(1, perf.aftertouch + this.aftertouch);
    const pmd = Math.min(1, (voice.lfoPmd / 99) * ramp + (wheel * perf.wheelPitch) / 99 + (touch * perf.atPitch) / 99);
    const amd = Math.min(1, (voice.lfoAmd / 99) * ramp + (wheel * perf.wheelAmp) / 99 + (touch * perf.atAmp) / 99);
    return { pitch: pmd * PMS[voice.lfoPms] * w, amp: amd * (1 - w) / 2 };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const frames = L.length;
    L.fill(0);
    if (R !== L) R.fill(0);
    const anyActive = this.voices.some((v) => v.active);
    if (anyActive) {
      this.fxIdle = false;
      for (let start = 0; start < frames; start += BLOCK) this.renderBlock(L, start, Math.min(BLOCK, frames - start));
      if (R !== L) R.set(L);
    }
    let tail = 0;
    if (!this.fxIdle) tail = this.reverb.process(L, R, frames);
    this.limit(L, R, frames);
    if (!anyActive && tail < 1e-4) {
      this.fxIdle = true;
      this.reverb.clear();
    }
    return true;
  }

  renderBlock(L, start, n) {
    const voice = this.voice, perf = this.perf;
    const alg = ALGORITHMS[voice.algorithm - 1];
    const seconds = n / this.sr;
    const lfo = this.lfoStep(seconds);
    const bendOct = (this.bend * perf.bendRange + (perf.bendSemis ?? 0)) / 12;
    const vol = OUT_GAIN * perf.volume;
    const [fbFrom, fbTo] = alg.fb;
    const fbScale = voice.feedback ? 2 ** (voice.feedback - 8) : 0;
    const glide = perf.portamento ? seconds / (0.002 * 2 ** (perf.portamento / 10)) : 1; // octaves per block
    // modulators of each op, as op indexes 0–5
    const mods = this.mods ?? (this.mods = new Map());
    let modList = mods.get(voice.algorithm);
    if (!modList) {
      modList = [0, 1, 2, 3, 4, 5].map((i) => alg.edges.filter(([, to]) => to === i + 1).map(([from]) => from - 1));
      mods.set(voice.algorithm, modList);
    }
    const isCarrier = [0, 1, 2, 3, 4, 5].map((i) => alg.carriers.includes(i + 1));
    const inc = new Float64Array(6);
    const g0 = new Float64Array(6), dg = new Float64Array(6);

    for (const v of this.voices) {
      if (!v.active) continue;
      // pitch: key (gliding in mono), pitch EG, LFO, bend
      if (v.pitch !== v.pitchTarget) {
        const d = v.pitchTarget - v.pitch;
        v.pitch = Math.abs(d) <= glide ? v.pitchTarget : v.pitch + Math.sign(d) * glide;
      }
      const mod = v.pitchEnv.step(seconds) + lfo.pitch;
      const keyHz = 440 * 2 ** (v.pitch + bendOct);
      const log2f = Math.log2(Math.max(1, keyHz));
      let alive = false;
      for (let i = 0; i < 6; i++) {
        const op = voice.ops[i];
        let hz;
        if (op.mode === 1) hz = 10 ** ((op.coarse & 3) + op.fine / 100);
        else hz = keyHz * (op.coarse === 0 ? 0.5 : op.coarse) * (1 + op.fine / 100);
        // detune: a step is about a cent in the middle of the keyboard, less higher up (msfa)
        const det = ((0.0209 * Math.exp(-0.396 * log2f)) / 7) * log2f * op.detune;
        hz *= 2 ** (mod + det);
        inc[i] = hz / this.sr;
        const env = v.envs[i];
        let level = env.step(n);
        if (op.ams && lfo.amp) level -= lfo.amp * AMS[op.ams] * 2048; // amp mod: up to 48 dB down
        const on = perf.opOn[i] ? 1 : 0;
        const g1 = level <= 16 ? 0 : on * 2 ** ((level - MAX_LEVEL) / 256);
        g0[i] = v.gain[i];
        dg[i] = (g1 - g0[i]) / n;
        v.gain[i] = g1;
        if (isCarrier[i] && !env.done) alive = true;
      }
      if (!alive) { v.active = false; continue; }
      const phase = v.phase, outs = v.out, fb = v.fb;
      for (let f = 0; f < n; f++) {
        let sum = 0;
        for (let i = 5; i >= 0; i--) {
          let input = 0;
          const ml = modList[i];
          for (let k = 0; k < ml.length; k++) input += outs[ml[k]];
          if (i === fbTo - 1 && fbScale) input += (fb[0] + fb[1]) * 0.5 * fbScale;
          const g = g0[i] + dg[i] * f;
          const y = g === 0 ? 0 : sin1(phase[i] + input) * g;
          outs[i] = y;
          phase[i] += inc[i];
          if (phase[i] >= 1) phase[i] -= 1;
          if (isCarrier[i]) sum += y;
        }
        fb[1] = fb[0];
        fb[0] = outs[fbFrom - 1];
        L[start + f] += sum * vol;
      }
    }
  }

  limit(L, R, frames) {
    const LIMIT = 0.7;
    const attack = this.limAttack, release = this.limRelease;
    let g = this.limGain;
    for (let f = 0; f < frames; f++) {
      const peak = Math.max(Math.abs(L[f]), Math.abs(R[f]));
      const target = peak > LIMIT ? LIMIT / peak : 1;
      g = target + (g - target) * (target < g ? attack : release);
      L[f] = knee(L[f] * g);
      if (R !== L) R[f] = knee(R[f] * g);
    }
    this.limGain = g;
  }
}

function knee(y) {
  const m = Math.abs(y);
  if (m <= 0.9) return y;
  return Math.sign(y) * (0.9 + 0.1 * Math.tanh((m - 0.9) / 0.1));
}

registerProcessor('fm-synth', FmSynthProcessor);
