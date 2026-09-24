// シンセ本体（サイン波の加算合成 + 軽量リバーブ）。AudioWorklet のオーディオスレッドで動く。
// process() 内ではメモリ確保をしない（GC による音切れを防ぐ）ため、状態はすべて事前確保した配列に持つ

const MAX_VOICES = 32;
const MAX_PARTIALS = 8;
const TWO_PI = 2 * Math.PI;
const ATTACK = 0, DECAY = 1, RELEASE = 2;

class Voice {
  constructor() {
    this.active = false;
    this.key = -1;          // 押された鍵盤（transpose 前）。noteOff の照合に使う
    this.gate = false;      // 鍵盤を押している
    this.sustained = false; // 離したがペダルで保持中
    this.stage = ATTACK;
    this.env = 0;
    this.gain = 0;
    this.panL = 0;
    this.panR = 0;
    this.phase = new Float64Array(MAX_PARTIALS);
    this.amp = new Float32Array(MAX_PARTIALS); // 各 partial の現在の音量（時間で減衰）
    this.chorusPhase = 0.25;
    this.age = 0;
  }
}

// 4 本の遅延線による軽量 FDN リバーブ。残響が消えたら idle になり処理を止める
class Reverb {
  constructor(sr) {
    this.lengths = [1557, 1617, 1491, 1422].map((n) => Math.floor((n * sr) / 44100));
    this.lines = this.lengths.map((n) => new Float32Array(n));
    this.pos = [0, 0, 0, 0];
    this.damp = new Float32Array(4);
    this.feedback = 0.8;
    this.dampCoef = 0.35; // ループ内ローパス（小さいほど残響が暗く柔らかい）
    this.wet = 0.22;
    this.idle = true;
  }

  process(L, R, frames, anyInput) {
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
      // Hadamard 行列で混ぜる
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
    if (!anyInput && energy < 1e-4) {
      this.idle = true;
      for (const line of this.lines) line.fill(0);
      damp.fill(0);
    }
  }
}

class SoftSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice());
    this.reverb = new Reverb(this.sr);
    this.sustainDown = false;
    this.counter = 0;
    this.lfoPhase = 0;

    this.p = null;
    this.partialCount = 0;
    this.ratio = new Float32Array(MAX_PARTIALS);
    this.level = new Float32Array(MAX_PARTIALS);
    this.velocityLevel = new Float32Array(MAX_PARTIALS);
    this.partialDecayCoef = new Float32Array(MAX_PARTIALS);
    this.bright = new Float32Array(MAX_PARTIALS);
    this.baseInc = new Float64Array(MAX_PARTIALS);
    this.a = new Float32Array(MAX_PARTIALS);

    // メッセージはオーディオスレッドで process() の合間に届く
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
            if (v.active && v.sustained) { v.sustained = false; v.stage = RELEASE; }
          }
        }
        break;
      case 'allNotesOff':
        this.sustainDown = false;
        for (const v of this.voices) {
          if (v.active) { v.gate = false; v.sustained = false; v.stage = RELEASE; }
        }
        break;
    }
  }

  apply(p, partials) {
    const sr = this.sr;
    this.p = p;
    this.attackInc = 1 / (Math.max(p.attack, 0.001) * sr);
    this.decayCoef = Math.exp(-1 / (Math.max(p.decay, 0.01) * sr));
    this.releaseCoef = Math.exp(-1 / (Math.max(p.release, 0.01) * sr));
    this.partialCount = Math.min(partials.length, MAX_PARTIALS);
    for (let k = 0; k < MAX_PARTIALS; k++) {
      const q = partials[k];
      this.ratio[k] = q ? q.ratio : 0;
      this.level[k] = q ? q.level : 0;
      this.velocityLevel[k] = q ? q.velocity : 0;
      this.partialDecayCoef[k] = q && q.decay > 0 ? Math.exp(-1 / (q.decay * sr)) : 1;
      // ratio == 1 の partial は基音、それ以外は brightness で量を変える
      this.bright[k] = this.ratio[k] === 1 ? 1 : p.brightness;
    }
    this.reverb.feedback = Math.min(Math.max(p.reverbSize, 0), 0.97);
    this.reverb.dampCoef = 1 - Math.min(Math.max(p.reverbDamp, 0), 0.99);
    this.reverb.wet = Math.max(p.reverb, 0);
  }

  noteOn(key, vel) {
    const voices = this.voices;
    this.counter++;
    // 同じ鍵盤が鳴っていればそのボイスを再トリガ（位相を保つのでクリックしない）
    let v = voices.find((x) => x.active && x.key === key);
    if (!v) v = voices.find((x) => !x.active);
    if (!v) {
      // 空きがなければ、リリース中で最も小さい音 → 最も古い音 を奪う
      let best = voices[0], bestScore = Infinity;
      for (const x of voices) {
        const score = (x.stage === RELEASE ? 0 : 10) + x.env - (this.counter - x.age) * 1e-6;
        if (score < bestScore) { bestScore = score; best = x; }
      }
      v = best;
    }

    const p = this.p;
    const note = key + Math.round(p.transpose);
    const vn = vel / 127;
    const keyScale = Math.min(Math.max(2 ** (-(note - 60) / 36), 0.55), 1.4); // 高音を少し抑える
    const pan = (Math.min(Math.max(note - 64, -64), 64) / 64) * 0.35;
    const sens = Math.min(Math.max(p.velocity, 0), 1);

    const retrigger = v.active;
    v.active = true;
    v.key = key;
    v.gate = true;
    v.sustained = false;
    v.stage = ATTACK;
    v.age = this.counter;
    v.gain = (1 - sens + sens * vn ** 1.6) * keyScale;
    v.panL = Math.cos(((pan + 1) * Math.PI) / 4);
    v.panR = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let k = 0; k < MAX_PARTIALS; k++) v.amp[k] = this.level[k] + this.velocityLevel[k] * vn;
    if (!retrigger) {
      v.env = 0;
      v.phase.fill(0);
      v.chorusPhase = 0.25;
    }
  }

  noteOff(key) {
    for (const v of this.voices) {
      if (v.active && v.key === key && v.gate) {
        v.gate = false;
        if (this.sustainDown) v.sustained = true;
        else v.stage = RELEASE;
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const p = this.p;
    if (!p) return true;
    const frames = L.length;
    const sr = this.sr;
    const count = this.partialCount;
    // transpose は鳴っている音にも即座に効かせる（ストリップで動かしても音が切れない）
    const pitchOffset = Math.round(p.transpose) + p.bend - 69;
    const chorusRatio = 2 ** (p.detune / 1200);
    const lfoInc = p.vibratoRate / sr;
    const vibDepth = p.vibrato;
    const sustain = p.sustain;
    const { attackInc, decayCoef, releaseCoef, ratio, partialDecayCoef, bright, baseInc, a } = this;

    let anyActive = false;
    for (const v of this.voices) {
      if (!v.active) continue;
      const freq = 440 * 2 ** ((v.key + pitchOffset) / 12);
      for (let k = 0; k < count; k++) baseInc[k] = (ratio[k] * freq) / sr;
      const chorusInc = (freq * chorusRatio) / sr;
      const phase = v.phase, amp = v.amp;
      let env = v.env, stage = v.stage, lfo = this.lfoPhase, chorusPhase = v.chorusPhase;
      const gain = v.gain, panL = v.panL, panR = v.panR;

      for (let f = 0; f < frames; f++) {
        if (stage === ATTACK) {
          env += attackInc;
          if (env >= 1) { env = 1; stage = DECAY; }
        } else if (stage === DECAY) {
          env = sustain + (env - sustain) * decayCoef;
        } else {
          env *= releaseCoef;
        }
        let vib = 1;
        if (vibDepth > 0) {
          vib = 2 ** ((vibDepth * Math.sin(TWO_PI * lfo)) / 12);
          lfo += lfoInc;
          if (lfo >= 1) lfo -= 1;
        }

        let main = 0;
        for (let k = 0; k < count; k++) {
          main += amp[k] * bright[k] * Math.sin(TWO_PI * phase[k]);
          let ph = phase[k] + baseInc[k] * vib;
          if (ph >= 1) ph -= Math.floor(ph);
          phase[k] = ph;
          amp[k] *= partialDecayCoef[k];
        }
        const ch = p.chorus * Math.sin(TWO_PI * chorusPhase);
        chorusPhase += chorusInc * vib;
        if (chorusPhase >= 1) chorusPhase -= 1;
        const g = env * gain;
        // デチューン成分を左右で配分を変えて自然な広がりを出す
        L[f] += (main + 0.35 * ch) * g * panL;
        R[f] += (0.85 * main + 0.65 * ch) * g * panR;
      }

      v.env = env;
      v.stage = stage;
      v.chorusPhase = chorusPhase;
      if (env < 1e-4 && (stage === RELEASE || (stage === DECAY && sustain < 1e-4))) v.active = false;
      anyActive ||= v.active;
    }
    if (vibDepth > 0) {
      this.lfoPhase += lfoInc * frames;
      this.lfoPhase -= Math.floor(this.lfoPhase);
    }

    if (anyActive) this.reverb.idle = false;
    if (this.reverb.idle) return true; // 無音時はほぼ何もしない

    // マスター: 同時押しで音割れしないよう tanh でソフトクリップ
    const vol = Math.max(p.volume, 0);
    for (let f = 0; f < frames; f++) {
      L[f] = Math.tanh(L[f] * 0.25) * vol;
      R[f] = Math.tanh(R[f] * 0.25) * vol;
    }
    this.reverb.process(L, R, frames, anyActive);
    return true;
  }
}

registerProcessor('soft-synth', SoftSynthProcessor);
