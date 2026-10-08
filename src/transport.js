// Transport and DAW-style buttons from standard MIDI, with no learning: the realtime Start / Continue / Stop
// messages, MMC (MIDI Machine Control, SysEx), and Mackie Control buttons on the input the controller settings
// name as a Mackie port. They all become the same commands, which the Edit and Play screens carry out.
// Mackie LEDs (play, record, cycle, track rec-arm) are sent back to the Mackie port's output.

/** Commands a transport button can give. track1...track8 are the channel strips' buttons. */
export const COMMANDS = [
  'play', 'stop', 'record', 'recordExit', 'rewind', 'forward', 'bankLeft', 'bankRight',
  'undo', 'save', 'cycle', 'click', ...Array.from({ length: 8 }, (_, i) => `track${i + 1}`),
];

/** Start / Continue / Stop (FA / FB / FC) and MMC (F0 7F <device> 06 <command> F7) → command, or null. */
export function standardCommand(bytes) {
  switch (bytes[0]) {
    case 0xfa: case 0xfb: return 'play';
    case 0xfc: return 'stop';
  }
  if (bytes[0] === 0xf0 && bytes[1] === 0x7f && bytes[3] === 0x06) {
    return { 0x01: 'stop', 0x02: 'play', 0x03: 'play', 0x04: 'forward', 0x05: 'rewind', 0x06: 'record', 0x07: 'recordExit', 0x09: 'stop' }[bytes[4]] ?? null;
  }
  return null;
}

// Mackie Control button notes (host ↔ surface, channel 1). The LED of a button is the same note sent back.
const MACKIE = { play: 94, stop: 93, record: 95, rewind: 91, forward: 92, bankLeft: 46, bankRight: 47, undo: 81, save: 80, cycle: 86, click: 89 };
const BUTTONS = new Map(Object.entries(MACKIE).map(([cmd, note]) => [note, cmd]));
for (let i = 0; i < 8; i++) {
  BUTTONS.set(i, `track${i + 1}`);      // rec-arm 1-8
  BUTTONS.set(24 + i, `track${i + 1}`); // select 1-8
}
// modifiers (shift, option, control, alt) come along with other buttons: they do nothing by themselves
const MODIFIERS = new Set([70, 71, 72, 73]);

/** The command of a Mackie button note (press only), with the settings' overrides; null for anything else. */
export function mackieCommand(note, overrides = {}) {
  if (MODIFIERS.has(note)) return null;
  return overrides[note] ?? BUTTONS.get(note) ?? null;
}

/**
 * Keeps a Mackie surface's LEDs in step with the transport: play, record, cycle, and the rec-arm LED of the
 * active track (the Play screen's slot). Sends only what changed; reset() forgets, so everything is sent again.
 */
export class MackieLights {
  constructor(send) {
    this.send = send; // (bytes) => void, or null while there is no Mackie output
    this.lit = new Map();
  }

  update({ playing = false, recording = false, cycle = false, track = 0 } = {}) {
    const want = new Map([[MACKIE.play, playing], [MACKIE.record, recording], [MACKIE.cycle, cycle],
      [MACKIE.stop, !playing && !recording]]);
    for (let i = 0; i < 8; i++) want.set(i, track === i + 1);
    for (const [note, on] of want) {
      if (this.lit.get(note) === on) continue;
      this.lit.set(note, on);
      this.send?.([0x90, note, on ? 0x7f : 0x00]);
    }
  }

  reset() {
    this.lit.clear();
  }
}
