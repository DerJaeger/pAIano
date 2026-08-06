import { describe, expect, it } from 'vitest';
import { Matcher } from './matcher';
import type { ExpectedChord, ExpectedNote } from './types';

/**
 * Ticks are quoted in quarters here — the matcher's tolerances are musical, not
 * measured in milliseconds, so a test reads the way the window is specified.
 */
const QUARTER = 96;
const TOLERANCE = 0.3 * QUARTER;
const WINDOW = 1 * QUARTER;

/** Builds a chord list from `[startQuarter, ...midiNotes]` tuples. */
function chords(...written: [number, ...number[]][]): ExpectedChord[] {
  let index = 0;
  return written.map(([start, ...midiNotes]) => ({
    startTick: start * QUARTER,
    measureIndex: Math.floor(start / 4),
    pass: 0,
    notes: midiNotes.map<ExpectedNote>((midiNote) => ({
      index: index++,
      midiNote,
      startTick: start * QUARTER,
      measureIndex: Math.floor(start / 4),
      tickInMeasure: (start % 4) * QUARTER,
      pass: 0,
      trackId: 'P1/1',
    })),
  }));
}

function matcher(written: ExpectedChord[]): Matcher {
  return new Matcher({ chords: written, toleranceTicks: TOLERANCE, windowTicks: WINDOW });
}

/** A rising C-D-E, one per beat. */
const scale = () => chords([0, 60], [1, 62], [2, 64]);

describe('Matcher, one note at a time', () => {
  it('calls the right note at the right moment correct', () => {
    const match = matcher(scale());

    expect(match.press(60, 0).verdict).toBe('correct');
    expect(match.press(62, QUARTER).verdict).toBe('correct');
  });

  it('forgives a note inside the tolerance either side', () => {
    const match = matcher(scale());

    expect(match.press(60, 0.2 * QUARTER).verdict).toBe('correct');
    expect(match.press(62, 0.8 * QUARTER).verdict).toBe('correct');
  });

  it('calls a note played before its time early, and after it late', () => {
    const match = matcher(scale());

    expect(match.press(62, 0.5 * QUARTER)).toMatchObject({
      verdict: 'early',
      offsetTicks: -0.5 * QUARTER,
    });
    expect(match.press(60, 0.5 * QUARTER)).toMatchObject({
      verdict: 'late',
      offsetTicks: 0.5 * QUARTER,
    });
  });

  it('calls a note the score does not have here wrong', () => {
    const match = matcher(scale());

    expect(match.press(61, 0)).toMatchObject({ verdict: 'wrong', note: undefined });
  });

  it('calls the right note in the wrong octave wrong', () => {
    const match = matcher(scale());

    expect(match.press(72, 0).verdict).toBe('wrong');
    // …and the note it was standing in for is still owed.
    expect(match.press(60, 0).verdict).toBe('correct');
  });

  it('blames a wrong note on the bar the playhead is in', () => {
    const match = matcher(chords([0, 60], [4, 62]));

    match.advanceTo(4 * QUARTER);

    expect(match.press(61, 4 * QUARTER).measureIndex).toBe(1);
  });

  it('will not let one press pay for a note already played', () => {
    const match = matcher(scale());

    expect(match.press(60, 0).verdict).toBe('correct');
    expect(match.press(60, 0).verdict).toBe('wrong');
  });

  it('takes the nearer of two written instances of the same note', () => {
    const match = matcher(chords([0, 60], [4, 60]));

    expect(match.press(60, 3.5 * QUARTER)).toMatchObject({
      verdict: 'early',
      offsetTicks: -0.5 * QUARTER,
    });
    // The first C is still unplayed and is the only one left to match.
    expect(match.press(60, 0)).toMatchObject({ verdict: 'correct', offsetTicks: 0 });
  });

  it('ignores a note too far from anything written to be that note', () => {
    const match = matcher(scale());

    expect(match.press(64, 0).verdict).toBe('wrong');
  });
});

describe('Matcher, chords', () => {
  it('takes the notes of a chord in any order', () => {
    const match = matcher(chords([0, 60, 64, 67]));

    expect(
      [match.press(67, 0), match.press(60, 0), match.press(64, 0)].map((j) => j.verdict),
    ).toEqual(['correct', 'correct', 'correct']);
  });

  it('accepts a chord rolled across the tolerance', () => {
    const match = matcher(chords([0, 60, 64, 67]));

    expect(match.press(60, 0).verdict).toBe('correct');
    expect(match.press(64, 0.1 * QUARTER).verdict).toBe('correct');
    expect(match.press(67, 0.25 * QUARTER).verdict).toBe('correct');
  });

  it('calls an extra note inside a chord wrong without disturbing the rest', () => {
    const match = matcher(chords([0, 60, 64]));

    expect(match.press(60, 0).verdict).toBe('correct');
    expect(match.press(62, 0).verdict).toBe('wrong');
    expect(match.press(64, 0).verdict).toBe('correct');
  });
});

describe('Matcher, notes that never came', () => {
  it('reports a note as missed once its window has closed', () => {
    const match = matcher(scale());

    expect(match.advanceTo(0.5 * QUARTER)).toEqual([]);
    expect(match.advanceTo(1.5 * QUARTER)).toMatchObject([{ verdict: 'missed', midiNote: 60 }]);
  });

  it('never reports a note that was played', () => {
    const match = matcher(scale());

    match.press(60, 0);

    expect(match.advanceTo(4 * QUARTER)).toMatchObject([{ midiNote: 62 }, { midiNote: 64 }]);
  });

  it('reports every unplayed note of a chord', () => {
    const match = matcher(chords([0, 60, 64, 67]));

    match.press(64, 0);

    expect(match.advanceTo(4 * QUARTER).map((j) => j.midiNote)).toEqual([60, 67]);
  });

  it('will not report the same note missed twice', () => {
    const match = matcher(scale());

    match.advanceTo(4 * QUARTER);

    expect(match.advanceTo(8 * QUARTER)).toEqual([]);
  });
});

describe('Matcher, the next thing owed', () => {
  it('points at the first chord with a note still unplayed', () => {
    const match = matcher(scale());

    expect(match.pending()?.startTick).toBe(0);
    match.press(60, 0);
    expect(match.pending()?.startTick).toBe(QUARTER);
  });

  it('lists only the notes of that chord still owed', () => {
    const match = matcher(chords([0, 60, 64, 67]));

    match.press(64, 0);

    expect(match.owed()).toEqual([60, 67]);
  });

  it('has nothing pending once the piece has been played', () => {
    const match = matcher(chords([0, 60]));

    match.press(60, 0);

    expect(match.pending()).toBeUndefined();
    expect(match.owed()).toEqual([]);
  });

  it('gives up on the pending chord when asked to skip it', () => {
    const match = matcher(scale());

    expect(match.skipPending(0).map((j) => j.verdict)).toEqual(['missed']);
    expect(match.pending()?.startTick).toBe(QUARTER);
  });
});

describe('Matcher, moving around the score', () => {
  it('owes the notes again after a jump back — a looped bar is played twice', () => {
    const match = matcher(scale());

    match.press(60, 0);
    match.press(62, QUARTER);
    match.moveTo(0);

    expect(match.pending()?.startTick).toBe(0);
    expect(match.press(60, 0).verdict).toBe('correct');
  });

  it('does not blame you for the notes a jump forward skipped over', () => {
    const match = matcher(scale());

    match.moveTo(2 * QUARTER);

    expect(match.pending()?.startTick).toBe(2 * QUARTER);
    expect(match.advanceTo(8 * QUARTER).map((j) => j.midiNote)).toEqual([64]);
  });

  it('starts over on reset', () => {
    const match = matcher(scale());

    match.advanceTo(8 * QUARTER);
    match.reset();

    expect(match.pending()?.startTick).toBe(0);
    expect(match.press(60, 0).verdict).toBe('correct');
  });
});
