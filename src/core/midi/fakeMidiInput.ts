import { applyMidiEvent, silentKeyboard, type KeyboardState } from './keyboard';
import { MidiInputHub } from './midiInputHub';
import type { MidiDevice, MidiInputEvent } from './types';

const DEFAULT_DEVICE: MidiDevice = {
  id: 'fake-midi-1',
  name: 'Fake Keyboard',
  manufacturer: 'Web PianoBooster',
};

/**
 * A keyboard you can play from a test. Time is explicit — nothing advances
 * unless you say so — which is what makes the practice engine's timing
 * assertions deterministic.
 */
export class FakeMidiInput extends MidiInputHub {
  /** Current audio-clock time, in seconds. */
  now = 0;
  /** What the fake player is holding down, for convenient assertions. */
  keyboard: KeyboardState = silentKeyboard;

  constructor(devices: readonly MidiDevice[] = [DEFAULT_DEVICE]) {
    super();
    this.onMessage((event) => {
      this.keyboard = applyMidiEvent(this.keyboard, event);
    });
    this.setDevices(devices);
  }

  advance(seconds: number): void {
    this.now += seconds;
  }

  press(midiNote: number, velocity = 64): void {
    this.send({ type: 'noteOn', midiNote, velocity, channel: 0, time: this.now });
  }

  release(midiNote: number): void {
    this.send({ type: 'noteOff', midiNote, channel: 0, time: this.now });
  }

  pedal(down: boolean): void {
    this.send({ type: 'sustain', down, channel: 0, time: this.now });
  }

  /** Presses several notes at the same instant — a block chord. */
  chord(midiNotes: readonly number[], velocity = 64): void {
    for (const midiNote of midiNotes) this.press(midiNote, velocity);
  }

  releaseAll(): void {
    for (const midiNote of [...this.keyboard.keysDown]) this.release(midiNote);
    if (this.keyboard.sustain) this.pedal(false);
  }

  attach(device: MidiDevice): void {
    this.setDevices([...this.getDevices(), device]);
  }

  detach(deviceId: string): void {
    this.setDevices(this.getDevices().filter((device) => device.id !== deviceId));
  }

  private send(event: MidiInputEvent): void {
    if (this.getSelectedDeviceId() === undefined) return;
    this.deliver(event);
  }
}
