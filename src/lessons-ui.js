// The Lessons drawer: pick a lesson, read a step, set its knobs, hear an example, and see the
// controls it talks about highlighted on the panel.
import { CHOICES } from './config.js';
import { LESSONS as DEFAULT_LESSONS, PHRASES } from './lessons.js';

const STATE_KEY = 'soft-synth-web:lesson'; // which lesson / step is open, remembered in this browser
const INTRO = 'Short, hands-on lessons in sound design. Each step sets a few knobs, highlights them on the panel, and can play an example — then it is your turn to turn the knobs and listen. Set knobs always starts over from the init patch and rebuilds the lesson up to that step, so you can jump to any step. Undo (⌘Z / Ctrl+Z) brings back the sound you had before.';

function loadState(key) {
  try {
    const s = JSON.parse(localStorage.getItem(key));
    if (s && typeof s === 'object') return s;
  } catch { /* start fresh */ }
  return null;
}

function saveState(key, s) {
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* not essential */ }
}

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
};

/**
 * Mounts the lessons drawer.
 * controls: the panel's controls by parameter name (for highlighting);
 * play(note, on, velocity): plays a note through the synth; startAudio(): unlocks audio.
 * Another course (the FM page's) passes its own lessons, a storage key, an intro, and
 * load(values): set those values on top of the course's init sound (one undo step).
 */
export function mountLessons({
  drawer, toggle, controller, controls, play, startAudio,
  lessons: LESSONS = DEFAULT_LESSONS, stateKey = STATE_KEY, intro = INTRO,
  load = (values) => controller.loadSound(values, { init: true }),
  value = (name, v) => (CHOICES[name] && typeof v === 'string' ? CHOICES[name].indexOf(v) : v),
  // brings a control into view (a page that hides some controls opens them first)
  reveal = (name) => controls.get(name)?.el.scrollIntoView({ behavior: 'smooth', block: 'center' }),
}) {
  const state = { lesson: null, step: 0, open: false, ...loadState(stateKey) };
  if (!LESSONS[state.lesson]) state.lesson = null;
  let timers = [];
  let sounding = [];

  function stopExample() {
    timers.forEach(clearTimeout);
    timers = [];
    sounding.forEach((n) => play(n, false, 0));
    sounding = [];
  }

  async function playExample(name) {
    stopExample();
    await startAudio();
    for (const [note, start, length, velocity] of PHRASES[name]) {
      timers.push(setTimeout(() => { play(note, true, velocity); sounding.push(note); }, start * 1000));
      timers.push(setTimeout(() => {
        play(note, false, 0);
        sounding = sounding.filter((n) => n !== note);
      }, (start + length) * 1000));
    }
  }

  /**
   * Steps build on each other, so a step's sound is the init patch plus every step's values from the
   * nearest earlier step that starts from init up to this one. Applying all of them together gives
   * the same sound whichever step you start from and whatever you changed in between.
   */
  function setKnobs(lesson, index) {
    let first = index;
    while (first > 0 && lesson.steps[first].start !== 'init') first--;
    const values = {};
    for (const step of lesson.steps.slice(first, index + 1)) {
      for (const [name, v] of Object.entries(step.set ?? {})) values[name] = value(name, v);
    }
    load(values);
    // bring the first control the step talks about into view
    const focus = lesson.steps[index].focus?.[0];
    if (focus) reveal(focus);
  }

  function highlight(names) {
    for (const c of controls.values()) c.el.classList.remove('teach');
    for (const n of names) controls.get(n)?.el.classList.add('teach');
  }

  function go(lesson, step) {
    stopExample();
    state.lesson = lesson;
    state.step = step;
    saveState(stateKey, state);
    render();
  }

  function renderList() {
    highlight([]);
    const items = LESSONS.map((l, i) => el('li', {},
      el('button', { type: 'button', className: 'lesson-item', onclick: () => go(i, 0) },
        el('span', { className: 'lesson-num', textContent: String(i + 1) }),
        el('span', {}, el('strong', { textContent: l.title }), el('small', { textContent: l.summary })))));
    drawer.querySelector('.lessons-body').replaceChildren(
      el('p', { className: 'lesson-intro', textContent: intro }),
      el('ol', { className: 'lesson-list' }, ...items),
    );
  }

  function renderStep() {
    const lesson = LESSONS[state.lesson];
    const step = lesson.steps[state.step];
    highlight(step.focus ?? []);
    const last = state.step === lesson.steps.length - 1;
    // a step that only explains (no values, no fresh start) has no Set knobs
    const hasSound = lesson.steps.slice(0, state.step + 1).some((s) => s.set || s.start);
    const buttons = !hasSound ? [] : [
      el('button', {
        type: 'button',
        className: 'primary',
        textContent: 'Set knobs',
        title: 'Resets to the init patch, then sets everything this lesson has set up to this step',
        onclick: () => setKnobs(lesson, state.step),
      }),
    ];
    if (step.play) buttons.push(el('button', { type: 'button', textContent: '▶ Play example', onclick: () => playExample(step.play) }));
    drawer.querySelector('.lessons-body').replaceChildren(
      el('button', { type: 'button', className: 'lesson-back', textContent: '← All lessons', onclick: () => go(null, 0) }),
      el('h3', { textContent: `${state.lesson + 1}. ${lesson.title}` }),
      el('div', { className: 'lesson-progress', textContent: `Step ${state.step + 1} of ${lesson.steps.length}` },
        el('span', { className: 'lesson-bar', style: `--p: ${(state.step + 1) / lesson.steps.length}` })),
      el('h4', { textContent: step.title }),
      ...step.text.map((t) => el('p', { textContent: t })),
      el('div', { className: 'lesson-actions' }, ...buttons),
      step.focus?.length
        ? el('p', { className: 'lesson-note', textContent: 'The highlighted controls on the panel are the ones this step is about.' })
        : '',
      el('div', { className: 'lesson-nav' },
        el('button', { type: 'button', textContent: '◀ Back', disabled: state.step === 0, onclick: () => go(state.lesson, state.step - 1) }),
        el('button', {
          type: 'button',
          textContent: last ? (LESSONS[state.lesson + 1] ? 'Next lesson ▶' : 'Finish') : 'Next ▶',
          onclick: () => (last ? go(LESSONS[state.lesson + 1] ? state.lesson + 1 : null, 0) : go(state.lesson, state.step + 1)),
        })),
    );
    drawer.querySelector('.lessons-body').scrollTop = 0;
  }

  function render() {
    drawer.hidden = !state.open;
    document.body.classList.toggle('lessons-open', state.open);
    toggle.classList.toggle('on', state.open);
    if (!state.open) {
      highlight([]);
      return;
    }
    if (state.lesson === null) renderList();
    else renderStep();
  }

  function setOpen(open) {
    state.open = open;
    if (!open) stopExample();
    saveState(stateKey, state);
    render();
  }

  toggle.addEventListener('click', () => setOpen(!state.open));
  drawer.querySelector('.lessons-close').addEventListener('click', () => setOpen(false));
  render();
  return { close: () => state.open && setOpen(false) };
}
