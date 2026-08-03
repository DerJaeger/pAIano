// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiUnavailableError, openWebMidi } from './webMidiAdapter';
import type { MidiInputEvent } from '../../core/midi/types';

/** Minimal stand-ins for the Web MIDI objects the adapter actually touches. */
class StubInput {
  onmidimessage: ((event: MIDIMessageEvent) => void) | null = null;
  readonly id: string;
  readonly name: string;
  readonly manufacturer = 'Acme';
  state: 'connected' | 'disconnected' = 'connected';

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  send(data: number[], timeStamp = 0): void {
    this.onmidimessage?.({ data: new Uint8Array(data), timeStamp } as MIDIMessageEvent);
  }
}

class StubAccess {
  onstatechange: (() => void) | null = null;
  readonly inputs = new Map<string, StubInput>();

  constructor(...inputs: StubInput[]) {
    for (const input of inputs) this.inputs.set(input.id, input);
  }

  plug(input: StubInput): void {
    this.inputs.set(input.id, input);
    this.onstatechange?.();
  }

  unplug(id: string): void {
    this.inputs.delete(id);
    this.onstatechange?.();
  }
}

function stubWebMidi(access: StubAccess | (() => Promise<never>)) {
  const request = typeof access === 'function' ? access : () => Promise.resolve(access);
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: request });
}

const clock = () => ({ performanceTime: 1000, audioTime: 10 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openWebMidi', () => {
  it('exposes the attached inputs as devices', async () => {
    stubWebMidi(new StubAccess(new StubInput('in-1', 'Digital Piano')));
    const port = await openWebMidi(clock);

    expect(port.getDevices()).toEqual([
      { id: 'in-1', name: 'Digital Piano', manufacturer: 'Acme' },
    ]);
    expect(port.getSelectedDeviceId()).toBe('in-1');
  });

  it('turns messages from the selected device into port events', async () => {
    const input = new StubInput('in-1', 'Digital Piano');
    stubWebMidi(new StubAccess(input));
    const port = await openWebMidi(clock);

    const events: MidiInputEvent[] = [];
    port.onMessage((event) => events.push(event));
    input.send([0x90, 60, 100], 1250);

    expect(events).toEqual([
      { type: 'noteOn', midiNote: 60, velocity: 100, channel: 0, time: 10.25 },
    ]);
  });

  it('ignores messages from a device you did not pick', async () => {
    const piano = new StubInput('in-1', 'Digital Piano');
    const pad = new StubInput('in-2', 'Drum Pad');
    stubWebMidi(new StubAccess(piano, pad));
    const port = await openWebMidi(clock);

    const listener = vi.fn();
    port.onMessage(listener);
    pad.send([0x90, 40, 100]);
    expect(listener).not.toHaveBeenCalled();

    // Switching device takes effect without re-opening anything.
    port.select('in-2');
    pad.send([0x90, 40, 100]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('picks up a keyboard plugged in after start-up', async () => {
    const access = new StubAccess();
    stubWebMidi(access);
    const port = await openWebMidi(clock);
    expect(port.getDevices()).toEqual([]);

    const changed = vi.fn();
    port.onDevicesChanged(changed);
    const input = new StubInput('in-1', 'Digital Piano');
    access.plug(input);

    expect(changed).toHaveBeenCalledTimes(1);
    expect(port.getSelectedDeviceId()).toBe('in-1');

    const events: MidiInputEvent[] = [];
    port.onMessage((event) => events.push(event));
    input.send([0x90, 60, 100]);
    expect(events).toHaveLength(1);
  });

  it('drops a device that is unplugged', async () => {
    const access = new StubAccess(new StubInput('in-1', 'Digital Piano'));
    stubWebMidi(access);
    const port = await openWebMidi(clock);

    access.unplug('in-1');
    expect(port.getDevices()).toEqual([]);
    expect(port.getSelectedDeviceId()).toBeUndefined();
  });

  it('detaches every handler on close', async () => {
    const input = new StubInput('in-1', 'Digital Piano');
    const access = new StubAccess(input);
    stubWebMidi(access);
    const port = await openWebMidi(clock);

    port.close();
    expect(input.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
  });

  it('reports a browser without Web MIDI, rather than crashing', async () => {
    vi.stubGlobal('navigator', {});
    await expect(openWebMidi(clock)).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('reports a denied permission distinctly from any other failure', async () => {
    stubWebMidi(() => Promise.reject(new DOMException('nope', 'SecurityError')));
    await expect(openWebMidi(clock)).rejects.toMatchObject({ reason: 'denied' });

    stubWebMidi(() => Promise.reject(new Error('boom')));
    const error = await openWebMidi(clock).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(MidiUnavailableError);
    expect(error).toMatchObject({ reason: 'failed' });
    expect(String(error)).toContain('boom');
  });
});
