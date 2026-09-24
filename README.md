# soft-synth-web

A gentle-sounding synth in the browser that plays whatever MIDI keyboard you connect.
It is the web port of the macOS daemon [soft-synth](https://github.com/na-o-ys/soft-synth):
same sound engine, same config format, plus a few config features for designing sounds from the keyboard.

- Additive sine synthesis + a light FDN reverb, running in an AudioWorklet
- 32-voice polyphony, sustain pedal (CC64)
- Web MIDI picks up USB keyboards and any keyboard the OS has connected, and follows hot-plugging
- Web Bluetooth connects BLE MIDI keyboards directly (no Audio MIDI Setup needed) and reconnects when they drop
- Presets and knob / pad / strip mappings are defined in JSON and saved in the browser
- Every parameter and harmonic has a slider; values moved from MIDI show up on screen
- Design sounds from the keyboard with knob pages, then save them into the current preset
- Play from the computer keyboard too (A W S E D F T G Y H U J K, Z / X for octave)

## Running

Static files only, no build step. AudioWorklet and Web MIDI do not work from `file://`, so serve it over HTTP:

```sh
node serve.mjs        # http://localhost:5173/
```

Open it and press **Start sound** (browsers need one click before audio can play).

| Browser | Web MIDI | Web Bluetooth |
|---|---|---|
| Chrome / Edge | yes | yes |
| Firefox | yes | no |
| Safari | no | no |

## Config

Edit the JSON under **Config** and press **Apply and save**; it is stored in this browser.
Mistakes are reported with their location, and the previous config keeps running.

Templates:

- [configs/default.json](configs/default.json): generic keyboard (pitch bend, mod wheel, GM CCs 7/72/73/74/91/93)
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
  "controls": [ ... ],             // MIDI mappings
  "logMIDI": false                 // log every incoming message
}
```

### Parameters

| Name | Meaning | Default |
|---|---|---|
| `volume` | master volume | 0.8 |
| `attack` / `decay` / `release` | envelope times in seconds; decay is the time constant toward sustain | 0.008 / 1.6 / 0.28 |
| `sustain` | level while the key is held, 0–1 | 0.3 |
| `brightness` | multiplier for every partial whose ratio is not 1 | 1 |
| `chorus` / `detune` | level of a slightly detuned copy of the fundamental / how far it is detuned (cents) | 0.5 / 4 |
| `reverb` / `reverbSize` / `reverbDamp` | reverb level / length (0–0.97) / darkness (0–1) | 0.22 / 0.8 / 0.65 |
| `vibrato` / `vibratoRate` | vibrato depth (semitones) / speed (Hz) | 0 / 5 |
| `velocity` | velocity sensitivity 0–1 | 0.8 |
| `transpose` | transpose in semitones (applies to held notes too) | 0 |
| `bend` | pitch bend in semitones | 0 |
| `partialN.ratio` / `.level` / `.velocity` / `.decay` | one field of harmonic N (1–8), see Presets | from the preset |

`volume`, `transpose`, and `bend` are performance state: they survive preset changes and are never saved into a preset.
Everything else is reset on a preset change to defaults ← `params` ← the preset.

### Presets

```json
{"name": "e-piano", "attack": 0.004, "sustain": 0.15,
 "partials": [
   {"ratio": 1, "level": 1},
   {"ratio": 2, "level": 0.05, "velocity": 0.3, "decay": 0.4}
 ]}
```

`partials` (up to 8) is the harmonic recipe: `ratio` is the frequency relative to the note, `level` its volume,
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
- `pickup` (default from the top-level `pickup`): soft takeover. After a preset or page change the knob's position
  no longer matches the value, so it is ignored until you turn it to (or past) the current value. Avoids jumps.

Actions on press (pads, buttons):

| action | extra fields | does |
|---|---|---|
| `preset` | `preset` | switch to that preset |
| `nextPreset` / `prevPreset` | | next / previous preset |
| `page` | `page` | switch the knob page |
| `nextPage` / `prevPage` | | next / previous knob page |
| `savePreset` | | write the current sound into the current preset (updates the config JSON and saves it) |
| `set` | `param`, `value` | set a value |
| `add` | `param`, `value`, optional `min`, `max` | add to a value, clamped |
| `toggle` | `param`, `values: [off, on]` | flip between two values |
| `panic` | | stop every sounding note |

Unmapped notes, CC64 (sustain), and CC120/123 (all notes off) behave as standard MIDI.

> `pages`, `pickup`, `page` on controls, `partialN.*` parameters, and the `page` / `nextPage` / `prevPage` / `savePreset`
> actions are web-only. The native soft-synth rejects `partialN.*` and the new actions, and ignores `page`,
> so it would treat paged knobs as if all pages were active at once.

### M-VAVE SMK-25 II template

| Control | Does |
|---|---|
| Pads, top row (notes 40–43, 48–51) | presets: soft-piano, e-piano, warm-pad, next preset, music-box, organ, strings, glass |
| Pads, bottom row (notes 36–39) | knob page: envelope / harmonics / tuning / effects |
| Pads, bottom row (notes 44, 45) | octave down / up |
| Pad, bottom row (note 46) | save the current sound into the current preset |
| Knobs 1–8 (CC 30–37), page **envelope** | volume, attack, decay, sustain, release, velocity, brightness, reverb |
| Knobs, page **harmonics** | levels of partials 2–5 (knobs 1–4), decay of partials 2–5 (knobs 5–8) |
| Knobs, page **tuning** | ratios of partials 2–5 (knobs 1–4), velocity response of partials 2–5 (knobs 5–8) |
| Knobs, page **effects** | chorus, detune, vibrato, vibratoRate, reverb, reverbSize, reverbDamp, level of partial 1 |
| PITCH strip | transpose ±12 semitones |
| MOD strip | vibrato depth |

The keyboard's 8th bottom pad sends note 43, the same as the 4th top pad, so both act as "next preset".
All knobs use pickup, so switching pages or presets never makes values jump.

## Files

| File | Role |
|---|---|
| `src/synth-worklet.js` | the synth (AudioWorklet): voices, additive synthesis, envelopes, reverb |
| `src/config.js` | defaults, JSON validation, JSON formatting for saved presets |
| `src/controller.js` | MIDI message → parameter change / action / note, pages, pickup, preset saving |
| `src/midi.js` | Web MIDI input and Web Bluetooth (BLE MIDI packet parsing) |
| `src/main.js` | the page: wiring and UI |

## Differences from the native version

- It only plays while the tab is open (no auto-start at login, no background daemon)
- A Bluetooth keyboard has to be picked once with **Connect Bluetooth MIDI keyboard** (a browser requirement)
- If the OS has the same keyboard connected too, its Web MIDI input is ignored so notes don't play twice
