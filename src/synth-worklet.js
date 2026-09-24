// The synth, running on the AudioWorklet audio thread. Per voice, a classic subtractive layout:
//
//   oscillator 1 (× unison) ─┐   ↑ pitch envelope, LFO (vibrato), glide
//   oscillator 2 (× unison) ─┼─ mixer ─ filter (LP/BP/HP) ─ amp ─┐
//   noise                   ─┤          ↑ filter env,          ↑ amp env, LFO (tremolo)
//   chorus sine             ─┘            LFO, velocity         │
//                                                  (all voices) ─ delay ─ reverb ─ limiter ─ out
//
// Oscillator 1 can also play the preset's "harmonics" recipe (additive sines), which is how the
// original soft presets sound; with the filter fully open they are unchanged.
// Voices glide between pitches (portamento); in mono mode one voice plays legato over held keys.
// process() never allocates (to avoid GC glitches), so all state lives in preallocated arrays.

const MAX_VOICES = 32;
const MAX_PARTIALS = 8;
const MAX_UNISON = 7;
const BLOCK = 128;
const TWO_PI = 2 * Math.PI;
const ATTACK = 0, DECAY = 1, RELEASE = 2;
const SINE = 0, TRIANGLE = 1, SAW = 2, SQUARE = 3, PULSE = 4, HARMONICS = 5;
const LFO_TRIANGLE = 1, LFO_SQUARE = 2, LFO_SAW = 3, LFO_RANDOM = 4;
// saw and square carry far more energy than a sine; scale them so waves sound about as loud
const WAVE_GAIN = [1, 1, 0.6, 0.5, 0.5, 1];

/** PolyBLEP correction: smooths the jump of a saw / square edge so it does not alias (sound harsh). */
function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** One sample of a basic wave at phase p (0...1) with phase increment dt. */
function wave(shape, p, dt, pw) {
  switch (shape) {
    case TRIANGLE: return 1 - 4 * Math.abs(p - 0.5);
    case SAW: return 2 * p - 1 - blep(p, dt);
    case SQUARE: {
      let v = p < 0.5 ? 1 : -1;
      v += blep(p, dt);
      v -= blep((p + 0.5) % 1, dt);
      return v;
    }
    case PULSE: {
      let v = p < pw ? 1 : -1;
      v += blep(p, dt);
      v -= blep((p + 1 - pw) % 1, dt);
      return v - (2 * pw - 1); // remove the DC offset of an uneven pulse
    }
    default: return Math.sin(TWO_PI * p);
  }
}

class Voice {
  constructor() {
    this.active = false;
    this.key = -1;          // key sounding (before transpose); used to match noteOff
    this.pitch = 0;         // current pitch in keys; glides toward `key`
    this.gate = false;      // key is held
    this.sustained = false; // released but held by the sustain pedal
    this.stage = ATTACK;    // amp envelope
    this.env = 0;
    this.fStage = ATTACK;   // filter envelope
    this.fEnv = 0;
    this.pEnv = 0;          // pitch envelope: 1 at note start, falls toward 0
    this.gain = 0;
    this.panL = 0;
    this.panR = 0;
    this.vn = 0;            // note velocity 0...1
    this.phase = new Float64Array(MAX_PARTIALS); // harmonics wave, one phase per partial
    this.amp = new Float32Array(MAX_PARTIALS);   // per-partial decay envelope (starts at 1)
    this.u1 = new Float64Array(MAX_UNISON);      // oscillator 1 phases, one per unison copy
    this.u2 = new Float64Array(MAX_UNISON);      // oscillator 2 phases
    this.chorusPhase = 0.25;
    // filter state (left / right mixes share coefficients)
    this.l1 = 0; this.l2 = 0; this.r1 = 0; this.r2 = 0;
    this.age = 0;
  }

  release() {
    this.stage = RELEASE;
    this.fStage = RELEASE;
  }

  resetPhases() {
    this.phase.fill(0);
    // spread unison copies over the cycle so they do not start in phase (which sounds like a flanger sweep)
    for (let j = 0; j < MAX_UNISON; j++) {
      this.u1[j] = j / MAX_UNISON;
      this.u2[j] = ((j + 0.5) / MAX_UNISON) % 1;
    }
    this.chorusPhase = 0.25;
    this.l1 = this.l2 = this.r1 = this.r2 = 0;
  }
}

// Light FDN reverb with four delay lines.
class Reverb {
  constructor(sr) {
    this.lengths = [1557, 1617, 1491, 1422].map((n) => Math.floor((n * sr) / 44100));
    this.lines = this.lengths.map((n) => new Float32Array(n));
    this.pos = [0, 0, 0, 0];
    this.damp = new Float32Array(4);
    this.feedback = 0.8;
    this.dampCoef = 0.35; // in-loop lowpass (smaller = darker, softer tail)
    this.wet = 0.22;
  }

  /** Adds the reverb to L/R in place and returns the tail's energy in this block. */
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
      // mix through a Hadamard matrix
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

// Ping-pong delay: echoes alternate left and right, and each repeat gets a little darker.
class Delay {
  constructor(sr) {
    this.size = Math.ceil(sr * 2);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.pos = 0;
    this.lpL = 0;
    this.lpR = 0;
    this.samples = Math.round(sr * 0.35);
    this.feedback = 0.35;
    this.wet = 0;
    this.empty = true;
  }

  /** Adds the echoes to L/R in place and returns their energy in this block. */
  process(L, R, frames) {
    const n = this.size, fb = this.feedback, wet = this.wet, bufL = this.bufL, bufR = this.bufR;
    let pos = this.pos, lpL = this.lpL, lpR = this.lpR, energy = 0;
    let rp = pos - this.samples;
    if (rp < 0) rp += n;
    for (let f = 0; f < frames; f++) {
      const dl = bufL[rp], dr = bufR[rp];
      lpL += 0.35 * (dl - lpL);
      lpR += 0.35 * (dr - lpR);
      bufL[pos] = (L[f] + R[f]) * 0.5 + fb * lpR; // new sound enters on the left
      bufR[pos] = fb * lpL;                       // and bounces to the right, then back
      L[f] += wet * dl;
      R[f] += wet * dr;
      energy += Math.abs(dl) + Math.abs(dr);
      if (++pos === n) pos = 0;
      if (++rp === n) rp = 0;
    }
    this.pos = pos; this.lpL = lpL; this.lpR = lpR;
    this.empty = false;
    return energy;
  }

  clear() {
    if (this.empty) return;
    this.bufL.fill(0);
    this.bufR.fill(0);
    this.lpL = this.lpR = 0;
    this.empty = true;
  }
}

class SoftSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice());
    this.reverb = new Reverb(this.sr);
    this.delay = new Delay(this.sr);
    this.fxIdle = true;
    this.limGain = 1; // output limiter: current gain, and how fast it drops (0.5 ms) and recovers (200 ms)
    this.limAttack = Math.exp(-1 / (0.0005 * this.sr));
    this.limRelease = Math.exp(-1 / (0.2 * this.sr));
    this.sustainDown = false;
    this.counter = 0;
    this.lastKey = -1;      // most recent key, where the next note glides from
    this.held = new Int16Array(128); // mono mode: keys held, newest last
    this.heldCount = 0;
    this.lfoPhase = 0;
    this.lfoHold = 0;       // current step of the random (sample & hold) LFO
    this.noiseSeed = 22222;

    this.p = null;
    this.partialCount = 0;
    this.ratio = new Float32Array(MAX_PARTIALS);
    this.level = new Float32Array(MAX_PARTIALS);
    this.velocityLevel = new Float32Array(MAX_PARTIALS);
    this.partialDecayCoef = new Float32Array(MAX_PARTIALS);
    this.bright = new Float32Array(MAX_PARTIALS);
    this.baseInc = new Float64Array(MAX_PARTIALS);
    this.lv = new Float32Array(MAX_PARTIALS);
    this.unisonCount = 1;
    this.unisonRatio = new Float64Array(MAX_UNISON);
    this.unisonL = new Float32Array(MAX_UNISON);
    this.unisonR = new Float32Array(MAX_UNISON);
    this.lfoBuf = new Float32Array(BLOCK); // LFO value per sample, shared by all voices
    this.vibBuf = new Float32Array(BLOCK); // pitch multiplier per sample from the LFO

    // messages arrive on the audio thread between process() calls
    this.port.onmessage = (e) => this.handle(e.data);
  }

  handle(m) {
    switch (m.type) {
      case 'params': this.apply(m.params, m.partials); break;
      case 'noteOn': if (this.p) this.noteOn(m.key, m.velocity); break;
      case 'noteOff': this.noteOff(m.key); break;
      case 'sustain':
        this.sustainDown = m.down;
        if (!m.down) {
          for (const v of this.voices) {
            if (v.active && v.sustained) { v.sustained = false; v.release(); }
          }
        }
        break;
      case 'allNotesOff':
        this.sustainDown = false;
        this.heldCount = 0;
        for (const v of this.voices) {
          if (v.active) { v.gate = false; v.sustained = false; v.release(); }
        }
        break;
    }
  }

  apply(p, partials) {
    const sr = this.sr;
    const coef = (seconds) => Math.exp(-1 / (Math.max(seconds, 0.001) * sr));
    const wasMono = this.p?.mono >= 0.5;
    this.p = p;
    this.mono = p.mono >= 0.5;
    if (this.mono && !wasMono) {
      // switching to mono: let everything but one voice ring out
      this.heldCount = 0;
      for (const v of this.voices) if (v.active && v.gate) { v.gate = false; v.release(); }
    }
    this.attackInc = 1 / (Math.max(p.attack, 0.001) * sr);
    this.decayCoef = coef(Math.max(p.decay, 0.01));
    this.releaseCoef = coef(Math.max(p.release, 0.01));
    this.fAttackInc = 1 / (Math.max(p.fAttack, 0.001) * sr);
    this.fDecayCoef = coef(p.fDecay);
    this.fReleaseCoef = coef(p.fRelease);
    this.glideCoef = p.glide > 0 ? Math.exp(-BLOCK / (p.glide * sr)) : 0; // per 128-sample block
    this.osc1Wave = Math.round(p.osc1Wave);
    // oscillator 2 has no partials of its own, so "harmonics" falls back to a sine
    this.osc2Wave = Math.round(p.osc2Wave) === HARMONICS ? SINE : Math.round(p.osc2Wave);
    this.lfoWave = Math.round(p.lfoWave);
    this.filterType = Math.round(p.filterType); // 0 low-pass, 1 band-pass, 2 high-pass
    // the filter only costs CPU when it can actually change the sound (a fully open low-pass does not)
    this.filterOn = !(this.filterType === 0 && p.cutoff >= 19999 && p.filterEnv === 0 && p.lfoFilter === 0
      && p.keyTrack === 0 && p.velFilter === 0);
    this.pitchDecayCoef = coef(p.pitchDecay);

    // unison: copies spread evenly in pitch (cents) and across the stereo field
    const n = Math.min(Math.max(Math.round(p.unison), 1), MAX_UNISON);
    const norm = 1 / Math.sqrt(n);
    this.unisonCount = n;
    for (let j = 0; j < n; j++) {
      const spread = n === 1 ? 0 : j / (n - 1) - 0.5; // -0.5 ... +0.5
      this.unisonRatio[j] = 2 ** ((spread * p.unisonDetune) / 1200);
      const pan = n === 1 ? 0 : spread * 2 * Math.min(Math.max(p.unisonWidth, 0), 1);
      this.unisonL[j] = norm * (1 - Math.max(pan, 0));
      this.unisonR[j] = norm * (1 + Math.min(pan, 0));
    }

    this.partialCount = Math.min(partials.length, MAX_PARTIALS);
    for (let k = 0; k < MAX_PARTIALS; k++) {
      const q = partials[k];
      this.ratio[k] = q ? q.ratio : 0;
      this.level[k] = q ? q.level : 0;
      this.velocityLevel[k] = q ? q.velocity : 0;
      this.partialDecayCoef[k] = q && q.decay > 0 ? Math.exp(-1 / (q.decay * sr)) : 1;
      // ratio == 1 is the fundamental; brightness scales every other partial
      this.bright[k] = this.ratio[k] === 1 ? 1 : p.brightness;
    }
    this.reverb.feedback = Math.min(Math.max(p.reverbSize, 0), 0.97);
    this.reverb.dampCoef = 1 - Math.min(Math.max(p.reverbDamp, 0), 0.99);
    this.reverb.wet = Math.max(p.reverb, 0);
    this.delay.wet = Math.max(p.delay, 0);
    this.delay.samples = Math.min(Math.max(Math.round(p.delayTime * sr), 1), this.delay.size - BLOCK);
    this.delay.feedback = Math.min(Math.max(p.delayFeedback, 0), 0.9);
  }

  /** Starts (or restarts) the envelopes of voice v for key at velocity vel. */
  trigger(v, key, vel) {
    const p = this.p;
    const note = key + Math.round(p.transpose);
    const vn = vel / 127;
    const keyScale = Math.min(Math.max(2 ** (-(note - 60) / 36), 0.55), 1.4); // tame high notes a little
    const pan = (Math.min(Math.max(note - 64, -64), 64) / 64) * 0.35;
    const sens = Math.min(Math.max(p.velocity, 0), 1);

    const retrigger = v.active;
    v.active = true;
    v.key = key;
    // with glide, start from the previous note's pitch
    if (!retrigger) v.pitch = p.glide > 0 && this.lastKey >= 0 ? this.lastKey : key;
    v.gate = true;
    v.sustained = false;
    v.stage = ATTACK;
    v.fStage = ATTACK;
    v.pEnv = 1;
    v.age = ++this.counter;
    v.gain = (1 - sens + sens * vn ** 1.6) * keyScale;
    v.panL = Math.cos(((pan + 1) * Math.PI) / 4);
    v.panR = Math.sin(((pan + 1) * Math.PI) / 4);
    v.vn = vn;
    v.amp.fill(1);
    if (!retrigger) {
      v.env = 0;
      v.fEnv = 0;
      v.resetPhases();
    }
  }

  noteOn(key, vel) {
    if (this.mono) {
      this.monoNoteOn(key, vel);
    } else {
      const voices = this.voices;
      // retrigger the voice already playing this key (keeps phase, so no click)
      let v = voices.find((x) => x.active && x.key === key);
      if (!v) v = voices.find((x) => !x.active);
      if (!v) {
        // no free voice: steal the quietest releasing voice, then the oldest one
        let best = voices[0], bestScore = Infinity;
        for (const x of voices) {
          const score = (x.stage === RELEASE ? 0 : 10) + x.env - (this.counter - x.age) * 1e-6;
          if (score < bestScore) { bestScore = score; best = x; }
        }
        v = best;
      }
      this.trigger(v, key, vel);
    }
    this.lastKey = key;
  }

  monoNoteOn(key, vel) {
    this.removeHeld(key);
    this.held[this.heldCount++] = key;
    const v = this.voices[0];
    for (let i = 1; i < MAX_VOICES; i++) {
      const x = this.voices[i];
      if (x.active && x.stage !== RELEASE) { x.gate = false; x.release(); }
    }
    if (v.active && v.gate) {
      v.key = key; // legato: another key is already held, so glide there without restarting the envelopes
    } else {
      this.trigger(v, key, vel);
    }
  }

  removeHeld(key) {
    let w = 0;
    for (let r = 0; r < this.heldCount; r++) if (this.held[r] !== key) this.held[w++] = this.held[r];
    this.heldCount = w;
  }

  noteOff(key) {
    if (this.mono) {
      this.removeHeld(key);
      const v = this.voices[0];
      if (!(v.active && v.gate && v.key === key)) return;
      if (this.heldCount > 0) {
        v.key = this.held[this.heldCount - 1]; // fall back to the key still held
        this.lastKey = v.key;
        return;
      }
    }
    for (const v of this.voices) {
      if (v.active && v.key === key && v.gate) {
        v.gate = false;
        if (this.sustainDown) v.sustained = true;
        else v.release();
      }
    }
  }

  /** Fills lfoBuf (−1...1) and vibBuf (pitch multiplier) for this block. */
  runLFO(frames, p, vibratoDepth) {
    const inc = p.vibratoRate / this.sr;
    const shape = this.lfoWave;
    let ph = this.lfoPhase;
    for (let f = 0; f < frames; f++) {
      let v;
      switch (shape) {
        case LFO_TRIANGLE: v = 1 - 4 * Math.abs(ph - 0.5); break;
        case LFO_SQUARE: v = ph < 0.5 ? 1 : -1; break;
        case LFO_SAW: v = 2 * ph - 1; break;
        case LFO_RANDOM: v = this.lfoHold; break;
        default: v = Math.sin(TWO_PI * ph);
      }
      this.lfoBuf[f] = v;
      this.vibBuf[f] = vibratoDepth > 0 ? 2 ** ((vibratoDepth * v) / 12) : 1;
      ph += inc;
      if (ph >= 1) {
        ph -= Math.floor(ph);
        this.lfoHold = Math.random() * 2 - 1; // new random step once per cycle
      }
    }
    this.lfoPhase = ph;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const p = this.p;
    if (!p) return true;
    const frames = L.length;
    const sr = this.sr;
    const count = this.partialCount;
    // transpose applies to sounding notes too (moving a strip does not cut them)
    const transpose = Math.round(p.transpose);
    const pitchOffset = transpose + p.bend - 69;
    const chorusRatio = 2 ** (p.detune / 1200);
    const osc2Ratio = 2 ** (Math.round(p.osc2Octave) + Math.round(p.osc2Semi) / 12 + p.osc2Detune / 1200);
    const lfoFilter = p.lfoFilter, lfoAmp = Math.min(Math.max(p.lfoAmp, 0), 1), lfoPwm = p.lfoPwm;
    const vibratoDepth = p.vibrato + Math.max(p.modWheel, 0); // the mod wheel adds vibrato on top of the preset's
    const useLfo = vibratoDepth > 0 || lfoFilter !== 0 || lfoAmp > 0 || lfoPwm !== 0;
    if (useLfo) this.runLFO(frames, p, vibratoDepth);
    const lfoBuf = this.lfoBuf, vibBuf = this.vibBuf;
    const sustain = p.sustain, fSustain = p.fSustain, filterEnvAmount = p.filterEnv;
    const osc1Wave = this.osc1Wave, osc2Wave = this.osc2Wave, pwBase = p.pulseWidth;
    const osc1Level = p.osc1Level * WAVE_GAIN[osc1Wave];
    const osc2Level = p.osc2Level * WAVE_GAIN[osc2Wave];
    const noiseLevel = p.noise; // full scale, like an oscillator: noise-based drums need the level
    const chorus = p.chorus;
    const filterOn = this.filterOn, filterType = this.filterType;
    const pitchEnvAmount = p.pitchEnv, pitchDecayCoef = this.pitchDecayCoef;
    const k = 2 - 2 * Math.min(Math.max(p.resonance, 0), 0.97); // SVF damping: 2 = none, → 0 = ringing
    const maxCutoff = 0.45 * sr;
    const { attackInc, decayCoef, releaseCoef, fAttackInc, fDecayCoef, fReleaseCoef, glideCoef } = this;
    const { ratio, level, velocityLevel, partialDecayCoef, bright, baseInc, lv } = this;
    const { unisonCount: un, unisonRatio, unisonL, unisonR } = this;
    let seed = this.noiseSeed;

    let anyActive = false;
    for (const v of this.voices) {
      if (!v.active) continue;
      // portamento: move the pitch a step toward the key once per block
      v.pitch = glideCoef > 0 ? v.key + (v.pitch - v.key) * glideCoef : v.key;
      if (Math.abs(v.pitch - v.key) < 1e-3) v.pitch = v.key;
      const note = v.pitch + transpose;
      const inc1 = (440 * 2 ** ((v.pitch + pitchOffset) / 12)) / sr;
      const inc2 = inc1 * osc2Ratio;
      const chorusInc = inc1 * chorusRatio;
      // levels are read every block so editing a partial is heard on notes that are already sounding
      if (osc1Wave === HARMONICS) {
        for (let q = 0; q < count; q++) {
          baseInc[q] = ratio[q] * inc1;
          lv[q] = (level[q] + velocityLevel[q] * v.vn) * bright[q];
        }
      }
      // cutoff in octaves (log2 Hz) before the envelope and LFO; follows the note and the velocity
      const cutoffBase = Math.log2(Math.max(p.cutoff, 20)) + (p.keyTrack * (note - 60)) / 12 + p.velFilter * v.vn;
      const phase = v.phase, amp = v.amp, u1 = v.u1, u2 = v.u2;
      let env = v.env, stage = v.stage, fEnv = v.fEnv, fStage = v.fStage, chorusPhase = v.chorusPhase, pEnv = v.pEnv;
      let l1 = v.l1, l2 = v.l2, r1 = v.r1, r2 = v.r2;
      const gain = v.gain, panL = v.panL, panR = v.panR;

      for (let f = 0; f < frames; f++) {
        // amp envelope
        if (stage === ATTACK) {
          env += attackInc;
          if (env >= 1) { env = 1; stage = DECAY; }
        } else if (stage === DECAY) {
          env = sustain + (env - sustain) * decayCoef;
        } else {
          env *= releaseCoef;
        }
        const lfo = useLfo ? lfoBuf[f] : 0;
        // pitch multiplier: LFO vibrato × pitch envelope (the start-of-note drop of kicks and toms)
        let pm = useLfo ? vibBuf[f] : 1;
        if (pitchEnvAmount !== 0) {
          pm *= 2 ** ((pitchEnvAmount * pEnv) / 12);
          pEnv *= pitchDecayCoef;
        }
        let pw = pwBase + lfoPwm * lfo;
        pw = pw < 0.05 ? 0.05 : pw > 0.95 ? 0.95 : pw;

        // oscillators; unison copies are summed separately for left and right
        let oscL = 0, oscR = 0;
        if (osc1Wave === HARMONICS) {
          let s = 0;
          for (let q = 0; q < count; q++) {
            s += lv[q] * amp[q] * Math.sin(TWO_PI * phase[q]);
            let ph = phase[q] + baseInc[q] * pm;
            if (ph >= 1) ph -= Math.floor(ph);
            phase[q] = ph;
            amp[q] *= partialDecayCoef[q];
          }
          oscL = oscR = s * osc1Level;
        } else if (osc1Level > 0) {
          for (let j = 0; j < un; j++) {
            const dt = inc1 * unisonRatio[j] * pm;
            const s = osc1Level * wave(osc1Wave, u1[j], dt, pw);
            oscL += s * unisonL[j];
            oscR += s * unisonR[j];
            let ph = u1[j] + dt;
            if (ph >= 1) ph -= Math.floor(ph);
            u1[j] = ph;
          }
        }
        if (osc2Level > 0) {
          for (let j = 0; j < un; j++) {
            const dt = inc2 * unisonRatio[j] * pm;
            const s = osc2Level * wave(osc2Wave, u2[j], dt, pw);
            oscL += s * unisonL[j];
            oscR += s * unisonR[j];
            let ph = u2[j] + dt;
            if (ph >= 1) ph -= Math.floor(ph);
            u2[j] = ph;
          }
        }
        // noise (xorshift, no allocation)
        if (noiseLevel > 0) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          const n = noiseLevel * (((seed >>> 0) / 4294967296) * 2 - 1);
          oscL += n;
          oscR += n;
        }
        const ch = chorus * Math.sin(TWO_PI * chorusPhase);
        chorusPhase += chorusInc * pm;
        if (chorusPhase >= 1) chorusPhase -= 1;
        // split the detuned copy unevenly between L/R for natural width
        let xl = oscL + 0.35 * ch;
        let xr = 0.85 * oscR + 0.65 * ch;

        if (filterOn) {
          // filter envelope
          if (fStage === ATTACK) {
            fEnv += fAttackInc;
            if (fEnv >= 1) { fEnv = 1; fStage = DECAY; }
          } else if (fStage === DECAY) {
            fEnv = fSustain + (fEnv - fSustain) * fDecayCoef;
          } else {
            fEnv *= fReleaseCoef;
          }
          // 12 dB/octave state-variable filter (Cytomic / Simper), stable while the cutoff moves.
          // It gives low-pass (v2), band-pass (k·v1, peak normalized to 1), and high-pass at once.
          let fc = 2 ** (cutoffBase + filterEnvAmount * fEnv + lfoFilter * lfo);
          if (fc > maxCutoff) fc = maxCutoff;
          else if (fc < 20) fc = 20;
          const g = Math.tan((Math.PI * fc) / sr);
          const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
          let v3 = xl - l2;
          let v1 = a1 * l1 + a2 * v3;
          let v2 = l2 + a2 * l1 + a3 * v3;
          l1 = 2 * v1 - l1;
          l2 = 2 * v2 - l2;
          xl = filterType === 0 ? v2 : filterType === 1 ? k * v1 : xl - k * v1 - v2;
          v3 = xr - r2;
          v1 = a1 * r1 + a2 * v3;
          v2 = r2 + a2 * r1 + a3 * v3;
          r1 = 2 * v1 - r1;
          r2 = 2 * v2 - r2;
          xr = filterType === 0 ? v2 : filterType === 1 ? k * v1 : xr - k * v1 - v2;
        }

        // amp: envelope × velocity, with the LFO dipping the volume for tremolo
        const g = env * gain * (1 - lfoAmp * (0.5 - 0.5 * lfo));
        L[f] += xl * g * panL;
        R[f] += xr * g * panR;
      }

      v.env = env; v.stage = stage; v.fEnv = fEnv; v.fStage = fStage; v.chorusPhase = chorusPhase; v.pEnv = pEnv;
      v.l1 = l1; v.l2 = l2; v.r1 = r1; v.r2 = r2;
      if (env < 1e-4 && (stage === RELEASE || (stage === DECAY && sustain < 1e-4))) v.active = false;
      anyActive ||= v.active;
    }
    this.noiseSeed = seed;

    if (anyActive) this.fxIdle = false;
    if (this.fxIdle) return true; // nearly free while silent

    // master: scale the voice sum, add the effects, then limit the peaks
    const vol = Math.max(p.volume, 0) * 0.25;
    for (let f = 0; f < frames; f++) {
      L[f] *= vol;
      R[f] *= vol;
    }
    let tail = 0;
    if (this.delay.wet > 0) tail += this.delay.process(L, R, frames);
    else this.delay.clear();
    tail += this.reverb.process(L, R, frames);
    this.limit(L, R, frames);
    // once no voice plays and the echoes and reverb have died out, stop processing effects
    if (!anyActive && tail < 1e-4) {
      this.fxIdle = true;
      this.delay.clear();
      this.reverb.clear();
    }
    return true;
  }

  /**
   * Peak limiter: turns the whole output down when it would exceed LIMIT (fast attack, slow release),
   * instead of bending the waveform. Bending (soft clipping) adds harmonics and, in chords,
   * intermodulation tones that belong to none of the notes; a slowly moving gain adds almost none.
   * A gentle knee above 0.9 only catches the brief overshoot of the attack.
   */
  limit(L, R, frames) {
    const LIMIT = 0.7;
    const attack = this.limAttack, release = this.limRelease;
    let g = this.limGain;
    for (let f = 0; f < frames; f++) {
      const peak = Math.max(Math.abs(L[f]), Math.abs(R[f]));
      const target = peak > LIMIT ? LIMIT / peak : 1;
      g = target + (g - target) * (target < g ? attack : release);
      L[f] = knee(L[f] * g);
      R[f] = knee(R[f] * g);
    }
    this.limGain = g;
  }
}

/** Leaves everything up to 0.9 untouched and rounds off anything above so the output stays below 1. */
function knee(y) {
  const m = Math.abs(y);
  if (m <= 0.9) return y;
  return Math.sign(y) * (0.9 + 0.1 * Math.tanh((m - 0.9) / 0.1));
}

registerProcessor('soft-synth', SoftSynthProcessor);
