import type { MidiOutputPort, ScheduledNote } from '../../core/midi/output';
import type { MidiDevice, Unsubscribe } from '../../core/midi/types';

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const ALL_SOUND_OFF = 120;
const ALL_NOTES_OFF = 123;
const SUSTAIN_OFF = 64;
const CHANNELS = 16;

/**
 * The guide track, played by your own instrument.
 *
 * Notes are handed over with an absolute `performance.now()` timestamp and the
 * browser's MIDI stack delivers them; we never sit in a timer waiting to send.
 * That is the whole reason a 25ms ticker is accurate enough to play music.
 */
export class WebMidiOutput implements MidiOutputPort {
  private readonly access: MIDIAccess;
  private readonly listeners = new Set<() => void>();
  private devices: readonly MidiDevice[] = [];
  private selectedDeviceId: string | undefined;
  /** Latest timestamp handed to the browser, for the panic below. */
  private furthestScheduled = 0;

  constructor(access: MIDIAccess) {
    this.access = access;
    this.refresh();
  }

  getDevices(): readonly MidiDevice[] {
    return this.devices;
  }

  getSelectedDeviceId(): string | undefined {
    return this.selectedDeviceId;
  }

  select(deviceId: string | undefined): void {
    if (deviceId === this.selectedDeviceId) return;
    this.panic();
    this.selectedDeviceId = deviceId;
    this.notify();
  }

  onDevicesChanged(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(note: ScheduledNote): void {
    const port = this.selected();
    if (!port) return;

    const status = note.channel & 0x0f;
    port.send([NOTE_ON | status, note.midiNote, note.velocity], note.startTime);
    port.send([NOTE_OFF | status, note.midiNote, 0], note.endTime);
    this.furthestScheduled = Math.max(this.furthestScheduled, note.endTime);
  }

  /**
   * Silences the instrument now, and again just after the last thing we queued.
   *
   * `MIDIOutput.clear()` is specified but unimplemented in Chrome, so notes
   * already handed to the browser will still fire. The second, later silence
   * catches those — without it, pausing could leave a note hanging until you
   * unplugged the keyboard.
   */
  panic(): void {
    const port = this.selected();
    if (!port) return;

    // `clear()` is in the spec but missing from Chrome and from the DOM types.
    (port as MIDIOutput & { clear?: () => void }).clear?.();
    this.silence(port, undefined);

    const afterQueued = this.furthestScheduled + 1;
    if (afterQueued > performance.now()) this.silence(port, afterQueued);
    this.furthestScheduled = 0;
  }

  close(): void {
    this.panic();
    this.access.onstatechange = null;
    this.listeners.clear();
  }

  /** Rebuilds the device list; called on every plug and unplug. */
  refresh(): void {
    const outputs = [...this.access.outputs.values()].filter(
      (output) => output.state !== 'disconnected',
    );
    const devices = outputs.map((output) => ({
      id: output.id,
      name: output.name ?? 'MIDI output',
      manufacturer: output.manufacturer ?? '',
    }));
    if (sameDevices(this.devices, devices)) return;

    this.devices = devices;
    if (!devices.some((device) => device.id === this.selectedDeviceId)) {
      this.selectedDeviceId = devices[0]?.id;
    }
    this.notify();
  }

  private selected(): MIDIOutput | undefined {
    return this.selectedDeviceId === undefined
      ? undefined
      : this.access.outputs.get(this.selectedDeviceId);
  }

  /** Every channel: the transport is not the only thing that may have played. */
  private silence(port: MIDIOutput, at: number | undefined): void {
    for (let channel = 0; channel < CHANNELS; channel++) {
      port.send([CONTROL_CHANGE | channel, SUSTAIN_OFF, 0], at);
      port.send([CONTROL_CHANGE | channel, ALL_NOTES_OFF, 0], at);
      port.send([CONTROL_CHANGE | channel, ALL_SOUND_OFF, 0], at);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function sameDevices(a: readonly MidiDevice[], b: readonly MidiDevice[]): boolean {
  return (
    a.length === b.length &&
    a.every((device, i) => device.id === b[i]?.id && device.name === b[i]?.name)
  );
}
