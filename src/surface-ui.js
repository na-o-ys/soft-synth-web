// The Controller screen: lay out the virtual knobs, pads, and sliders, and learn which physical control is
// which. Click a widget and move a control to bind it, or turn on "learn in order" and use the controls one
// after another (notes fill the pads, CCs the knobs, pitch bend the sliders).
import { LIMITS, describeSource, padName, sourceOf } from './surface.js';

/**
 * Mounts the Controller screen into `root`. surface: the Surface; log(line).
 * Returns { handle(status, d1, d2), render() }.
 */
export function mountSurface(root, { surface, log }) {
  let target = null;     // { kind, index }: the widget the next message binds to
  let inOrder = false;   // learn in order: each new control takes the next free widget
  let last = 'nothing yet';

  const el = (tag, props = {}, ...children) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...children);
    return e;
  };

  function label(kind, index) {
    if (kind === 'pads') return `pad ${padName(index, surface.layout.cols)}`;
    return `${kind === 'knobs' ? 'knob' : 'slider'} ${index + 1}`;
  }

  /** One incoming message while this screen is open: bind it, or show which widget it moves. */
  function handle(status, d1, d2) {
    const kind = status & 0xf0;
    const source = sourceOf(status, d1);
    if (!source) return;
    last = `${describeSource(source)}${kind === 0xb0 ? ` = ${d2}` : ''}`;
    const lastEl = root.querySelector('.surface-last');
    if (lastEl) lastEl.textContent = last;
    // a note-off or a knob returning to 0 is not a new control
    const fresh = kind === 0xe0 || (kind === 0xb0) || (kind === 0x90 && d2 > 0);
    const bound = surface.find(source);
    let dest = target;
    if (!dest && inOrder && fresh && !bound) dest = surface.nextFree(source);
    if (dest && fresh) {
      surface.bind(dest.kind, dest.index, source);
      log(`${describeSource(source)} → ${label(dest.kind, dest.index)}`);
      // clicking picked one widget; in order, move on to the next free one of that kind
      target = null;
      render();
      flash(dest.kind, dest.index);
      return;
    }
    if (bound) flash(bound.kind, bound.index);
  }

  function flash(kind, index) {
    const w = root.querySelector(`[data-kind="${kind}"][data-index="${index}"]`);
    if (!w) return;
    w.classList.add('hit');
    clearTimeout(w.flashTimer);
    w.flashTimer = setTimeout(() => w.classList.remove('hit'), 150);
  }

  function widget(kind, index, text) {
    const source = surface[kind][index];
    const w = el('button', { type: 'button', className: `surface-widget surface-${kind}` },
      el('span', { className: 'surface-name', textContent: text }),
      el('span', { className: 'surface-source', textContent: source ? describeSource(source) : '—' }));
    w.dataset.kind = kind;
    w.dataset.index = String(index);
    w.classList.toggle('target', target?.kind === kind && target.index === index);
    w.classList.toggle('unbound', !source);
    w.title = 'Click, then move a control on your keyboard to bind it. Right-click (or ⌥-click) to unbind.';
    w.onclick = (e) => {
      if (e.altKey) return unbind(kind, index);
      target = target?.kind === kind && target.index === index ? null : { kind, index };
      render();
    };
    w.oncontextmenu = (e) => { e.preventDefault(); unbind(kind, index); };
    return w;
  }

  function unbind(kind, index) {
    surface.unbind(kind, index);
    log(`unbound ${label(kind, index)}`);
    render();
  }

  function size(text, value, max, onchange) {
    return el('label', { className: 'play-size' }, text,
      el('input', { type: 'number', min: 1, max, value, onchange: (e) => onchange(Math.min(Math.max(Math.round(Number(e.target.value) || 1), 1), max)) }));
  }

  function render() {
    const { knobs, rows, cols, sliders } = surface.layout;
    const grid = el('div', { className: 'surface-pads' });
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    for (let i = 0; i < rows * cols; i++) grid.append(widget('pads', i, padName(i, cols)));
    root.replaceChildren(
      el('section', { className: 'module surface-setup' },
        el('h3', { textContent: 'CONTROLLER', title: 'Your controller as virtual knobs, pads, and sliders. Learn it once: the Edit and Play screens and the config use these.' }),
        el('p', { className: 'strip-note', textContent: 'Click a knob, pad, or slider below, then move that control on your keyboard. '
          + 'Or turn on “learn in order” and use your controls one after another: notes fill the pads, knobs (CCs) the knobs, and pitch bend the sliders; click a slider first for a strip that sends a CC. '
          + 'Right-click to unbind. The Edit knobs follow the page, the Play screen’s knobs and pads follow these, and the config’s "edit" / "play" say what each pad and slider does.' }),
        el('div', { className: 'play-row' },
          size('knobs', knobs, LIMITS.knobs, (v) => { surface.resize({ knobs: v }); render(); }),
          size('pads', rows, LIMITS.rows, (v) => { surface.resize({ rows: v }); render(); }),
          el('span', { className: 'strip-note', textContent: '×' }),
          size('', cols, LIMITS.cols, (v) => { surface.resize({ cols: v }); render(); }),
          size('sliders', sliders, LIMITS.sliders, (v) => { surface.resize({ sliders: v }); render(); }),
          el('button', { type: 'button', className: inOrder ? 'on' : '', textContent: inOrder ? 'Stop learning in order' : 'Learn in order',
            onclick: () => { inOrder = !inOrder; target = null; render(); } }),
          el('button', { type: 'button', textContent: 'Clear all', onclick: () => {
            if (!confirm('Unbind every knob, pad, and slider?')) return;
            surface.clear(); log('controller cleared'); render();
          } }),
          el('span', { className: 'strip-note' }, 'last received: ', el('span', { className: 'surface-last', textContent: last })))),
      el('section', { className: 'module' },
        el('h3', { textContent: 'KNOBS' }),
        el('div', { className: 'surface-row' }, ...Array.from({ length: knobs }, (_, i) => widget('knobs', i, `K${i + 1}`)))),
      el('section', { className: 'module' }, el('h3', { textContent: 'PADS' }), grid),
      el('section', { className: 'module' },
        el('h3', { textContent: 'SLIDERS' }),
        el('div', { className: 'surface-row' }, ...Array.from({ length: sliders }, (_, i) => widget('sliders', i, `S${i + 1}`)))));
  }

  render();
  return { handle, render };
}
