// Knob pages for the Edit screen: every panel module is a page group, in panel order, followed by the
// harmonics (one group per partial field). The virtual knobs play a page's controls from left to right;
// a group with more controls than knobs continues on further pages ("filter 2").
import { CHOICES } from './config.js';
import { MODULES, PARTIAL_SPECS, SPECS } from './panel.js';

const partials = (field) => Array.from({ length: 8 }, (_, i) => `partial${i + 1}.${field}`);

export const PAGE_GROUPS = [
  ...MODULES.map((m) => ({ id: m.title.toLowerCase(), title: m.title, params: m.items.map((i) => i.choice ?? i.knob) })),
  { id: 'levels', title: 'LEVELS', params: partials('level') },
  { id: 'ratios', title: 'RATIOS', params: partials('ratio') },
  { id: 'vel', title: 'VEL', params: partials('velocity') },
  { id: 'decay', title: 'DECAY', params: partials('decay') },
];

export const PAGE_IDS = PAGE_GROUPS.map((g) => g.id);

/** The pages for n knobs: [{ group, title, sub, subs, params }], each with at most n params. */
export function pagesFor(knobs) {
  const n = Math.max(1, knobs);
  const pages = [];
  for (const g of PAGE_GROUPS) {
    const subs = Math.ceil(g.params.length / n);
    for (let sub = 0; sub < subs; sub++) {
      pages.push({ group: g.id, title: g.title, sub, subs, params: g.params.slice(sub * n, (sub + 1) * n) });
    }
  }
  return pages;
}

/** Range of a parameter as a knob sees it (choices are stepped 0...count-1). */
export function paramSpec(name) {
  if (CHOICES[name]) return { min: 0, max: CHOICES[name].length - 1, step: 1 };
  const m = /^partial\d\.(\w+)$/.exec(name);
  return m ? PARTIAL_SPECS[m[1]] : SPECS[name];
}

/** Throws if the config switches to a page group that does not exist. */
export function checkPages(config) {
  for (const screen of ['edit', 'play']) {
    config[screen].forEach((c, i) => {
      if (c.target.kind === 'page' && !PAGE_IDS.includes(c.target.page)) {
        throw new Error(`${screen}[${i}]: unknown page "${c.target.page}" (pages: ${PAGE_IDS.join(', ')})`);
      }
    });
  }
}
