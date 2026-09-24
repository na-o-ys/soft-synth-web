// A phrase recorder: records what is played live (notes and the sustain pedal) and plays it back
// through the same synth, once or looped. The take starts at the first note, so there is no
// silence before it, and ends when recording is stopped.

export class Recorder {
  /**
   * @param {object} hooks
   * @param {(msg: object) => void} hooks.send  message to the synth
   * @param {(line: string) => void} hooks.log
   * @param {() => void} [hooks.onChange]      state changed (for the UI)
   */
  constructor({ send, log, onChange = () => {} }) {
    this.send = send;
    this.log = log;
    this.onChange = onChange;
    this.state = 'idle'; // idle | recording | playing
    this.loop = false;
    this.events = [];    // { time: seconds from the first note, msg }
    this.length = 0;     // seconds
    this.recordStart = null;
    this.timers = [];
    this.sounding = new Set(); // keys held by the playback
    this.sustainDown = false;
  }

  /** Called with every note / sustain message played live. */
  capture(msg) {
    if (this.state !== 'recording') return;
    const now = performance.now() / 1000;
    if (this.recordStart === null) {
      if (msg.type !== 'noteOn') return; // the take starts at the first note
      this.recordStart = now;
    }
    this.events.push({ time: now - this.recordStart, msg });
  }

  /** Starts a new take (the previous one is replaced); pressed again while recording, ends it. */
  record() {
    if (this.state === 'recording') {
      this.finish();
      return;
    }
    this.stopPlayback();
    this.events = [];
    this.recordStart = null;
    this.setState('recording');
    this.log('recording… (play, then press record or stop to end the take)');
  }

  /** Plays the take from the start (ending a recording first). */
  play() {
    if (this.state === 'recording') this.finish();
    if (this.events.length === 0) {
      this.log('nothing recorded yet');
      return;
    }
    this.stopPlayback();
    this.setState('playing');
    this.log(`playing${this.loop ? ' (loop)' : ''}`);
    this.schedule();
  }

  /** Ends a recording or stops the playback. */
  stop() {
    if (this.state === 'recording') this.finish();
    else if (this.state === 'playing') {
      this.stopPlayback();
      this.log('stopped');
    }
  }

  toggleLoop() {
    this.loop = !this.loop;
    this.log(`loop ${this.loop ? 'on' : 'off'}`);
    this.onChange();
  }

  finish() {
    this.setState('idle');
    if (this.recordStart === null) {
      this.events = [];
      this.log('nothing recorded (no notes were played)');
      return;
    }
    this.length = performance.now() / 1000 - this.recordStart;
    const notes = this.events.filter((e) => e.msg.type === 'noteOn').length;
    this.log(`recorded ${notes} notes, ${this.length.toFixed(1)} s`);
  }

  schedule() {
    for (const { time, msg } of this.events) {
      this.timers.push(setTimeout(() => this.emit(msg), time * 1000));
    }
    this.timers.push(setTimeout(() => {
      this.release();
      this.timers = [];
      if (this.loop && this.state === 'playing') this.schedule();
      else this.setState('idle');
    }, this.length * 1000));
  }

  emit(msg) {
    if (msg.type === 'noteOn') this.sounding.add(msg.key);
    if (msg.type === 'noteOff') this.sounding.delete(msg.key);
    if (msg.type === 'sustain') this.sustainDown = msg.down;
    this.send(msg);
  }

  /** Lets go of whatever the playback still holds, without touching notes played live. */
  release() {
    for (const key of this.sounding) this.send({ type: 'noteOff', key });
    this.sounding.clear();
    if (this.sustainDown) this.send({ type: 'sustain', down: false });
    this.sustainDown = false;
  }

  stopPlayback() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.release();
    if (this.state === 'playing') this.setState('idle');
  }

  setState(state) {
    this.state = state;
    this.onChange();
  }
}
