import type { MidiInputEvent } from './types';

export interface KeyboardState {
  /** Keys physically held, ascending. */
  readonly keysDown: readonly number[];
  /** Notes still sounding — held keys plus anything the pedal is holding on. */
  readonly sounding: readonly number[];
  readonly sustain: boolean;
}

export const silentKeyboard: KeyboardState = { keysDown: [], sounding: [], sustain: false };

/**
 * What the player's hands are doing right now. A pure reducer: it returns the
 * *same* state object when nothing changed, so React can skip re-rendering and
 * the practice engine (Phase 5) can diff cheaply.
 */
export function applyMidiEvent(state: KeyboardState, event: MidiInputEvent): KeyboardState {
  switch (event.type) {
    case 'noteOn': {
      const keysDown = withNote(state.keysDown, event.midiNote);
      if (keysDown === state.keysDown) return state;
      return { ...state, keysDown, sounding: withNote(state.sounding, event.midiNote) };
    }
    case 'noteOff': {
      const keysDown = withoutNote(state.keysDown, event.midiNote);
      if (keysDown === state.keysDown) return state;
      // The pedal keeps a released note ringing until it comes up.
      const sounding = state.sustain ? state.sounding : withoutNote(state.sounding, event.midiNote);
      return { ...state, keysDown, sounding };
    }
    case 'sustain': {
      if (event.down === state.sustain) return state;
      // Lifting the pedal silences everything the fingers are not still holding.
      return event.down
        ? { ...state, sustain: true }
        : { ...state, sustain: false, sounding: state.keysDown };
    }
  }
}

function withNote(notes: readonly number[], note: number): readonly number[] {
  const at = notes.findIndex((n) => n >= note);
  if (at >= 0 && notes[at] === note) return notes;
  const result = [...notes];
  result.splice(at < 0 ? notes.length : at, 0, note);
  return result;
}

function withoutNote(notes: readonly number[], note: number): readonly number[] {
  const at = notes.indexOf(note);
  return at < 0 ? notes : [...notes.slice(0, at), ...notes.slice(at + 1)];
}
