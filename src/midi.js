// MIDI input: Web MIDI (USB / BLE keyboards the OS has connected) and Web Bluetooth (direct BLE MIDI connection)

/** Receives from every Web MIDI input and follows hot-plugging. */
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
    this.access = await navigator.requestMIDIAccess();
    this.access.onstatechange = (e) => {
      if (e.port.type === 'input') this.log(`MIDI ${e.port.state}: ${e.port.name}`);
      this.attach();
    };
    this.attach();
  }

  attach() {
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => {
        if (this.isIgnored(input.name)) return;
        const [status, d1 = 0, d2 = 0] = e.data;
        if (status < 0xf0) this.onMessage(status, d1, d2);
      };
    }
    this.onDevicesChange();
  }

  isIgnored(name) {
    for (const n of this.ignoredNames) if (name?.includes(n)) return true;
    return false;
  }

  get inputs() {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({
      name: i.name, state: i.state, ignored: this.isIgnored(i.name),
    }));
  }
}

const MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

/** Connects to a BLE MIDI keyboard over Web Bluetooth (Chrome / Edge) and reconnects when it drops. */
export class BluetoothMIDIInput {
  constructor({ onMessage, onStatus, log }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.log = log;
    this.device = null;
    this.status = 'disconnected';
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
    ch.addEventListener('characteristicvaluechanged', (e) => {
      parseBLEMIDIPacket(new Uint8Array(e.target.value.buffer), this.onMessage);
    });
    await ch.startNotifications();
    this.setStatus('connected');
    this.log(`bluetooth connected: ${this.device.name}`);
  }

  async reconnect() {
    this.log(`bluetooth disconnected: ${this.device.name}`);
    this.onMessage(0xb0, 123, 0); // avoid stuck notes
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
 * Splits a BLE MIDI packet into MIDI messages.
 * Layout: [header] ([timestamp] status data...)... Within a packet, running status may omit
 * the timestamp and/or status byte. SysEx is skipped.
 */
export function parseBLEMIDIPacket(data, emit) {
  let i = 1; // header
  let running = 0;
  while (i < data.length) {
    if (data[i] & 0x80) {
      i++; // timestamp
      if (i >= data.length) break;
      if (data[i] & 0x80) {
        const status = data[i++];
        if (status === 0xf0) {
          // SysEx: skip to 0xF7 (preceded by a timestamp byte)
          while (i < data.length && data[i] !== 0xf7) i++;
          i++;
          running = 0;
          continue;
        }
        if (status >= 0xf8) continue; // realtime message (no data)
        running = status;
      }
    }
    if (!running) { i++; continue; }
    const n = dataLength(running);
    const d1 = data[i] ?? 0;
    const d2 = n === 2 ? data[i + 1] ?? 0 : 0;
    i += n;
    if (running < 0xf0) emit(running, d1 & 0x7f, d2 & 0x7f);
    else running = 0; // system common messages cancel running status
  }
}
