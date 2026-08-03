import { describe, expect, it } from 'vitest';
import { expandRepeats } from './repeats';
import { emptyStructure, type MeasureStructure } from './structure';

/** Builds a bar line of measures from terse specs, e.g. `bars(4, { 1: { forwardRepeat: true } })`. */
function bars(count: number, overrides: Record<number, Partial<MeasureStructure>> = {}) {
  return Array.from({ length: count }, (_, i) => ({ ...emptyStructure(), ...overrides[i] }));
}

const played = (measures: readonly MeasureStructure[]) =>
  expandRepeats(measures).map((step) => step.measureIndex);

describe('expandRepeats', () => {
  it('plays a piece without repeats straight through', () => {
    expect(played(bars(4))).toEqual([0, 1, 2, 3]);
  });

  it('repeats a section between forward and backward repeat marks', () => {
    // |: 1 2 :| 3 4
    const measures = bars(4, { 0: { forwardRepeat: true }, 1: { backwardRepeat: true } });
    expect(played(measures)).toEqual([0, 1, 0, 1, 2, 3]);
  });

  it('repeats from the start of the piece when there is no forward mark', () => {
    expect(played(bars(3, { 1: { backwardRepeat: true } }))).toEqual([0, 1, 0, 1, 2]);
  });

  it('honours an explicit repeat count', () => {
    const measures = bars(2, {
      0: { forwardRepeat: true },
      1: { backwardRepeat: true, repeatTimes: 3 },
    });
    expect(played(measures)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('numbers the passes through each measure', () => {
    const measures = bars(2, { 0: { forwardRepeat: true }, 1: { backwardRepeat: true } });
    expect(expandRepeats(measures)).toEqual([
      { measureIndex: 0, pass: 0 },
      { measureIndex: 1, pass: 0 },
      { measureIndex: 0, pass: 1 },
      { measureIndex: 1, pass: 1 },
    ]);
  });

  it('takes first and second endings', () => {
    // |: 0 1 [1. 2 :| [2. 3 ] 4
    const measures = bars(5, {
      0: { forwardRepeat: true },
      2: { endingStart: [1], endingStop: true, backwardRepeat: true },
      3: { endingStart: [2], endingStop: true },
    });
    expect(played(measures)).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });

  it('handles a multi-measure volta bracket', () => {
    // |: 0 [1. 1 2 :| [2. 3 4 ]
    const measures = bars(5, {
      0: { forwardRepeat: true },
      1: { endingStart: [1] },
      2: { endingStop: true, backwardRepeat: true },
      3: { endingStart: [2] },
      4: { endingStop: true },
    });
    expect(played(measures)).toEqual([0, 1, 2, 0, 3, 4]);
  });

  it('plays an ending listed for several repetitions on each of them', () => {
    // |: 0 [1.,2. 1 :| [3. 2 ]
    const measures = bars(3, {
      0: { forwardRepeat: true },
      1: { endingStart: [1, 2], endingStop: true, backwardRepeat: true, repeatTimes: 3 },
      2: { endingStart: [3], endingStop: true },
    });
    expect(played(measures)).toEqual([0, 1, 0, 1, 0, 2]);
  });

  it('takes a da capo once and then ignores repeats', () => {
    // 0 |: 1 :| 2(D.C.)
    const measures = bars(3, {
      1: { forwardRepeat: true, backwardRepeat: true },
      2: { dacapo: true },
    });
    expect(played(measures)).toEqual([0, 1, 1, 2, 0, 1, 2]);
  });

  it('stops at Fine after a da capo, but not on the way there', () => {
    const measures = bars(4, { 1: { fine: true }, 3: { dacapo: true } });
    expect(played(measures)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('jumps to the segno on a dal segno', () => {
    const measures = bars(4, { 1: { segno: true }, 3: { dalsegno: true, fine: false } });
    expect(played(measures)).toEqual([0, 1, 2, 3, 1, 2, 3]);
  });

  it('goes to the coda on the repeat pass', () => {
    // 0 1(To Coda) 2 3(D.S.) 4(Coda) — segno at 0.
    const measures = bars(5, {
      0: { segno: true },
      1: { toCoda: true },
      3: { dalsegno: true },
      4: { coda: true },
    });
    expect(played(measures)).toEqual([0, 1, 2, 3, 0, 1, 4]);
  });

  it('throws rather than hanging on a malformed structure', () => {
    // A backward repeat with an absurd count that never terminates would hang;
    // simulate by pointing a da capo at a measure that jumps back forever.
    const measures = bars(2, { 1: { backwardRepeat: true, repeatTimes: 10_000 } });
    expect(() => expandRepeats(measures)).toThrow(/did not terminate/);
  });
});
