// MIDI input: Web MIDI (USB / BLE keyboards the OS has connected) and Web Bluetooth (direct BLE MIDI connection)

/**
 * Receives from every Web MIDI input and follows hot-plugging.
 * onMessage(bytes, port) gets each complete message (channel messages and SysEx) with the input's name.
 */
export class WebMIDIInput {
  constructor({ onMessage, onDevicesChange, log }) {
    this.onMessage = onMessage;
    this.onDevicesChange = onDevicesChange;
    this.log = log;
    this.access = null;
    this.ignoredNames = new Set(); // keyboards connected directly over Web Bluetooth (avoid playing twice)
  }

  get supported() {
    return 'requestMIDIAccess' in navigator;
  }

  async start() {
    // SysEx lets input rules read controllers that wrap buttons in SysEx (the browser asks once);
    // without that permission, notes and knobs still work
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
    } catch {
      this.access = await navigator.requestMIDIAccess();
      // Chrome then passes a SysEx's data bytes on as stray notes, so say what to change
      this.log('MIDI without SysEx: allow "MIDI device control & reprogram" in the site settings, then reload');
    }
    this.log(`MIDI started (SysEx ${this.access.sysexEnabled ? 'on' : 'off'})`);
    this.access.onstatechange = (e) => {
      if (e.port.type === 'input') this.log(`MIDI ${e.port.state}: ${e.port.name}`);
      this.attach();
    };
    this.attach();
  }

  attach() {
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => {
        if (this.ignoreReason(input.name)) return;
        const status = e.data[0];
        // channel messages, SysEx, and the transport realtime messages (Start / Continue / Stop; not the clock)
        if (status <= 0xf0 || status === 0xfa || status === 0xfb || status === 0xfc) this.onMessage(Array.from(e.data), input.name);
      };
    }
    this.onDevicesChange();
  }

  /**
   * Why an input's messages are dropped, or null. A keyboard connected over both USB and Bluetooth sends
   * everything twice (two notes per key, a button "pressed" twice — record starts and stops at once), so while
   * its USB ports are there the Bluetooth one is ignored. macOS names a Bluetooth MIDI port "<device> Bluetooth"
   * and the USB ports carry the device name too (e.g. "SMK25II Bluetooth" / "SINCO SMK25II-Master").
   */
  ignoreReason(name) {
    for (const n of this.ignoredNames) if (name?.includes(n)) return 'connected directly over Bluetooth';
    const device = /^(.+?)\s+bluetooth$/i.exec(name ?? '')?.[1];
    if (device && this.access) {
      const usb = [...this.access.inputs.values()].find((i) => i.name !== name && i.state === 'connected' && i.name?.includes(device));
      if (usb) return `the same keyboard is connected over USB (${usb.name})`;
    }
    return null;
  }

  /** The output called exactly `name`, or null. */
  outputNamed(name) {
    if (!this.access) return null;
    return [...this.access.outputs.values()].find((o) => o.name === name && o.state !== 'disconnected') ?? null;
  }

  /** The output whose name contains `part` (e.g. to light a Mackie surface's buttons), or null. */
  output(part) {
    if (!this.access || !part) return null;
    return [...this.access.outputs.values()].find((o) => o.name?.includes(part) && o.state !== 'disconnected') ?? null;
  }

  get inputs() {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({
      name: i.name, state: i.state, ignored: this.ignoreReason(i.name),
    }));
  }
}

const MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

/**
 * Connects to a BLE MIDI keyboard over Web Bluetooth (Chrome / Edge) and reconnects when it drops.
 * onMessage(bytes, port) as for WebMIDIInput; port is the keyboard's Bluetooth name.
 */
export class BluetoothMIDIInput {
  constructor({ onMessage, onStatus, log }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.log = log;
    this.device = null;
    this.status = 'disconnected';
    this.parser = { sysex: null }; // a SysEx message can continue into the next packet
  }

  get supported() {
    return 'bluetooth' in navigator;
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [MIDI_SERVICE] }] });
    this.device.addEventListener('gattserverdisconnected', () => this.reconnect());
    await this.open();
  }

  async open() {
    this.setStatus('connecting');
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(MIDI_SERVICE);
    const ch = await service.getCharacteristic(MIDI_CHARACTERISTIC);
    this.parser = { sysex: null };
    ch.addEventListener('characteristicvaluechanged', (e) => {
      parseBLEMIDIPacket(new Uint8Array(e.target.value.buffer), (bytes) => this.onMessage(bytes, this.device?.name), this.parser);
    });
    await ch.startNotifications();
    this.setStatus('connected');
    this.log(`bluetooth connected: ${this.device.name}`);
  }

  async reconnect() {
    this.log(`bluetooth disconnected: ${this.device.name}`);
    this.onMessage([0xb0, 123, 0], this.device.name); // avoid stuck notes
    for (let delay = 1000; this.device; delay = Math.min(delay * 2, 30000)) {
      this.setStatus('reconnecting');
      await new Promise((r) => setTimeout(r, delay));
      try {
        await this.open();
        return;
      } catch {
        // keeps retrying while the keyboard is off
      }
    }
  }

  disconnect() {
    const d = this.device;
    this.device = null;
    d?.gatt.disconnect();
    this.setStatus('disconnected');
  }

  setStatus(s) {
    this.status = s;
    this.onStatus(s);
  }
}

// number of data bytes for a MIDI 1.0 status byte
function dataLength(status) {
  switch (status & 0xf0) {
    case 0xc0: case 0xd0: return 1;
    case 0xf0:
      if (status === 0xf1 || status === 0xf3) return 1;
      if (status === 0xf2) return 2;
      return 0;
    default: return 2;
  }
}

/**
 * Splits a BLE MIDI packet into MIDI messages and calls emit(bytes) for each.
 * Layout: [header] ([timestamp] status data...)... Within a packet, running status may omit
 * the timestamp and/or status byte. SysEx is F0 data... [timestamp] F7 and may continue into the
 * next packet (right after its header); `state` keeps the unfinished SysEx between packets.
 */
export function parseBLEMIDIPacket(data, emit, state = { sysex: null }) {
  let i = 1; // header
  let running = 0;
  // SysEx continued from the previous packet
  while (state.sysex && i < data.length) {
    const b = data[i++];
    if (b & 0x80) {
      if (data[i] === 0xf7) { emit([...state.sysex, 0xf7]); i++; state.sysex = null; }
      else if (b === 0xf7) { emit([...state.sysex, 0xf7]); state.sysex = null; }
      // otherwise a timestamp (or a realtime message) inside the SysEx: skip it
    } else {
      state.sysex.push(b);
    }
  }
  while (i < data.length) {
    if (data[i] & 0x80) {
      i++; // timestamp
      if (i >= data.length) break;
      if (data[i] & 0x80) {
        const status = data[i++];
        if (status === 0xf0) {
          state.sysex = [0xf0];
          while (i < data.length) {
            const b = data[i++];
            if (!(b & 0x80)) { state.sysex.push(b); continue; }
            // a timestamp; the SysEx ends if F7 follows
            if (data[i] === 0xf7) { i++; emit([...state.sysex, 0xf7]); state.sysex = null; break; }
            if (b === 0xf7) { emit([...state.sysex, 0xf7]); state.sysex = null; break; }
          }
          running = 0;
          continue;
        }
        if (status >= 0xf8) {
          // realtime (no data): pass the transport ones (Start / Continue / Stop), not the clock
          if (status === 0xfa || status === 0xfb || status === 0xfc) emit([status]);
          continue;
        }
        running = status;
      }
    }
    if (!running) { i++; continue; }
    const n = dataLength(running);
    const d1 = data[i] ?? 0;
    const d2 = n === 2 ? data[i + 1] ?? 0 : 0;
    i += n;
    if (running < 0xf0) emit([running, d1 & 0x7f, d2 & 0x7f]);
    else running = 0; // system common messages cancel running status
  }
}
