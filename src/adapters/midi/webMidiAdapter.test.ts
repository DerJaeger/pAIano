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

/** What the adapter uses of a `MIDIOutput`: `send` with a timestamp. */
class StubOutput {
  readonly sent: { data: number[]; at: number | undefined }[] = [];
  readonly id: string;
  readonly name: string;
  readonly manufacturer = 'Acme';
  state: 'connected' | 'disconnected' = 'connected';
  cleared = 0;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  send(data: number[], at?: number): void {
    this.sent.push({ data, at });
  }

  clear(): void {
    this.cleared++;
  }

  /** Note-ons only, which is what the musical assertions care about. */
  noteOns(): { midiNote: number; velocity: number; at: number | undefined }[] {
    return this.sent
      .filter((message) => (message.data[0]! & 0xf0) === 0x90)
      .map((message) => ({
        midiNote: message.data[1]!,
        velocity: message.data[2]!,
        at: message.at,
      }));
  }
}

class StubAccess {
  onstatechange: (() => void) | null = null;
  readonly inputs = new Map<string, StubInput>();
  readonly outputs = new Map<string, StubOutput>();

  constructor(...ports: (StubInput | StubOutput)[]) {
    for (const port of ports) this.attach(port);
  }

  plug(port: StubInput | StubOutput): void {
    this.attach(port);
    this.onstatechange?.();
  }

  unplug(id: string): void {
    this.inputs.delete(id);
    this.outputs.delete(id);
    this.onstatechange?.();
  }

  private attach(port: StubInput | StubOutput): void {
    if (port instanceof StubOutput) this.outputs.set(port.id, port);
    else this.inputs.set(port.id, port);
  }
}

function stubWebMidi(access: StubAccess | (() => Promise<never>)) {
  const request = typeof access === 'function' ? access : () => Promise.resolve(access);
  vi.stubGlobal('navigator', { ...navigator, requestMIDIAccess: request });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openWebMidi', () => {
  it('exposes the attached inputs as devices', async () => {
    stubWebMidi(new StubAccess(new StubInput('in-1', 'Digital Piano')));
    const { input: port } = await openWebMidi();

    expect(port.getDevices()).toEqual([
      { id: 'in-1', name: 'Digital Piano', manufacturer: 'Acme' },
    ]);
    expect(port.getSelectedDeviceId()).toBe('in-1');
  });

  it('turns messages from the selected device into port events', async () => {
    const input = new StubInput('in-1', 'Digital Piano');
    stubWebMidi(new StubAccess(input));
    const { input: port } = await openWebMidi();

    const events: MidiInputEvent[] = [];
    port.onMessage((event) => events.push(event));
    input.send([0x90, 60, 100], 1250);

    expect(events).toEqual([
      { type: 'noteOn', midiNote: 60, velocity: 100, channel: 0, time: 1250 },
    ]);
  });

  it('ignores messages from a device you did not pick', async () => {
    const piano = new StubInput('in-1', 'Digital Piano');
    const pad = new StubInput('in-2', 'Drum Pad');
    stubWebMidi(new StubAccess(piano, pad));
    const { input: port } = await openWebMidi();

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
    const { input: port } = await openWebMidi();
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
    const { input: port } = await openWebMidi();

    access.unplug('in-1');
    expect(port.getDevices()).toEqual([]);
    expect(port.getSelectedDeviceId()).toBeUndefined();
  });

  it('detaches every handler on close', async () => {
    const input = new StubInput('in-1', 'Digital Piano');
    const access = new StubAccess(input);
    stubWebMidi(access);
    const ports = await openWebMidi();

    ports.close();
    expect(input.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
  });

  it('reports a browser without Web MIDI, rather than crashing', async () => {
    vi.stubGlobal('navigator', {});
    await expect(openWebMidi()).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('reports a denied permission distinctly from any other failure', async () => {
    stubWebMidi(() => Promise.reject(new DOMException('nope', 'SecurityError')));
    await expect(openWebMidi()).rejects.toMatchObject({ reason: 'denied' });

    stubWebMidi(() => Promise.reject(new Error('boom')));
    const error = await openWebMidi().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(MidiUnavailableError);
    expect(error).toMatchObject({ reason: 'failed' });
    expect(String(error)).toContain('boom');
  });
});

describe('WebMidiOutput', () => {
  it('exposes the attached outputs as devices', async () => {
    stubWebMidi(new StubAccess(new StubOutput('out-1', 'Digital Piano')));
    const { output } = await openWebMidi();

    expect(output.getDevices()).toEqual([
      { id: 'out-1', name: 'Digital Piano', manufacturer: 'Acme' },
    ]);
    expect(output.getSelectedDeviceId()).toBe('out-1');
  });

  it('sends a note as a timestamped on/off pair', async () => {
    const device = new StubOutput('out-1', 'Digital Piano');
    stubWebMidi(new StubAccess(device));
    const { output } = await openWebMidi();

    output.send({ midiNote: 60, velocity: 90, startTime: 5000, endTime: 5500, channel: 0 });

    expect(device.sent).toEqual([
      { data: [0x90, 60, 90], at: 5000 },
      { data: [0x80, 60, 0], at: 5500 },
    ]);
  });

  it('puts the note on the channel it was given', async () => {
    const device = new StubOutput('out-1', 'Digital Piano');
    stubWebMidi(new StubAccess(device));
    const { output } = await openWebMidi();

    output.send({ midiNote: 76, velocity: 110, startTime: 1, endTime: 2, channel: 9 });

    expect(device.sent[0]!.data[0]).toBe(0x99);
  });

  it('sends nothing when no destination is selected', async () => {
    const device = new StubOutput('out-1', 'Digital Piano');
    stubWebMidi(new StubAccess(device));
    const { output } = await openWebMidi();

    output.select(undefined);
    output.send({ midiNote: 60, velocity: 90, startTime: 1, endTime: 2, channel: 0 });

    expect(device.noteOns()).toEqual([]);
  });

  it('silences every channel on panic', async () => {
    const device = new StubOutput('out-1', 'Digital Piano');
    stubWebMidi(new StubAccess(device));
    const { output } = await openWebMidi();

    output.panic();

    const allNotesOff = device.sent.filter((message) => message.data[1] === 123);
    expect(allNotesOff).toHaveLength(16);
    expect(device.cleared).toBe(1);
  });

  it('silences again after the last queued note, since clear() may do nothing', async () => {
    // Chrome does not implement MIDIOutput.clear(), so a note already handed to
    // the browser still fires; the later silence stops it hanging.
    const device = new StubOutput('out-1', 'Digital Piano');
    stubWebMidi(new StubAccess(device));
    const { output } = await openWebMidi();
    const endTime = performance.now() + 10_000;

    output.send({ midiNote: 60, velocity: 90, startTime: endTime - 500, endTime, channel: 0 });
    device.sent.length = 0;
    output.panic();

    const timestamps = new Set(
      device.sent.filter((message) => message.data[1] === 123).map((message) => message.at),
    );
    expect(timestamps).toEqual(new Set([undefined, endTime + 1]));
  });

  it('picks up an instrument plugged in after start-up', async () => {
    const access = new StubAccess();
    stubWebMidi(access);
    const { output } = await openWebMidi();
    expect(output.getDevices()).toEqual([]);

    const changed = vi.fn();
    output.onDevicesChanged(changed);
    access.plug(new StubOutput('out-1', 'Digital Piano'));

    expect(changed).toHaveBeenCalledTimes(1);
    expect(output.getSelectedDeviceId()).toBe('out-1');
  });

  it('silences the old instrument when you switch destination', async () => {
    const first = new StubOutput('out-1', 'Digital Piano');
    const second = new StubOutput('out-2', 'Synth');
    stubWebMidi(new StubAccess(first, second));
    const { output } = await openWebMidi();

    output.select('out-2');

    expect(first.sent.filter((message) => message.data[1] === 123)).toHaveLength(16);
  });
});
