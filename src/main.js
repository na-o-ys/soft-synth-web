// 画面と各部品の結線: オーディオ開始、MIDI 入力、設定の編集・保存、パラメータの表示と操作
import { BUILTIN, PARAMS, parseConfig } from './config.js';
import { Controller, describeMIDI } from './controller.js';
import { BluetoothMIDIInput, WebMIDIInput } from './midi.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'soft-synth-web:config';

// パラメータのスライダー範囲（exp は時間系など、対数的に動かしたいもの）
const SLIDERS = {
  volume: { min: 0, max: 1 },
  attack: { min: 0.001, max: 2, exp: true, unit: 's' },
  decay: { min: 0.05, max: 8, exp: true, unit: 's' },
  sustain: { min: 0, max: 1 },
  release: { min: 0.02, max: 5, exp: true, unit: 's' },
  brightness: { min: 0, max: 2 },
  chorus: { min: 0, max: 1 },
  detune: { min: 0, max: 30, unit: 'cent' },
  reverb: { min: 0, max: 0.8 },
  reverbSize: { min: 0, max: 0.97 },
  reverbDamp: { min: 0, max: 0.99 },
  vibrato: { min: 0, max: 1, unit: '半音' },
  vibratoRate: { min: 0.5, max: 10, unit: 'Hz' },
  transpose: { min: -24, max: 24, step: 1, unit: '半音' },
  bend: { min: -2, max: 2, unit: '半音' },
  velocity: { min: 0, max: 1 },
};

// MARK: ログ

const logLines = [];
function log(line) {
  const t = new Date().toLocaleTimeString();
  logLines.push(`[${t}] ${line}`);
  if (logLines.length > 300) logLines.splice(0, logLines.length - 300);
  const el = $('log');
  el.textContent = logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

// MARK: シンセ（AudioWorklet）

let audioContext = null;
let synthNode = null;

function send(msg) {
  synthNode?.port.postMessage(msg);
}

async function startAudio() {
  if (audioContext) {
    await audioContext.resume();
    return;
  }
  audioContext = new AudioContext({ latencyHint: 'interactive' });
  await audioContext.audioWorklet.addModule('src/synth-worklet.js');
  synthNode = new AudioWorkletNode(audioContext, 'soft-synth', {
    numberOfInputs: 0,
    outputChannelCount: [2],
  });
  synthNode.connect(audioContext.destination);
  controller.sync();
  audioContext.onstatechange = renderAudioStatus;
  renderAudioStatus();
  log(`audio started (${audioContext.sampleRate} Hz)`);
}

function renderAudioStatus() {
  const running = audioContext?.state === 'running';
  $('audio-status').textContent = running ? `再生中 ${audioContext.sampleRate / 1000} kHz` : '停止中';
  $('audio-status').classList.toggle('on', running);
  $('start').textContent = running ? '音が出ています' : '音を出す';
  $('start').disabled = running;
}

// MARK: コントローラーと UI 更新

let uiDirty = false;
const controller = new Controller({
  send,
  log,
  onChange: () => {
    // MIDI のノブを回すと大量に来るので描画はフレームごとにまとめる
    if (uiDirty) return;
    uiDirty = true;
    requestAnimationFrame(() => {
      uiDirty = false;
      renderPresets();
      renderParams();
    });
  },
});

function onMIDI(status, d1, d2) {
  if ($('monitor').checked) log(`midi: ${describeMIDI(status, d1, d2)}`);
  controller.handle(status, d1, d2);
}

function renderPresets() {
  const box = $('presets');
  const presets = controller.config.presets;
  if (box.childElementCount !== presets.length || box.dataset.names !== presets.map((p) => p.name).join()) {
    box.replaceChildren(...presets.map((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.onclick = () => controller.selectPreset(i);
      return b;
    }));
    box.dataset.names = presets.map((p) => p.name).join();
  }
  [...box.children].forEach((b, i) => b.classList.toggle('active', i === controller.presetIndex));
}

const toSlider = (s, v) => (s.exp ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min));
const fromSlider = (s, x) => {
  let v = s.exp ? s.min * (s.max / s.min) ** x : s.min + (s.max - s.min) * x;
  if (s.step) v = Math.round(v / s.step) * s.step;
  return v;
};
const format = (s, v) => `${s.step ? v : v.toFixed(v >= 10 ? 1 : v >= 1 ? 2 : 3)}${s.unit ? ` ${s.unit}` : ''}`;

function buildParams() {
  $('params').replaceChildren(...PARAMS.map((p) => {
    const s = SLIDERS[p];
    const wrap = document.createElement('div');
    wrap.className = 'param';
    wrap.innerHTML = `<label for="p-${p}">${p}<output id="o-${p}"></output></label>
      <input type="range" id="p-${p}" min="0" max="1000" step="1">`;
    wrap.querySelector('input').addEventListener('input', (e) => {
      controller.setParam(p, fromSlider(s, e.target.value / 1000));
    });
    return wrap;
  }));
}

function renderParams() {
  for (const p of PARAMS) {
    const s = SLIDERS[p];
    const v = controller.params[p];
    const input = $(`p-${p}`);
    if (document.activeElement !== input) {
      input.value = Math.round(Math.min(Math.max(toSlider(s, v), 0), 1) * 1000);
    }
    $(`o-${p}`).textContent = format(s, v);
  }
}

// MARK: 設定

function storageGet() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function storageSet(text) {
  try { localStorage.setItem(STORAGE_KEY, text); } catch { /* 保存できなくても動作は続ける */ }
}

async function fetchTemplate(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

function applyConfigText(text, { save }) {
  const err = $('config-error');
  try {
    const config = parseConfig(text);
    controller.load(config);
    err.hidden = true;
    if (save) {
      storageSet(text);
      log('config saved');
    }
    return true;
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    log(`config error: ${e.message}`);
    return false;
  }
}

async function initConfig() {
  let text = storageGet();
  if (!text) {
    try {
      text = await fetchTemplate($('config-template').value);
    } catch (e) {
      log(`config template not found (${e.message}), using built-in defaults`);
      controller.load(BUILTIN);
      return;
    }
  }
  $('config-text').value = text;
  if (!applyConfigText(text, { save: false })) controller.load(BUILTIN);
}

// MARK: MIDI 入力

const webMIDI = new WebMIDIInput({ onMessage: onMIDI, onDevicesChange: renderInputs, log });
const bleMIDI = new BluetoothMIDIInput({
  onMessage: onMIDI,
  log,
  onStatus: (s) => {
    const labels = { connecting: '接続中…', connected: '接続済み', reconnecting: '再接続を待っています…', disconnected: '' };
    $('ble-status').textContent = bleMIDI.device ? `${bleMIDI.device.name}: ${labels[s]}` : labels[s];
    $('ble-connect').textContent = bleMIDI.device ? '切断' : 'Bluetooth MIDI 鍵盤に接続';
    renderInputs();
  },
});

function renderInputs() {
  const list = $('midi-inputs');
  const inputs = webMIDI.inputs;
  if (!webMIDI.supported) {
    list.innerHTML = '<li class="muted">このブラウザは Web MIDI に対応していません（Chrome / Edge / Firefox を使ってください）</li>';
    return;
  }
  if (!webMIDI.access) return;
  if (inputs.length === 0) {
    list.innerHTML = '<li class="muted">MIDI 鍵盤が見つかりません（接続すると自動で表示されます）</li>';
    return;
  }
  list.replaceChildren(...inputs.map((i) => {
    const li = document.createElement('li');
    li.textContent = i.name + (i.ignored ? '（Bluetooth で直接接続中のため無視）' : '');
    if (i.ignored) li.className = 'muted';
    return li;
  }));
}

async function startMIDI() {
  if (!webMIDI.supported || webMIDI.access) return;
  try {
    await webMIDI.start();
  } catch (e) {
    log(`MIDI access denied: ${e.message}`);
    $('midi-inputs').innerHTML = '<li class="muted">MIDI へのアクセスが許可されませんでした</li>';
  }
}

// MARK: PC キーボードで演奏

const KEYS = 'awsedftgyhujk';
let octave = 0;
const keyNotes = new Map(); // 押しているキー → 鳴らした音（オクターブ切替後も正しく止めるため）

function isTyping(e) {
  return e.target.closest('textarea, input:not([type=range]), select');
}

addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || isTyping(e)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'x') {
    octave = Math.min(Math.max(octave + (k === 'x' ? 12 : -12), -36), 36);
    log(`keyboard octave ${octave >= 0 ? '+' : ''}${octave / 12}`);
    return;
  }
  const i = KEYS.indexOf(k);
  if (i < 0) return;
  const note = 60 + octave + i;
  keyNotes.set(k, note);
  startAudio();
  controller.handle(0x90, note, 90);
});

addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (!keyNotes.has(k)) return;
  controller.handle(0x80, keyNotes.get(k), 0);
  keyNotes.delete(k);
});

// MARK: 起動

buildParams();
$('start').onclick = async () => {
  await startAudio();
  await startMIDI();
};
$('panic').onclick = () => controller.panic();
$('config-apply').onclick = () => applyConfigText($('config-text').value, { save: true });
$('config-load').onclick = async () => {
  try {
    $('config-text').value = await fetchTemplate($('config-template').value);
    $('config-error').hidden = true;
  } catch (e) {
    log(`template load failed: ${e.message}`);
  }
};

if (!bleMIDI.supported) {
  $('ble-connect').disabled = true;
  $('ble-status').textContent = 'このブラウザは Web Bluetooth に対応していません（Chrome / Edge）';
}
$('ble-connect').onclick = async () => {
  if (bleMIDI.device) {
    webMIDI.ignoredNames.delete(bleMIDI.device.name);
    bleMIDI.disconnect();
    return;
  }
  try {
    await bleMIDI.connect();
    // OS 側でも同じ鍵盤がつながっていると二重に鳴るので、Web MIDI 側の同名入力は無視する
    webMIDI.ignoredNames.add(bleMIDI.device.name);
    renderInputs();
  } catch (e) {
    if (e.name !== 'NotFoundError') log(`bluetooth: ${e.message}`); // NotFoundError = 選択をキャンセル
    bleMIDI.device = null;
    bleMIDI.setStatus('disconnected');
  }
};

renderAudioStatus();
initConfig();
