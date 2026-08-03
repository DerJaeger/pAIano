/**
 * MIDI input as the rest of the app sees it. Pure types — only the adapter in
 * `src/adapters/midi` knows that `navigator.requestMIDIAccess` exists.
 */

export interface MidiDevice {
  /** Stable per-session id from the browser. */
  id: string;
  name: string;
  manufacturer: string;
}

interface MidiEventBase {
  /** Audio-clock seconds, comparable with `AudioContext.currentTime`. */
  time: number;
  /** 0-based MIDI channel. */
  channel: number;
}

export interface NoteOnEvent extends MidiEventBase {
  type: 'noteOn';
  midiNote: number;
  /** 1–127. A note-on with velocity 0 is decoded as a note-off instead. */
  velocity: number;
}

export interface NoteOffEvent extends MidiEventBase {
  type: 'noteOff';
  midiNote: number;
}

export interface SustainEvent extends MidiEventBase {
  type: 'sustain';
  down: boolean;
}

export type MidiInputEvent = NoteOnEvent | NoteOffEvent | SustainEvent;

export type Unsubscribe = () => void;

/**
 * One connected-keyboard source. Implemented by `MidiInputHub` (and so by both
 * the Web MIDI adapter and `FakeMidiInput`), which is what the practice engine
 * and the UI are written against.
 */
export interface MidiInputPort {
  /** Attached devices. The array identity only changes when the set changes. */
  getDevices(): readonly MidiDevice[];
  getSelectedDeviceId(): string | undefined;
  /** `undefined` listens to nothing. Unknown ids are accepted (device may return). */
  select(deviceId: string | undefined): void;
  /** Messages from the selected device only. */
  onMessage(listener: (event: MidiInputEvent) => void): Unsubscribe;
  /** Hot-plug, or a change of selection. */
  onDevicesChanged(listener: () => void): Unsubscribe;
  close(): void;
}
