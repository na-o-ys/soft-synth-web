// Sound-design lessons. Each step explains a few controls, can set them ("set", applied on top of the
// current sound, or of the init patch when start: 'init'), highlights them on the panel ("focus"), and
// can play an example ("play", one of the PHRASES below).
//
// Values use the config's names: choices by name ('saw', 'mono'), partials as 'partialN.field'.

/** Example phrases: [note, start (s), length (s), velocity] */
export const PHRASES = {
  chord: [[60, 0, 1.6, 90], [64, 0, 1.6, 90], [67, 0, 1.6, 90]],
  notes: [[60, 0, 0.3, 90], [64, 0.35, 0.3, 90], [67, 0.7, 0.3, 90], [72, 1.05, 0.6, 90]],
  range: [[48, 0, 0.5, 90], [60, 0.6, 0.5, 90], [72, 1.2, 0.5, 90], [84, 1.8, 0.5, 90]],
  softHard: [[60, 0, 0.7, 25], [64, 0, 0.7, 25], [60, 1, 0.7, 127], [64, 1, 0.7, 127]],
  long: [[60, 0, 3, 90], [64, 0, 3, 90], [67, 0, 3, 90]],
  low: [[36, 0, 3.5, 90], [43, 0, 3.5, 90], [48, 0, 3.5, 90]],
  bass: [[36, 0, 0.2, 110], [36, 0.25, 0.2, 70], [43, 0.5, 0.2, 110], [46, 0.75, 0.2, 90],
    [36, 1, 0.2, 120], [48, 1.25, 0.2, 80], [43, 1.5, 0.45, 100]],
  // overlapping notes, so mono / glide can be heard as legato slides
  legato: [[72, 0, 0.5, 100], [74, 0.45, 0.5, 100], [76, 0.9, 0.5, 100], [79, 1.35, 1.2, 100]],
  lead: [[72, 0, 0.3, 100], [76, 0.3, 0.3, 90], [79, 0.6, 1.8, 110]],
  piano: [[48, 0, 2.5, 70], [60, 0, 2.5, 80], [64, 0.02, 2.5, 80], [67, 0.04, 2.5, 80],
    [72, 1.2, 0.4, 110], [76, 1.6, 0.4, 60], [79, 2, 1.5, 100]],
  // drums: short hits in a groove (the pitch of each drum comes from the key it is played on)
  kick: [[33, 0, 0.2, 120], [33, 0.5, 0.2, 100], [33, 1, 0.2, 120], [33, 1.375, 0.1, 80], [33, 1.5, 0.2, 110]],
  toms: [[50, 0, 0.3, 110], [47, 0.2, 0.3, 105], [43, 0.4, 0.3, 110], [40, 0.6, 0.6, 120]],
  snare: [[54, 0.5, 0.15, 115], [54, 1.5, 0.15, 115], [54, 1.875, 0.08, 60]],
  hats: Array.from({ length: 16 }, (_, i) => [66, i * 0.125, 0.05, i % 2 ? 60 : 110]),
  openHat: [[66, 0, 0.05, 100], [66, 0.25, 0.4, 110], [66, 1, 0.05, 100], [66, 1.25, 0.4, 110]],
  clap: [[60, 0.5, 0.15, 115], [60, 1.5, 0.15, 115]],
  cowbell: [[72, 0, 0.12, 115], [72, 0.375, 0.12, 90], [72, 0.75, 0.12, 115], [72, 1.25, 0.12, 100]],
  zaps: [[84, 0, 0.3, 110], [79, 0.35, 0.3, 110], [72, 0.7, 0.5, 115]],
  bass808: [[36, 0, 0.7, 115], [43, 0.6, 0.35, 100], [36, 1, 0.9, 115]],
  reese: [[36, 0, 1.4, 100], [39, 1.5, 1.4, 100]],
  chip: [[72, 0, 0.14, 100], [76, 0.15, 0.14, 100], [79, 0.3, 0.14, 100], [84, 0.45, 0.28, 100],
    [79, 0.8, 0.14, 100], [84, 0.95, 0.6, 100]],
  marimba: [[60, 0, 0.3, 90], [64, 0.2, 0.3, 90], [67, 0.4, 0.3, 90], [72, 0.6, 0.3, 110],
    [76, 0.8, 0.3, 90], [79, 1, 0.8, 110]],
};

export const LESSONS = [
  {
    title: 'Oscillators: the raw sound',
    summary: 'Hear what each wave shape sounds like, and see why.',
    steps: [
      {
        title: 'The init patch',
        start: 'init',
        set: { cutoff: 20000 },
        focus: ['osc1Wave'],
        play: 'chord',
        text: [
          'Every sound starts with an oscillator: a wave repeating at the pitch of the note. This is the init patch — one sawtooth wave, nothing else.',
          'Play some notes and watch two screens: SCOPE shows the wave’s shape, FILTER shows its harmonics as bars (the note itself on the left, higher overtones to the right). The shape and the harmonics are two views of the same thing, and the harmonics are what you hear as “tone”.',
        ],
      },
      {
        title: 'Sine: no harmonics',
        set: { osc1Wave: 'sine' },
        focus: ['osc1Wave'],
        play: 'notes',
        text: [
          'A sine wave is the only wave with no overtones — FILTER shows a single bar. It sounds pure and soft, like a whistle or a tuning fork. Gentle, but thin on its own.',
        ],
      },
      {
        title: 'Triangle: soft and hollow',
        set: { osc1Wave: 'triangle' },
        focus: ['osc1Wave'],
        play: 'notes',
        text: [
          'A triangle has only the odd harmonics (3×, 5×, 7×…) and they fade quickly. Still soft, with a slightly hollow, woody color — think flute or ocarina.',
        ],
      },
      {
        title: 'Saw: bright and buzzy',
        set: { osc1Wave: 'saw' },
        focus: ['osc1Wave'],
        play: 'notes',
        text: [
          'A sawtooth has every harmonic, fading slowly — look how many bars there are. Bright and buzzy on its own, but it is the classic starting point for strings, brass, pads, and basses, because a filter has plenty to shape.',
        ],
      },
      {
        title: 'Square: hollow and reedy',
        set: { osc1Wave: 'square' },
        focus: ['osc1Wave'],
        play: 'notes',
        text: [
          'A square has only odd harmonics, and they stay strong. Hollow and reedy — a clarinet, or retro game music.',
        ],
      },
      {
        title: 'Pulse and pulse width',
        set: { osc1Wave: 'pulse', pulseWidth: 0.15 },
        focus: ['osc1Wave', 'pulseWidth'],
        play: 'notes',
        text: [
          'A pulse is a square whose “up” part is shorter than its “down” part. PW (in the OSC 2 module; it applies to both oscillators) sets that ratio: 0.5 is a square, smaller values get thinner and more nasal.',
          'Try: hold a note and turn PW slowly — the tone changes character without changing pitch.',
        ],
      },
      {
        title: 'Harmonics: build your own',
        set: { osc1Wave: 'harmonics' },
        focus: ['osc1Wave', 'partial1.level'],
        play: 'notes',
        text: [
          'The last choice turns OSC 1 into a stack of sines that you mix yourself in the ADDITIVE section below. Right now there is only partial 1, so it sounds like a sine. Lesson 9 builds organs and bells this way.',
        ],
      },
    ],
  },

  {
    title: 'The filter: sculpting brightness',
    summary: 'Cutoff, resonance, key tracking, and playing dynamics.',
    steps: [
      {
        title: 'A bright starting point',
        start: 'init',
        set: { osc1Wave: 'saw', cutoff: 20000 },
        focus: ['cutoff'],
        play: 'chord',
        text: [
          'Subtractive synthesis means starting from a bright wave and removing harmonics with a filter. This one is a low-pass filter: it lets lower frequencies pass and removes the ones above the CUTOFF.',
          'At 20 kHz the filter is fully open, so you hear the raw saw.',
        ],
      },
      {
        title: 'Lower the cutoff',
        set: { cutoff: 800 },
        focus: ['cutoff'],
        play: 'chord',
        text: [
          'At 800 Hz the sound is warmer and darker. On the FILTER screen, the curve now bends down and the bars to its right shrink; on WAVE the saw’s sharp edge rounds off.',
          'Try: hold a note and sweep CUTOFF slowly from right to left. This single knob is the most expressive control on most synths.',
        ],
      },
      {
        title: 'Very low',
        set: { cutoff: 250 },
        focus: ['cutoff'],
        play: 'chord',
        text: [
          'At 250 Hz only the lowest harmonics remain: muffled, like music through a wall. When the cutoff falls below a note’s own pitch, the note also gets quieter.',
        ],
      },
      {
        title: 'Resonance',
        set: { cutoff: 700, resonance: 0.8 },
        focus: ['resonance', 'cutoff'],
        play: 'long',
        text: [
          'RESO boosts the harmonics right at the cutoff — see the peak on the FILTER curve. It gives a nasal, “singing” edge.',
          'Try: hold the chord and sweep CUTOFF now. The moving peak is the classic synth “wow” sweep. High resonance can get loud and whistly, so go gently.',
        ],
      },
      {
        title: 'Key tracking',
        set: { resonance: 0.2, cutoff: 500, keyTrack: 0 },
        focus: ['keyTrack'],
        play: 'range',
        text: [
          'Listen to the example: low notes sound fine, but high notes get duller and duller, because the cutoff stays at 500 Hz while the notes climb past it.',
          'Now set KEY TRK to 1 and play the example again: the cutoff moves up with the note (one octave per octave), so every note is equally bright. The CUTOFF value then means “the cutoff at middle C”.',
        ],
      },
      {
        title: 'Brighter when you play harder',
        set: { keyTrack: 1, velFilter: 2 },
        focus: ['velFilter'],
        play: 'softHard',
        text: [
          'VELOCITY (in the FILTER module) opens the cutoff when you hit the keys harder — here by up to 2 octaves. The example plays softly, then hard.',
          'Acoustic instruments work this way: louder also means brighter. It makes a synth feel much more responsive to your playing.',
        ],
      },
    ],
  },

  {
    title: 'Envelopes: sound over time',
    summary: 'Shape volume and brightness from key-down to release.',
    steps: [
      {
        title: 'The amp envelope',
        start: 'init',
        set: { osc1Wave: 'saw', cutoff: 2000 },
        focus: ['attack', 'decay', 'sustain', 'release'],
        play: 'notes',
        text: [
          'An envelope describes how something changes after you press a key. The AMP ENV shapes the volume with four knobs:',
          'ATTACK — how long it takes to fade in. DECAY — how fast it falls toward the sustain level. SUSTAIN — the level while you keep holding the key. RELEASE — how long it takes to fade out after you let go. The solid line on the ENVELOPES screen draws the result.',
        ],
      },
      {
        title: 'Organ: on / off',
        set: { attack: 0.003, decay: 1, sustain: 1, release: 0.04 },
        focus: ['attack', 'sustain', 'release'],
        play: 'notes',
        text: [
          'Instant attack, full level while held, stops at once when released: the shape of an organ.',
        ],
      },
      {
        title: 'Pluck: sustain 0',
        set: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
        focus: ['decay', 'sustain'],
        play: 'notes',
        text: [
          'With SUSTAIN at 0 the sound dies away even while you hold the key, and DECAY sets how fast. This is the shape of anything plucked or struck — guitar, marimba, piano.',
          'Try DECAY at 1 s: the same pluck rings much longer.',
        ],
      },
      {
        title: 'Swell: slow attack, long release',
        set: { attack: 1.2, decay: 2, sustain: 0.9, release: 1.5 },
        focus: ['attack', 'release'],
        play: 'long',
        text: [
          'A slow ATTACK fades the sound in; a long RELEASE lets it linger after you let go. Strings and pads live here. Play slow, connected chords.',
        ],
      },
      {
        title: 'The filter envelope: brass',
        set: {
          attack: 0.03, decay: 1.5, sustain: 0.8, release: 0.25,
          cutoff: 350, keyTrack: 0.6, filterEnv: 3, fAttack: 0.08, fDecay: 0.6, fSustain: 0.4,
        },
        focus: ['filterEnv', 'fAttack', 'fDecay', 'fSustain'],
        play: 'notes',
        text: [
          'FILTER ENV is a second envelope that moves the cutoff instead of the volume. AMOUNT is how far it opens, in octaves (here 350 Hz × 2³ ≈ 2.8 kHz at its peak). The dashed line on ENVELOPES shows it.',
          'A slightly slow filter ATTACK (80 ms) gives the “bwah” of brass: the tone brightens just after the note starts, then settles.',
        ],
      },
      {
        title: 'The filter envelope: pluck',
        set: {
          attack: 0.002, decay: 0.5, sustain: 0, release: 0.2,
          cutoff: 200, filterEnv: 5, fAttack: 0.001, fDecay: 0.15, fSustain: 0,
        },
        focus: ['filterEnv', 'fDecay'],
        play: 'notes',
        text: [
          'Now the filter opens instantly and closes fast: a bright “pick” at the start of every note, then a round tone. Most plucked synth sounds are built from exactly this.',
          'Try: change the filter DECAY between 0.05 s and 0.5 s and listen to the pick soften.',
        ],
      },
    ],
  },

  {
    title: 'Synth piano',
    summary: 'Put oscillator, filter, and envelopes together into a piano-like sound.',
    steps: [
      {
        title: 'Start from the saw',
        start: 'init',
        set: { osc1Wave: 'saw', osc1Level: 0.8 },
        focus: ['osc1Wave'],
        play: 'piano',
        text: [
          'A piano’s character is: bright when the hammer hits, quickly rounder, and fading away even while you hold the key. We will build exactly that from a saw.',
        ],
      },
      {
        title: 'Piano-shaped volume',
        set: { attack: 0.002, decay: 2.5, sustain: 0, release: 0.3 },
        focus: ['attack', 'decay', 'sustain', 'release'],
        play: 'piano',
        text: [
          'Instant attack, SUSTAIN 0 so it fades while held, a long DECAY (it is mostly gone after about three times that), and a short RELEASE like the damper stopping the string. The shape is right; the tone is still buzzy.',
        ],
      },
      {
        title: 'Take the buzz away',
        set: { cutoff: 300 },
        focus: ['cutoff'],
        play: 'piano',
        text: [
          'A low cutoff makes it round and muffled — too dark on purpose. The next step brings the brightness back, but only at the start of each note.',
        ],
      },
      {
        title: 'The hammer: filter envelope',
        set: { filterEnv: 3.5, fAttack: 0.001, fDecay: 0.6, fSustain: 0, fRelease: 0.3 },
        focus: ['filterEnv', 'fAttack', 'fDecay', 'fSustain'],
        play: 'piano',
        text: [
          'The filter opens instantly by 3.5 octaves and closes over about half a second. Now every note starts with a bright “clang” and mellows — this is the heart of the sound.',
          'Shorter filter DECAY = harder, more percussive; longer = sparkly.',
        ],
      },
      {
        title: 'Even brightness across the keyboard',
        set: { keyTrack: 1 },
        focus: ['keyTrack'],
        play: 'range',
        text: [
          'KEY TRK 1 moves the cutoff with the note, so high notes are not muffled.',
        ],
      },
      {
        title: 'Touch sensitivity',
        set: { velFilter: 2, velocity: 0.8 },
        focus: ['velFilter', 'velocity'],
        play: 'softHard',
        text: [
          'Harder playing now opens the filter by up to 2 more octaves (FILTER VELOCITY) and is louder (AMP ENV VELOCITY). Soft = dark and gentle, hard = bright and loud, like a real piano.',
        ],
      },
      {
        title: 'A little body on top',
        set: { osc2Wave: 'triangle', osc2Octave: 1, osc2Level: 0.3 },
        focus: ['osc2Wave', 'osc2Octave', 'osc2Level'],
        play: 'piano',
        text: [
          'A quiet triangle an octave up adds a clear upper tone. Keep it low — too much sounds like an organ.',
        ],
      },
      {
        title: 'Strings slightly out of tune',
        set: { unison: 2, unisonDetune: 6, unisonWidth: 0.5 },
        focus: ['unison', 'unisonDetune', 'unisonWidth'],
        play: 'piano',
        text: [
          'Each piano note has two or three strings, tuned very slightly apart. Two unison voices 6 cents apart give that slow, living shimmer. Try 20 cents for a honky-tonk saloon piano.',
        ],
      },
      {
        title: 'A room to play in',
        set: { reverb: 0.25, reverbSize: 0.85 },
        focus: ['reverb', 'reverbSize'],
        play: 'piano',
        text: [
          'A little reverb and it is done. Press Write to save it as a new preset.',
          'This is a synth piano, not a sampled one — it keeps the piano’s behavior (bright hit, mellow decay, touch) rather than its exact sound.',
        ],
      },
    ],
  },

  {
    title: 'Thick and wide',
    summary: 'Detune, intervals, unison, and chorus.',
    steps: [
      {
        title: 'One oscillator',
        start: 'init',
        set: { osc1Wave: 'saw', cutoff: 3000, attack: 0.05, sustain: 0.9, release: 0.5 },
        focus: ['osc1Wave'],
        play: 'long',
        text: [
          'A single saw: clear, but thin and static. Let’s thicken it.',
        ],
      },
      {
        title: 'Two identical oscillators',
        set: { osc2Wave: 'saw', osc2Level: 1, osc2Detune: 0 },
        focus: ['osc2Level'],
        play: 'long',
        text: [
          'OSC 2 playing exactly the same wave just makes it louder — the timbre does not change.',
        ],
      },
      {
        title: 'Detune',
        set: { osc2Detune: 8 },
        focus: ['osc2Detune'],
        play: 'long',
        text: [
          'Detune OSC 2 by 8 cents (a cent is 1/100 of a semitone). The two waves now drift in and out of step, and you hear a slow, rich movement. More cents = faster and more out-of-tune; 3–10 is the sweet spot.',
        ],
      },
      {
        title: 'A sub octave',
        set: { osc2Detune: 0, osc2Octave: -1 },
        focus: ['osc2Octave'],
        play: 'chord',
        text: [
          'OSC 2 an octave below adds weight and depth — a “sub oscillator”. +1 octave instead adds sparkle.',
        ],
      },
      {
        title: 'Intervals',
        set: { osc2Octave: 0, osc2Semi: 7 },
        focus: ['osc2Semi'],
        play: 'notes',
        text: [
          '7 semitones is a fifth: every key now plays a two-note “power chord”. A staple of 80s leads and brass stabs. Try 5 (a fourth) or 12 (an octave). Careful with chords — the intervals stack up.',
        ],
      },
      {
        title: 'Unison: the supersaw',
        set: { osc2Semi: 0, osc2Level: 0.7, osc2Detune: 0, unison: 5, unisonDetune: 25, unisonWidth: 0.9 },
        focus: ['unison', 'unisonDetune', 'unisonWidth'],
        play: 'long',
        text: [
          'Unison (in the VOICE module) stacks several slightly detuned copies of both oscillators. UNISON is how many, SPREAD how far apart (in cents), WIDTH how far they spread left and right. This is the huge “supersaw” of trance and EDM pads.',
          'It works on the basic waves; the harmonics wave is not stacked.',
        ],
      },
      {
        title: 'Chorus: gentle width',
        set: { unison: 1, osc2Level: 0, osc1Wave: 'triangle', chorus: 0.6, detune: 8 },
        focus: ['chorus', 'detune'],
        play: 'long',
        text: [
          'CHORUS mixes in a sine at the note’s pitch, detuned by CH DETUNE cents and placed a bit more to one side. It widens soft sounds without adding brightness — the soft presets all use it.',
          'If a sound seems to “wobble”, CHORUS or a detune is often why: lower CH DETUNE for a slower, calmer beat.',
        ],
      },
    ],
  },

  {
    title: 'Bass: mono, glide, sub',
    summary: 'One-note-at-a-time playing and pitch slides.',
    steps: [
      {
        title: 'A classic bass',
        start: 'init',
        set: {
          osc1Wave: 'saw', osc2Wave: 'square', osc2Level: 0.6, osc2Octave: -1,
          cutoff: 300, resonance: 0.25, keyTrack: 0.3, filterEnv: 2.5, fAttack: 0.002, fDecay: 0.25, fSustain: 0.15,
          attack: 0.003, decay: 0.6, sustain: 0.7, release: 0.1,
        },
        focus: ['osc2Octave', 'cutoff', 'filterEnv', 'fDecay'],
        play: 'bass',
        text: [
          'A saw plus a square one octave below (the sub), a low cutoff, and a short filter-envelope “blip” on every note. Play in the low octaves (C1–C3).',
        ],
      },
      {
        title: 'Mono',
        set: { mono: 'mono' },
        focus: ['mono'],
        play: 'legato',
        text: [
          'MONO plays one note at a time, like a bass player or singer. Hold one key and press another: the new note takes over without restarting its envelopes (legato). Release it and the held note comes back.',
        ],
      },
      {
        title: 'Glide',
        set: { glide: 0.08 },
        focus: ['glide'],
        play: 'legato',
        text: [
          'GLIDE (portamento) slides the pitch from the previous note instead of jumping. A short glide is a subtle swoop; try 0.3 s for a dramatic slide. It works in poly mode too.',
        ],
      },
      {
        title: 'Touch',
        set: { velFilter: 1.5, velocity: 0.5 },
        focus: ['velFilter', 'velocity'],
        play: 'bass',
        text: [
          'Harder notes are brighter and punchier, soft ones a round thump — the example accents some notes.',
        ],
      },
      {
        title: 'Acid squelch',
        set: { resonance: 0.7, cutoff: 220, filterEnv: 3.5, fDecay: 0.18, osc2Level: 0.3 },
        focus: ['resonance', 'cutoff', 'filterEnv'],
        play: 'bass',
        text: [
          'High resonance plus a snappy filter envelope makes the squelchy, talking bass of acid house. Sweep CUTOFF and filter DECAY while the example plays.',
        ],
      },
    ],
  },

  {
    title: 'Lead: vibrato and expression',
    summary: 'The LFO for vibrato, the mod wheel, and delay.',
    steps: [
      {
        title: 'A lead sound',
        start: 'init',
        set: {
          osc1Wave: 'saw', osc2Wave: 'square', osc2Level: 0.5, osc2Detune: 7,
          cutoff: 900, keyTrack: 0.6, filterEnv: 2, fDecay: 0.5, fSustain: 0.5,
          sustain: 0.9, release: 0.2, mono: 'mono', glide: 0.06, reverb: 0.2,
        },
        focus: ['mono', 'glide'],
        play: 'lead',
        text: [
          'A mono lead with a touch of glide. It sounds good, but long notes are a little lifeless.',
        ],
      },
      {
        title: 'Vibrato with the LFO',
        set: { lfoWave: 'sine', vibratoRate: 5.5, vibrato: 0.12 },
        focus: ['lfoWave', 'vibratoRate', 'vibrato'],
        play: 'lead',
        text: [
          'The LFO (low-frequency oscillator) is an oscillator too slow to hear; instead, it moves other things. → PITCH sends it to the pitch: vibrato. RATE is its speed (5–6 Hz sounds natural), → PITCH the depth in semitones.',
        ],
      },
      {
        title: 'Vibrato when you want it',
        set: { vibrato: 0 },
        focus: ['modWheel'],
        play: 'lead',
        text: [
          'Singers and violinists add vibrato mainly on long notes. With → PITCH back at 0, hold a note and push the MOD strip on your keyboard (or turn MOD in the MASTER module): vibrato appears on top of the preset’s own, and goes away when you release it.',
          'MOD is performance only — it is not saved in presets.',
        ],
      },
      {
        title: 'Echoes',
        set: { delay: 0.3, delayTime: 0.3, delayFeedback: 0.35 },
        focus: ['delay', 'delayTime', 'delayFeedback'],
        play: 'lead',
        text: [
          'DELAY repeats what you play, bouncing left and right and softening each time. In the FX module, DELAY is how loud the echoes are, TIME the gap between them, and REPEATS how long they keep going. A little makes a lead line bigger without blurring it.',
        ],
      },
    ],
  },

  {
    title: 'Movement with the LFO',
    summary: 'Wah, wave shapes, random bleeps, tremolo, and PWM.',
    steps: [
      {
        title: 'Wah: LFO → cutoff',
        start: 'init',
        set: { osc1Wave: 'saw', cutoff: 600, resonance: 0.5, lfoWave: 'sine', vibratoRate: 2, lfoFilter: 1.5 },
        focus: ['lfoFilter', 'vibratoRate', 'cutoff'],
        play: 'long',
        text: [
          '→ CUTOFF lets the LFO sweep the filter up and down by that many octaves: a “wah” or “wobble”. RATE sets how fast.',
          'Try RATE at 0.3 Hz for a slow breathing pad, or 6 Hz for a fast warble.',
        ],
      },
      {
        title: 'The LFO’s shape',
        set: { lfoWave: 'square', vibratoRate: 3 },
        focus: ['lfoWave'],
        play: 'long',
        text: [
          'The LFO has wave shapes too. Square jumps between two cutoffs (“wah-wah”), saw ramps up and snaps back, triangle sweeps evenly like the sine but with sharper turns.',
        ],
      },
      {
        title: 'Random: sci-fi bleeps',
        set: { lfoWave: 'random', vibratoRate: 8, lfoFilter: 2, resonance: 0.75 },
        focus: ['lfoWave', 'vibratoRate'],
        play: 'long',
        text: [
          'random picks a new value every cycle (“sample & hold”). Sent to a resonant filter it makes the burbling computer sounds of old science-fiction films.',
        ],
      },
      {
        title: 'Tremolo: LFO → volume',
        set: { osc1Wave: 'triangle', lfoFilter: 0, resonance: 0, cutoff: 20000, lfoWave: 'sine', vibratoRate: 6, lfoAmp: 0.7 },
        focus: ['lfoAmp'],
        play: 'chord',
        text: [
          '→ VOLUME makes the level pulse: tremolo, as on a vintage electric piano or a guitar amp.',
        ],
      },
      {
        title: 'PWM: shimmering strings',
        set: {
          osc1Wave: 'pulse', pulseWidth: 0.5, lfoAmp: 0, lfoWave: 'triangle', vibratoRate: 0.8, lfoPwm: 0.35,
          cutoff: 3000, keyTrack: 0.5, attack: 0.3, sustain: 0.85, release: 0.8, reverb: 0.3,
        },
        focus: ['lfoPwm', 'pulseWidth'],
        play: 'long',
        text: [
          '→ PW slowly changes the pulse width. The tone shimmers as if several players were bowing together — pulse-width modulation, the lush string pad of classic analog synths.',
        ],
      },
    ],
  },

  {
    title: 'Additive: build a wave from harmonics',
    summary: 'Organ drawbars, bells, and a touch-sensitive electric piano.',
    steps: [
      {
        title: 'One sine',
        start: 'init',
        set: { osc1Wave: 'harmonics', attack: 0.005, sustain: 1, release: 0.08 },
        focus: ['osc1Wave', 'partial1.level'],
        play: 'chord',
        text: [
          'With the harmonics wave, OSC 1 becomes a stack of up to eight sines (the ADDITIVE section). Each column is one sine: its level (drawbar), RATIO (its frequency as a multiple of the note), VEL, and DECAY. Right now only partial 1 plays: a pure sine.',
        ],
      },
      {
        title: 'Organ drawbars',
        set: { 'partial2.level': 0.6, 'partial3.level': 0.4, 'partial4.level': 0.3 },
        focus: ['partial2.level', 'partial3.level', 'partial4.level'],
        play: 'chord',
        text: [
          'Pull up partials 2–4: sines at 2×, 3×, and 4× the note. This is exactly how a Hammond organ’s drawbars work. Watch WAVE change shape as you move them.',
        ],
      },
      {
        title: 'A sub-octave',
        set: { 'partial5.ratio': 0.5, 'partial5.level': 0.5 },
        focus: ['partial5.ratio', 'partial5.level'],
        play: 'chord',
        text: [
          'A RATIO of 0.5 plays an octave below the note — the organ’s deep “16-foot” drawbar.',
        ],
      },
      {
        title: 'A bell: inharmonic ratios',
        set: {
          'partial1.decay': 3,
          'partial2.ratio': 2.76, 'partial2.level': 0.5, 'partial2.decay': 1.2,
          'partial3.ratio': 5.4, 'partial3.level': 0.3, 'partial3.decay': 0.5,
          'partial4.ratio': 8.9, 'partial4.level': 0.15, 'partial4.decay': 0.25,
          'partial5.level': 0,
          attack: 0.002, decay: 3, sustain: 0, release: 1.5, reverb: 0.35,
        },
        focus: ['partial2.ratio', 'partial3.ratio', 'partial4.ratio', 'partial2.decay'],
        play: 'notes',
        text: [
          'Whole-number ratios sound musical and blend into one tone. Ratios like 2.76 and 5.4 do not — that clash is what makes bells, glass, and metal sound metallic.',
          'Each partial’s DECAY lets the high ones fade first, as in a real bell. Try nudging a RATIO slightly and listen to the character change.',
        ],
      },
      {
        title: 'Electric piano: harmonics that follow your touch',
        set: {
          'partial1.decay': 0,
          'partial2.ratio': 2, 'partial2.level': 0.05, 'partial2.velocity': 0.3, 'partial2.decay': 0.4,
          'partial3.ratio': 3, 'partial3.level': 0, 'partial3.velocity': 0.1, 'partial3.decay': 0.15,
          'partial4.ratio': 7, 'partial4.level': 0, 'partial4.velocity': 0.06, 'partial4.decay': 0.05,
          attack: 0.004, decay: 2.2, sustain: 0.15, release: 0.35, chorus: 0.5, detune: 5, reverb: 0.2,
        },
        focus: ['partial2.velocity', 'partial3.velocity', 'partial4.velocity'],
        play: 'softHard',
        text: [
          'VEL adds a partial only when you play hard, and a short DECAY makes it vanish quickly. Soft notes are round; hard notes get a bright “bark” at the start — the tine of an electric piano.',
        ],
      },
      {
        title: 'Brightness',
        set: { brightness: 1.8 },
        focus: ['brightness'],
        play: 'softHard',
        text: [
          'HARM BRIGHT scales every partial except the note itself at once — a quick way to make a whole recipe darker (below 1) or brighter (above 1).',
        ],
      },
    ],
  },

  {
    title: 'Effects, noise, and space',
    summary: 'Reverb, tempo delay, breath, and wind.',
    steps: [
      {
        title: 'Dry',
        start: 'init',
        set: { osc1Wave: 'triangle', attack: 0.005, decay: 0.6, sustain: 0, release: 0.3, cutoff: 4000 },
        focus: [],
        play: 'notes',
        text: [
          'A short, dry pluck. Everything so far happened inside each note; effects work on everything that comes out.',
        ],
      },
      {
        title: 'Reverb',
        set: { reverb: 0.35, reverbSize: 0.9, reverbDamp: 0.7 },
        focus: ['reverb', 'reverbSize', 'reverbDamp'],
        play: 'notes',
        text: [
          'Reverb places the sound in a room. The REVERB knob is how much room, SIZE how long the tail lasts, DARK how muffled the reflections are (darker is gentler, like a hall with curtains).',
        ],
      },
      {
        title: 'Delay in time',
        set: { delay: 0.35, delayTime: 0.375, delayFeedback: 0.45 },
        focus: ['delay', 'delayTime', 'delayFeedback'],
        play: 'notes',
        text: [
          'Set delay TIME to your song’s tempo and the echoes become part of the rhythm: 0.375 s is an eighth note at 80 BPM (one beat = 60 / BPM seconds).',
        ],
      },
      {
        title: 'Breath: a touch of noise',
        set: {
          delay: 0, osc1Wave: 'triangle', noise: 0.08, cutoff: 2500, keyTrack: 0.8,
          attack: 0.08, decay: 1, sustain: 0.9, release: 0.2, lfoWave: 'sine', vibratoRate: 5, vibrato: 0.05,
        },
        focus: ['noise'],
        play: 'lead',
        text: [
          'NOISE adds a hiss that goes through the filter with everything else. A little gives the breathy edge of a flute or a pan pipe; the gentle vibrato helps too.',
        ],
      },
      {
        title: 'Wind',
        set: {
          osc1Level: 0, noise: 1, cutoff: 800, keyTrack: 0.5, resonance: 0.8, vibrato: 0,
          lfoWave: 'sine', vibratoRate: 0.2, lfoFilter: 1.5, attack: 1, sustain: 1, release: 2, reverb: 0.4,
        },
        focus: ['noise', 'resonance', 'lfoFilter'],
        play: 'low',
        text: [
          'No oscillator at all: just noise, a resonant filter, and a very slow LFO sweeping the cutoff. That is wind. The notes you play set where the resonant “whistle” sits.',
          'Sound design is often like this — combining a few simple parts in an unusual way.',
        ],
      },
    ],
  },

  {
    title: 'Percussion: drums from scratch',
    summary: 'Kick, tom, snare, hi-hats, clap, and cowbell from oscillators and noise.',
    steps: [
      {
        title: 'Kick: a falling sine',
        start: 'init',
        set: {
          osc1Wave: 'sine', chorus: 0, pitchEnv: 24, pitchDecay: 0.04,
          attack: 0.001, decay: 0.35, sustain: 0, release: 0.3, velocity: 0.5,
        },
        focus: ['pitchEnv', 'pitchDecay', 'decay'],
        play: 'kick',
        text: [
          'Drum machines like the TR-808 make a kick from a sine wave whose pitch drops fast. PITCH ENV (in the VOICE module) starts every note that many semitones higher — here 24, two octaves — and P DECAY sets how fast it falls back to the key you play.',
          'The key sets the drum’s pitch: the example plays A1 (55 Hz); try the keys around it. Try P DECAY at 0.1 s for a boomy 808, or 0.02 s for a tight punch; a longer amp DECAY makes the tail ring.',
        ],
      },
      {
        title: 'Toms: same idea, higher',
        start: 'init',
        set: {
          osc1Wave: 'triangle', chorus: 0, pitchEnv: 12, pitchDecay: 0.08,
          attack: 0.001, decay: 0.4, sustain: 0, release: 0.3, reverb: 0.15,
        },
        focus: ['osc1Wave', 'pitchEnv', 'pitchDecay'],
        play: 'toms',
        text: [
          'A smaller drop (one octave) that falls more slowly, on a triangle for a little more body. Play different keys for high, mid, and floor toms — the example rolls down the kit.',
        ],
      },
      {
        title: 'Snare: tone + noise',
        start: 'init',
        set: {
          osc1Wave: 'triangle', osc1Level: 0.25, chorus: 0, pitchEnv: 24, pitchDecay: 0.01, noise: 0.8,
          cutoff: 8000, attack: 0.001, decay: 0.12, sustain: 0, release: 0.12,
        },
        focus: ['noise', 'osc1Level', 'pitchEnv', 'pitchDecay'],
        play: 'snare',
        text: [
          'A real snare is a drum head (a short tone) plus the rattling wires underneath (noise). Here the triangle is the head and NOISE the wires.',
          'A drum should not sound like a note, so the head is kept quiet (LEVEL 0.25) and its pitch falls two octaves within about 10 ms (PITCH ENV 24, P DECAY 0.01 s): you hear a thud, not a “pong”. Raise LEVEL or slow P DECAY and the pitch comes back.',
          'Try: more NOISE and a shorter DECAY for a tight, modern snare; lower CUTOFF for a softer, vintage one. For no body at all, set the filter to HP around 400 Hz.',
        ],
      },
      {
        title: 'Closed hi-hat: noise through a high-pass',
        start: 'init',
        set: {
          osc1Level: 0, noise: 1, chorus: 0, filterType: 'high-pass', cutoff: 7000, resonance: 0.2,
          attack: 0.001, decay: 0.02, sustain: 0, release: 0.02, velocity: 0.7,
        },
        focus: ['filterType', 'cutoff', 'decay'],
        play: 'hats',
        text: [
          'Cymbals are mostly high noise. The filter’s HP (high-pass) setting does the opposite of the low-pass: it removes everything below the CUTOFF, leaving only the sizzle. A very short DECAY makes it a closed “tss”.',
          'The example accents every other hit — hi-hats come alive with velocity. Raise CUTOFF for a thinner, brighter hat.',
        ],
      },
      {
        title: 'Open hi-hat',
        set: { decay: 0.3, release: 0.25 },
        focus: ['decay', 'release'],
        play: 'openHat',
        text: [
          'Same sound, longer DECAY and RELEASE: the hat rings open. On a drum machine the next closed hat usually cuts it off; here, just keep it short enough to breathe.',
        ],
      },
      {
        title: 'Clap: a band of noise',
        start: 'init',
        set: {
          osc1Level: 0, noise: 1, chorus: 0, filterType: 'band-pass', cutoff: 1500, resonance: 0.1,
          attack: 0.001, decay: 0.13, sustain: 0, release: 0.15, reverb: 0.3, reverbSize: 0.6,
        },
        focus: ['filterType', 'cutoff', 'resonance'],
        play: 'clap',
        text: [
          'BP (band-pass) keeps only a band of frequencies around the CUTOFF and removes both sides: noise becomes a papery “clack” in the middle of the spectrum. A small room of reverb makes it sound like hands in a room.',
          'RESO narrows the band: turn it up and the clap turns into a pitched, ringing noise.',
        ],
      },
      {
        title: 'Cowbell: two squares',
        start: 'init',
        set: {
          osc1Wave: 'square', osc2Wave: 'square', osc2Level: 1, osc2Semi: 7, osc2Detune: -20, chorus: 0,
          filterType: 'band-pass', cutoff: 700, resonance: 0.5,
          attack: 0.001, decay: 0.12, sustain: 0, release: 0.1,
        },
        focus: ['osc2Semi', 'osc2Detune', 'filterType'],
        play: 'cowbell',
        text: [
          'The famous 808 cowbell is just two square waves about 6.8 semitones apart (here +7 semitones −20 cents), through a band-pass filter, with a short decay. Two tones that do not form a musical interval sound metallic.',
          'That is a drum kit from one synth: pitch drops for drums, filtered noise for cymbals and claps, clashing tones for metal. Save each one with Write to build your own kit.',
        ],
      },
    ],
  },

  {
    title: 'Classic sounds',
    summary: '808 bass, reese bass, chiptune lead, marimba, sweep pad, laser.',
    steps: [
      {
        title: '808 bass',
        start: 'init',
        set: {
          osc1Wave: 'sine', chorus: 0, pitchEnv: 12, pitchDecay: 0.05,
          attack: 0.002, decay: 1.2, sustain: 0, release: 0.3, velocity: 0.4, mono: 'mono', glide: 0.05,
        },
        focus: ['pitchEnv', 'decay', 'glide'],
        play: 'bass808',
        text: [
          'The hip-hop and trap bass is a kick drum that you play in tune: a sine with a short pitch drop for the punch, and a long DECAY so the note booms. Mono and a little GLIDE give the sliding notes between hits.',
          'Play it low (C1–C2). It is almost a pure sine, so it is felt more than heard on small speakers.',
        ],
      },
      {
        title: 'Reese bass',
        start: 'init',
        set: {
          osc1Wave: 'saw', osc2Wave: 'saw', osc2Level: 1, osc2Detune: 18, chorus: 0,
          cutoff: 400, resonance: 0.1, keyTrack: 0.3, attack: 0.01, sustain: 1, release: 0.15, mono: 'mono',
        },
        focus: ['osc2Detune', 'cutoff'],
        play: 'reese',
        text: [
          'Two saws detuned far apart (18 cents) beat against each other, making the growling, phasing bass of drum & bass. The low CUTOFF keeps it dark and heavy.',
          'Try DETUNE between 8 and 30 cents: slow, smooth movement at the low end, an aggressive growl at the high end.',
        ],
      },
      {
        title: 'Chiptune lead',
        start: 'init',
        set: {
          osc1Wave: 'pulse', pulseWidth: 0.125, chorus: 0, attack: 0.001, decay: 1, sustain: 0.8, release: 0.05,
          mono: 'mono', lfoWave: 'sine', vibratoRate: 6, vibrato: 0.1,
        },
        focus: ['osc1Wave', 'pulseWidth'],
        play: 'chip',
        text: [
          'Old game consoles had only a few simple pulse waves, with no filter. A 12.5 % pulse (PW 0.125) is the thin, bright sound of 8-bit music; 25 % and 50 % were the other classic widths.',
          'No reverb, no chorus: the dry, instant sound is part of the style.',
        ],
      },
      {
        title: 'Marimba',
        start: 'init',
        set: {
          osc1Wave: 'harmonics', chorus: 0,
          'partial1.decay': 0.6,
          'partial2.ratio': 4, 'partial2.level': 0.3, 'partial2.velocity': 0.3, 'partial2.decay': 0.08,
          'partial3.ratio': 9.9, 'partial3.level': 0.05, 'partial3.velocity': 0.1, 'partial3.decay': 0.03,
          attack: 0.001, decay: 0.8, sustain: 0, release: 0.3, reverb: 0.2,
        },
        focus: ['partial2.ratio', 'partial3.ratio', 'partial2.decay'],
        play: 'marimba',
        text: [
          'A marimba bar is tuned so its first overtone sits two octaves up (4×) and the next near 10×. Those overtones are loud at the strike and vanish almost at once, leaving a soft, round tone — so: additive partials at 4 and 9.9 with very short DECAYs.',
          'Try the partial RATIOs at 3 and 6.3 instead: the same recipe then sounds more like a xylophone or a kalimba.',
        ],
      },
      {
        title: 'Sweep pad',
        start: 'init',
        set: {
          osc1Wave: 'saw', osc2Wave: 'saw', osc2Level: 0.8, osc2Detune: 7, unison: 3, unisonDetune: 15, chorus: 0,
          cutoff: 250, resonance: 0.35, keyTrack: 0.4, filterEnv: 4, fAttack: 3, fDecay: 4, fSustain: 0.3, fRelease: 2,
          attack: 1, sustain: 0.9, release: 2.5, reverb: 0.4, reverbSize: 0.9, delay: 0.2, delayTime: 0.45, delayFeedback: 0.4,
        },
        focus: ['fAttack', 'fDecay', 'filterEnv', 'resonance'],
        play: 'long',
        text: [
          'A slow filter envelope (3 s attack, 4 s decay) opens the cutoff over several seconds, so every chord blooms from dark to bright and back. The resonance makes the sweep audible as a moving “whoosh”.',
          'Hold chords for a long time and let them evolve; this is the lush pad of 80s film scores.',
        ],
      },
      {
        title: 'Laser zap',
        start: 'init',
        set: {
          osc1Wave: 'square', chorus: 0, pitchEnv: 36, pitchDecay: 0.12,
          attack: 0.001, decay: 0.4, sustain: 0, release: 0.2, delay: 0.25, delayTime: 0.15, delayFeedback: 0.3,
        },
        focus: ['pitchEnv', 'pitchDecay'],
        play: 'zaps',
        text: [
          'Three octaves of pitch drop in about a third of a second: “pew!”. The pitch envelope that made the kick is also the classic sci-fi and video-game effect.',
          'Try a negative PITCH ENV: the note then rises into place instead — a “bloop” or a riser.',
        ],
      },
    ],
  },
];
