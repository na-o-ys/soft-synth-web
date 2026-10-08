// DX7 system exclusive: reading .syx files (32-voice bank dumps, single-voice dumps, header-less banks)
// into voices, and writing a bank back out. Voices use the editor's form (see voice.js).
import { initVoice, sanitizeVoice } from './voice.js';

// the editor's operator fields in the order of the single-voice (VCED) format, 21 bytes per operator
const VCED_OP = ['r1', 'r2', 'r3', 'r4', 'l1', 'l2', 'l3', 'l4', 'breakPoint', 'leftDepth', 'rightDepth',
  'leftCurve', 'rightCurve', 'rateScale', 'ams', 'velocity', 'level', 'mode', 'coarse', 'fine', 'detune'];
const VCED_GLOBAL = ['pr1', 'pr2', 'pr3', 'pr4', 'pl1', 'pl2', 'pl3', 'pl4', 'algorithm', 'feedback', 'oscSync',
  'lfoSpeed', 'lfoDelay', 'lfoPmd', 'lfoAmd', 'lfoSync', 'lfoWave', 'lfoPms', 'transpose'];

const checksum = (data) => (-data.reduce((s, b) => s + b, 0)) & 0x7f;

/** DX7 names are ASCII, with a few odd glyphs; anything unprintable becomes a space. */
function readName(bytes) {
  let s = '';
  for (const b of bytes) {
    const c = b & 0x7f;
    s += c === 92 ? '¥' : c === 126 ? '→' : c === 127 ? '←' : c >= 32 ? String.fromCharCode(c) : ' ';
  }
  return s.replace(/\s+$/, '');
}

function writeName(name) {
  const out = new Array(10).fill(32);
  [...(name ?? '')].slice(0, 10).forEach((ch, i) => {
    const c = ch === '¥' ? 92 : ch === '→' ? 126 : ch === '←' ? 127 : ch.charCodeAt(0);
    out[i] = c >= 32 && c < 128 ? c : 32;
  });
  return out;
}

/** One voice from the 128-byte packed form (VMEM) used in 32-voice banks. */
export function unpackVoice(d) {
  const v = initVoice();
  for (let i = 0; i < 6; i++) {
    const o = (5 - i) * 17; // operators are stored 6 first
    const op = v.ops[i];
    [op.r1, op.r2, op.r3, op.r4, op.l1, op.l2, op.l3, op.l4] = d.slice(o, o + 8);
    op.breakPoint = d[o + 8];
    op.leftDepth = d[o + 9];
    op.rightDepth = d[o + 10];
    op.leftCurve = d[o + 11] & 3;
    op.rightCurve = (d[o + 11] >> 2) & 3;
    op.rateScale = d[o + 12] & 7;
    op.detune = ((d[o + 12] >> 3) & 15) - 7;
    op.ams = d[o + 13] & 3;
    op.velocity = (d[o + 13] >> 2) & 7;
    op.level = d[o + 14];
    op.mode = d[o + 15] & 1;
    op.coarse = (d[o + 15] >> 1) & 31;
    op.fine = d[o + 16];
  }
  [v.pr1, v.pr2, v.pr3, v.pr4, v.pl1, v.pl2, v.pl3, v.pl4] = d.slice(102, 110);
  v.algorithm = (d[110] & 31) + 1;
  v.feedback = d[111] & 7;
  v.oscSync = (d[111] >> 3) & 1;
  v.lfoSpeed = d[112];
  v.lfoDelay = d[113];
  v.lfoPmd = d[114];
  v.lfoAmd = d[115];
  v.lfoSync = d[116] & 1;
  v.lfoWave = (d[116] >> 1) & 7;
  v.lfoPms = (d[116] >> 4) & 7;
  v.transpose = d[117];
  v.name = readName(d.slice(118, 128));
  return sanitizeVoice(v); // junk in unused bits or out-of-range values (common in archives) is clamped
}

/** One voice as the 128-byte packed form. */
export function packVoice(voice) {
  const v = sanitizeVoice(voice);
  const d = new Array(128).fill(0);
  for (let i = 0; i < 6; i++) {
    const o = (5 - i) * 17;
    const op = v.ops[i];
    [op.r1, op.r2, op.r3, op.r4, op.l1, op.l2, op.l3, op.l4].forEach((x, j) => { d[o + j] = x; });
    d[o + 8] = op.breakPoint;
    d[o + 9] = op.leftDepth;
    d[o + 10] = op.rightDepth;
    d[o + 11] = op.leftCurve | (op.rightCurve << 2);
    d[o + 12] = op.rateScale | ((op.detune + 7) << 3);
    d[o + 13] = op.ams | (op.velocity << 2);
    d[o + 14] = op.level;
    d[o + 15] = op.mode | (op.coarse << 1);
    d[o + 16] = op.fine;
  }
  [v.pr1, v.pr2, v.pr3, v.pr4, v.pl1, v.pl2, v.pl3, v.pl4].forEach((x, j) => { d[102 + j] = x; });
  d[110] = v.algorithm - 1;
  d[111] = v.feedback | (v.oscSync << 3);
  d[112] = v.lfoSpeed;
  d[113] = v.lfoDelay;
  d[114] = v.lfoPmd;
  d[115] = v.lfoAmd;
  d[116] = v.lfoSync | (v.lfoWave << 1) | (v.lfoPms << 4);
  d[117] = v.transpose;
  writeName(v.name).forEach((c, j) => { d[118 + j] = c; });
  return d;
}

/** One voice from the 155-byte single-voice form (VCED). */
export function decodeVced(d) {
  const v = initVoice();
  for (let i = 0; i < 6; i++) {
    const o = (5 - i) * 21;
    VCED_OP.forEach((k, j) => { v.ops[i][k] = d[o + j]; });
    v.ops[i].detune -= 7;
  }
  VCED_GLOBAL.forEach((k, j) => { v[k] = d[126 + j]; });
  v.algorithm += 1;
  v.name = readName(d.slice(145, 155));
  return sanitizeVoice(v);
}

/** One voice as the 155-byte single-voice form. */
export function encodeVced(voice) {
  const v = sanitizeVoice(voice);
  const d = new Array(155).fill(0);
  for (let i = 0; i < 6; i++) {
    const o = (5 - i) * 21;
    VCED_OP.forEach((k, j) => { d[o + j] = k === 'detune' ? v.ops[i].detune + 7 : v.ops[i][k]; });
  }
  VCED_GLOBAL.forEach((k, j) => { d[126 + j] = k === 'algorithm' ? v.algorithm - 1 : v[k]; });
  writeName(v.name).forEach((c, j) => { d[145 + j] = c; });
  return d;
}

/**
 * Reads a .syx file. Returns { voices: [voice], warnings: [text] }; throws if nothing in it is a DX7 voice.
 * Accepts any number of sysex messages (32-voice banks and single voices, other messages are skipped),
 * and a bare 4096-byte bank without the sysex wrapper.
 */
export function parseSyx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const voices = [];
  const warnings = [];
  if (bytes.length === 4096 && bytes[0] !== 0xf0) {
    for (let i = 0; i < 32; i++) voices.push(unpackVoice(Array.from(bytes.subarray(i * 128, i * 128 + 128))));
    return { voices, warnings: ['no sysex header: read as a bare 32-voice bank'] };
  }
  let i = 0;
  let skipped = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0xf0) { i++; continue; }
    let end = i + 1;
    while (end < bytes.length && bytes[end] !== 0xf7 && !(bytes[end] === 0xf0)) end++;
    const msg = bytes.subarray(i, end); // without F7
    i = end;
    if (msg.length < 6 || msg[1] !== 0x43 || (msg[2] & 0xf0) !== 0x00) { skipped++; continue; }
    const format = msg[3];
    const count = (msg[4] << 7) | msg[5];
    const data = Array.from(msg.subarray(6, 6 + count));
    const sum = msg[6 + count];
    if (format === 9 && count === 4096) {
      if (data.length < 4096) {
        warnings.push(`bank is cut short (${data.length} of 4096 bytes); read what is there`);
      } else if (sum !== undefined && sum !== checksum(data)) {
        warnings.push('bank checksum does not match (common in archived files); loaded anyway');
      }
      for (let n = 0; n * 128 + 128 <= data.length; n++) voices.push(unpackVoice(data.slice(n * 128, n * 128 + 128)));
    } else if (format === 0 && count === 155) {
      if (data.length < 155) { warnings.push('single voice is cut short; skipped'); continue; }
      if (sum !== undefined && sum !== checksum(data)) warnings.push('voice checksum does not match; loaded anyway');
      voices.push(decodeVced(data));
    } else {
      skipped++;
    }
  }
  if (skipped) warnings.push(`${skipped} other sysex message${skipped > 1 ? 's' : ''} skipped`);
  if (!voices.length) throw new Error('no DX7 voices found (expected a 32-voice bank or a single-voice dump)');
  return { voices, warnings };
}

/** A 32-voice bank dump (4104 bytes); fewer than 32 voices are padded with INIT VOICE. */
export function bankSyx(voices, channel = 0) {
  const data = [];
  for (let n = 0; n < 32; n++) data.push(...packVoice(voices[n] ?? initVoice()));
  return new Uint8Array([0xf0, 0x43, channel & 15, 0x09, 0x20, 0x00, ...data, checksum(data), 0xf7]);
}

/** A single-voice dump (163 bytes). */
export function voiceSyx(voice, channel = 0) {
  const data = encodeVced(voice);
  return new Uint8Array([0xf0, 0x43, channel & 15, 0x00, 0x01, 0x1b, ...data, checksum(data), 0xf7]);
}
