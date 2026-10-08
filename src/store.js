// Where things are kept. Three stores, apart from one another so each can later move to a server on its own:
//
// - controller: the controller settings, as the JSON text edited under Setup (inputs, what the pads and sliders
//   do on each screen, pickup). The learned controller surface is kept by surface.js.
// - library: the sounds — presets (drums have "group": "drums") and drum kits. Built on screen (Write,
//   Save as kit), not hand-edited.
// - performances: the Play screen's performances.

const KEYS = {
  controller: 'soft-synth-web:controller',
  library: 'soft-synth-web:library',
  performances: 'soft-synth-web:performances',
};
const OLD_CONFIG = 'soft-synth-web:config'; // before the split: one JSON with everything

function get(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function set(key, text) {
  try { localStorage.setItem(key, text); } catch { /* keep working even if it cannot be saved */ }
}

function getJSON(key) {
  try { return JSON.parse(get(key)); } catch { return null; }
}

export const store = {
  /** The controller settings text, or null. */
  controllerText: () => get(KEYS.controller),
  saveControllerText: (text) => set(KEYS.controller, text),
  /** The library as plain JSON ({ params, preset, presets, kits }), or null. */
  library: () => getJSON(KEYS.library),
  saveLibrary: (library) => set(KEYS.library, JSON.stringify(library)),
  /** The Play performances (array), or null. */
  performances: () => getJSON(KEYS.performances),
  savePerformances: (performances) => set(KEYS.performances, JSON.stringify(performances)),
};

/**
 * Splits a config saved before the stores were separated: its presets (and params, startup preset) become the
 * library, its performances the performances, and its inputs and pad / slider assignments the controller settings.
 * Runs once: afterwards the old config is kept only as a backup. Returns what it moved, for the log, or null.
 */
export function migrateOldConfig() {
  const text = get(OLD_CONFIG);
  if (text === null) return null;
  let old = null;
  try { old = JSON.parse(text); } catch { /* not JSON: nothing to move */ }
  const moved = [];
  if (old && typeof old === 'object') {
    if (Array.isArray(old.presets) && store.library() === null) {
      const library = { presets: old.presets };
      if (old.params !== undefined) library.params = old.params;
      if (old.preset !== undefined) library.preset = old.preset;
      store.saveLibrary(library);
      moved.push(`${old.presets.length} presets`);
    }
    if (Array.isArray(old.performances) && store.performances() === null) {
      store.savePerformances(old.performances);
      moved.push(`${old.performances.length} performances`);
    }
    if (store.controllerText() === null && (old.edit || old.play || old.inputs)) {
      const settings = {};
      for (const key of ['pickup', 'logMIDI', 'inputs', 'edit', 'play']) if (old[key] !== undefined) settings[key] = old[key];
      store.saveControllerText(JSON.stringify(settings, null, 2) + '\n');
      moved.push('controller settings');
    }
  }
  set(`${OLD_CONFIG}.backup`, text);
  try { localStorage.removeItem(OLD_CONFIG); } catch { /* not essential */ }
  return moved;
}
