import { describe, expect, it } from 'vitest';
import { HIGHEST_KEY, LOWEST_KEY, isBlackKey, pianoLayout } from './pianoLayout';

describe('pianoLayout', () => {
  const keys = pianoLayout();

  it('lays out all 88 keys, 52 white and 36 black', () => {
    expect(keys).toHaveLength(88);
    expect(keys.filter((key) => !key.black)).toHaveLength(52);
    expect(keys.filter((key) => key.black)).toHaveLength(36);
    expect(keys[0]?.midiNote).toBe(LOWEST_KEY);
    expect(keys.at(-1)?.midiNote).toBe(HIGHEST_KEY);
  });

  it('fills the width exactly with the white keys', () => {
    const white = keys.filter((key) => !key.black);
    expect(white[0]?.left).toBe(0);
    const last = white.at(-1)!;
    expect(last.left + last.width).toBeCloseTo(100);
  });

  it('straddles each black key over the seam between its neighbours', () => {
    const c4 = keys.find((key) => key.midiNote === 60)!;
    const cSharp4 = keys.find((key) => key.midiNote === 61)!;
    const seam = c4.left + c4.width;
    expect(cSharp4.left + cSharp4.width / 2).toBeCloseTo(seam);
    expect(cSharp4.width).toBeLessThan(c4.width);
  });

  it('knows which notes are black keys', () => {
    expect(isBlackKey(60)).toBe(false); // C4
    expect(isBlackKey(61)).toBe(true); // C♯4
    expect(isBlackKey(70)).toBe(true); // B♭4
  });

  it('handles a narrower range', () => {
    expect(pianoLayout(60, 72)).toHaveLength(13);
    expect(pianoLayout(60, 60)).toEqual([{ midiNote: 60, black: false, left: 0, width: 100 }]);
  });
});
