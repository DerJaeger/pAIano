import { describe, expect, it } from 'vitest';
import { decodeMidiMessage } from './decode';

const at = 1.5;

describe('decodeMidiMessage', () => {
  it('decodes a note-on', () => {
    expect(decodeMidiMessage([0x90, 60, 100], at)).toEqual({
      type: 'noteOn',
      midiNote: 60,
      velocity: 100,
      channel: 0,
      time: at,
    });
  });

  it('decodes a note-off', () => {
    expect(decodeMidiMessage([0x80, 60, 64], at)).toEqual({
      type: 'noteOff',
      midiNote: 60,
      channel: 0,
      time: at,
    });
  });

  it('treats a note-on with velocity 0 as a note-off', () => {
    // Most keyboards use running status and never send a real 0x8n message.
    expect(decodeMidiMessage([0x90, 60, 0], at)).toEqual({
      type: 'noteOff',
      midiNote: 60,
      channel: 0,
      time: at,
    });
  });

  it('keeps the channel', () => {
    expect(decodeMidiMessage([0x93, 60, 100], at)).toMatchObject({ channel: 3 });
    expect(decodeMidiMessage([0x8f, 60, 0], at)).toMatchObject({ channel: 15 });
  });

  it('decodes the sustain pedal, half-pedal counting as down', () => {
    expect(decodeMidiMessage([0xb0, 64, 127], at)).toEqual({
      type: 'sustain',
      down: true,
      channel: 0,
      time: at,
    });
    expect(decodeMidiMessage([0xb0, 64, 64], at)).toMatchObject({ down: true });
    expect(decodeMidiMessage([0xb0, 64, 63], at)).toMatchObject({ down: false });
    expect(decodeMidiMessage([0xb0, 64, 0], at)).toMatchObject({ down: false });
  });

  it('ignores messages we do not act on', () => {
    expect(decodeMidiMessage([0xb0, 7, 100], at)).toBeUndefined(); // volume
    expect(decodeMidiMessage([0xe0, 0, 64], at)).toBeUndefined(); // pitch bend
    expect(decodeMidiMessage([0xf8], at)).toBeUndefined(); // clock tick
    expect(decodeMidiMessage([0xfe], at)).toBeUndefined(); // active sensing
  });

  it('ignores malformed messages rather than throwing', () => {
    expect(decodeMidiMessage([], at)).toBeUndefined();
    expect(decodeMidiMessage([0x90], at)).toBeUndefined();
    expect(decodeMidiMessage([0x90, 60], at)).toMatchObject({ type: 'noteOff' });
    expect(decodeMidiMessage([60, 100], at)).toBeUndefined(); // no status byte
  });

  it('reads a Uint8Array, which is what Web MIDI actually hands us', () => {
    expect(decodeMidiMessage(new Uint8Array([0x90, 62, 80]), at)).toMatchObject({
      type: 'noteOn',
      midiNote: 62,
    });
  });
});
