export interface PianoKey {
  midiNote: number;
  black: boolean;
  /** Left edge, as a percentage of the keyboard's width. */
  left: number;
  /** Width, as a percentage of the keyboard's width. */
  width: number;
}

/** Semitones within an octave that are black keys. */
const BLACK = new Set([1, 3, 6, 8, 10]);

/** A0 to C8 — the 88 keys of a full-size piano. */
export const LOWEST_KEY = 21;
export const HIGHEST_KEY = 108;

export const isBlackKey = (midiNote: number): boolean => BLACK.has(((midiNote % 12) + 12) % 12);

/**
 * Geometry for drawing a keyboard: white keys tile the full width, black keys
 * straddle the seam between the two whites they sit between. Percentages, so
 * the strip scales with whatever width the layout gives it.
 */
export function pianoLayout(lowest = LOWEST_KEY, highest = HIGHEST_KEY): PianoKey[] {
  const whiteCount = countWhiteKeys(lowest, highest);
  if (whiteCount === 0) return [];

  const whiteWidth = 100 / whiteCount;
  const blackWidth = whiteWidth * 0.6;

  const keys: PianoKey[] = [];
  let whiteIndex = 0;
  for (let midiNote = lowest; midiNote <= highest; midiNote++) {
    if (isBlackKey(midiNote)) {
      keys.push({
        midiNote,
        black: true,
        left: whiteIndex * whiteWidth - blackWidth / 2,
        width: blackWidth,
      });
    } else {
      keys.push({ midiNote, black: false, left: whiteIndex * whiteWidth, width: whiteWidth });
      whiteIndex++;
    }
  }
  return keys;
}

function countWhiteKeys(lowest: number, highest: number): number {
  let count = 0;
  for (let midiNote = lowest; midiNote <= highest; midiNote++) {
    if (!isBlackKey(midiNote)) count++;
  }
  return count;
}
