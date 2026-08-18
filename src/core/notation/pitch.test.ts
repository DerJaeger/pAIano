import { describe, expect, it } from 'vitest';
import { diatonicStep, diatonicStepOf, letterIndexOfSemitone, pitchClassName } from './pitch';

describe('pitchClassName', () => {
  it('names a key the way the rest of the app names it', () => {
    expect(pitchClassName(60)).toBe('C');
    expect(pitchClassName(61)).toBe('C♯');
    expect(pitchClassName(63)).toBe('E♭');
    expect([21, 108].map(pitchClassName)).toEqual(['A', 'C']);
  });
});

describe('letterIndexOfSemitone', () => {
  it('maps the seven naturals onto their letters', () => {
    expect([0, 2, 4, 5, 7, 9, 11].map(letterIndexOfSemitone)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('reports a semitone that is not a natural', () => {
    expect(letterIndexOfSemitone(1)).toBe(-1);
  });
});

describe('diatonicStep', () => {
  it('counts one step per line and space', () => {
    // C4 D4 E4 F4 G4 A4 B4 C5 — eight consecutive lines and spaces.
    const scale = [60, 62, 64, 65, 67, 69, 71, 72].map(diatonicStepOf);
    expect(scale.map((step) => step - scale[0]!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('writes a sharp on the line of its letter, not the key above', () => {
    expect(diatonicStepOf(61)).toBe(diatonicStepOf(60)); // C♯4 on C4's line
    expect(diatonicStepOf(63)).toBe(diatonicStepOf(64)); // E♭4 on E4's line
  });

  it('takes the octave from the spelling, so B♯ stays on a B line', () => {
    expect(diatonicStep(60, 6)).toBe(diatonicStepOf(59)); // B♯3 with B3
    expect(diatonicStep(59, 0)).toBe(diatonicStepOf(60)); // C♭4 with C4
  });

  it('is one octave — seven steps — apart for the same letter', () => {
    expect(diatonicStepOf(72) - diatonicStepOf(60)).toBe(7);
  });
});
