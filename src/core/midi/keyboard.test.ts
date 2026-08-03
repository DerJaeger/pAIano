import { describe, expect, it } from 'vitest';
import { applyMidiEvent, silentKeyboard, type KeyboardState } from './keyboard';
import type { MidiInputEvent } from './types';

const noteOn = (midiNote: number, velocity = 80): MidiInputEvent => ({
  type: 'noteOn',
  midiNote,
  velocity,
  channel: 0,
  time: 0,
});
const noteOff = (midiNote: number): MidiInputEvent => ({
  type: 'noteOff',
  midiNote,
  channel: 0,
  time: 0,
});
const pedal = (down: boolean): MidiInputEvent => ({ type: 'sustain', down, channel: 0, time: 0 });

const play = (...events: MidiInputEvent[]): KeyboardState =>
  events.reduce(applyMidiEvent, silentKeyboard);

describe('keyboard state', () => {
  it('starts silent', () => {
    expect(silentKeyboard).toEqual({ keysDown: [], sounding: [], sustain: false });
  });

  it('tracks keys down, in pitch order whatever order they were pressed', () => {
    expect(play(noteOn(64), noteOn(60), noteOn(67)).keysDown).toEqual([60, 64, 67]);
  });

  it('releases a key', () => {
    expect(play(noteOn(60), noteOn(64), noteOff(60)).keysDown).toEqual([64]);
  });

  it('keeps notes sounding while the sustain pedal is down', () => {
    const state = play(noteOn(60), pedal(true), noteOff(60));
    expect(state.keysDown).toEqual([]);
    expect(state.sounding).toEqual([60]);
    expect(state.sustain).toBe(true);
  });

  it('drops pedal-held notes when the pedal comes up, keeping held keys', () => {
    const state = play(noteOn(60), noteOn(64), pedal(true), noteOff(60), pedal(false));
    expect(state.sounding).toEqual([64]);
    expect(state.keysDown).toEqual([64]);
  });

  it('sounds a note pressed while the pedal is already down', () => {
    const state = play(pedal(true), noteOn(60), noteOff(60));
    expect(state.sounding).toEqual([60]);
  });

  it('ignores a release for a key that is not down', () => {
    const state = play(noteOn(60));
    expect(applyMidiEvent(state, noteOff(64))).toBe(state);
  });

  it('ignores a repeated note-on for a key already down', () => {
    const state = play(noteOn(60));
    expect(applyMidiEvent(state, noteOn(60))).toBe(state);
  });

  it('ignores a redundant pedal message', () => {
    const state = play(noteOn(60), pedal(true));
    expect(applyMidiEvent(state, pedal(true))).toBe(state);
  });

  it('never mutates the state it is given', () => {
    const before = play(noteOn(60));
    applyMidiEvent(before, noteOn(64));
    expect(before.keysDown).toEqual([60]);
  });
});
