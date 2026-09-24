// 受信した MIDI メッセージを設定の controls に従ってパラメータ操作・アクションに変換する
import { BUILTIN, DEFAULT_PARAMS, DEFAULT_PARTIALS, PARAMS, PERFORMANCE } from './config.js';

export class Controller {
  /**
   * @param {object} hooks
   * @param {(msg: object) => void} hooks.send   シンセ（AudioWorklet）へのメッセージ送信
   * @param {(line: string) => void} hooks.log
   * @param {() => void} hooks.onChange          パラメータ・プリセットが変わったとき（UI 更新用）
   */
  constructor({ send, log, onChange }) {
    this.send = send;
    this.log = log;
    this.onChange = onChange;
    this.config = BUILTIN;
    this.params = { ...DEFAULT_PARAMS };
    this.partials = DEFAULT_PARTIALS;
    this.presetIndex = 0;
  }

  get presetName() {
    return this.config.presets[this.presetIndex]?.name;
  }

  load(config) {
    const current = this.presetName;
    this.config = config;
    this.params = { ...DEFAULT_PARAMS, ...config.params };
    // 読み直し時は同名のプリセットがあればそれを維持する
    const name = config.presets.some((p) => p.name === current) ? current : config.initialPreset;
    this.selectPreset(Math.max(0, config.presets.findIndex((p) => p.name === name)));
  }

  /** 現在の状態をシンセへ送り直す（オーディオ開始直後など） */
  sync() {
    this.send({ type: 'params', params: this.params, partials: this.partials });
  }

  /** MIDI 1.0 のチャンネルメッセージを 1 つ処理する */
  handle(status, d1, d2) {
    const kind = status & 0xf0;
    const channel = status & 0x0f;
    if (this.config.logMIDI) this.log(`midi: ${describeMIDI(status, d1, d2)}`);

    let source, value, pressed;
    switch (kind) {
      case 0x90:
      case 0x80:
        source = { type: 'note', number: d1 };
        pressed = kind === 0x90 && d2 > 0;
        value = pressed ? 1 : 0;
        break;
      case 0xb0:
        source = { type: 'cc', number: d1 };
        value = d2 / 127;
        pressed = d2 > 0;
        break;
      case 0xe0:
        source = { type: 'pitchBend' };
        value = ((d2 << 7) | d1) / 16383;
        pressed = false;
        break;
      default:
        return;
    }

    let matched = false;
    for (const c of this.config.controls) {
      if (c.source.type !== source.type || c.source.number !== source.number) continue;
      if (c.channel !== null && c.channel !== channel) continue;
      matched = true;
      this.apply(c.target, value, pressed);
    }
    if (matched) return;

    // 割り当てのないメッセージは標準の MIDI として扱う
    if (kind === 0x90 && d2 > 0) this.send({ type: 'noteOn', key: d1, velocity: d2 });
    else if (kind === 0x90 || kind === 0x80) this.send({ type: 'noteOff', key: d1 });
    else if (kind === 0xb0 && d1 === 64) this.send({ type: 'sustain', down: d2 >= 64 });
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) this.send({ type: 'allNotesOff' });
  }

  apply(t, value, pressed) {
    const presets = this.config.presets;
    switch (t.kind) {
      case 'param': {
        let v = t.exponential ? t.min * (t.max / t.min) ** value : t.min + (t.max - t.min) * value;
        if (t.step > 0) v = Math.round(v / t.step) * t.step;
        this.setParam(t.param, v, t.step > 0); // 段階的な値（transpose 等）は変化をログに出す
        break;
      }
      case 'preset':
        if (pressed) this.selectPreset(presets.findIndex((p) => p.name === t.preset));
        break;
      case 'nextPreset':
        if (pressed) this.selectPreset((this.presetIndex + 1) % presets.length);
        break;
      case 'prevPreset':
        if (pressed) this.selectPreset((this.presetIndex + presets.length - 1) % presets.length);
        break;
      case 'set':
        if (pressed) this.setParam(t.param, t.value, true);
        break;
      case 'add':
        if (pressed) this.setParam(t.param, Math.min(Math.max(this.params[t.param] + t.value, t.min), t.max), true);
        break;
      case 'toggle':
        if (pressed) this.setParam(t.param, this.params[t.param] === t.on ? t.off : t.on, true);
        break;
      case 'panic':
        if (pressed) this.panic();
        break;
    }
  }

  setParam(p, v, announce = false) {
    v += 0; // -0 を 0 にする
    if (this.params[p] === v) return;
    this.params[p] = v;
    this.sync();
    if (announce) this.log(`${p} = ${+v.toFixed(4)}`);
    this.onChange();
  }

  selectPreset(i) {
    if (i < 0) return;
    this.presetIndex = i;
    const preset = this.config.presets[i];
    // 音色パラメータは 既定値 ← params ← プリセット の順で決める。演奏中の状態は引き継ぐ
    const next = { ...DEFAULT_PARAMS, ...this.config.params, ...preset.values };
    for (const p of PARAMS) if (PERFORMANCE.has(p)) next[p] = this.params[p];
    this.params = next;
    this.partials = preset.partials ?? DEFAULT_PARTIALS;
    this.sync();
    this.log(`preset: ${preset.name}`);
    this.onChange();
  }

  panic() {
    this.send({ type: 'allNotesOff' });
    this.log('panic');
  }
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
