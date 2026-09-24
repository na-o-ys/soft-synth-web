# soft-synth-web

A gentle-sounding synth in the browser that plays whatever MIDI keyboard you connect.
It is the web port of the macOS daemon [soft-synth](https://github.com/na-o-ys/soft-synth):
same config format, extended into a classic subtractive synth for designing sounds from the keyboard.

- Classic synth layout, running in an AudioWorklet:
  two oscillators (sine / triangle / saw / square / pulse, or an additive "harmonics" recipe) with unison + noise
  → 12 dB filter (low-pass, band-pass, or high-pass) with its own envelope and velocity response → amp envelope
  → ping-pong delay → reverb, plus a pitch envelope for drums and zaps
- An LFO (sine / triangle / square / saw / random) that can move pitch, cutoff, volume, and pulse width
- Poly or mono (legato) play, with glide (portamento)
- The original soft presets (additive harmonics, filter open) sound as before; added classic presets
  analog-pad, synth-brass, soft-bass, pluck, mono-lead, super-pad, pwm-strings
- 32-voice polyphony, sustain pedal (CC64)
- Web MIDI picks up USB keyboards and any keyboard the OS has connected, and follows hot-plugging
- Web Bluetooth connects BLE MIDI keyboards directly (no Audio MIDI Setup needed) and reconnects when they drop
- Presets and knob / pad / strip mappings are defined in JSON and saved in the browser
- A hardware-style panel: program display with ◀ ▶ / New / Write / Revert / Undo, five LCD screens, modules of rotary knobs
  in signal order (OSC 1 · OSC 2 · MIXER · FILTER · FILTER ENV / AMP ENV · VOICE · LFO · FX · MASTER),
  organ-style drawbars for the additive harmonics, and an on-screen keyboard that lights up the notes being played
- **New** starts from the init patch (one plain saw, filter open, no effects) without saving anything;
  **Write** asks for a name: keep it to overwrite the preset, or type a new one to save a copy
- **Play screen**: play several sounds at once — a preset on the keyboard, presets on a grid of virtual pads,
  parameters on virtual knobs — with physical pads and knobs linked by MIDI learn (see below)
- **Lessons**: ten hands-on sound-design lessons in a side drawer — each step explains a few controls,
  sets them, highlights them on the panel, and plays an example (see below)
- **Undo** (button, ⌘Z / Ctrl+Z, or a pad) steps back through knob gestures, preset changes, and New;
  one continuous turn of a knob is one step
- Unsaved edits (including a New patch and the knob page) survive a page reload; `*` next to the program
  number means the sound has edits that are not written yet
- Knobs: drag up / down, mouse wheel, or arrow keys; hold Shift for fine steps (1/1000 of the range);
  double-click returns to the preset's value. Values show three significant digits, times under a second in ms
  A badge shows which hardware control moves each knob (knob number on the current page, or its CC)
- Screens: live oscilloscope and spectrum of the output, plus the filtered waveform, the oscillator harmonics
  under the filter curve, and both envelopes, computed from the current settings
- Design sounds from the keyboard with knob pages, then save them into the current preset
- Play from the computer keyboard too (A W S E D F T G Y H U J K, Z / X for octave)

## Running

Static files only, no build step. AudioWorklet and Web MIDI do not work from `file://`, so serve it over HTTP:

```sh
node serve.mjs        # http://localhost:5173/
```

Open it and press **Start** (browsers need one click before audio can play; clicking the on-screen keyboard works too).
MIDI setup, the config editor, and the log are under **Setup** below the panel.

| Browser | Web MIDI | Web Bluetooth |
|---|---|---|
| Chrome / Edge | yes | yes |
| Firefox | yes | no |
| Safari | no | no |

## Play

**Play** in the top strip switches from editing sounds to performing with them (**Edit** switches back).
A *performance* is:

- **KEYS** — the preset the keyboard plays (pitch bend, mod wheel, and sustain go to it)
- **PADS** — a grid of virtual pads (any size up to 8 × 8); each plays a preset at a fixed note and volume.
  Click a pad to hear it and edit it below the grid.
- **KNOBS** — any number of virtual knobs (up to 16); each moves one parameter of the keys sound, the pad sounds,
  or both, on top of their presets (the presets themselves do not change). Double-click to go back to the preset value.

Every preset in use runs as its own synth, so the keyboard and pads sound together; pads with the same preset share one.

**Preset slots:** controls the config maps to `"action": "slot"` (e.g. the SMK-25 II's MCP pads) switch the keys
sound. Which preset each slot plays is chosen per performance in the **slots** row under KEYS (the slot playing
now is lit); the config only says which control is which slot.

**Linking your controller (MIDI learn):** press **Learn**, then just hit your pads in order and turn your knobs one by one.
Each new pad links to the next free virtual pad, each new knob to the next free virtual knob (both are highlighted),
so pads and knobs can be linked in one go without clicking anything. Controls that are already linked are never
moved — a turning knob sends many messages and a pad may be hit twice — they simply play, so you can check what is
where. To link one again, click that virtual pad or knob's label and use the control. **Clear pad links** /
**Clear knob links** start over. Links belong to the controller, so they are shared by all performances. Notes that
are not linked to a pad play the keys sound.

Performances and links are saved in the config (`performances`, `playLinks`) as you go.

## Lessons

Open **Lessons** in the top strip. Each step has **Set knobs**, **▶ Play example** (plays a short phrase, no keyboard
needed), and highlights the controls it talks about. Set knobs always starts over from the init patch (also putting
transpose, pitch bend, and mod back to 0; volume stays) and applies everything the lesson has set up to that step,
as one undo step — so any step can be opened directly and sounds the same however you got there.

| # | Lesson | Covers |
|---|---|---|
| 1 | Oscillators | the six wave shapes (how they sound, look on SCOPE, and show on FILTER), pulse width |
| 2 | The filter | cutoff, resonance sweep, key tracking, velocity → cutoff |
| 3 | Envelopes | organ / pluck / swell volume shapes, brass and pluck filter envelopes |
| 4 | Synth piano | oscillator + filter + envelopes + velocity + unison + reverb, step by step |
| 5 | Thick and wide | detune, sub octave, intervals, unison (supersaw), chorus |
| 6 | Bass | sub oscillator, mono, glide, touch, acid resonance |
| 7 | Lead | LFO vibrato, the mod wheel, delay |
| 8 | Movement with the LFO | wah, LFO shapes, random sample & hold, tremolo, PWM |
| 9 | Additive | organ drawbars, sub octave, inharmonic bells, touch-sensitive e-piano, brightness |
| 10 | Effects, noise, and space | reverb, tempo delay, breath noise, wind |
| 11 | Percussion | kick and toms (pitch envelope), snare (tone + noise), hi-hats (high-pass noise), clap (band-pass noise), 808 cowbell |
| 12 | Classic sounds | 808 bass, reese bass, chiptune lead, marimba, sweep pad, laser zap |

Lessons live in [src/lessons.js](src/lessons.js) as plain data (values, highlighted controls, example phrases),
so adding one needs no other code.

## Config

Edit the JSON under **Config** and press **Apply and save**; it is stored in this browser.
Mistakes are reported with their location, and the previous config keeps running.

Templates:

- [configs/default.json](configs/default.json): generic keyboard (pitch bend, mod wheel → extra vibrato, GM CCs 5 glide, 7 volume, 71 resonance, 72 release, 73 attack, 74 cutoff, 91 reverb, 93 chorus)
- [configs/smk25ii.json](configs/smk25ii.json): M-VAVE SMK-25 II (see below)

To map another keyboard, tick **Also show incoming MIDI messages**, touch its knobs and pads,
and put the numbers you see into `controls`.

```jsonc
{
  "preset": "soft-piano",          // preset at startup
  "params": {"volume": 0.8},       // values shared by every preset
  "pickup": true,                  // default for knobs: soft takeover (see below)
  "pages": ["envelope", "tone"],   // knob pages, first one is active at startup
  "presets": [ ... ],              // order = nextPreset / prevPreset order
  "inputs": [ ... ],               // rewrite incoming MIDI before the controls see it (see below)
  "controls": [ ... ],             // MIDI mappings
  "logMIDI": false                 // log every incoming message
}
```

### Parameters

In signal order. Choice parameters (`osc1Wave`, `osc2Wave`, `lfoWave`, `filterType`, `mono`) take a name (`"saw"`, `"mono"`)
or its index (oscillator waves: `sine, triangle, saw, square, pulse, harmonics` = 0–5).

| Name | Meaning | Default |
|---|---|---|
| `osc1Wave` / `osc1Level` | oscillator 1 wave and level; `harmonics` plays the preset's `partials` | harmonics / 1 |
| `brightness` | multiplier for every partial whose ratio is not 1 (harmonics wave) | 1 |
| `osc2Wave` / `osc2Level` | oscillator 2 wave (`harmonics` falls back to sine) and level | saw / 0 |
| `osc2Octave` / `osc2Semi` / `osc2Detune` | oscillator 2 pitch: octaves, semitones, cents | 0 / 0 / 0 |
| `pulseWidth` | duty cycle of the pulse wave (both oscillators), 0.05–0.95 | 0.5 |
| `unison` / `unisonDetune` / `unisonWidth` | copies of each oscillator per note (1–7, basic waves only) / their pitch spread (cents) / stereo spread (0–1) | 1 / 15 / 0.6 |
| `noise` | white noise level | 0 |
| `chorus` / `detune` | level of a slightly detuned sine copy of the fundamental / how far (cents) | 0.5 / 4 |
| `filterType` | `low-pass` (removes highs), `band-pass` (keeps a band), `high-pass` (removes lows) | low-pass |
| `cutoff` | cutoff in Hz; a low-pass at 20000 with no modulation bypasses the filter | 20000 |
| `resonance` | emphasis at the cutoff, 0–0.97 | 0 |
| `keyTrack` | how much the cutoff follows the note, 0–1 (1 = one octave per octave) | 0 |
| `velFilter` | octaves added to the cutoff at full velocity (harder = brighter) | 0 |
| `filterEnv` | octaves the filter envelope adds to the cutoff (negative closes it) | 0 |
| `fAttack` / `fDecay` / `fSustain` / `fRelease` | filter envelope (seconds, sustain 0–1) | 0.005 / 0.5 / 0 / 0.3 |
| `attack` / `decay` / `release` | amp envelope times in seconds; decay is the time constant toward sustain | 0.008 / 1.6 / 0.28 |
| `sustain` | level while the key is held, 0–1 | 0.3 |
| `velocity` | velocity sensitivity 0–1 | 0.8 |
| `mono` | `poly` or `mono`; mono plays one note, and overlapping keys slide without restarting the envelopes (legato) | poly |
| `glide` | portamento time in seconds (0 = off); works in poly too | 0 |
| `pitchEnv` / `pitchDecay` | each note starts this many semitones away and returns within this time constant (s): kicks, toms, zaps | 0 / 0.05 |
| `lfoWave` | LFO shape: `sine`, `triangle`, `square`, `saw`, `random` (a new value each cycle) | sine |
| `vibratoRate` | LFO speed (Hz) | 5 |
| `vibrato` / `lfoFilter` | LFO depth to pitch (semitones) / to cutoff (octaves) | 0 / 0 |
| `lfoAmp` / `lfoPwm` | LFO depth to volume (tremolo, 0–1) / to pulse width (0–0.45) | 0 / 0 |
| `delay` / `delayTime` / `delayFeedback` | ping-pong delay level / time between echoes (s) / how long it repeats (0–0.9) | 0 / 0.35 / 0.35 |
| `reverb` / `reverbSize` / `reverbDamp` | reverb level / length (0–0.97) / darkness (0–1) | 0.22 / 0.8 / 0.65 |
| `volume` | master volume | 0.8 |
| `transpose` | transpose in semitones (applies to held notes too) | 0 |
| `bend` | pitch bend in semitones | 0 |
| `modWheel` | mod wheel: extra vibrato (semitones) on top of `vibrato`; not saved, back to 0 on reload | 0 |
| `partialN.ratio` / `.level` / `.velocity` / `.decay` | one field of harmonic N (1–8), see Presets | from the preset |

`volume`, `transpose`, `bend`, and `modWheel` are performance state: they survive preset changes, are never saved
into a preset, and do not count as edits or undo steps.
Everything else is reset on a preset change to defaults ← `params` ← the preset.

### Presets

```json
{"name": "e-piano", "attack": 0.004, "sustain": 0.15,
 "partials": [
   {"ratio": 1, "level": 1},
   {"ratio": 2, "level": 0.05, "velocity": 0.3, "decay": 0.4}
 ]}
{"name": "synth-brass", "osc1Wave": "saw", "osc2Wave": "saw", "osc2Level": 0.8, "osc2Detune": 6,
 "cutoff": 350, "filterEnv": 3.5, "fAttack": 0.06, "fDecay": 0.7, "fSustain": 0.45}
```

`partials` (up to 8) is the recipe for the `harmonics` wave: `ratio` is the frequency relative to the note, `level` its volume,
`velocity` extra volume when you play harder, and `decay` a time constant (seconds, 0 = none) that fades that harmonic on its own.
Without `partials`, a soft-piano-like recipe is used.
Editing a harmonic the preset does not have yet (e.g. `partial5.level`) adds silent harmonics up to it.

### Controls

Each control is "which message" plus "what to do". Omit `channel` (1–16) to match every channel.
Mapped messages do not play notes (e.g. pads used for preset changes).

Input: `{"cc": number}` / `{"note": number}` / `{"pitchBend": true}`

Move a parameter continuously (knobs, sliders):

```json
{"cc": 31, "param": "release", "min": 0.05, "max": 4, "curve": "exp"}
{"pitchBend": true, "param": "transpose", "min": -12, "max": 12, "step": 1}
{"cc": 30, "page": "tone", "param": "partial2.level", "min": 0, "max": 1}
```

- `curve: "exp"` is for times and ratios (min and max > 0). `step` quantizes the value.
- On a note, the value is `max` while held and `min` when released.
- `page`: the control only responds while that knob page is active (see `pages`). Without it, it always responds.
- `pickup` (default from the top-level `pickup`; stepped controls such as wave switches are left out): soft takeover
  by value scaling. After a preset or page change the knob's position no longer matches the value; until they meet,
  turning the knob moves the value the same way, scaled so both reach the end of their range together, and from then
  on the knob drives the value directly. No jumps, and the knob always responds.

Actions on press (pads, buttons):

| action | extra fields | does |
|---|---|---|
| `preset` | `preset` | switch to that preset |
| `nextPreset` / `prevPreset` | | next / previous preset |
| `page` | `page` | switch the knob page |
| `nextPage` / `prevPage` | | next / previous knob page |
| `pageKnob` | | (on a knob) choose the knob page by position: the range is split evenly between `pages` |
| `undo` | | undo the last change (a knob gesture, a preset change, or New) |
| `savePreset` | | write the current sound into the current preset (an unsaved init patch gets the name `init`, `init-2`, …) |
| `set` | `param`, `value` | set a value |
| `add` | `param`, `value`, optional `min`, `max` | add to a value, clamped |
| `toggle` | `param`, `values: [off, on]` | flip between two values |
| `panic` | | stop every sounding note |
| `record` | | start recording what you play (replaces the last take); press again to end the take |
| `play` | | play the take from the start (ends a recording first) |
| `stop` | | end the recording, or stop the playback |
| `loop` | | playback loops on / off |
| `slot` | `slot` (1–16) | Play screen: switch the keys to the preset chosen for that slot on screen (does nothing on the Edit screen) |

Unmapped notes, CC64 (sustain), and CC120/123 (all notes off) behave as standard MIDI.

The recorder keeps one take of the notes and sustain pedal you play on the Edit screen (from the first note to
the end of recording) and plays it back through the current sound, so you can loop a phrase and tweak knobs
over it. It is not saved, and switching to the Play screen stops it.

### Inputs

`inputs` rewrites messages as they arrive, before controls and the Play screen see them. Use it when a controller
sends some buttons in a way that clashes with the keyboard or that apps do not read as notes:

```json
"inputs": [
  {"port": "Port 3", "toChannel": 16},
  {"sysexNote": "F0 35 59 10", "toChannel": 16},
  {"channel": 16, "note": 72, "drop": true}
]
```

| field | matches / does |
|---|---|
| `port` | only messages from an input whose name contains this text (e.g. one USB port of a controller) |
| `channel`, `note` | only messages on that channel (1–16) / that note number |
| `toChannel` | move the message to this channel (1–16) |
| `drop: true` | ignore the message |
| `sysexNote` | a SysEx message starting with these bytes, followed by a note number and a velocity, becomes a note on `toChannel` (velocity 0 = note off) |

Rules apply in order, each to the result of the ones before. Reading SysEx needs the browser's SysEx permission
(asked once when MIDI starts); without it, everything else still works.

> The oscillator / unison / filter (incl. type) / voice-mode / pitch-envelope / LFO / delay parameters, `pages`, `pickup`, `page` on controls, `partialN.*` parameters, and the
> `page` / `nextPage` / `prevPage` / `savePreset` / `record` / `play` / `stop` / `loop` actions, and `inputs`, are web-only. The native soft-synth rejects the new parameters
> and actions, and ignores `page`, so it would treat paged knobs as if all pages were active at once.

### M-VAVE SMK-25 II template

This assumes the pads send notes 36–51 with no duplicates (out of the box, the 8th bottom pad sends note 43 like the
4th top pad; set it to 47 in the keyboard's settings). Every control on the screen is reachable from the knobs. **Knob 8 chooses the page**, and the pages are the
panel's modules in the same order (turn knob 8 left to right to walk the panel from OSC 1 to MASTER, then the
harmonics). On each page, knobs 1–7 are that module's controls from left to right, and the number badge on a
screen control shows its knob. The pages are generated from the panel layout, so the two always match.
The normal pad bank never changes the preset; the MCP bank (below) does.

| Page (knob 8, left → right) | Knobs 1–7 (CC 30–36) |
|---|---|
| **osc 1** | wave, level, harmonics brightness |
| **osc 2** | wave, level, octave, semitones, detune, pulse width |
| **mixer** | noise, chorus, chorus detune |
| **filter** | type (LP / BP / HP), cutoff, resonance, key tracking, velocity → cutoff |
| **filter env** | amount, attack, decay, sustain, release |
| **amp env** | attack, decay, sustain, release, velocity sensitivity |
| **voice** | poly / mono, glide, unison voices, spread, width, pitch envelope, pitch decay |
| **lfo** | wave, rate, → pitch, → cutoff, → volume, → pulse width |
| **fx** | delay, time, repeats, reverb, size, darkness |
| **master** | volume, transpose, pitch bend, mod |
| **levels** / **ratios** / **vel** / **decay** | that field of partials 1–7 |
| **p8** | partial 8: level, ratio, velocity, decay |

| Pad | Does |
|---|---|
| top row (notes 40–43, 48–51) | jump to page osc 1 / osc 2 / mixer / filter / filter env / amp env / voice / lfo |
| bottom row (notes 36–39, 44, 45) | jump to page fx / master / levels / ratios / vel / decay (p8: knob 8) |
| bottom row (note 46) | save the current sound into the current preset |
| bottom-right (note 47) | undo |
| PITCH strip | transpose ±12 semitones |
| MOD strip | mod wheel: extra vibrato while you hold it, on top of the preset's LFO → pitch (not saved) |

Continuous knobs use pickup, so switching pages or presets never makes values jump.

**MCP bank** (press MCP on the keyboard). These pads are meant for DAWs (Mackie Control), and the keyboard sends
them differently depending on the connection: over USB as notes on channel 1 from its third port ("ポート3" /
"Port 3"), which would clash with the keys; over Bluetooth wrapped in SysEx (`F0 35 59 10 <note> <velocity> F7`).
The template's `inputs` turn both into notes on channel 16 and drop the Mackie "Control" note (72) that the top
pads send along with their own.

| MCP pad | Does |
|---|---|
| top row 1–8 | preset slots 1–8: on the Play screen, switches the keys to the preset chosen for that slot |
| bottom row ▶ (note 94) | play the recorded take |
| bottom row ■ (93) | stop |
| bottom row ● (95) | record (press again to end the take) |
| bottom row ◀◀ / ▶▶ (91 / 92) | previous / next preset |
| bottom row bank ◀ / ▶ (46 / 47) | previous / next knob page |
| bottom row (76) | loop on / off |

The top row sends press and release at once, so it works as buttons only. If the keyboard is connected over USB
and Bluetooth at the same time, each MCP pad arrives twice (toggles such as loop would cancel out): use one connection.

## Files

| File | Role |
|---|---|
| `src/synth-worklet.js` | the synth (AudioWorklet): voices, poly / mono with glide, oscillators (PolyBLEP) with unison, additive harmonics, SVF low-pass filter, envelopes, LFO, delay, reverb |
| `src/config.js` | defaults, JSON validation, JSON formatting for saved presets |
| `src/controller.js` | MIDI message → parameter change / action / note, pages, pickup, preset saving |
| `src/midi.js` | Web MIDI input and Web Bluetooth (BLE MIDI packet parsing, including SysEx) |
| `src/input-rules.js` | the config's `inputs`: moving / dropping incoming messages, SysEx → note |
| `src/recorder.js` | the phrase recorder behind the `record` / `play` / `stop` / `loop` actions |
| `src/visuals.js` | graphs: oscilloscope, spectrum, filtered waveform / harmonics-under-filter / envelope previews |
| `src/panel.js` | the instrument panel: knob / switch / drawbar controls, module layout, on-screen keyboard |
| `src/lessons.js` / `src/lessons-ui.js` | lesson content (data) / the lessons drawer |
| `src/play.js` | the Play screen: performances, parts (one synth per preset in use), virtual pads and knobs, MIDI learn |
| `src/main.js` | the page: wiring and UI |

## Differences from the native version

- It only plays while the tab is open (no auto-start at login, no background daemon)
- A Bluetooth keyboard has to be picked once with **Connect Bluetooth MIDI keyboard** (a browser requirement)
- If the OS has the same keyboard connected too, its Web MIDI input is ignored so notes don't play twice
