// The FM page: a DX7-style panel — algorithm diagram, global section (feedback, pitch EG, LFO), and six
// operator strips with their envelopes and keyboard scaling drawn as small LCD graphs.
import { Knob } from '../panel.js';
import { PITCH_LEVELS, PITCH_RATES, levelScaling, segmentTime } from './tables.js';
import { ALGORITHMS, CONTINUOUS, OSC_MODES, algorithmLayout, formatParam, opFrequencyText, paramSpec } from './voice.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A knob showing DX7 values (0–99, note names, curve names) instead of the subtractive panel's units. */
class FmKnob extends Knob {
  constructor(name, api, label, size = 'sm') {
    const s = paramSpec(name);
    super(name, { min: s.min, max: s.max, step: CONTINUOUS.has(name) ? undefined : 1 }, label ?? s.label, api, { size });
    this.voice = () => api.voice?.();
  }

  update(v) {
    super.update(v);
    const text = formatParam(this.name, v, this.voice());
    this.valueEl.textContent = text;
    this.dial.setAttribute('aria-valuetext', text);
  }
}

/** A row of text buttons choosing one value (osc mode, LFO wave, on / off). */
class Choice {
  constructor(name, labels, api, title) {
    this.name = name;
    this.el = el('div', 'switch fm-choice');
    this.el.setAttribute('role', 'radiogroup');
    this.el.setAttribute('aria-label', title ?? name);
    this.buttons = labels.map((label, i) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.onclick = () => api.set(name, i);
      return b;
    });
    this.badgeEl = el('span', 'knob-badge switch-badge');
    this.badgeEl.hidden = true;
    this.el.append(...this.buttons, this.badgeEl);
  }

  update(v) {
    this.buttons.forEach((b, i) => {
      b.classList.toggle('on', i === v);
      b.setAttribute('aria-checked', String(i === v));
    });
  }

  badge(text) {
    this.badgeEl.hidden = !text;
    this.badgeEl.textContent = text ?? '';
  }
}

/** A module box with a title (hint on hover) and a body. */
function module(title, hint, cls = '') {
  const m = el('section', `module fm-module ${cls}`);
  const h = el('h3', '', title);
  h.tabIndex = 0;
  if (hint) h.title = hint;
  const body = el('div', 'module-body');
  m.append(h, body);
  return { el: m, title: h, body };
}

function group(label, ...children) {
  const g = el('div', 'fm-group');
  if (label) g.append(el('div', 'fm-group-label', label));
  const row = el('div', 'fm-group-body');
  row.append(...children);
  g.append(row);
  return g;
}

function lcdCanvas(cls, caption) {
  const f = el('figure', `lcd fm-graph ${cls}`);
  if (caption) f.append(el('figcaption', '', caption));
  const c = el('canvas');
  f.append(c);
  return { el: f, canvas: c };
}

// MARK: graphs

const LCD = { bg: '#17130c', grid: '#3b2f1b', line: '#f2a541', dim: '#6b4d24', text: '#b8955a' };

function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 120, h = canvas.clientHeight || 48;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

const pitchTime = (rate, from, to) => (Math.abs(PITCH_LEVELS[to] - PITCH_LEVELS[from]) / 32) / (PITCH_RATES[rate] / 21.3);

/** Draws a 4-rate / 4-level envelope: attack from L4 through L1, L2 to L3 (held), then release to L4. */
function drawEG(canvas, r, l, { pitch = false } = {}) {
  const { g, w, h } = prepare(canvas);
  const center = pitch;
  const time = pitch ? (i, a, b) => pitchTime(r[i], a, b) : (i, a, b) => segmentTime(r[i], b - a);
  const t = [time(0, l[3], l[0]), time(1, l[0], l[1]), time(2, l[1], l[2])];
  const rel = time(3, l[2], l[3]);
  const hold = Math.max(0.15, (t[0] + t[1] + t[2]) * 0.3);
  // compress long segments so a slow release does not squash the attack into a line
  const squash = (x) => Math.sqrt(x);
  const xs = [0, t[0], t[1], t[2], hold, rel].map(squash);
  const total = xs.reduce((a, b) => a + b, 0) || 1;
  const pad = 3;
  const X = (x) => pad + (x / total) * (w - 2 * pad);
  const Y = pitch ? (lv) => h / 2 - (PITCH_LEVELS[lv] / 128) * (h / 2 - pad) : (lv) => h - pad - (lv / 99) * (h - 2 * pad);
  g.strokeStyle = LCD.grid;
  g.lineWidth = 1;
  if (center) {
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  }
  const pts = [[0, l[3]], [xs[1], l[0]], [xs[2], l[1]], [xs[3], l[2]], [xs[4], l[2]], [xs[5], l[3]]];
  let x = 0;
  g.strokeStyle = LCD.line;
  g.lineWidth = 1.5;
  g.beginPath();
  pts.forEach(([dx, lv], i) => {
    x += dx;
    if (i === 0) g.moveTo(X(x), Y(lv)); else g.lineTo(X(x), Y(lv));
  });
  g.stroke();
  // key-off marker
  const off = X(xs.slice(0, 5).reduce((a, b) => a + b, 0));
  g.strokeStyle = LCD.dim;
  g.setLineDash([2, 2]);
  g.beginPath(); g.moveTo(off, 0); g.lineTo(off, h); g.stroke();
  g.setLineDash([]);
}

function drawScaling(canvas, op) {
  const { g, w, h } = prepare(canvas);
  const pad = 3;
  const X = (n) => pad + (n / 127) * (w - 2 * pad);
  const Y = (d) => h / 2 - (Math.max(-127, Math.min(127, d)) / 127) * (h / 2 - pad);
  g.strokeStyle = LCD.grid;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  const bp = op.breakPoint + 21;
  g.strokeStyle = LCD.dim;
  g.setLineDash([2, 2]);
  g.beginPath(); g.moveTo(X(bp), 0); g.lineTo(X(bp), h); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = LCD.line;
  g.lineWidth = 1.5;
  g.beginPath();
  for (let n = 0; n <= 127; n++) {
    const y = Y(levelScaling(op, n));
    if (n === 0) g.moveTo(X(n), y); else g.lineTo(X(n), y);
  }
  g.stroke();
}

/** Draws the algorithm: operator boxes (carriers on the bottom row), modulation lines, the feedback loop. */
function drawAlgorithm(svg, n, { current, levels, onSelect }) {
  svg.replaceChildren();
  const alg = ALGORITHMS[n - 1];
  const { pos, width, height } = algorithmLayout(n);
  const box = 26, gapX = 40, gapY = 38, padX = 18, padY = 16;
  const W = padX * 2 + (width - 1) * gapX + box, H = padY * 2 + (height - 1) * gapY + box + 12;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const cx = (op) => padX + pos[op].x * gapX + box / 2;
  const cy = (op) => H - padY - 12 - pos[op].y * gapY - box / 2;
  const add = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e);
    return e;
  };
  // output bus under the carriers
  const carrierXs = alg.carriers.map(cx);
  const busY = H - padY + 2;
  add('line', { x1: Math.min(...carrierXs), y1: busY, x2: Math.max(...carrierXs), y2: busY, class: 'fm-alg-bus' });
  for (const c of alg.carriers) add('line', { x1: cx(c), y1: cy(c) + box / 2, x2: cx(c), y2: busY, class: 'fm-alg-bus' });
  for (const [from, to] of alg.edges) {
    add('line', { x1: cx(from), y1: cy(from) + box / 2, x2: cx(to), y2: cy(to) - box / 2, class: 'fm-alg-edge' });
  }
  // feedback: a loop from the bottom of `from` back to the top of `to`, on the right side
  const [ff, ft] = alg.fb;
  const right = Math.max(cx(ff), cx(ft)) + box / 2 + 7;
  add('path', {
    d: `M${cx(ff)} ${cy(ff) + box / 2} V${cy(ff) + box / 2 + 6} H${right} V${cy(ft) - box / 2 - 6} H${cx(ft)} V${cy(ft) - box / 2}`,
    class: 'fm-alg-fb',
  });
  for (let op = 1; op <= 6; op++) {
    const g = add('g', { class: `fm-alg-op${op === current ? ' current' : ''}${alg.carriers.includes(op) ? ' carrier' : ''}`, tabindex: '0', role: 'button', 'aria-label': `Operator ${op}` });
    add('rect', { x: cx(op) - box / 2, y: cy(op) - box / 2, width: box, height: box, rx: 3 }, g);
    const lv = levels?.[op - 1] ?? 0;
    add('rect', { x: cx(op) - box / 2, y: cy(op) + box / 2 - (box * lv) / 99, width: box, height: (box * lv) / 99, rx: 3, class: 'fm-alg-level' }, g);
    const t = add('text', { x: cx(op), y: cy(op) + 4.5, 'text-anchor': 'middle' }, g);
    t.textContent = String(op);
    g.addEventListener('click', () => onSelect(op));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { onSelect(op); e.preventDefault(); } });
  }
}

// MARK: the page

/**
 * Mounts the FM page into `root`. hooks:
 *   get(name) / set(name, value): read / write a flat parameter ("op2.level", "algorithm", "volume")
 *   reset(name): back to the stored preset's value
 *   voice(): the edit buffer (for graphs); selectOp(n): make operator n current
 *   loadSyx(file), exportSyx(), newVoice(), write(), revert(), undo(), stepPreset(±1), choosePreset(name)
 */
export function mountFmPage(root, hooks) {
  const widgets = new Map(); // name → widgets showing it
  const api = {
    get: (name) => hooks.get(name),
    set: (name, v) => hooks.set(name, v),
    reset: (name) => hooks.reset(name),
    voice: () => hooks.voice(),
  };
  const knob = (name, label, size) => {
    const k = new FmKnob(name, api, label, size);
    track(name, k);
    return k.el;
  };
  const choice = (name, labels, title) => {
    const c = new Choice(name, labels, api, title);
    track(name, c);
    return c.el;
  };
  function track(name, w) {
    if (!widgets.has(name)) widgets.set(name, []);
    widgets.get(name).push(w);
  }

  root.replaceChildren();

  // row 1: how the operators connect, and the six operators at a glance (ratio, level, envelope shape)
  const top = el('div', 'modules fm-top');

  const algM = module('ALGORITHM', 'How the six operators connect. An operator above another modulates it (bends its phase, adding harmonics); operators on the bottom row are carriers — the ones you hear. The loop marks the operator with feedback.', 'fm-alg-module');
  const algSvg = document.createElementNS(SVG_NS, 'svg');
  algSvg.classList.add('fm-alg');
  const algNav = el('div', 'fm-alg-nav');
  const algPrev = el('button', '', '◀');
  algPrev.type = 'button';
  algPrev.setAttribute('aria-label', 'Previous algorithm');
  const algNext = el('button', '', '▶');
  algNext.type = 'button';
  algNext.setAttribute('aria-label', 'Next algorithm');
  const algNum = el('span', 'lcd fm-alg-num');
  algPrev.onclick = () => hooks.set('algorithm', Math.max(1, hooks.get('algorithm') - 1));
  algNext.onclick = () => hooks.set('algorithm', Math.min(32, hooks.get('algorithm') + 1));
  algNav.append(algPrev, algNum, algNext);
  const algFigure = el('div', 'lcd fm-alg-screen');
  algFigure.append(algSvg);
  algM.body.append(
    group('', algFigure),
    group('', algNav, knob('algorithm', 'algo', 'sm'), knob('feedback', 'feedback', 'md'), choice('oscSync', ['free', 'sync'], 'Oscillator key sync')),
  );

  const ovM = module('OPERATORS', 'The six operators side by side: frequency ratio, level, and envelope shape. Carriers (the ones you hear) are amber; modulators shape the tone of the operators below them. Click one to edit it in detail below.', 'fm-overview');
  const strips = [];
  const stripRow = el('div', 'fm-strips');
  for (let n = 1; n <= 6; n++) {
    const col = el('div', 'fm-strip');
    col.dataset.op = String(n);
    const head = el('div', 'fm-strip-head');
    const onBtn = el('button', 'fm-op-on', 'on');
    onBtn.type = 'button';
    onBtn.title = 'Mute / unmute this operator (not stored in the voice). Alt-click: solo';
    onBtn.onclick = (e) => {
      e.stopPropagation();
      if (e.altKey) hooks.solo(n);
      else hooks.set(`op${n}.on`, hooks.get(`op${n}.on`) ? 0 : 1);
    };
    head.append(el('span', 'fm-strip-name', `OP ${n}`), onBtn);
    const role = el('div', 'fm-op-role');
    const freq = el('div', 'lcd fm-op-freq');
    const eg = lcdCanvas('fm-graph-thumb');
    col.append(head, role, freq, knob(`op${n}.coarse`, 'ratio', 'sm'), knob(`op${n}.level`, 'level', 'md'), eg.el);
    col.addEventListener('pointerdown', () => hooks.selectOp(n));
    stripRow.append(col);
    strips.push({ el: col, role, freq, onBtn, eg: eg.canvas });
  }
  ovM.body.append(stripRow);
  top.append(algM.el, ovM.el);

  // row 2: the selected operator in detail (one panel per operator; only the selected one is shown)
  const detailBox = el('div', 'fm-detail-box');
  const details = [];
  for (let n = 1; n <= 6; n++) {
    const p = `op${n}.`;
    const m = module(`OP ${n}`, `Operator ${n} in detail. As a carrier its level is loudness; as a modulator its level is brightness. The envelope shapes that over time: from L4 to L1 at rate R1, on to L2 at R2, to L3 at R3 while the key is held, back to L4 at R4 on release.`, 'fm-op fm-detail');
    m.el.dataset.op = String(n);
    m.el.hidden = n !== 1;
    const role = el('span', 'fm-op-role');
    const freq = el('span', 'lcd fm-op-freq');
    m.title.append(role, freq);
    const eg = lcdCanvas('fm-graph-big');
    const scl = lcdCanvas('fm-graph-scl');
    const adv = el('details', 'fm-advanced');
    const sum = el('summary', '', 'More: keyboard scaling, rate scaling, amp mod');
    adv.append(sum,
      el('p', 'fm-advanced-note', 'Rarely needed at first. Scaling makes the operator louder or softer, and its envelope faster, towards the ends of the keyboard; amp mod lets the LFO reach it.'),
      Object.assign(el('div', 'module-body'), {}),
    );
    adv.lastChild.append(
      group('keyboard scaling', scl.el),
      group('', knob(`${p}breakPoint`, 'break pt'), knob(`${p}leftDepth`, 'L depth'), knob(`${p}leftCurve`, 'L curve'), knob(`${p}rightDepth`, 'R depth'), knob(`${p}rightCurve`, 'R curve')),
      group('', knob(`${p}rateScale`, 'rate scl'), knob(`${p}ams`, 'amp mod')),
    );
    m.body.append(
      group('envelope', eg.el),
      group('rate', knob(`${p}r1`), knob(`${p}r2`), knob(`${p}r3`), knob(`${p}r4`)),
      group('level', knob(`${p}l1`), knob(`${p}l2`), knob(`${p}l3`), knob(`${p}l4`)),
      group('frequency', choice(`${p}mode`, OSC_MODES, 'Oscillator mode'), knob(`${p}coarse`, 'coarse'), knob(`${p}fine`, 'fine'), knob(`${p}detune`, 'detune')),
      group('output', knob(`${p}level`, 'level', 'md'), knob(`${p}velocity`, 'velocity')),
      adv,
    );
    detailBox.append(m.el);
    details.push({ el: m.el, role, freq, eg: eg.canvas, scl: scl.canvas });
  }

  // row 3: voice-wide sections; the less used ones folded (click a title to open)
  const pegM = module('PITCH EG', 'An envelope on the pitch of every operator: level 50 is no change; above bends up, below bends down. Brass "blips", drops, and swoops.');
  const pegGraph = lcdCanvas('fm-graph-wide');
  pegM.body.append(
    group('', pegGraph.el),
    group('rate', knob('pr1'), knob('pr2'), knob('pr3'), knob('pr4')),
    group('level', knob('pl1'), knob('pl2'), knob('pl3'), knob('pl4')),
  );

  const lfoM = module('LFO', 'A slow oscillator for vibrato (pitch mod) and tremolo / wah (amp mod — reaches only operators with AMP MOD sensitivity above 0). The mod wheel adds pitch mod on top of PITCH MOD.');
  lfoM.body.append(
    el('div', 'module-switch'),
    group('', knob('lfoSpeed', 'speed', 'md'), knob('lfoDelay', 'delay', 'md'), knob('lfoPmd', 'pitch mod', 'md'), knob('lfoAmd', 'amp mod', 'md'), knob('lfoPms', 'pitch sens', 'md')),
    group('', choice('lfoSync', ['free', 'key sync'], 'LFO key sync')),
  );
  lfoM.body.firstChild.append(choice('lfoWave', ['tri', 'saw↓', 'saw↑', 'sqr', 'sine', 'S&H'], 'LFO wave'));

  const voiceM = module('VOICE', 'The voice name (10 characters, stored in the voice and in .syx files) and transpose (C3 = none).');
  const nameInput = el('input', 'lcd fm-name');
  nameInput.type = 'text';
  nameInput.maxLength = 10;
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', 'Voice name');
  nameInput.oninput = () => hooks.setName(nameInput.value);
  voiceM.body.append(group('name', nameInput), group('', knob('transpose', 'trans', 'md')));

  const perfM = module('PERFORMANCE', 'Not part of the voice (the DX7 keeps these in its function settings): volume, reverb, pitch bend range, where the mod wheel and aftertouch go, mono with portamento.');
  perfM.body.append(
    group('', knob('volume', 'volume', 'md'), knob('reverb', 'reverb', 'md'), knob('bendRange', 'bend', 'md')),
    group('mod wheel', knob('modWheel', 'wheel'), knob('wheelPitch', 'pitch'), knob('wheelAmp', 'amp')),
    group('aftertouch', knob('atPitch', 'pitch'), knob('atAmp', 'amp')),
    group('', choice('mono', ['poly', 'mono'], 'Poly / mono'), knob('portamento', 'porta')),
  );

  const fold = (m, folded) => {
    m.el.classList.add('foldable');
    m.el.classList.toggle('folded', folded);
    m.title.addEventListener('click', () => m.el.classList.toggle('folded'));
  };
  fold(pegM, true);
  fold(lfoM, true);
  fold(perfM, true);
  const more = el('div', 'modules fm-more');
  more.append(voiceM.el, lfoM.el, pegM.el, perfM.el);

  root.append(top, detailBox, more);

  // the .syx bank browser
  const dialog = el('dialog', 'fm-bank');
  dialog.innerHTML = `
    <form method="dialog" class="fm-bank-form">
      <header><h2>.syx bank</h2><span class="fm-bank-file muted"></span></header>
      <p class="fm-bank-note muted">Click a voice to try it on the keyboard. Close puts your previous sound back; Keep stays on the voice you tried. Tick voices and Import them into the library.</p>
      <ol class="fm-bank-list"></ol>
      <p class="fm-bank-warn error" hidden></p>
      <footer>
        <label><input type="checkbox" class="fm-bank-all"> all</label>
        <button type="button" class="fm-bank-import primary">Import</button>
        <button type="button" class="fm-bank-keep">Keep</button>
        <button value="close">Close</button>
      </footer>
    </form>`;
  root.append(dialog);

  let currentOp = 1;

  function update() {
    for (const [name, ws] of widgets) {
      const v = hooks.get(name);
      for (const w of ws) w.update(v);
    }
    const voice = hooks.voice();
    const alg = ALGORITHMS[voice.algorithm - 1];
    algNum.textContent = String(voice.algorithm).padStart(2, '0');
    drawAlgorithm(algSvg, voice.algorithm, {
      current: currentOp,
      levels: voice.ops.map((o, i) => (hooks.get(`op${i + 1}.on`) ? o.level : 0)),
      onSelect: (op) => hooks.selectOp(op),
    });
    if (document.activeElement !== nameInput) nameInput.value = voice.name;
    drawEG(pegGraph.canvas, [voice.pr1, voice.pr2, voice.pr3, voice.pr4], [voice.pl1, voice.pl2, voice.pl3, voice.pl4], { pitch: true });
    voice.ops.forEach((op, i) => {
      const n = i + 1;
      const on = hooks.get(`op${n}.on`);
      const carrier = alg.carriers.includes(n);
      const roleText = `${carrier ? 'carrier' : 'mod'}${alg.fb.includes(n) ? ' · fb' : ''}`;
      const s = strips[i], d = details[i];
      s.role.textContent = roleText;
      s.el.classList.toggle('carrier', carrier);
      s.el.classList.toggle('muted-op', !on);
      s.el.classList.toggle('current', n === currentOp);
      s.freq.textContent = opFrequencyText(op);
      s.onBtn.classList.toggle('on', !!on);
      s.onBtn.textContent = on ? 'on' : 'off';
      drawEG(s.eg, [op.r1, op.r2, op.r3, op.r4], [op.l1, op.l2, op.l3, op.l4]);
      d.el.hidden = n !== currentOp;
      if (n !== currentOp) return;
      d.role.textContent = roleText;
      d.el.classList.toggle('carrier', carrier);
      d.el.classList.toggle('muted-op', !on);
      d.freq.textContent = opFrequencyText(op);
      drawEG(d.eg, [op.r1, op.r2, op.r3, op.r4], [op.l1, op.l2, op.l3, op.l4]);
      drawScaling(d.scl, op);
    });
  }

  function badges(map) {
    for (const ws of widgets.values()) for (const w of ws) w.badge(null);
    for (const [name, text] of Object.entries(map ?? {})) for (const w of widgets.get(name) ?? []) w.badge(text);
  }

  /** Brings a control into view: selects its operator, opens folded sections around it (for lessons). */
  function reveal(name) {
    const m = /^op([1-6])\./.exec(name);
    if (m) hooks.selectOp(Number(m[1]));
    const w = widgets.get(name)?.find((x) => !x.el.closest('.fm-strip')) ?? widgets.get(name)?.[0];
    if (!w) return;
    const d = w.el.closest('details');
    if (d) d.open = true;
    w.el.closest('.folded')?.classList.remove('folded');
    requestAnimationFrame(() => w.el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  function setCurrentOp(n) {
    currentOp = n;
    update();
  }

  /** Fills the bank browser with voice names and opens it. */
  function showBank({ fileName, names, warning, onAudition, onImport, onKeep, onClose }) {
    dialog.querySelector('.fm-bank-file').textContent = fileName ?? '';
    const warn = dialog.querySelector('.fm-bank-warn');
    warn.hidden = !warning;
    warn.textContent = warning ?? '';
    const list = dialog.querySelector('.fm-bank-list');
    list.replaceChildren(...names.map((name, i) => {
      const li = el('li');
      const box = el('input');
      box.type = 'checkbox';
      box.value = String(i);
      box.setAttribute('aria-label', `Select ${name}`);
      const b = el('button', 'fm-bank-voice', name);
      b.type = 'button';
      b.onclick = () => {
        list.querySelectorAll('.fm-bank-voice.on').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        onAudition(i);
      };
      li.append(box, b);
      return li;
    }));
    const all = dialog.querySelector('.fm-bank-all');
    all.checked = false;
    all.onchange = () => list.querySelectorAll('input').forEach((x) => { x.checked = all.checked; });
    dialog.querySelector('.fm-bank-import').onclick = () => {
      const chosen = [...list.querySelectorAll('input:checked')].map((x) => Number(x.value));
      if (chosen.length) onImport(chosen);
    };
    let kept = false;
    dialog.querySelector('.fm-bank-keep').onclick = () => { kept = true; onKeep(); dialog.close(); };
    dialog.onclose = () => { if (!kept) onClose(); };
    if (!dialog.open) dialog.show(); // not modal: the keyboard stays playable while auditioning
  }

  const closeBank = () => dialog.open && dialog.close();

  return { update, badges, reveal, setCurrentOp, get currentOp() { return currentOp; }, showBank, closeBank, widgets };
}
