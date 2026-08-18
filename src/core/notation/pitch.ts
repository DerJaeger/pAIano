/**
 * How a pitch is written down: the letter it is spelled with, and which line or
 * space of a staff that letter sits on.
 *
 * A MIDI note number does not say how it is spelled — 61 is both C♯ and D♭, and
 * the two are written a step apart on the page. Nothing upstream tells us which
 * one a player meant, so one spelling per pitch class is fixed here and used
 * everywhere: the name shown on a notehead, the name in the practice panel and
 * the line a key you are holding is drawn on all agree.
 */

/** The seven letters as semitones above C — C D E F G A B. */
export const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** The letter each of those names is written on, as an index into the seven. */
const LETTERS = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];

const pitchClass = (midiNote: number) => ((midiNote % 12) + 12) % 12;

/** The pitch class on its own, e.g. 61 → "C♯". */
export function pitchClassName(midiNote: number): string {
  return NAMES[pitchClass(midiNote)]!;
}

/** The letter a semitone offset from C is spelled with; -1 if it is not one. */
export function letterIndexOfSemitone(semitones: number): number {
  return LETTER_SEMITONES.indexOf(pitchClass(semitones) as (typeof LETTER_SEMITONES)[number]);
}

/**
 * Which line or space a pitch occupies, counted in steps from C0 upwards — one
 * per letter, so consecutive steps are consecutive lines and spaces.
 *
 * The letter is given rather than derived, because that is what decides the
 * line: B♯3 and C4 are the same key and are written a step apart. Only
 * differences between two steps mean anything, so where the count starts does
 * not matter as long as everyone counts the same way.
 */
export function diatonicStep(midiNote: number, letterIndex: number): number {
  const octave = Math.round((midiNote - 12 - LETTER_SEMITONES[letterIndex]!) / 12);
  return octave * 7 + letterIndex;
}

/** The step a played key lands on, spelled the way this app spells things. */
export function diatonicStepOf(midiNote: number): number {
  return diatonicStep(midiNote, LETTERS[pitchClass(midiNote)]!);
}
