// Sends the Play screen's state to the native soft-synth app (the always-on macOS daemon), so it plays the same
// keys sound, pad drums, knobs, and slots without the browser. The app offers a virtual MIDI input called
// "soft-synth"; the state goes there as one SysEx message: F0 7D "SSYN" 01 <JSON in ASCII> F7.

const PORT = 'soft-synth';
const HEADER = [0xf0, 0x7d, 0x53, 0x53, 0x59, 0x4e, 0x01];
const KEY = 'soft-synth-web:native-sync';

/** JSON with every non-ASCII character escaped, so each byte fits SysEx's 7 bits. */
const asciiJSON = (value) => JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function encodeSync(state) {
  const json = asciiJSON({ v: 1, ...state });
  const bytes = new Uint8Array(HEADER.length + json.length + 1);
  bytes.set(HEADER);
  for (let i = 0; i < json.length; i++) bytes[HEADER.length + i] = json.charCodeAt(i);
  bytes[bytes.length - 1] = 0xf7;
  return bytes;
}

/**
 * output(): the app's MIDI output, or null when it is not running; getState(): what to send; log(text).
 * The choice to follow the browser is remembered in this browser (off by default).
 */
export function createNativeSync({ output, getState, log, onChange = () => {} }) {
  let enabled = false;
  try { enabled = localStorage.getItem(KEY) === 'on'; } catch { /* off */ }
  let timer = 0;
  let last = '';
  let lastPortSeen = false;

  function send(force = false) {
    const out = output();
    if (!out) return;
    let state;
    try { state = enabled ? getState() : { off: true }; } catch (e) { return log(`soft-synth app: ${e.message}`); }
    if (!state) return;
    const bytes = encodeSync(state);
    const key = bytes.join(',');
    if (!force && key === last) return; // nothing changed
    try {
      out.send(bytes);
      last = key;
      if (enabled) log(`soft-synth app: sent the Play state (${(bytes.length / 1024).toFixed(1)} KB)`);
      else log('soft-synth app: back to its own config file');
    } catch (e) {
      log(`soft-synth app: could not send (${e.message}); allow SysEx for MIDI in the site settings`);
    }
  }

  return {
    get enabled() { return enabled; },
    get connected() { return !!output(); },
    /** Something on the Play screen changed: send it soon (changes come in bursts while knobs turn). */
    schedule() {
      if (!enabled) return;
      clearTimeout(timer);
      timer = setTimeout(() => send(), 400);
    },
    setEnabled(on) {
      enabled = on;
      try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* not essential */ }
      clearTimeout(timer);
      send(true);
      onChange();
    },
    /** MIDI devices changed: when the app's port appears (the app started), bring it up to date. */
    devicesChanged() {
      const seen = !!output();
      if (seen && !lastPortSeen && enabled) send(true);
      lastPortSeen = seen;
      onChange();
    },
  };
}
