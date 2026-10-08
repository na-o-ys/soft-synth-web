// The FM page's controller: the edit buffer (one DX7 voice + performance values), its presets in the library,
// undo, session restore, the header buttons, .syx import / export, and MIDI / surface input while the page
// is in front.
import { bankSyx, parseSyx, voiceSyx } from './dx7.js';
import { mountFmPage } from './fm-page.js';
import {
  CONTINUOUS, PERF_DEFAULTS, cleanName, getParam, initOpOn, initVoice, isPerfParam, paramSpec, sanitizeVoice, setParam,
} from './voice.js';

const SESSION_KEY = 'soft-synth-web:fm-session';
const $ = (id) => document.getElementById(id);

// MARK: knob pages

const opParams = (fields) => (op) => fields.map((f) => `op${op}.${f}`);
/** Page groups of the FM page; operator pages follow the current operator. */
export const FM_PAGE_GROUPS = [
  { id: 'op', title: 'OP', params: opParams(['level', 'coarse', 'fine', 'detune', 'velocity', 'r1', 'r2', 'r4']) },
  { id: 'op eg', title: 'OP EG', params: opParams(['r1', 'r2', 'r3', 'r4', 'l1', 'l2', 'l3', 'l4']) },
  { id: 'op scale', title: 'OP SCALE', params: opParams(['breakPoint', 'leftDepth', 'rightDepth', 'leftCurve', 'rightCurve', 'rateScale', 'ams']) },
  { id: 'levels', title: 'LEVELS', params: () => [1, 2, 3, 4, 5, 6].map((n) => `op${n}.level`) },
  { id: 'voice', title: 'VOICE', params: () => ['algorithm', 'feedback', 'lfoSpeed', 'lfoDelay', 'lfoPmd', 'lfoAmd', 'lfoPms', 'transpose'] },
  { id: 'pitch eg', title: 'PITCH EG', params: () => ['pr1', 'pr2', 'pr3', 'pr4', 'pl1', 'pl2', 'pl3', 'pl4'] },
];

function fmPagesFor(knobs, op) {
  const n = Math.max(1, knobs);
  const pages = [];
  for (const g of FM_PAGE_GROUPS) {
    const params = g.params(op);
    const subs = Math.ceil(params.length / n);
    for (let sub = 0; sub < subs; sub++) pages.push({ group: g.id, title: g.title, sub, subs, params: params.slice(sub * n, (sub + 1) * n) });
  }
  return pages;
}

const norm = (spec, v) => (v - spec.min) / (spec.max - spec.min);
const denorm = (spec, name, x) => {
  const v = spec.min + x * (spec.max - spec.min);
  return CONTINUOUS.has(name) ? v : Math.round(v);
};

/**
 * hooks: log(text); startAudio(); onKeysNote(note, on) to light the on-screen keyboard;
 * presets() → the library's FM presets [{ name, voice }]; savePreset(name, voice) → stores one;
 * importPresets([{ name, voice }]) → stores several, returns the names used; nameTaken(name) → 'fm' | 'synth' | null;
 * knobCount() → the controller surface's knobs; knobBound(k) → whether knob k is learned; editActions() → the controller settings' "edit" pad / slider list;
 * onChange() after every change (the lessons drawer follows it).
 */
export function mountFm(root, hooks) {
  let voice = initVoice();
  const perf = { ...PERF_DEFAULTS, opOn: initOpOn() };
  let presetName = null; // the stored preset the buffer came from (null = a new voice)
  const history = []; // undo: { voice, presetName } before each change
  let lastUndoKey = null; // one undo step per knob gesture
  let lastUndoTime = 0;
  let node = null; // the fm-synth AudioWorkletNode once audio runs
  let pageIndex = 0;
  let pages = fmPagesFor(hooks.knobCount(), 1);
  const pickup = new Map(); // "page:knob" → soft takeover state

  const page = mountFmPage(root, {
    get: (name) => getParam(voice, perf, name),
    set: (name, v) => set(name, v),
    reset: (name) => reset(name),
    voice: () => voice,
    selectOp: (n) => selectOp(n),
    setName: (name) => setName(name),
    solo: (n) => solo(n),
  });

  // MARK: editing

  function remember(key) {
    const now = performance.now();
    if (key && key === lastUndoKey && now - lastUndoTime < 800) { lastUndoTime = now; return; }
    history.push({ voice: structuredClone(voice), presetName });
    if (history.length > 200) history.shift();
    lastUndoKey = key;
    lastUndoTime = now;
  }

  function set(name, v) {
    if (!paramSpec(name)) return;
    if (getParam(voice, perf, name) === v) return;
    if (!isPerfParam(name)) remember(name);
    setParam(voice, perf, name, v);
    push();
    changed();
  }

  function setName(name) {
    const clean = cleanName(name);
    if (clean === voice.name) return;
    remember('name');
    voice.name = clean;
    push();
    changed();
  }

  /** Solo: only operator n sounds; asked again (or for a soloed op), every operator sounds. */
  function solo(n) {
    const soloed = perf.opOn.every((on, i) => (i === n - 1 ? on : !on));
    perf.opOn = soloed ? initOpOn() : perf.opOn.map((_, i) => (i === n - 1 ? 1 : 0));
    push();
    changed();
  }

  function stored() {
    const p = presetName && hooks.presets().find((x) => x.name === presetName);
    return p ? sanitizeVoice(p.voice) : initVoice();
  }

  function reset(name) {
    set(name, isPerfParam(name) ? (/\.on$/.test(name) ? 1 : PERF_DEFAULTS[name]) : getParam(stored(), perf, name));
  }

  /** Loads a voice into the buffer (one undo step). */
  function load(v, name = null) {
    remember(null);
    voice = sanitizeVoice(v);
    presetName = name;
    perf.opOn = initOpOn();
    lastUndoKey = null;
    push();
    changed();
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return;
    voice = prev.voice;
    presetName = prev.presetName;
    lastUndoKey = null;
    push();
    changed();
  }

  function selectOp(n) {
    if (page.currentOp === n) return;
    page.setCurrentOp(n);
    pages = fmPagesFor(hooks.knobCount(), n);
    pickup.clear();
    changed();
  }

  // MARK: sound

  function push() {
    node?.port.postMessage({ type: 'voice', voice, perf });
  }

  function send(msg) {
    node?.port.postMessage(msg);
    if (msg.type === 'noteOn') hooks.onKeysNote(msg.key, true);
    else if (msg.type === 'noteOff') hooks.onKeysNote(msg.key, false);
  }

  /** One MIDI 1.0 channel message: notes, pedal, wheel, bend, aftertouch, volume. */
  function handle(status, d1, d2) {
    const kind = status & 0xf0;
    if (kind === 0x90 && d2 > 0) {
      hooks.startAudio();
      send({ type: 'noteOn', key: d1, velocity: d2 });
    } else if (kind === 0x90 || kind === 0x80) send({ type: 'noteOff', key: d1 });
    else if (kind === 0xb0 && d1 === 64) send({ type: 'sustain', on: d2 >= 64 });
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) panic();
    else if (kind === 0xb0 && d1 === 1) set('modWheel', d2 / 127);
    else if (kind === 0xb0 && d1 === 7) set('volume', d2 / 127);
    else if (kind === 0xd0) send({ type: 'aftertouch', value: d1 / 127 });
    else if (kind === 0xe0) send({ type: 'bend', value: (((d2 << 7) | d1) / 16383) * 2 - 1 });
  }

  /** An event from the controller surface: knobs play the current page; pads and sliders as configured. */
  function handleSurface(e, raw) {
    if (e.kind === 'knobs') return knob(e.index, e.value);
    const a = hooks.editActions().find((c) => (e.kind === 'pads'
      ? c.source.type === 'pad' && c.source.row === e.row && c.source.col === e.col
      : c.source.type === 'slider' && c.source.index === e.index));
    if (!a) {
      if (e.kind === 'sliders') handle(...raw);
      return;
    }
    const t = a.target;
    if (t.kind === 'pageKnob') return selectPage(Math.min(pages.length - 1, Math.floor(e.value * pages.length)));
    if (t.kind === 'param') {
      // sliders made for the Analog page: the mod wheel works the same; others are left to the Analog page
      if (t.param === 'modWheel') set('modWheel', e.value);
      return;
    }
    if (!e.pressed) return;
    switch (t.kind) {
      case 'page': {
        // the Analog page's page pads choose the FM page groups by position
        const ids = hooks.editActions().filter((c) => c.target.kind === 'page').map((c) => c.target.page);
        const g = FM_PAGE_GROUPS[ids.indexOf(t.page)];
        if (g) selectGroup(g.id);
        else selectOp((ids.indexOf(t.page) - FM_PAGE_GROUPS.length) % 6 + 1); // the rest choose the operator
        break;
      }
      case 'nextPage': selectPage((pageIndex + 1) % pages.length); break;
      case 'prevPage': selectPage((pageIndex + pages.length - 1) % pages.length); break;
      case 'undo': undo(); break;
      case 'savePreset': write(); break;
      case 'panic': panic(); break;
      case 'nextPreset': step(1); break;
      case 'prevPreset': step(-1); break;
      default: break;
    }
  }

  function knob(k, value) {
    const name = pages[pageIndex]?.params[k];
    if (!name) return;
    const spec = paramSpec(name);
    const key = `${pageIndex}:${k}:${name}`;
    const st = pickup.get(key) ?? {};
    pickup.set(key, st);
    const current = getParam(voice, perf, name);
    if (st.lastSent !== current) st.synced = false;
    const pos = Math.min(Math.max(norm(spec, current), 0), 1);
    let target = value;
    if (!st.synced && Math.abs(value - pos) < 0.02) st.synced = true;
    if (!st.synced) {
      // soft takeover by value scaling, as on the Analog page: no jumps, and the knob always responds
      const last = st.lastIn;
      st.lastIn = value;
      if (last === undefined || value === last) return;
      target = value > last ? pos + ((value - last) * (1 - pos)) / Math.max(1 - last, 1e-6) : pos - ((last - value) * pos) / Math.max(last, 1e-6);
      target = Math.min(Math.max(target, 0), 1);
      if (Math.abs(target - value) < 0.02) st.synced = true;
    }
    st.lastIn = value;
    set(name, denorm(spec, name, target));
    st.lastSent = getParam(voice, perf, name);
  }

  function selectPage(i) {
    if (i === pageIndex || !pages[i]) return;
    pageIndex = i;
    const p = pages[i];
    hooks.log(`FM page: ${p.subs > 1 ? `${p.group} ${p.sub + 1}/${p.subs}` : p.group}`);
    changed();
  }

  function selectGroup(id) {
    const first = pages.findIndex((p) => p.group === id);
    if (first < 0) return;
    const cur = pages[pageIndex];
    selectPage(cur.group === id ? first + ((cur.sub + 1) % cur.subs) : first);
  }

  function setKnobCount() {
    const group = pages[pageIndex]?.group;
    pages = fmPagesFor(hooks.knobCount(), page.currentOp);
    pageIndex = Math.max(0, pages.findIndex((p) => p.group === group));
    pickup.clear();
    changed();
  }

  function panic() {
    node?.port.postMessage({ type: 'allNotesOff' });
    hooks.onKeysNote(null, false);
  }

  // MARK: screen

  let dirty = false;
  function changed() {
    saveSession();
    hooks.onChange?.();
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(() => {
      dirty = false;
      render();
    });
  }

  function render() {
    page.update();
    const p = pages[pageIndex];
    // badges: which controller knob moves each control on the current page (only knobs that are learned)
    page.badges(Object.fromEntries((p?.params ?? []).map((name, k) => [name, hooks.knobBound(k) ? String(k + 1) : null])));
    const box = $('fm-pages');
    box.replaceChildren(...FM_PAGE_GROUPS.map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      const sub = p?.group === g.id && p.subs > 1 ? ` ${p.sub + 1}/${p.subs}` : '';
      b.textContent = (g.id.startsWith('op') ? g.title.replace('OP', `OP${page.currentOp}`) : g.title) + sub;
      b.classList.toggle('on', p?.group === g.id);
      b.onclick = () => selectGroup(g.id);
      return b;
    }));
    const presets = hooks.presets();
    const select = $('fm-preset-select');
    select.replaceChildren(new Option('— new voice —', ''), ...presets.map((x) => new Option(x.name, x.name)));
    select.options[0].hidden = presetName !== null;
    select.value = presetName ?? '';
    const i = presets.findIndex((x) => x.name === presetName);
    $('fm-preset-number').textContent = `${i < 0 ? '--' : String(i + 1).padStart(2, '0')}${isEdited() ? '*' : ''}`;
    $('fm-undo').disabled = !history.length;
  }

  const isEdited = () => JSON.stringify(stored()) !== JSON.stringify(voice);

  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ voice, perf, presetName, op: page.currentOp, page: pages[pageIndex]?.group })); } catch { /* not essential */ }
  }

  function restoreSession() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { /* start fresh */ }
    if (s?.voice) voice = sanitizeVoice(s.voice);
    if (s?.perf) for (const k of Object.keys(PERF_DEFAULTS)) if (Number.isFinite(s.perf[k])) perf[k] = s.perf[k];
    perf.bend = 0;
    perf.modWheel = 0;
    perf.aftertouch = 0;
    presetName = typeof s?.presetName === 'string' && hooks.presets().some((x) => x.name === s.presetName) ? s.presetName : null;
    if (Number.isInteger(s?.op) && s.op >= 1 && s.op <= 6) {
      page.setCurrentOp(s.op);
      pages = fmPagesFor(hooks.knobCount(), s.op);
    }
    pageIndex = Math.max(0, pages.findIndex((x) => x.group === s?.page));
    render();
  }

  // MARK: presets

  function choose(name) {
    const p = hooks.presets().find((x) => x.name === name);
    if (p) load(p.voice, p.name);
  }

  function step(d) {
    const presets = hooks.presets();
    if (!presets.length) return;
    const i = presets.findIndex((p) => p.name === presetName);
    const next = presets[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + presets.length) % presets.length];
    load(next.voice, next.name);
  }

  function write() {
    const name = prompt('Save this FM voice as:', presetName ?? voice.name.trim())?.trim();
    if (!name) return;
    const taken = hooks.nameTaken(name);
    if (taken === 'synth') return alert(`“${name}” is an Analog preset. Choose another name.`);
    if (name !== presetName && taken && !confirm(`An FM preset called “${name}” exists. Overwrite it?`)) return;
    hooks.savePreset(name, voice);
    presetName = name;
    changed();
  }

  // MARK: .syx

  function download(bytes, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function openSyx(file) {
    let parsed;
    try {
      parsed = parseSyx(new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      hooks.log(`.syx: ${file.name}: ${err.message}`);
      alert(`${file.name}: ${err.message}`);
      return;
    }
    const { voices, warnings } = parsed;
    hooks.log(`.syx: ${file.name}: ${voices.length} voice${voices.length > 1 ? 's' : ''}${warnings.length ? ` (${warnings.join('; ')})` : ''}`);
    // auditioning replaces the buffer; Close puts it back, Keep stays (one undo step)
    const before = { voice: structuredClone(voice), presetName };
    let auditioned = null;
    page.showBank({
      fileName: `${file.name} · ${voices.length} voice${voices.length > 1 ? 's' : ''}`,
      names: voices.map((v, i) => (voices.length > 32 ? `${Math.floor(i / 32) + 1}:` : '') + (v.name || '(no name)')),
      warning: warnings.join(' · '),
      onAudition: (i) => {
        auditioned = i;
        voice = structuredClone(voices[i]);
        presetName = null;
        perf.opOn = initOpOn();
        hooks.startAudio();
        push();
        changed();
      },
      onKeep: () => {
        if (auditioned === null) return;
        const v = voice;
        voice = before.voice;
        presetName = before.presetName;
        load(v, null);
      },
      onClose: () => {
        if (auditioned === null) return;
        voice = before.voice;
        presetName = before.presetName;
        push();
        changed();
      },
      onImport: (chosen) => {
        const names = hooks.importPresets(chosen.map((i) => ({ name: voices[i].name || 'voice', voice: voices[i] })));
        hooks.log(`.syx: imported ${names.length} voice${names.length > 1 ? 's' : ''}: ${names.join(', ')}`);
        changed();
      },
    });
  }

  $('fm-preset-select').onchange = (e) => choose(e.target.value);
  $('fm-preset-prev').onclick = () => step(-1);
  $('fm-preset-next').onclick = () => step(1);
  $('fm-new').onclick = () => load(initVoice(), null);
  $('fm-revert').onclick = () => (presetName ? choose(presetName) : load(initVoice(), null));
  $('fm-undo').onclick = undo;
  $('fm-save').onclick = write;
  $('fm-syx').onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) openSyx(file);
  };
  $('fm-export').onclick = () => {
    const presets = hooks.presets();
    const which = presets.length
      ? prompt(`Export as .syx:\n  v = this voice (single-voice dump)\n  1…${Math.ceil(presets.length / 32)} = bank of library FM presets (32 per bank)`, 'v')?.trim()
      : 'v';
    if (!which) return;
    if (which.toLowerCase() === 'v') return download(voiceSyx(voice), `${voice.name.trim() || 'voice'}.syx`);
    const b = Number(which);
    if (!Number.isInteger(b) || b < 1 || (b - 1) * 32 >= presets.length) return alert('No such bank');
    download(bankSyx(presets.slice((b - 1) * 32, b * 32).map((p) => sanitizeVoice(p.voice))), `fm-bank-${b}.syx`);
  };
  // drop a .syx anywhere on the page
  root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drop'); });
  root.addEventListener('dragleave', () => root.classList.remove('drop'));
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('drop');
    const file = e.dataTransfer.files[0];
    if (file) openSyx(file);
  });

  restoreSession();

  return {
    handle,
    handleSurface,
    panic,
    undo,
    render,
    refresh: render,
    setKnobCount,
    attachAudio(n) { node = n; push(); },
    get voice() { return voice; },
    get perf() { return perf; },
    get presetName() { return presetName; },
    page,
    load,
    /** A lesson's values on top of INIT VOICE (one undo step). */
    loadValues(values) {
      const v = initVoice();
      for (const [name, x] of Object.entries(values)) if (!isPerfParam(name)) setParam(v, perf, name, x);
      load(v, null);
    },
    set,
    get: (name) => getParam(voice, perf, name),
    selectOp,
  };
}
