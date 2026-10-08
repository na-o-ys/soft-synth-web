# soft-synth-web

**Try it: https://na-o-ys.github.io/soft-synth-web/** (Chrome or Edge recommended; press **Start**, allow MIDI access)

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
- **master** volume in the header for everything the app plays (Analog, FM, Play); remembered in this browser, double-click for 100
- Web MIDI picks up USB keyboards and any keyboard the OS has connected, and follows hot-plugging
- Web Bluetooth connects BLE MIDI keyboards directly (no Audio MIDI Setup needed) and reconnects when they drop
- **FM page**: a DX7-style 6-operator FM synth beside the subtractive one (see [FM](#fm)) — all 32 algorithms,
  every DX7 voice parameter, `.syx` import / export, its own lessons; FM presets play on the Play screen too
- **Setup screen** (the Setup button): MIDI inputs and Bluetooth, learning your controller once as virtual knobs, pads, and sliders; the Edit and Play screens
  both use them, and the config assigns their jobs by position ("pad 1-3"), not by MIDI numbers
- Three things are kept apart in the browser: the **controller settings** (JSON: what the pads and sliders do),
  the **sound library** (presets and drum kits, built on screen), and the Play **performances**
- **Drums**: synth drum sounds (kick, snare, clap, hats, crash, rim, tom, cowbell, zap) and a ready-made kit that
  fills the pads in one go; save your own pad layouts as kits
- A hardware-style panel: program display with ◀ ▶ / New / Write / Revert / Undo, five LCD screens, modules of rotary knobs
  in signal order (OSC 1 · OSC 2 · MIXER · FILTER · FILTER ENV / AMP ENV · VOICE · LFO · FX · MASTER),
  organ-style drawbars for the additive harmonics, and an on-screen keyboard that lights up the notes being played
- **New** starts from the init patch (one plain saw, filter open, no effects) without saving anything;
  **Write** asks for a name: keep it to overwrite the preset, or type a new one to save a copy
- **Play screen**: play several sounds at once — a preset on the keyboard, presets on a grid of virtual pads,
  parameters on virtual knobs — played by the controller's pads and knobs in the same positions (see below)
- **Lessons**: ten hands-on sound-design lessons in a side drawer — each step explains a few controls,
  sets them, highlights them on the panel, and plays an example (see below)
- **Undo** (button, ⌘Z / Ctrl+Z, or a pad) steps back through knob gestures, preset changes, and New;
  one continuous turn of a knob is one step
- Unsaved edits (including a New patch and the knob page) survive a page reload; `*` next to the program
  number means the sound has edits that are not written yet
- Knobs: drag up / down, mouse wheel, or arrow keys; hold Shift for fine steps (1/1000 of the range);
  double-click returns to the preset's value. Values show three significant digits, times under a second in ms
  A badge shows which controller knob moves each control on the current page (or `S1`… for a slider)
- Screens: live oscilloscope and spectrum of the output, plus the filtered waveform, the oscillator harmonics
  under the filter curve, and both envelopes, computed from the current settings
- Design sounds from the keyboard: the controller's knobs play the module you pick (with a pad, ◀ ▶ pads, or by
  touching it on screen), then save them into the current preset
- Play from the computer keyboard too (A W S E D F T G Y H U J K, Z / X for octave)

## Running

Static files only, no build step. AudioWorklet and Web MIDI do not work from `file://`, so serve it over HTTP:

```sh
node serve.mjs        # http://localhost:5173/
```

Open it and press **Start** (browsers need one click before audio can play; clicking the on-screen keyboard works too).
MIDI inputs, the controller surface, the config editor, the library export / import, and the log are on the **Setup** screen (the Setup button in the header).

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
  Click a pad to hear it and edit it below the grid. **kit ▾ → Load** fills the pads with a drum kit (and its grid
  size); **Save as kit** keeps the current pads as a kit in the library; **Delete kit** removes one.
- **KNOBS** — any number of virtual knobs (up to 16); each moves one parameter of the keys sound, the pad sounds,
  or both, on top of their presets (the presets themselves do not change). Double-click to go back to the preset value.

Every preset in use runs as its own synth, so the keyboard and pads sound together; pads with the same preset share one.

**LOOP:** record what you play on the keys and pads (physical or on screen) into a loop, then keep adding
layers while it plays, like a looper pedal. Set the tempo and length (1, 2, 4, or 8 bars of 4/4) first; they are
fixed once something is recorded.

- **● Rec** starts recording a layer (and the loop, if it is stopped); press it again to keep the take. Each take is
  one layer; clicking a layer mutes it. **↶ Undo** takes back the last recorded note, one note per press.
- **▶ Play** plays from the top and **■ Stop** stops; pressed while recording, both keep the take first.
  **Clear** removes every layer.
- **quantize 1/16** snaps each recorded note to the nearest sixteenth (keeping its length); **click** is a metronome.
- Each recorded note keeps the sound it was played with (the preset and the virtual knobs at that moment), so
  changing the keys preset, a pad, or a knob afterwards does not change what is already in the loop. Loops are
  not saved yet (a reload clears them).
- The config's `record`, `play`, `stop`, and `undoNote` actions drive the loop on this screen
  (the SMK-25 II template maps them to the MCP bank's ●, ▶, ■, and its right-hand pad).

**Preset slots:** pads the config's `"play"` list maps to `"action": "slot"` (e.g. the SMK-25 II's MCP pads) switch
the keys sound. Which preset each slot plays is chosen per performance in the **slots** row under KEYS (the slot
playing now is lit); the config only says which pad is which slot.

**Your controller on this screen:** controller pad r-c plays the Play pad in row r, column c, and controller knob k
moves knob k (learn the controller on the **Controller** screen, below). Pads and sliders the config's `"play"` list
assigns (slots, the loop's record / play / stop) do that instead. New performances take the controller's pad grid.
Notes from the keys, and sliders without an assignment (pitch bend, mod wheel), play the keys sound.

Performances are saved as you go, apart from the controller settings and the library.

## Controller

**Controller** in the top strip opens the controller screen (press it again to go back). It describes your
controller as virtual widgets and learns which physical control is which, once, for both the Edit and Play screens:

- **knobs** (1–16), **pads** as a grid of rows × columns (up to 8 × 8), and **sliders** (1–4) for strips and wheels.
  Set the numbers to match your controller; pads are named by position, `row-column` (`2-3`).
- To bind one, click it and move that control. **Learn in order** binds new controls one after another instead:
  notes fill the pads, CCs the knobs, pitch bend the sliders (click a slider first for a strip that sends a CC).
  Right-click (or ⌥-click) a widget to unbind it; **Clear all** starts over. Moving a bound control lights its widget.
- A controller with two pad banks (such as the SMK-25 II's MCP bank) can use extra rows for the second bank.

The bindings are stored in this browser apart from the config, so applying a config or a template never loses them.
Messages go through the config's `inputs` first, so a bank that `inputs` moves to another channel is learned as
that channel.

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

## Storage

The browser keeps three things apart (see `src/store.js`), so each can move elsewhere (a server) on its own:

| store | what | how it changes |
|---|---|---|
| controller settings | `inputs`, `edit`, `play`, `pickup`, `logMIDI` | the JSON under **Setup → Controller settings** |
| sound library | presets (drums are `"group": "drums"`) and kits | on screen: **Write**, **Save as kit**; **Export / Import library** under Setup |
| performances | the Play screen's performances | on screen, saved as you go |

The learned controller surface (Setup screen) is kept on its own too. A browser that still holds the old
single config splits it into these on the first start (the old one stays as `soft-synth-web:config.backup`), and the
built-in drum sounds and kit are added to an existing library.

The built-in library is [configs/library.json](configs/library.json) (its presets, drums, and kit, in the same
format as an exported library).

## Controller settings

Edit the JSON under **Setup → Controller settings** and press **Apply and save**; it is stored in this browser.
Mistakes are reported with their location, and the previous settings keep running. Applying them never touches
the sound being edited, the library, or the performances.

Templates:

- [configs/controller/default.json](configs/controller/default.json): a keyboard with knobs (they follow the Edit page) and pitch / mod wheels; no pad jobs
- [configs/controller/smk25ii.json](configs/controller/smk25ii.json): M-VAVE SMK-25 II (see below)

For another controller, learn it on the **Controller** screen, then say in `"edit"` / `"play"` what its pads and
sliders do.

```jsonc
{
  "pickup": true,                  // soft takeover for the Edit knobs (default true, see below)
  "mackie": { ... },               // the input that is a Mackie Control surface (see Transport below)
  "inputs": [ ... ],               // rewrite incoming MIDI before anything else sees it (see below)
  "edit": [ ... ],                 // what the controller's pads and sliders do on the Edit screen
  "play": [ ... ],                 // ... and on the Play screen
  "logMIDI": false                 // log every incoming message
}
```

`preset` actions name presets of the library; a missing one is reported in the log when pressed.

### Transport

Play / stop / record work from standard MIDI with nothing to learn or assign, on whichever screen is in front
(the Play screen's loop, or the Edit screen's recorder):

- **MIDI Start / Continue / Stop** (`FA` / `FB` / `FC`), from any input — e.g. a sequencer or a drum machine
- **MMC** (MIDI Machine Control, `F0 7F <device> 06 <command> F7`), from any input: play, stop, record, record exit,
  pause, fast forward / rewind
- **Mackie Control** buttons, from the input named in `"mackie"`:

```json
"mackie": {"port": ["ポート3", "Port 3"], "sysexNote": "F0 35 59 10", "buttons": {"76": "undo"}}
```

`port`: part of the input's name, or a list of them (port names can be localized). Nothing from that input plays
or reaches the controller surface. `sysexNote` (optional): a SysEx prefix some controllers wrap the button notes
in (the SMK-25 II does over Bluetooth). `buttons` (optional): other jobs for button notes (`"note": command`).

| Mackie button (note) | command | Edit | Play |
|---|---|---|---|
| ▶ play (94) | `play` | recorder: play | loop: play from the top |
| ■ stop (93) | `stop` | recorder: stop | loop: stop |
| ● record (95) | `record` | recorder: record / end the take | loop: record a layer / keep it |
| ◀◀ / ▶▶ (91 / 92) | `rewind` / `forward` | previous / next preset | — |
| bank ◀ / ▶ (46 / 47) | `bankLeft` / `bankRight` | previous / next knob page | — |
| rec-arm / select 1–8 (0–7 / 24–31) | `track1` … `track8` | preset 1–8 of the library | preset slots 1–8 |
| undo (81) | `undo` | undo | undo the last loop note |
| save (80) | `save` | write the preset | — |
| cycle (86) | `cycle` | recorder loop on / off | — |
| click (89) | `click` | — | metronome on / off |

Modifier buttons (shift, option, control, alt) do nothing on their own. With a Mackie port, the Play screen shows
eight preset slots.

**LEDs:** the Mackie port's output (the output with the same name) gets the transport's state as Mackie LED
messages — play, record, stop, cycle, and the rec-arm LED of the active slot — so a surface that lights its buttons
from the host shows where things are. Whether a surface does is up to it (the SMK-25 II may not).

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

### Presets (library)

The library (as exported) is `{"preset": startup preset, "params": values shared by every preset, "presets": [...],
"kits": [...]}`; the order of `presets` is the nextPreset / prevPreset order. A preset:

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

`"group": "drums"` files a preset under drums: preset lists show sounds and drums apart (pad sound lists put drums
first), and Write keeps the group. The drums are ordinary presets made from the synth — noise, the pitch envelope
(kick, toms, zap), and short envelopes — so they can be edited like any sound.

A kit is a pad layout: `{"name": "synth kit", "cols": 8, "rows": 2, "items": [{"preset": "kick", "note": 36, "volume": 1}, …]}`,
row by row from the top left. The built-in **synth kit** (2 × 8, for a controller with two rows of eight pads):

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| top | hat closed | hat open | crash | rim | tom (low) | tom (mid) | tom (high) | cowbell |
| bottom | kick | snare | clap | hat (soft) | kick (deep) | snare (tight) | zap (low) | zap (high) |

### Edit and play

On the Edit screen the **knobs follow the page**: the page is one panel module (OSC 1, FILTER, … then the harmonics'
LEVELS / RATIOS / VEL / DECAY), and knob k plays its k-th control from the left. A module with more controls than
your controller has knobs continues on a second page. The page changes with pads (`page`, `prevPage` / `nextPage`),
with the page buttons in the top strip, or by touching a control or module title on screen. The module being played
is lit and its controls show their knob numbers; the Setup card lists them.

Knobs use **pickup** (soft takeover by value scaling; stepped controls such as wave switches are left out): after a
preset or page change the knob's position no longer matches the value; until they meet, turning the knob moves the
value the same way, scaled so both reach the end of their range together, and from then on the knob drives the value
directly. No jumps, and the knob always responds. `"pickup": false` turns it off.

`"edit"` and `"play"` list what pads and sliders do on each screen. A pad is `"row-column"` of the controller
surface, a slider its number:

```json
{"pad": "1-4", "action": "page", "page": "filter"}
{"pad": "2-8", "action": "undo"}
{"slider": 1, "param": "transpose", "min": -12, "max": 12, "step": 1}
```

A slider moves a parameter: `curve: "exp"` is for times and ratios (min and max > 0), `step` quantizes the value,
`"pickup": true` gives it soft takeover. On the Play screen it moves the keys sound. A slider with no assignment keeps
its standard meaning (pitch bend ±2, mod wheel). Unassigned pads do nothing on the Edit screen and play the Play
pads on the Play screen.

Actions on press (pads):

| action | extra fields | does |
|---|---|---|
| `preset` | `preset` | switch to that preset |
| `nextPreset` / `prevPreset` | | next / previous preset |
| `page` | `page` (`osc 1` … `master`, `levels`, `ratios`, `vel`, `decay`) | show that module on the knobs; pressed again, its next page |
| `nextPage` / `prevPage` | | next / previous knob page |
| `pageKnob` | | (on a slider) choose the knob page by position |
| `undo` | | undo the last change (a knob gesture, a preset change, or New) |
| `savePreset` | | write the current sound into the current preset (an unsaved init patch gets the name `init`, `init-2`, …) |
| `set` | `param`, `value` | set a value |
| `add` | `param`, `value`, optional `min`, `max` | add to a value, clamped |
| `toggle` | `param`, `values: [off, on]` | flip between two values |
| `panic` | | stop every sounding note |
| `record` | | Edit: record what you play (replaces the last take), again to end it · Play: record a loop layer |
| `play` | | Edit: play the take · Play: play the loop from the top |
| `stop` | | end the recording, or stop the playback |
| `loop` | | Edit: playback loops on / off |
| `undoNote` | | Play: remove the last note recorded into the loop |
| `slot` | `slot` (1–16) | Play: switch the keys to the preset chosen for that slot on screen |

Keys, CC64 (sustain), and CC120/123 (all notes off) behave as standard MIDI on both screens.

The Edit recorder keeps one take of the notes and sustain pedal you play on the Edit screen (from the first note to
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

> The config format has moved away from the native soft-synth's: pads and sliders are assigned by controller-surface
> position in `edit` / `play` (the native version maps raw `controls`), and the synth parameters, actions, and `inputs`
> above are web-only. The two versions no longer share config files.

### M-VAVE SMK-25 II template

Learn the keyboard on the Setup screen as **8 knobs, 2 × 8 pads, and 2 sliders**:

- knobs 1–8: the eight knobs; slider 1: the PITCH strip; slider 2: the MOD strip
- pad row 1: the top row of the normal pad bank, row 2: the bottom row, left to right

With "learn in order", hit the top pads, then the bottom pads, turn knobs 1–8, and move the PITCH strip; click
slider 2 and touch the MOD strip. (Out of the box, the 8th bottom pad sends the same note as the 4th top pad; set it
to 47 in the keyboard's settings, or learn it after the other.)

| Pad | Edit | Play |
|---|---|---|
| row 1 | pages osc 1 / osc 2 / mixer / filter / filter env / amp env / voice / lfo | Play pads, row 1 |
| row 2 | pages fx / master / levels / ratios / vel / decay, write, undo | Play pads, row 2 |

| Slider | Both screens |
|---|---|
| 1 (PITCH strip) | transpose ±12 semitones |
| 2 (MOD strip) | mod wheel: extra vibrato while you hold it (not saved) |

**MCP bank** (press MCP on the keyboard): nothing to learn. Its pads are Mackie Control buttons, and the template
names the keyboard's third USB port ("ポート3" / "Port 3") as the Mackie port (see Transport): the top row is tracks
1–8 (Edit: presets 1–8; Play: slots 1–8), the bottom row ▶ ■ ● ◀◀ ▶▶ bank ◀ ▶ and an 8th pad the template makes
`undo` (it sends note 76, Mackie's "trim"). Over Bluetooth the keyboard wraps these notes in SysEx
(`F0 35 59 10 <note> <velocity> F7`), which `sysexNote` unwraps — but Chrome on macOS may mangle Bluetooth SysEx,
so use USB for the MCP bank. The template's `inputs` also drop the keyboard's "Private" USB port, which repeats
every key (it is the port for the keyboard's settings).

The top row sends press and release at once, so it works as buttons only. If the keyboard is connected over USB
and Bluetooth at the same time, each key arrives twice: use one connection.

## FM

The **FM** button opens a DX7-style 6-operator FM synth (requirements: [docs/fm-requirements.md](docs/fm-requirements.md)).

- **ALGORITHM**: the 32 DX7 algorithms drawn as a diagram (carriers on the bottom row, the feedback loop
  dashed); click an operator to select its strip. Feedback 0–7, oscillator key sync.
- **OPERATORS**: the six operators at a glance — ratio, level, and envelope shape, carriers marked amber.
  Click one (or its box in the diagram) to edit it in the panel below: envelope (with a graph), frequency
  (ratio or fixed: coarse, fine, detune), level, velocity; under **More**, keyboard level scaling, rate scaling,
  and amp mod sensitivity. The on button mutes an operator (alt-click solos it); mutes are not part of the voice.
- The layout follows modern FM editors (overview + selected operator) rather than showing all ~130 controls
  at once; LFO, PITCH EG, and PERFORMANCE are folded until you click their titles (lessons open them as needed).
- **PITCH EG**, **LFO** (six waves, speed in Hz, delay, pitch / amp mod depth, key sync, pitch sensitivity),
  **VOICE** (the 10-character name and transpose), **PERFORMANCE** (volume, reverb, bend range, mod wheel and
  aftertouch → pitch / amp, poly / mono with portamento).
- **.syx**: open or drop a DX7 file — 32-voice banks (4104 bytes), single voices (163 bytes), several messages
  in one file, or a bare 4096-byte bank. The bank window auditions voices on your keyboard (Close puts your
  sound back, Keep stays), and Import copies ticked voices into the library. **Export** saves the current voice,
  or a bank of your FM presets.
- Presets live in the same library as the subtractive ones (`"engine": "fm"`, the voice under `"fm"`); names
  are unique across both. The Analog page lists only subtractive presets, the FM page only FM ones, Play both.
- Knob pages for the controller: OP (the selected operator), OP EG, OP SCALE, LEVELS (all six output levels),
  VOICE, PITCH EG. The Analog page's page pads choose them by position; the pads after them choose the operator.
- **Lessons**: thirteen FM lessons (carrier and modulator, ratios, envelopes, feedback, algorithms, electric
  piano, bass, bells, brass, keyboard scaling, LFO, fixed-frequency percussion, reading `.syx` patches).
- The engine follows msfa / Dexed's model of the DX7 (envelope curves, level and velocity tables, scaling,
  feedback, LFO and pitch EG rates) in floating point; it is close, not bit-exact. No Yamaha voices are shipped.

## Files

| File | Role |
|---|---|
| `src/synth-worklet.js` | the synth (AudioWorklet): voices, poly / mono with glide, oscillators (PolyBLEP) with unison, additive harmonics, SVF low-pass filter, envelopes, LFO, delay, reverb |
| `src/config.js` | defaults, validation of the controller settings and the library, JSON formatting for saved presets |
| `src/store.js` | the three stores (controller settings, library, performances) and the split of an old single config |
| `src/controller.js` | the Edit screen: controller surface events → knob pages / parameter changes / actions, pickup, notes, preset saving |
| `src/surface.js` / `src/surface-ui.js` | the controller surface (virtual knobs, pads, sliders and their learned MIDI sources) / the controller surface on the Setup screen |
| `src/pages.js` | the Edit knob pages, cut from the panel modules by the number of knobs |
| `src/midi.js` | Web MIDI input and Web Bluetooth (BLE MIDI packet parsing, including SysEx) |
| `src/input-rules.js` | the config's `inputs`: moving / dropping incoming messages, SysEx → note |
| `src/transport.js` | Start / Stop, MMC, and Mackie Control buttons → commands; Mackie LED feedback |
| `src/looper.js` | the Play screen's loop: layers, quantize, playback timing, metronome |
| `src/recorder.js` | the phrase recorder behind the `record` / `play` / `stop` / `loop` actions |
| `src/visuals.js` | graphs: oscilloscope, spectrum, filtered waveform / harmonics-under-filter / envelope previews |
| `src/panel.js` | the instrument panel: knob / switch / drawbar controls, module layout, on-screen keyboard |
| `src/lessons.js` / `src/lessons-ui.js` | lesson content (data) / the lessons drawer |
| `src/play.js` | the Play screen: performances, parts (one synth per preset in use), virtual pads and knobs, slots, the loop |
| `src/fm/voice.js` | the DX7 voice model: algorithms, parameter ranges, INIT VOICE, readouts |
| `src/fm/tables.js` | DX7 tables and curves (msfa / Dexed) shared by the engine and the graphs |
| `src/fm/fm-worklet.js` | the FM engine (AudioWorklet `fm-synth`) |
| `src/fm/dx7.js` | `.syx` reading and writing (VMEM banks, VCED single voices) |
| `src/fm/fm-page.js` / `src/fm/fm-app.js` | the FM page's panel / its controller (edit buffer, presets, MIDI, knob pages, .syx) |
| `src/fm/fm-lessons.js` | the FM course |
| `test/dx7.test.mjs` | `node --test test/*.test.mjs`: sysex round trips, header variants, algorithm table |
| `src/main.js` | the page: wiring and UI |

## Differences from the native version

- It only plays while the tab is open (no auto-start at login, no background daemon)
- A Bluetooth keyboard has to be picked once with **Connect Bluetooth MIDI keyboard** (a browser requirement)
- If the OS has the same keyboard connected too, its Web MIDI input is ignored so notes don't play twice
