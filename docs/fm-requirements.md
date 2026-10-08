# FM page — requirements

A third page next to **Edit** (subtractive) and **Play**: a DX7-style 6-operator FM synth with lessons and
DX7 `.syx` import. FM sounds live in the same library as subtractive ones, so the Play screen can put an FM
e-piano on the keys and subtractive drums on the pads.

## 1. Scope

| In | Out |
|---|---|
| DX7 voice model (all 155 voice parameters) and its sound, closely enough that factory/third-party banks sound recognisably right | Bit-exact DX7 emulation (log-sin tables, 12-bit DAC, EG quirks) |
| 32-voice bulk dump and single-voice `.syx` import | Function parameters of TX816/DX7II (performance, micro-tuning, AFTER TOUCH routing) |
| `.syx` export of one bank (32 voices) | Sending sysex to a real DX7 |
| Lessons on FM sound design | Editing more than one voice at a time |

## 2. Engine (AudioWorklet `fm-synth`)

### 2.1 Voice structure
- 6 operators (sine oscillators), numbered 1–6 as on the DX7.
- **Algorithm** 1–32: the DX7 routing table (which op modulates which, which ops are carriers, which op has
  the feedback loop). Algorithms 4 and 6 have the long feedback loop (op 4 → op 6, op 5 → op 6).
- **Feedback** 0–7 on the algorithm's feedback op.
- **Oscillator key sync** on/off: ops restart at phase 0 on note-on (off = free-running phases).
- Polyphony 16 voices, voice stealing of the oldest released voice, then the oldest held one.
- Sustain pedal (CC64), pitch bend (±2 semitones, a global parameter), all-notes-off.

### 2.2 Per operator (× 6)
| Parameter | Range | Meaning |
|---|---|---|
| Oscillator mode | ratio / fixed | frequency follows the key, or is a fixed Hz |
| Coarse | 0–31 | ratio 0.5, 1, 2 … 31; fixed: 1, 10, 100, 1000 Hz (coarse mod 4) |
| Fine | 0–99 | ratio ×(1 + fine/100); fixed ×10^(fine/100) |
| Detune | −7…+7 | a few cents up/down |
| Output level | 0–99 | operator amplitude (log scale, ≈0.75 dB/step) |
| EG rates 1–4 | 0–99 | speed of each segment |
| EG levels 1–4 | 0–99 | target of each segment; L4 is the start/release level |
| Keyboard rate scaling | 0–7 | higher notes run the EG faster |
| Level scaling break point | A-1 … C8 (0–99) | key where scaling starts |
| Left / right depth | 0–99 | amount of level change away from the break point |
| Left / right curve | −LIN, −EXP, +EXP, +LIN | shape and sign of that change |
| Key velocity sensitivity | 0–7 | how much velocity changes the level |
| Amp mod sensitivity | 0–3 | how much the LFO amp mod reaches this op |
| On / off | — | operator mute (the DX7 front-panel op switches): kept with the performance values, not in the voice, so it never marks the voice edited or reaches Write / .syx |

### 2.3 Global voice parameters
| Parameter | Range |
|---|---|
| Pitch EG rates 1–4, levels 1–4 | 0–99 (level 50 = no shift) |
| LFO wave | triangle, saw down, saw up, square, sine, sample & hold |
| LFO speed, delay | 0–99 |
| LFO pitch mod depth, amp mod depth | 0–99 |
| LFO key sync | on/off |
| Pitch mod sensitivity | 0–7 |
| Transpose | C1–C5 (±24 semitones, 24 = C3 = none) |
| Voice name | 10 characters of ASCII (DX7 glyphs 92 = ¥, 126 = →, 127 = ←), edited in the VOICE module; this is the name exported to .syx (the library name is chosen on Write and may differ) |

### 2.4 Performance (not stored in the voice — the DX7's function parameters)
- Master volume, reverb, pitch bend range (0–12).
- Mod wheel and aftertouch, each with a pitch amount and an amp amount (0–99): pitch adds LFO pitch mod depth,
  amp adds LFO amp mod depth (reaching ops by their AMS), as on the DX7.
- Poly / mono, portamento time (mono: legato glide between held notes).
- Output: carriers are summed with a **fixed** gain (as the DX7 does — changing the algorithm must not jump the
  level, and organ-style all-carrier voices keep their balance), then reverb and the peak limiter.

## 3. `.syx` import / export

Formats (all values 7-bit; operators are stored **OP6 first**; checksum = `(−sum of data bytes) & 0x7F`):
- **VMEM** (packed, 128 bytes/voice, 32 in a bank). Per operator, 17 bytes: 0–3 R1–R4, 4–7 L1–L4, 8 BP, 9 LD,
  10 RD, 11 `RC<<2 | LC`, 12 `DT<<3 | RS` (DT 0–14, 7 = centre), 13 `KVS<<2 | AMS`, 14 OL, 15 `FC<<1 | M`, 16 FF.
  Voice: 102–105 PR1–4, 106–109 PL1–4, 110 ALG (0–31), 111 `OKS<<3 | FB`, 112 LFS, 113 LFD, 114 LPMD, 115 LAMD,
  116 `LPMS<<4 | LFW<<1 | LFKS`, 117 TRNP, 118–127 name.
- **VCED** (single voice, 155 bytes). Per operator, 21 bytes: R1–4, L1–4, BP, LD, RD, LC, RC, RS, AMS, KVS, OL,
  M, FC, FF, DT; then 126–133 PR/PL, 134 ALG, 135 FB, 136 OKS, 137 LFS, 138 LFD, 139 LPMD, 140 LAMD, 141 LFKS,
  142 LFW, 143 LPMS, 144 TRNP, 145–154 name.

- Accept files (drag & drop or file picker) containing:
  - **32-voice bulk dump**: `F0 43 0n 09 20 00` + 4096 packed bytes + checksum + `F7` (4104 bytes).
  - **Single voice**: `F0 43 0n 00 01 1B` + 155 bytes + checksum + `F7` (163 bytes).
  - Several messages in one file, and raw 4096-byte headerless banks (some archives strip the header).
- Checksum mismatch: warn, still load (many archive files have bad checksums).
- Out-of-range values are clamped (some banks contain garbage in unused bits).
- A **bank browser** (not modal, so the keyboard stays playable) lists the names; clicking one auditions it.
  **Close** restores the sound that was there before; **Keep** stays on the auditioned voice (one undo step).
  "Import" copies chosen voices (or all) into the library as FM presets; a name already used by any preset
  (FM or subtractive) gets " 2", " 3"… Several banks in one file are listed one after another. Drag & drop a
  `.syx` onto the FM page works like the button. Checksum warnings are shown in the browser.
- **Export**: the current voice as a single-voice `.syx`, or the library's FM presets as 32-voice banks
  (`bank 1` = presets 1–32, …, padded with INIT VOICE).

## 4. Storage
- FM presets go in the existing library (`soft-synth-web:library`) as presets with `"engine": "fm"` and the
  voice under `"fm"` using readable names (e.g. `{"algorithm": 5, "ops": [{"ratio": 1, ...}, …]}`), so
  Export/Import library and the Play screen work unchanged.
- The Analog page's preset list shows only subtractive presets; the FM page's only FM presets; Play shows all.
- Preset names are unique across both engines: Write refuses to overwrite a preset of the other engine.
- Undo snapshots the voice together with the preset it came from, so Revert and the edited mark stay right.
- FM page edit buffer survives reload (session restore), with Write / Revert / New (INIT VOICE) / Undo as on
  the Edit page.

## 5. FM page UI
- Header: same strip (Start, page buttons **Analog / FM / Play / Controller**, preset LCD with ◀ ▶, New, Write,
  Revert, Undo, Lessons, Panic). A `.syx` button opens the bank browser.
- **Algorithm display**: diagram of the current algorithm (ops as boxes, carriers on the bottom row, the
  feedback loop drawn) with ◀ ▶ / select to change it; boxes light up by op output level.
- **Global section**: feedback, osc sync, transpose, pitch EG (4 R + 4 L, with a graph), LFO (wave, speed,
  delay, PMD, AMD, sync, PMS).
- **Overview + detail** (as modern FM editors: Operator, opsix), not all ~130 controls at once:
  - **OPERATORS**: six columns — on/off, carrier/mod role, frequency readout ("×1.41" / "100 Hz"), ratio,
    level, envelope thumbnail; carriers marked by colour. Clicking one selects it.
  - **Selected operator**: a large EG graph with R1–R4, L1–L4; mode, coarse, fine, detune; level, velocity;
    folded **More**: keyboard scaling (graph, break point, L/R depth and curve), rate scaling, AMS.
  - LFO, PITCH EG, PERFORMANCE folded by default; lessons select the operator and unfold what a step uses.
- **Screens**: scope, spectrum (shared with the other pages), plus the per-op EG graphs above.
- On-screen keyboard as on the other pages.
- Selecting an operator (click its strip or its box in the diagram) makes it the **current operator**.

## 6. Hardware control
- The surface's knobs follow **knob pages** on the FM page too (the header's "knobs" switch shows them; the
  same page-knob / pad gestures as on the Analog page, with pickup):
  - **OP** — the current operator: level, coarse, fine, detune, velocity, R1, R2, R4 (the knob count cuts the
    rest); a pad / the ◀ ▶ of the operator selector chooses the current operator.
  - **OP EG** — R1–R4, L1–L4 of the current operator.
  - **OP SCALE** — break point, L/R depth, L/R curve, rate scaling, AMS.
  - **LEVELS** — output level of OP1–OP6 (the "mixer" of an FM synth).
  - **VOICE** — algorithm, feedback, LFO speed, LFO delay, PMD, AMD, PMS, transpose.
  - **PITCH EG** — R1–R4, L1–L4.
- Mod wheel (CC1), aftertouch (channel pressure), pitch bend, sustain (CC64), volume work on the FM page.
- Mod wheel, pitch bend, sustain, volume work as on the other pages.

## 7. Play screen
- Any FM preset can be chosen for the keys, a pad, or a kit item; such a part runs an `fm-synth` node.
- A part's engine follows its preset: the Play screen lists FM presets with the others, `presetSound` returns
  `{ engine: 'fm', voice }` for them, and the part runs an `fm-synth` node instead of `soft-synth`.
- Knob assignments on Play can target FM parameters that make sense live: volume, reverb, mod wheel, LFO speed,
  feedback, and **brightness** (adds to the output level of every modulator, i.e. non-carrier).

## 8. Lessons (FM course)
Same lesson UI as the Edit page (steps that set knobs, explanations, "try this"). At least:
1. Carrier and modulator: one modulator, raise its level → harmonics appear.
2. Ratios: 1:1 saw-like, 1:2 square-like, non-integer ratios → bells.
3. Envelopes on the modulator: brightness that decays (plucks, e-piano).
4. Feedback: one op into itself → saw/noise.
5. Algorithms: stacks vs parallel carriers; organ (algorithm 32).
6. Electric piano (the classic: two stacks, velocity on the modulator, slight detune).
7. Bass (algorithm with a 1:1 stack + feedback, fast EG).
8. Bells and mallets (fixed/ratio inharmonic modulators).
9. Brass (pitch EG and a slow modulator attack).
10. Keyboard scaling and velocity: making it play like an instrument.
11. LFO: vibrato (pitch mod + delay), tremolo / wah with AMS.
12. Fixed-frequency operators for percussion (a fixed modulator gives the same "clang" on every key).
13. Loading `.syx` banks and reading someone else's patch.

The lesson panel is the same drawer as on the Analog page, with an FM course; each step sets voice parameters
on top of INIT VOICE (one undo step). An op **solo** (alt-click the on/off button) helps to hear one operator.

## 9. Built-in sounds
A small set of original FM presets (e-piano, bass, bell, brass, organ, marimba, strings-ish pad, clav) shipped
in `configs/library.json`. No Yamaha factory data is shipped; users load their own `.syx`.

## 10. Quality
- CPU: 16 voices × 6 ops at 48 kHz well under real time on the Mac mini; idle voices cost nothing.
- No clicks on note-on (EG starts from L4 / current level) or on voice stealing (short fade).
- Parser covered by Node tests (round trip export → import, checksum, header variants).
