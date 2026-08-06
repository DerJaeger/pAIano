import { describe, expect, it } from 'vitest';
import {
  accuracy,
  applyJudgements,
  attempts,
  EMPTY_STATS,
  timingAccuracy,
  troubleSpots,
} from './stats';
import type { Judgement, Verdict } from './types';

/** A judgement is only ever folded for its verdict and its bar. */
const judged = (verdict: Verdict, measureIndex: number): Judgement => ({
  verdict,
  midiNote: 60,
  tick: 0,
  note: undefined,
  offsetTicks: undefined,
  measureIndex,
});

const fold = (...judgements: Judgement[]) => applyJudgements(EMPTY_STATS, judgements);

describe('practice stats', () => {
  it('has nothing to report before a note is played', () => {
    expect(accuracy(EMPTY_STATS)).toBeUndefined();
    expect(timingAccuracy(EMPTY_STATS)).toBeUndefined();
    expect(attempts(EMPTY_STATS)).toBe(0);
  });

  it('counts each verdict', () => {
    const stats = fold(judged('correct', 0), judged('late', 0), judged('wrong', 0));

    expect(stats).toMatchObject({ correct: 1, late: 1, wrong: 1, early: 0, missed: 0 });
  });

  it('scores the right note as right however late it was', () => {
    const stats = fold(judged('correct', 0), judged('early', 0), judged('late', 0));

    expect(accuracy(stats)).toBe(1);
    expect(timingAccuracy(stats)).toBeCloseTo(1 / 3);
  });

  it('counts a missed note and an invented one equally against you', () => {
    const played = fold(judged('correct', 0), judged('missed', 0));
    const invented = fold(judged('correct', 0), judged('wrong', 0));

    expect(accuracy(played)).toBe(0.5);
    expect(accuracy(invented)).toBe(0.5);
  });

  it('attributes each judgement to its bar', () => {
    const stats = fold(judged('correct', 0), judged('missed', 1), judged('wrong', 1));

    expect(stats.bars.get(0)).toEqual({ measureIndex: 0, notes: 1, errors: 0 });
    // The wrong note is an error in bar 1 without being a note bar 1 contains.
    expect(stats.bars.get(1)).toEqual({ measureIndex: 1, notes: 1, errors: 2 });
  });

  it('ignores a judgement with no bar to blame', () => {
    const stats = applyJudgements(EMPTY_STATS, [
      { ...judged('wrong', 0), measureIndex: undefined },
    ]);

    expect(stats.bars.size).toBe(0);
    expect(stats.wrong).toBe(1);
  });

  it('ranks the bars you keep getting wrong first', () => {
    const stats = fold(
      judged('correct', 0),
      judged('missed', 1),
      judged('missed', 2),
      judged('wrong', 2),
    );

    expect(troubleSpots(stats).map((bar) => bar.measureIndex)).toEqual([2, 1]);
  });

  it('leaves the stats it was folded from alone', () => {
    const before = fold(judged('correct', 0));
    const after = applyJudgements(before, [judged('missed', 1)]);

    expect(before.correct).toBe(1);
    expect(before.missed).toBe(0);
    expect(before.bars.has(1)).toBe(false);
    expect(after.missed).toBe(1);
  });
});
