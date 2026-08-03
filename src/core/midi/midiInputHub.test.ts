import { describe, expect, it, vi } from 'vitest';
import { MidiInputHub } from './midiInputHub';
import { FakeClock } from '../transport/clock';
import { FakeMidiInput } from './fakeMidiInput';
import type { MidiInputEvent } from './types';

const device = (id: string, name = id) => ({ id, name, manufacturer: 'Acme' });

describe('MidiInputHub', () => {
  it('selects the first device that appears, so plugging in just works', () => {
    const hub = new MidiInputHub();
    expect(hub.getSelectedDeviceId()).toBeUndefined();
    hub.setDevices([device('a'), device('b')]);
    expect(hub.getSelectedDeviceId()).toBe('a');
  });

  it('keeps your choice when another device is plugged in', () => {
    const hub = new MidiInputHub();
    hub.setDevices([device('a'), device('b')]);
    hub.select('b');
    hub.setDevices([device('a'), device('b'), device('c')]);
    expect(hub.getSelectedDeviceId()).toBe('b');
  });

  it('falls back to another device when the selected one is unplugged', () => {
    const hub = new MidiInputHub();
    hub.setDevices([device('a'), device('b')]);
    hub.select('b');
    hub.setDevices([device('a')]);
    expect(hub.getSelectedDeviceId()).toBe('a');
  });

  it('reuses the device array while the set is unchanged', () => {
    // useSyncExternalStore re-renders on identity, so this must be stable.
    const hub = new MidiInputHub();
    hub.setDevices([device('a')]);
    const first = hub.getDevices();
    hub.setDevices([device('a')]);
    expect(hub.getDevices()).toBe(first);
    hub.setDevices([device('a', 'renamed')]);
    expect(hub.getDevices()).not.toBe(first);
  });

  it('notifies listeners only when the device set actually changes', () => {
    const hub = new MidiInputHub();
    const listener = vi.fn();
    hub.onDevicesChanged(listener);
    hub.setDevices([device('a')]);
    hub.setDevices([device('a')]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies listeners when the selection changes', () => {
    const hub = new MidiInputHub();
    hub.setDevices([device('a'), device('b')]);
    const listener = vi.fn();
    hub.onDevicesChanged(listener);
    hub.select('b');
    hub.select('b');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('decodes raw messages from the selected device and ignores the rest', () => {
    const hub = new MidiInputHub();
    hub.setDevices([device('a'), device('b')]);
    const events: MidiInputEvent[] = [];
    hub.onMessage((event) => events.push(event));

    hub.handleRawMessage('b', [0x90, 60, 100], 1000);
    hub.handleRawMessage('a', [0x90, 60, 100], 1000);

    expect(events).toEqual([
      { type: 'noteOn', midiNote: 60, velocity: 100, channel: 0, time: 1000 },
    ]);
  });

  it("keeps the driver's own timestamp, which is already the master clock", () => {
    const hub = new MidiInputHub(new FakeClock(50));
    hub.setDevices([device('a')]);
    const events: MidiInputEvent[] = [];
    hub.onMessage((event) => events.push(event));

    hub.handleRawMessage('a', [0x90, 60, 100], 1200);

    expect(events[0]?.time).toBe(1200);
  });

  it('reads the clock when the driver sends no timestamp', () => {
    // Several drivers send 0 for every message; that means "just now".
    const hub = new MidiInputHub(new FakeClock(1234));
    hub.setDevices([device('a')]);
    const events: MidiInputEvent[] = [];
    hub.onMessage((event) => events.push(event));

    hub.handleRawMessage('a', [0x90, 60, 100], 0);
    hub.handleRawMessage('a', [0x90, 62, 100]);

    expect(events.map((event) => event.time)).toEqual([1234, 1234]);
  });

  it('stops delivering after unsubscribe and after close', () => {
    const hub = new MidiInputHub();
    hub.setDevices([device('a')]);
    const first = vi.fn();
    const second = vi.fn();
    const stop = hub.onMessage(first);
    hub.onMessage(second);

    stop();
    hub.handleRawMessage('a', [0x90, 60, 100], 0);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    hub.close();
    hub.handleRawMessage('a', [0x90, 60, 100], 0);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('listens to nothing when nothing is selected', () => {
    const hub = new MidiInputHub();
    hub.setDevices([device('a')]);
    hub.select(undefined);
    const listener = vi.fn();
    hub.onMessage(listener);
    hub.handleRawMessage('a', [0x90, 60, 100], 0);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('FakeMidiInput', () => {
  it('drives the port from scripted playing, with times on the audio clock', () => {
    const midi = new FakeMidiInput();
    const events: MidiInputEvent[] = [];
    midi.onMessage((event) => events.push(event));

    midi.press(60, 90);
    midi.advance(0.5);
    midi.pedal(true);
    midi.release(60);

    expect(events).toEqual([
      { type: 'noteOn', midiNote: 60, velocity: 90, channel: 0, time: 0 },
      { type: 'sustain', down: true, channel: 0, time: 0.5 },
      { type: 'noteOff', midiNote: 60, channel: 0, time: 0.5 },
    ]);
  });

  it('offers a device and models hot-plug', () => {
    const midi = new FakeMidiInput();
    expect(midi.getDevices()).toHaveLength(1);
    expect(midi.getSelectedDeviceId()).toBe(midi.getDevices()[0]?.id);

    midi.attach({ id: 'second', name: 'Second', manufacturer: 'Acme' });
    expect(midi.getDevices()).toHaveLength(2);
    midi.detach('second');
    expect(midi.getDevices()).toHaveLength(1);
  });

  it('plays a chord and reports what is sounding', () => {
    const midi = new FakeMidiInput();
    midi.chord([60, 64, 67]);
    expect(midi.keyboard.sounding).toEqual([60, 64, 67]);
    midi.releaseAll();
    expect(midi.keyboard.sounding).toEqual([]);
  });
});
