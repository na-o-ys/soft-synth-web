// The FM course for the lessons drawer (see lessons-ui.js). Steps set voice parameters by their flat names
// ("op2.level", "algorithm") on top of INIT VOICE: algorithm 1, one sine on OP1, every other op silent.

const EG = (op, r, l) => ({ [`op${op}.r1`]: r[0], [`op${op}.r2`]: r[1], [`op${op}.r3`]: r[2], [`op${op}.r4`]: r[3], [`op${op}.l1`]: l[0], [`op${op}.l2`]: l[1], [`op${op}.l3`]: l[2], [`op${op}.l4`]: l[3] });
const PLUCK = [96, 25, 25, 67], PLUCK_L = [99, 75, 0, 0];

export const FM_INTRO = 'Hands-on lessons in FM synthesis on a six-operator, DX7-style engine. Each step sets a few parameters (starting from INIT VOICE — a single sine), highlights them, and can play an example; then turn the knobs yourself. Set knobs rebuilds the lesson up to that step, so you can jump around; Undo (⌘Z / Ctrl+Z) brings your sound back.';

export const FM_LESSONS = [
  {
    title: 'Carrier and modulator',
    summary: 'One sine bends another: the whole idea of FM.',
    steps: [
      {
        title: 'INIT VOICE: one sine',
        start: 'init',
        set: {},
        focus: ['op1.level'],
        play: 'notes',
        text: [
          'An operator is a sine-wave oscillator with its own envelope. INIT VOICE plays just OP 1, a pure sine — the SPECTRUM screen shows a single line.',
          'In the ALGORITHM diagram, OP 1 is on the bottom row: a carrier, the kind of operator you hear. Its LEVEL is its loudness.',
        ],
      },
      {
        title: 'Add a modulator',
        set: { 'op2.level': 60 },
        focus: ['op2.level'],
        play: 'notes',
        text: [
          'OP 2 sits on top of OP 1 in algorithm 1: it is a modulator. You do not hear it — it wobbles OP 1’s phase hundreds of times a second, and that wobble turns into new harmonics.',
          'At level 60 a few harmonics appear: watch the spectrum grow side lines.',
        ],
      },
      {
        title: 'Modulator level = brightness',
        set: { 'op2.level': 85 },
        focus: ['op2.level'],
        play: 'notes',
        text: [
          'More modulator level means more harmonics: brighter, then buzzy and brassy. Turn OP 2 LEVEL slowly from 0 to 99 while playing.',
          'That is the core of FM: a carrier’s level is how loud, a modulator’s level is how bright. The steps are not even — the last 20 or so do most of the work.',
        ],
      },
    ],
  },
  {
    title: 'Ratios: which harmonics',
    summary: 'The modulator’s frequency decides the kind of tone.',
    steps: [
      {
        title: '1 : 1 — all harmonics',
        start: 'init',
        set: { 'op2.level': 80, 'op2.coarse': 1 },
        focus: ['op2.coarse'],
        play: 'notes',
        text: [
          'COARSE sets an operator’s frequency as a multiple of the note (the readout in each op’s title shows it, ×1.00).',
          'With the modulator at the same frequency as the carrier you get every harmonic: a sawtooth-like, string or brass tone.',
        ],
      },
      {
        title: '1 : 2 — odd harmonics',
        set: { 'op2.coarse': 2 },
        focus: ['op2.coarse'],
        play: 'notes',
        text: ['Modulator at twice the carrier: only the odd harmonics. Hollow, like a square wave or a clarinet.'],
      },
      {
        title: '1 : 3 and higher',
        set: { 'op2.coarse': 3 },
        focus: ['op2.coarse'],
        play: 'notes',
        text: ['At ×3 the lower harmonics thin out; at high ratios (try 7, 14) the sidebands move far above the note — glassy, or a metallic “tine”.'],
      },
      {
        title: 'Between the numbers: bells',
        set: { 'op2.fine': 50 },
        focus: ['op2.fine'],
        play: 'notes',
        text: [
          'FINE adds a fraction: 3 + 50 % = ×3.5. Now the sidebands are not multiples of the note any more — inharmonic, like a bell, a gong, or metal.',
          'Whole-number ratios sound pitched and musical; in-between ratios clang. Try fine values like 41 or 73.',
        ],
      },
    ],
  },
  {
    title: 'Envelopes: tone that moves',
    summary: 'An envelope on the modulator makes the brightness change over time.',
    steps: [
      {
        title: 'Brightness that decays',
        start: 'init',
        set: { 'op2.level': 85, ...EG(2, [99, 50, 35, 70], [99, 0, 0, 0]) },
        focus: ['op2.r2', 'op2.l2', 'op2.l3'],
        play: 'notes',
        text: [
          'Each operator has a four-stage envelope: it goes from L4 to L1 at rate R1, on to L2 at R2, to L3 at R3 and stays there while the key is held; on release it goes back to L4 at R4. Rates are speeds (99 = instant), levels are 0–99.',
          'Here OP 2’s envelope falls to 0: the note starts bright and melts into a pure sine. That is how acoustic sounds behave — the high harmonics die first.',
        ],
      },
      {
        title: 'A plucked note',
        set: EG(1, PLUCK, PLUCK_L),
        focus: ['op1.r2', 'op1.l2', 'op1.r3'],
        play: 'notes',
        text: ['Now the carrier decays too, so the note dies away: a pluck. The graph in each operator strip shows its envelope.'],
      },
      {
        title: 'Velocity on the modulator',
        set: { 'op2.velocity': 7 },
        focus: ['op2.velocity'],
        play: 'softHard',
        text: [
          'VELOCITY sensitivity lets how hard you play change an operator’s level. On a modulator, hitting harder means brighter — exactly like a real piano or guitar.',
          'Play softly, then hard. This one trick makes FM sounds feel alive.',
        ],
      },
    ],
  },
  {
    title: 'Feedback',
    summary: 'An operator modulating itself: from sine to saw to noise.',
    steps: [
      {
        title: 'One operator alone',
        start: 'init',
        set: { algorithm: 32, 'op1.level': 0, 'op6.level': 99 },
        focus: ['algorithm', 'feedback'],
        play: 'notes',
        text: [
          'Algorithm 32 puts all six operators on the bottom row: six carriers, no modulation. Only OP 6 is up — a sine.',
          'The little loop drawn at OP 6 is the feedback path: its output can modulate itself.',
        ],
      },
      {
        title: 'Feedback 5: a saw',
        set: { feedback: 5 },
        focus: ['feedback'],
        play: 'notes',
        text: ['Feeding the output back into its own phase skews the sine towards a sawtooth: bright, every harmonic. Handy for basses and leads with only one operator.'],
      },
      {
        title: 'Feedback 7: the edge',
        set: { feedback: 7 },
        focus: ['feedback'],
        play: 'notes',
        text: ['At maximum the loop gets unstable and turns noisy — a breathy, gritty edge. Useful for wind noise, snares, and dirt.'],
      },
    ],
  },
  {
    title: 'Algorithms',
    summary: 'Stacks and parallel carriers: how six operators combine.',
    steps: [
      {
        title: 'Three two-operator voices',
        start: 'init',
        set: { algorithm: 5, 'op2.level': 70, 'op3.level': 90, 'op3.coarse': 2, 'op4.level': 60, 'op5.level': 80, 'op5.coarse': 4, 'op6.level': 50 },
        focus: ['algorithm'],
        play: 'chord',
        text: [
          'Algorithm 5 is three pairs side by side: 2→1, 4→3, 6→5. Each pair is its own little FM sound and the three are mixed — here an octave layer and a two-octave layer.',
          'Click an operator in the diagram to select its strip. Muting (the on button) or soloing (alt-click) one is the fastest way to hear what it adds.',
        ],
      },
      {
        title: 'Algorithm 32: an organ',
        set: { algorithm: 32, 'op1.coarse': 0, 'op1.level': 90, 'op2.level': 99, 'op3.coarse': 2, 'op3.level': 85, 'op4.coarse': 3, 'op4.level': 80, 'op5.coarse': 4, 'op5.level': 75, 'op6.coarse': 6, 'op6.level': 70 },
        focus: ['algorithm', 'op1.level', 'op2.level', 'op3.level'],
        play: 'chord',
        text: ['Six carriers and no modulation: plain additive synthesis. With ratios ½, 1, 2, 3, 4, 6 the levels act like organ drawbars.'],
      },
      {
        title: 'Deep stacks',
        set: { algorithm: 1, 'op1.coarse': 1, 'op2.coarse': 1, 'op2.level': 70, 'op3.coarse': 1, 'op3.level': 0, 'op4.coarse': 1, 'op4.level': 0, 'op5.coarse': 1, 'op5.level': 0, 'op6.coarse': 1, 'op6.level': 0 },
        focus: ['algorithm'],
        play: 'notes',
        text: [
          'Algorithm 1 has a four-high stack 6→5→4→3. A modulator that is itself modulated produces far richer spectra — try OP 3 up as a carrier, then add OP 4, 5, 6 one at a time.',
          'Step through the algorithms with ◀ ▶: the operators keep their settings, only the wiring changes.',
        ],
      },
    ],
  },
  {
    title: 'The electric piano',
    summary: 'The sound that made the DX7 famous, built from two pairs.',
    steps: [
      {
        title: 'The body',
        start: 'init',
        set: { algorithm: 5, ...EG(1, PLUCK, PLUCK_L), 'op1.velocity': 2, 'op2.level': 78, ...EG(2, [95, 29, 20, 50], [99, 95, 0, 0]), 'op2.velocity': 6 },
        focus: ['algorithm', 'op2.level', 'op2.velocity'],
        play: 'piano',
        text: ['Pair 2→1 at 1:1 with a decaying envelope and velocity on the modulator: a warm, round, slightly brassy tone.'],
      },
      {
        title: 'The tine',
        set: { 'op3.level': 99, ...EG(3, [95, 20, 20, 50], [99, 95, 0, 0]), 'op4.coarse': 14, 'op4.level': 58, ...EG(4, [95, 50, 35, 78], [99, 75, 0, 0]), 'op4.velocity': 7 },
        focus: ['op4.coarse', 'op4.level', 'op4.r2'],
        play: 'piano',
        text: ['Pair 4→3 with a ×14 modulator that decays fast: the bell-like “ding” on the attack — the metal tine of a Rhodes. Velocity 7 makes it ring only when you hit hard.'],
      },
      {
        title: 'Chorus and keyboard tracking',
        set: { 'op1.detune': 3, 'op3.detune': -3, 'op1.rateScale': 3, 'op2.rateScale': 3, 'op3.rateScale': 3, 'op4.rateScale': 3 },
        focus: ['op1.detune', 'op3.detune', 'op1.rateScale'],
        play: 'piano',
        text: [
          'DETUNE nudges the two carriers apart by a few cents, so they beat slowly — the shimmering chorus of DX pianos, with no effect needed.',
          'RATE SCALING makes envelopes faster on higher notes, as on a real piano where high strings die sooner.',
        ],
      },
    ],
  },
  {
    title: 'Bass',
    summary: 'Two operators and feedback for a punchy bass.',
    steps: [
      {
        title: 'A 2-operator bass',
        start: 'init',
        set: { algorithm: 2, 'op1.coarse': 0, ...EG(1, [99, 40, 30, 80], [99, 80, 60, 0]), 'op2.coarse': 0, 'op2.level': 80, ...EG(2, [99, 55, 30, 80], [99, 60, 40, 0]) },
        focus: ['op1.coarse', 'op2.coarse', 'op2.level'],
        play: 'bass',
        text: ['Coarse 0 means ×0.5: both operators an octave down. The modulator’s envelope gives a bright attack that settles — the “pluck” of a bass.'],
      },
      {
        title: 'Feedback for grit',
        set: { feedback: 5 },
        focus: ['feedback'],
        play: 'bass',
        text: ['In algorithm 2 the feedback loop sits on OP 2, the modulator. Feedback there makes the modulation richer: more growl without more operators.'],
      },
      {
        title: 'Dynamics',
        set: { 'op2.velocity': 5, 'op1.velocity': 2 },
        focus: ['op2.velocity'],
        play: 'bass',
        text: ['With velocity on the modulator, accented notes bite and ghost notes stay round.'],
      },
    ],
  },
  {
    title: 'Bells and mallets',
    summary: 'Inharmonic ratios and long decays.',
    steps: [
      {
        title: 'A bell',
        start: 'init',
        set: { algorithm: 5, ...EG(1, [99, 30, 20, 30], [99, 50, 0, 0]), 'op2.coarse': 3, 'op2.fine': 50, 'op2.level': 75, ...EG(2, [99, 30, 20, 30], [99, 50, 0, 0]) },
        focus: ['op2.coarse', 'op2.fine'],
        play: 'notes',
        text: ['×3.5 is inharmonic: a bell. Long, slow decays on both operators let it ring.'],
      },
      {
        title: 'More partials',
        set: { 'op3.coarse': 2, 'op3.level': 80, ...EG(3, [99, 26, 20, 30], [99, 40, 0, 0]), 'op4.coarse': 5, 'op4.fine': 41, 'op4.level': 70, ...EG(4, [99, 40, 20, 30], [99, 30, 0, 0]) },
        focus: ['op3.coarse', 'op4.coarse', 'op4.fine'],
        play: 'notes',
        text: ['A second pair an octave up with a ×5.41 modulator adds the clangorous upper partials of a large bell.'],
      },
      {
        title: 'A marimba',
        start: 'init',
        set: { algorithm: 5, ...EG(1, [99, 45, 30, 60], [99, 0, 0, 0]), 'op2.coarse': 4, 'op2.level': 72, ...EG(2, [99, 70, 40, 60], [99, 0, 0, 0]), 'op2.velocity': 5, 'op1.rateScale': 3 },
        focus: ['op2.coarse', 'op2.r2', 'op1.r2'],
        play: 'marimba',
        text: ['Same idea, short: a ×4 modulator that vanishes almost at once gives the wooden “tock”, and a quickly decaying carrier the bar. Mallet sounds are all about fast envelopes.'],
      },
    ],
  },
  {
    title: 'Brass',
    summary: 'A slow modulator attack and a pitch blip.',
    steps: [
      {
        title: 'The swell',
        start: 'init',
        set: { algorithm: 5, ...EG(1, [72, 76, 99, 71], [99, 88, 96, 0]), 'op2.level': 86, ...EG(2, [62, 51, 29, 71], [82, 95, 96, 0]), 'op2.velocity': 4 },
        focus: ['op2.r1', 'op2.l1', 'op2.l2'],
        play: 'lead',
        text: ['Brass gets brighter as the player blows harder. The modulator’s envelope rises more slowly (R1 62) than the carrier’s, so the tone opens up after the note starts.'],
      },
      {
        title: 'The pitch blip',
        set: { pr1: 80, pl4: 47 },
        focus: ['pr1', 'pl4'],
        play: 'lead',
        text: ['The PITCH EG moves the pitch of every operator. Starting it at 47 (just under 50, no shift) and rising quickly to 50 makes each note scoop up into tune, like a horn.'],
      },
      {
        title: 'Delayed vibrato',
        set: { lfoWave: 4, lfoSpeed: 33, lfoDelay: 50, lfoPmd: 6, lfoPms: 3 },
        focus: ['lfoDelay', 'lfoPmd', 'lfoSpeed'],
        play: 'lead',
        text: ['A player adds vibrato only on long notes. LFO DELAY holds it back after each key-down. Short notes stay straight; held ones bloom.'],
      },
    ],
  },
  {
    title: 'Keyboard scaling',
    summary: 'Making a sound play evenly across the keyboard.',
    steps: [
      {
        title: 'The problem',
        start: 'init',
        set: { 'op2.level': 90 },
        focus: ['op2.level'],
        play: 'range',
        text: ['A bright 1:1 tone sounds fine in the middle but harsh and thin at the top. Real instruments get mellower and quieter up high.'],
      },
      {
        title: 'Level scaling',
        set: { 'op2.breakPoint': 39, 'op2.rightDepth': 50, 'op2.rightCurve': 0 },
        focus: ['op2.breakPoint', 'op2.rightDepth', 'op2.rightCurve'],
        play: 'range',
        text: [
          'Keyboard level scaling changes an operator’s level by key: from the BREAK POINT (C3, middle C) upwards the right curve applies, downwards the left one. −LIN with depth 50 turns the modulator down as you go up — mellower highs.',
          'The small graph in the strip shows the change across the keyboard. +curves raise the level instead (e.g. more weight in the bass).',
        ],
      },
      {
        title: 'Rate scaling',
        set: { ...EG(1, PLUCK, PLUCK_L), ...EG(2, [99, 40, 30, 60], [99, 30, 0, 0]), 'op1.rateScale': 5, 'op2.rateScale': 5 },
        focus: ['op1.rateScale', 'op2.rateScale'],
        play: 'range',
        text: ['RATE SCALING speeds the envelope up on higher keys: low notes sustain, high notes ring briefly, as on a piano or a harp.'],
      },
    ],
  },
  {
    title: 'LFO: vibrato and tremolo',
    summary: 'Pitch mod, amp mod, and the AMS switch per operator.',
    steps: [
      {
        title: 'Vibrato',
        start: 'init',
        set: { 'op2.level': 70, lfoWave: 4, lfoSpeed: 35, lfoPmd: 15, lfoPms: 3 },
        focus: ['lfoPmd', 'lfoPms', 'lfoSpeed', 'lfoWave'],
        play: 'long',
        text: [
          'The LFO is a slow oscillator shared by all notes. PITCH MOD is how much it moves the pitch; PITCH SENS scales that for this voice (0 = immune).',
          'The mod wheel adds pitch mod too (PERFORMANCE → wheel → pitch): play and push the wheel.',
        ],
      },
      {
        title: 'Tremolo',
        set: { lfoPmd: 0, lfoAmd: 60, 'op1.ams': 3 },
        focus: ['lfoAmd', 'op1.ams'],
        play: 'long',
        text: ['AMP MOD moves levels instead — but only of operators whose AMP MOD sensitivity (AMS) is above 0. On a carrier that is tremolo: the volume pulses.'],
      },
      {
        title: 'Wah: amp mod on a modulator',
        set: { 'op1.ams': 0, 'op2.ams': 3, 'op2.level': 85, lfoSpeed: 25 },
        focus: ['op1.ams', 'op2.ams'],
        play: 'long',
        text: ['Move the sensitivity to the modulator: now the LFO sweeps the brightness — a wah or a rotating speaker. Same LFO, completely different effect, chosen per operator.'],
      },
    ],
  },
  {
    title: 'Fixed frequency: percussion',
    summary: 'Operators that ignore the key.',
    steps: [
      {
        title: 'The same clang on every key',
        start: 'init',
        set: { algorithm: 5, ...EG(1, PLUCK, PLUCK_L), 'op2.mode': 1, 'op2.coarse': 2, 'op2.fine': 50, 'op2.level': 75, ...EG(2, [99, 60, 40, 70], [99, 0, 0, 0]) },
        focus: ['op2.mode', 'op2.coarse', 'op2.fine'],
        play: 'range',
        text: [
          'In FIXED mode an operator plays a frequency in Hz whatever key you press: coarse picks 1, 10, 100, or 1000 Hz, fine multiplies up to almost ×10 (here 100 Hz × 3.16 ≈ 316 Hz).',
          'A fixed modulator puts the same metallic “clang” on every note, the way a hammer or stick sounds the same whatever the pitch.',
        ],
      },
      {
        title: 'A tom',
        start: 'init',
        set: { algorithm: 5, 'op1.mode': 1, 'op1.coarse': 2, 'op1.fine': 10, ...EG(1, [99, 50, 40, 60], [99, 0, 0, 0]), 'op2.mode': 1, 'op2.coarse': 2, 'op2.fine': 40, 'op2.level': 70, ...EG(2, [99, 80, 50, 60], [99, 0, 0, 0]), pr1: 70, pl1: 50, pl2: 50, pl3: 50, pl4: 62 },
        focus: ['op1.mode', 'pl4', 'pr1'],
        play: 'toms',
        text: [
          'With the carrier fixed too, the key no longer sets the pitch at all — a drum. The PITCH EG starts high (L4 62) and drops to 50 at R1: the “doom” of a tom.',
          'Raise op1 fine for a higher drum; set feedback on OP 6 with algorithm 32 for noise-based snares and hats.',
        ],
      },
    ],
  },
  {
    title: 'Loading .syx banks',
    summary: 'Use the thousands of DX7 sounds out there, and learn from them.',
    steps: [
      {
        title: 'Open a bank',
        text: [
          'DX7 sounds are shared as .syx files: a “bank” holds 32 voices (4104 bytes), a single-voice file one. Press .syx in the header, or drop a file onto the FM page.',
          'The bank window lists the voices. Click one to try it on your keyboard — nothing is saved, and Close puts your previous sound back. Keep stays on the voice you tried; Import copies the ticked voices into your library, where the Play screen can use them too.',
        ],
      },
      {
        title: 'Read someone else’s patch',
        text: [
          'Look at the ALGORITHM first: how many carriers, which stacks. Then solo each carrier (alt-click its on button) with its modulators to hear what each part contributes.',
          'Watch the modulators’ LEVEL and envelope graphs — that is where the tone is. VELOCITY and AMS show what the patch does under your fingers and the mod wheel.',
          'Export (in the header) saves the current voice, or a bank of your FM presets, as .syx for other DX7-compatible synths (Dexed, the real thing).',
        ],
      },
    ],
  },
];
