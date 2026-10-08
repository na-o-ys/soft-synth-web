// Run: node --test test/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bankSyx, decodeVced, encodeVced, packVoice, parseSyx, unpackVoice, voiceSyx } from '../src/fm/dx7.js';
import { ALGORITHMS, algorithmLayout, initVoice, sanitizeVoice } from '../src/fm/voice.js';

const library = JSON.parse(readFileSync(new URL('../configs/library.json', import.meta.url)));
const fmVoices = library.presets.filter((p) => p.engine === 'fm').map((p) => sanitizeVoice(p.fm));

test('library has FM presets', () => assert.ok(fmVoices.length >= 8));

test('packed voice round trip', () => {
  for (const v of fmVoices) assert.deepEqual(unpackVoice(packVoice(v)), v);
});

test('single voice (VCED) round trip', () => {
  for (const v of fmVoices) assert.deepEqual(decodeVced(encodeVced(v)), v);
});

test('bank dump: 4104 bytes, checksum, 32 voices padded with INIT VOICE', () => {
  const bytes = bankSyx(fmVoices);
  assert.equal(bytes.length, 4104);
  assert.deepEqual([...bytes.slice(0, 6)], [0xf0, 0x43, 0x00, 0x09, 0x20, 0x00]);
  const data = bytes.slice(6, 4102);
  assert.equal((data.reduce((s, b) => s + b, 0) + bytes[4102]) & 0x7f, 0);
  const { voices, warnings } = parseSyx(bytes);
  assert.equal(voices.length, 32);
  assert.deepEqual(warnings, []);
  assert.deepEqual(voices.slice(0, fmVoices.length), fmVoices);
  assert.deepEqual(voices[31], initVoice());
});

test('single-voice dump: 163 bytes', () => {
  const bytes = voiceSyx(fmVoices[0]);
  assert.equal(bytes.length, 163);
  assert.deepEqual(parseSyx(bytes).voices, [fmVoices[0]]);
});

test('several messages in one file, other sysex skipped', () => {
  const other = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];
  const file = new Uint8Array([...other, ...voiceSyx(fmVoices[1]), ...bankSyx(fmVoices)]);
  const { voices, warnings } = parseSyx(file);
  assert.equal(voices.length, 33);
  assert.deepEqual(voices[0], fmVoices[1]);
  assert.ok(warnings.some((w) => /skipped/.test(w)));
});

test('bad checksum loads with a warning; header-less bank loads', () => {
  const bytes = bankSyx(fmVoices);
  bytes[4102] ^= 1;
  const r = parseSyx(bytes);
  assert.equal(r.voices.length, 32);
  assert.ok(r.warnings.some((w) => /checksum/.test(w)));
  assert.equal(parseSyx(bankSyx(fmVoices).slice(6, 4102)).voices.length, 32);
});

test('junk bits are clamped', () => {
  const d = packVoice(initVoice());
  d[110] = 0x7f; // algorithm bits 0-4 = 31 → 32, upper junk ignored
  d[14] = 127;   // op6 output level 127 → 99
  const v = unpackVoice(d);
  assert.equal(v.algorithm, 32);
  assert.equal(v.ops[5].level, 99);
});

test('not a DX7 file throws', () => {
  assert.throws(() => parseSyx(new Uint8Array([0xf0, 0x41, 0x10, 0xf7])), /no DX7 voices/);
});

test('algorithms: edges go down, every op placed, carriers on the bottom row', () => {
  assert.equal(ALGORITHMS.length, 32);
  ALGORITHMS.forEach((a, i) => {
    for (const [from, to] of a.edges) assert.ok(from > to, `alg ${i + 1}`);
    const { pos } = algorithmLayout(i + 1);
    for (const c of a.carriers) assert.equal(pos[c].y, 0, `alg ${i + 1} carrier ${c}`);
    for (let op = 1; op <= 6; op++) assert.ok(pos[op], `alg ${i + 1} op ${op}`);
  });
});
