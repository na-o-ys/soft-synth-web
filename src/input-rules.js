// Input rules (the config's "inputs"): rewrite incoming MIDI before controls see it.
// A rule can move messages to another channel or drop them, and can turn a SysEx message that
// carries a note (prefix, note, velocity) into an ordinary note. Controllers that send the same
// button differently over USB and Bluetooth can so be made to look the same, and kept apart from
// the keyboard's own notes.

const isNoteKind = (kind) => kind === 0x90 || kind === 0x80;

function portMatches(rule, port) {
  return rule.port === null || (port ?? '').includes(rule.port);
}

function channelMatches(rule, msg) {
  if (rule.channel !== null && (msg[0] & 0x0f) !== rule.channel) return false;
  if (rule.note !== null && !(isNoteKind(msg[0] & 0xf0) && msg[1] === rule.note)) return false;
  return true;
}

/**
 * Applies the rules to one complete MIDI message from the input called `port`.
 * Returns the channel message to handle as [status, d1, d2], or null when it is dropped
 * (a SysEx message that no rule turns into a note is dropped too).
 */
export function routeInput(rules, port, bytes) {
  let msg;
  if (bytes[0] === 0xf0) {
    const rule = rules.find((r) => r.sysexNote && portMatches(r, port)
      && r.sysexNote.every((b, i) => bytes[i] === b));
    if (!rule) return null;
    const note = bytes[rule.sysexNote.length];
    const velocity = bytes[rule.sysexNote.length + 1];
    if (!(note < 0x80) || !(velocity < 0x80)) return null;
    msg = [0x90 | rule.toChannel, note, velocity];
  } else {
    if (bytes[0] >= 0xf0) return null;
    msg = [bytes[0], bytes[1] ?? 0, bytes[2] ?? 0];
  }
  // rules apply in order, each to the result of the ones before (e.g. move to channel 16, then drop a note there)
  for (const r of rules) {
    if (r.sysexNote || !portMatches(r, port) || !channelMatches(r, msg)) continue;
    if (r.drop) return null;
    msg = [(msg[0] & 0xf0) | r.toChannel, msg[1], msg[2]];
  }
  return msg;
}
