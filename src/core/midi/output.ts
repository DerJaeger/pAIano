/**
 * MIDI output as the rest of the app sees it: the guide track is played by your
 * keyboard's own voices rather than by a synthesiser in the browser (ADR-0004),
 * so "audio" in this app means "notes sent back out to the instrument".
 *
 * Only `src/adapters/midi/webMidiOutput.ts` knows Web MIDI exists.
 */
import type { MidiDevice, Unsubscribe } from './types';

/** A note the transport wants sounded, scheduled ahead of time. */
export interface ScheduledNote {
  midiNote: number;
  /** 1–127. */
  velocity: number;
  /** When to sound it, in `performance.now()` milliseconds. */
  startTime: number;
  /** When to release it, in the same domain. Must be after `startTime`. */
  endTime: number;
  /** 0-based. Lets the guide sit on a different voice from the player. */
  channel: number;
}

export interface MidiOutputPort {
  /** Attached destinations. The array identity changes only when the set does. */
  getDevices(): readonly MidiDevice[];
  getSelectedDeviceId(): string | undefined;
  /** `undefined` sends nowhere — the "silent guide" setting. */
  select(deviceId: string | undefined): void;
  /** Hot-plug, or a change of selection. */
  onDevicesChanged(listener: () => void): Unsubscribe;
  /**
   * Queues one note. `startTime` may be in the past, in which case it sounds
   * immediately; the transport's lookahead normally keeps it comfortably ahead.
   */
  send(note: ScheduledNote): void;
  /**
   * Drops everything queued but not yet sounded and silences what is sounding.
   * Called on pause, stop, seek and teardown — without it, a note scheduled
   * three seconds out would still fire after you hit stop.
   */
  panic(): void;
  close(): void;
}

/** A note as it actually reached a device, for assertions. */
export interface SentNote extends ScheduledNote {
  /** Clock reading when `send()` was called, not when the note sounds. */
  sentAt: number;
}

/**
 * An output that plays nothing and remembers everything, so the transport can
 * be driven in tests and asserted on exactly — no hardware, no timers.
 */
export class RecordingMidiOutput implements MidiOutputPort {
  readonly sent: SentNote[] = [];
  /** One entry per `panic()`, holding the clock reading at the time. */
  readonly panics: number[] = [];
  closed = false;

  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private devices: readonly MidiDevice[] = [
    { id: 'recording-output', name: 'Recording output', manufacturer: 'test' },
  ];
  private selectedDeviceId: string | undefined = 'recording-output';

  constructor(now: () => number = () => 0) {
    this.now = now;
  }

  getDevices(): readonly MidiDevice[] {
    return this.devices;
  }

  getSelectedDeviceId(): string | undefined {
    return this.selectedDeviceId;
  }

  select(deviceId: string | undefined): void {
    if (deviceId === this.selectedDeviceId) return;
    this.selectedDeviceId = deviceId;
    for (const listener of this.listeners) listener();
  }

  onDevicesChanged(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(note: ScheduledNote): void {
    if (this.selectedDeviceId === undefined) return;
    this.sent.push({ ...note, sentAt: this.now() });
  }

  panic(): void {
    this.panics.push(this.now());
    // Anything not yet audible would still fire on real hardware, so a panic
    // has to unqueue it here too, or assertions would disagree with reality.
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i]!.startTime > this.now()) this.sent.splice(i, 1);
    }
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  /** Test helper: `(startTime, midiNote)` pairs in the order they sound. */
  timeline(): [number, number][] {
    return [...this.sent]
      .sort((a, b) => a.startTime - b.startTime || a.midiNote - b.midiNote)
      .map((note) => [note.startTime, note.midiNote]);
  }

  /** Test helper: replaces the attached devices, as a hot-plug would. */
  setDevices(devices: readonly MidiDevice[]): void {
    this.devices = [...devices];
    if (!this.devices.some((device) => device.id === this.selectedDeviceId)) {
      this.selectedDeviceId = this.devices[0]?.id;
    }
    for (const listener of this.listeners) listener();
  }
}
