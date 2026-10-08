// Loop recorder for the Play screen: what is played on the keys and pads is recorded into layers
// over a fixed-length loop (tempo × bars) and played back in time, like a looper pedal.
// Each take (record → record) becomes one layer that can be muted; undo takes back one note at a time.

export class Looper {
  /**
   * @param {object} hooks
   * @param {() => number} hooks.now                 current time in seconds (the audio clock)
   * @param {(e: object, on: boolean) => void} hooks.trigger  play a recorded event: e = { target, note, velocity }
   *                                                  (target is whatever the caller passed to capture(): here,
   *                                                  which sound played the note)
   * @param {(accent: boolean, time: number) => {stop: (t?: number) => void} | void} [hooks.click]
   *        metronome click on a beat, booked ahead at `time` on the audio clock (returns something stoppable)
   * @param {() => void} [hooks.onChange]            state changed (for the UI)
   * @param {(line: string) => void} [hooks.log]
   * @param {(fn: () => void) => () => void} [hooks.every]  runs fn every few ms, returns a function that stops it
   */
  constructor({ now, trigger, click = () => {}, onChange = () => {}, log = () => {}, every }) {
    this.now = now;
    this.trigger = trigger;
    this.click = click;
    this.onChange = onChange;
    this.log = log;
    this.every = every ?? ((fn) => { const id = setInterval(fn, 5); return () => clearInterval(id); });
    this.bpm = 120;
    this.bars = 2;
    this.quantize = true;   // snap recorded notes to 1/16
    this.metronome = true;
    this.layers = [];       // { events: [{ time, target, note, velocity, on, pass }], muted }
    this.recording = null;  // the layer being recorded
    this.playing = false;
    this.start = 0;         // clock time of the loop's first beat
    this.lastPos = 0;
    this.lastPass = 0;
    this.held = new Map();  // key → { target, note, shift, id } of a note held while recording (its note-off moves with it)
    this.seq = 0;           // recording order: a note's on and off share its id
    this.sounding = new Map(); // key → { target, note, n }: notes the playback holds, n times
    this.stopTimer = null;
    this.nextBeat = 0;      // index (from the loop's start) of the next beat whose click is not booked yet
    this.booked = [];       // clicks booked ahead: { time, handle } (cancelled when the loop restarts or stops)
  }

  get beats() { return this.bars * 4; }
  get length() { return (this.beats * 60) / this.bpm; } // seconds

  /** Loop tempo and length can only change while nothing is recorded (they would misplace the notes). */
  get locked() { return this.layers.length > 0 || this.recording !== null; }

  setTempo(bpm, bars) {
    if (this.locked) return;
    this.bpm = Math.min(Math.max(Math.round(bpm), 40), 240);
    this.bars = bars;
    this.onChange();
  }

  /** Where the loop is now: pass (how many times it went round) and position in seconds. */
  clock() {
    const t = Math.max(0, this.now() - this.start);
    return { pass: Math.floor(t / this.length), pos: t % this.length };
  }

  // MARK: transport

  /** Starts recording (starting the loop if it is stopped); pressed while recording, keeps the take. */
  record() {
    if (this.recording) {
      this.finishLayer();
    } else {
      if (!this.playing) this.startLoop();
      this.recording = { events: [], muted: false };
      this.held.clear();
      this.log(`recording layer ${this.layers.length + 1}`);
    }
    this.onChange();
  }

  /** Plays from the top (restarts if already playing). A take being recorded is kept first. */
  play() {
    if (this.recording) this.finishLayer();
    if (this.playing) this.releaseAll();
    this.startLoop();
    this.onChange();
  }

  stop() {
    if (this.recording) this.finishLayer();
    if (!this.playing) return;
    this.playing = false;
    this.cancelClicks();
    this.stopTimer?.();
    this.stopTimer = null;
    this.releaseAll();
    this.log('loop stopped');
    this.onChange();
  }

  startLoop() {
    // passes count from 0 again: every recorded note may play from the first pass
    for (const layer of this.layers) for (const e of layer.events) e.pass = -1;
    if (this.recording) for (const e of this.recording.events) e.pass = -1;
    this.start = this.now();
    this.lastPos = -1e-9; // so events at 0 play on the first tick
    this.lastPass = 0;
    this.playing = true;
    this.cancelClicks();
    this.nextBeat = 0;
    this.bookClicks(); // the first beat's click right away, not on the first timer tick
    if (!this.stopTimer) this.stopTimer = this.every(() => this.tick());
  }

  /** Takes back the last recorded note (in any layer, including the take being recorded). */
  undo() {
    let last = null;
    for (const layer of this.recording ? [...this.layers, this.recording] : this.layers) {
      for (const e of layer.events) if (e.on && (!last || e.id > last.e.id)) last = { layer, e };
    }
    if (!last) {
      this.log('nothing to undo');
      return;
    }
    const { layer, e } = last;
    layer.events = layer.events.filter((x) => x.id !== e.id);
    for (const [key, h] of this.held) if (h.id === e.id) this.held.delete(key);
    // if the playback holds that note, let it go (other notes keep sounding)
    const key = noteKey(e.target, e.note);
    const playing = this.sounding.get(key);
    if (playing) {
      if (playing.n > 1) playing.n -= 1;
      else this.sounding.delete(key);
      this.trigger({ target: e.target, note: e.note, velocity: 0 }, false);
    }
    if (layer !== this.recording && layer.events.length === 0) this.layers.splice(this.layers.indexOf(layer), 1);
    this.log(`undo: removed note ${e.note}`);
    this.onChange();
  }

  clear() {
    this.recording = null;
    this.layers = [];
    this.releaseAll();
    this.log('loop cleared');
    this.onChange();
  }

  toggleMute(i) {
    const layer = this.layers[i];
    if (!layer) return;
    layer.muted = !layer.muted;
    if (layer.muted) this.releaseAll();
    this.onChange();
  }

  // MARK: recording

  /** Called with every note played live on the Play screen. */
  capture(target, note, on, velocity) {
    if (!this.recording || !this.playing) return;
    const { pass, pos } = this.clock();
    const key = noteKey(target, note);
    let time = pos;
    let id;
    if (on) {
      let shift = 0;
      if (this.quantize) {
        const step = this.length / (this.beats * 4); // 1/16 note
        shift = Math.round(pos / step) * step - pos;
      }
      id = ++this.seq;
      this.held.set(key, { target, note, shift, id });
      time = pos + shift;
    } else {
      const h = this.held.get(key);
      if (!h) return; // pressed before recording started (or undone while held)
      time = pos + h.shift; // keep the note's length when its start was snapped
      id = h.id;
      this.held.delete(key);
    }
    time = ((time % this.length) + this.length) % this.length;
    // pass: a note recorded now must not also play back later in this same pass
    this.recording.events.push({ time, target, note, velocity: on ? velocity : 0, on, pass, id });
  }

  finishLayer() {
    const layer = this.recording;
    this.recording = null;
    if (!layer) return;
    // notes still held when the take ends are let go there
    const { pass, pos } = this.clock();
    for (const { target, note, id } of this.held.values()) {
      layer.events.push({ time: pos, target, note, velocity: 0, on: false, pass, id });
    }
    this.held.clear();
    if (layer.events.length === 0) {
      this.log('nothing played: no layer added');
      return;
    }
    layer.events.sort((a, b) => a.time - b.time);
    this.layers.push(layer);
    const notes = layer.events.filter((e) => e.on).length;
    this.log(`layer ${this.layers.length}: ${notes} notes`);
  }

  // MARK: playback

  /** Plays the events whose time has come; call every few ms while playing. */
  tick() {
    if (!this.playing) return;
    this.bookClicks();
    const { pass, pos } = this.clock();
    if (pass !== this.lastPass) {
      this.dispatch(this.lastPos, this.length, this.lastPass); // the end of the pass just finished
      this.lastPos = -1e-9;
      this.lastPass = pass;
    }
    this.dispatch(this.lastPos, pos, pass);
    this.lastPos = pos;
  }

  /** Plays events with from < time <= to in the given pass, and clicks the beats in between. */
  dispatch(from, to, pass) {
    const layers = this.recording ? [...this.layers, this.recording] : this.layers;
    for (const layer of layers) {
      if (layer.muted) continue;
      for (const e of layer.events) {
        if (e.time <= from || e.time > to || e.pass >= pass) continue;
        this.emit(e);
      }
    }
  }

  /**
   * Books the metronome's clicks a little ahead at their exact times on the audio clock, as metronomes do:
   * a click played when the timer happens to run would land a few to tens of milliseconds late, unevenly.
   */
  bookClicks() {
    const LOOKAHEAD = 0.12; // seconds; well over the timer's interval and its usual delays
    const beat = this.length / this.beats;
    const now = this.now();
    this.booked = this.booked.filter((c) => c.time > now - 0.1);
    for (let t = this.start + this.nextBeat * beat; t <= now + LOOKAHEAD; t = this.start + this.nextBeat * beat) {
      // a beat already gone (the tab was in the background) is skipped rather than clicked late
      if (this.metronome && t >= now - 0.01) {
        const handle = this.click(this.nextBeat % 4 === 0, Math.max(t, now));
        if (handle) this.booked.push({ time: t, handle });
      }
      this.nextBeat++;
    }
  }

  /** Takes back the clicks booked ahead (the loop restarted or stopped, or the click was turned off). */
  cancelClicks() {
    const now = this.now();
    for (const c of this.booked) if (c.time > now) c.handle.stop?.();
    this.booked = [];
  }

  emit(e) {
    const key = noteKey(e.target, e.note);
    const n = this.sounding.get(key)?.n ?? 0;
    if (e.on) this.sounding.set(key, { target: e.target, note: e.note, n: n + 1 });
    else if (n > 1) this.sounding.get(key).n = n - 1;
    else if (n === 1) this.sounding.delete(key);
    else return; // its note-on was not played (muted or undone meanwhile)
    this.trigger(e, e.on);
  }

  /** Lets go of every note the playback holds. */
  releaseAll() {
    for (const { target, note } of this.sounding.values()) this.trigger({ target, note, velocity: 0 }, false);
    this.sounding.clear();
  }

  /** Every target the layers (and the take being recorded) still play. */
  get targets() {
    const out = new Set();
    for (const layer of this.recording ? [...this.layers, this.recording] : this.layers) {
      for (const e of layer.events) out.add(e.target);
    }
    return out;
  }

  /** Where the loop is, for the display: bar and beat (1-based) and progress 0...1. */
  get display() {
    if (!this.playing) return { bar: 1, beat: 1, progress: 0 };
    const { pos } = this.clock();
    const beat = Math.floor(pos / (this.length / this.beats));
    return { bar: Math.floor(beat / 4) + 1, beat: (beat % 4) + 1, progress: pos / this.length };
  }
}

const noteKey = (target, note) => `${note}\u0000${target}`;
