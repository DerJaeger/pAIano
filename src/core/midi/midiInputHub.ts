import { AudioTimeline, type AudioTimelineOptions } from './audioTimeline';
import { decodeMidiMessage } from './decode';
import type { MidiDevice, MidiInputEvent, MidiInputPort, Unsubscribe } from './types';

/**
 * The device-selection, hot-plug and fan-out logic behind every `MidiInputPort`.
 *
 * Both the Web MIDI adapter and `FakeMidiInput` extend this, so the fiddly parts
 * — auto-selecting a device, surviving an unplug, filtering by device, mapping
 * timestamps — are written and tested once, in the pure core.
 */
export class MidiInputHub implements MidiInputPort {
  private readonly timeline: AudioTimeline;
  private readonly messageListeners = new Set<(event: MidiInputEvent) => void>();
  private readonly deviceListeners = new Set<() => void>();
  private devices: readonly MidiDevice[] = [];
  private selectedDeviceId: string | undefined;

  constructor(options: AudioTimelineOptions = {}) {
    this.timeline = new AudioTimeline(options);
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
    this.notifyDevicesChanged();
  }

  onMessage(listener: (event: MidiInputEvent) => void): Unsubscribe {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onDevicesChanged(listener: () => void): Unsubscribe {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  close(): void {
    this.messageListeners.clear();
    this.deviceListeners.clear();
  }

  // --- Driver side. Adapters (and tests) push into these; consumers only ever
  // see the `MidiInputPort` half above.

  /** Replaces the attached devices; call whenever hardware comes or goes. */
  setDevices(devices: readonly MidiDevice[]): void {
    if (sameDevices(this.devices, devices)) return;
    this.devices = [...devices];

    const stillThere = this.devices.some((d) => d.id === this.selectedDeviceId);
    if (!stillThere) this.selectedDeviceId = this.devices[0]?.id;

    this.notifyDevicesChanged();
  }

  /** Correlates a `performance.now()` reading with an audio-clock reading. */
  syncClock(performanceMs: number, audioTime: number): void {
    this.timeline.sync(performanceMs, audioTime);
  }

  /** Raw bytes straight off a device, with the browser's timestamp in ms. */
  handleRawMessage(deviceId: string, data: ArrayLike<number>, performanceMs?: number): void {
    if (deviceId !== this.selectedDeviceId) return;
    const event = decodeMidiMessage(data, this.timeline.toAudioTime(performanceMs));
    if (event) this.deliver(event);
  }

  deliver(event: MidiInputEvent): void {
    for (const listener of this.messageListeners) listener(event);
  }

  private notifyDevicesChanged(): void {
    for (const listener of this.deviceListeners) listener();
  }
}

function sameDevices(a: readonly MidiDevice[], b: readonly MidiDevice[]): boolean {
  return (
    a.length === b.length &&
    a.every((device, i) => device.id === b[i]?.id && device.name === b[i]?.name)
  );
}
