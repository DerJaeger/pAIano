import type { Judgement, Verdict } from './types';

/** How one written bar went, for the heatmap. */
export interface BarStats {
  measureIndex: number;
  /** Notes of the score accounted for in this bar, right or wrong. */
  notes: number;
  /** Of those, the ones that were not played right and on time. */
  errors: number;
}

/**
 * The running score. Immutable and folded from judgements, so a summary is
 * never out of step with the feedback that produced it.
 */
export interface PracticeStats {
  correct: number;
  early: number;
  late: number;
  wrong: number;
  missed: number;
  /** Per written bar, in the order the bars were first reached. */
  bars: ReadonlyMap<number, BarStats>;
}

export const EMPTY_STATS: PracticeStats = {
  correct: 0,
  early: 0,
  late: 0,
  wrong: 0,
  missed: 0,
  bars: new Map(),
};

export function applyJudgement(stats: PracticeStats, judgement: Judgement): PracticeStats {
  const { verdict, measureIndex } = judgement;
  const bars = new Map(stats.bars);

  if (measureIndex !== undefined) {
    const bar = bars.get(measureIndex) ?? { measureIndex, notes: 0, errors: 0 };
    bars.set(measureIndex, {
      measureIndex,
      // A wrong note is an error that was never a note of the score, so it
      // counts against the bar without inflating what the bar contains.
      notes: bar.notes + (verdict === 'wrong' ? 0 : 1),
      errors: bar.errors + (verdict === 'correct' ? 0 : 1),
    });
  }

  return { ...stats, [verdict]: stats[verdict] + 1, bars };
}

export function applyJudgements(
  stats: PracticeStats,
  judgements: readonly Judgement[],
): PracticeStats {
  return judgements.reduce(applyJudgement, stats);
}

/** Written notes you played, whatever the timing. */
export function hit(stats: PracticeStats): number {
  return stats.correct + stats.early + stats.late;
}

/** Everything that was judged: notes played, notes owed, notes invented. */
export function attempts(stats: PracticeStats): number {
  return hit(stats) + stats.wrong + stats.missed;
}

/**
 * Right notes as a fraction of everything judged, or `undefined` before there
 * is anything to judge — "0%" on a run you have not started is a lie.
 */
export function accuracy(stats: PracticeStats): number | undefined {
  const total = attempts(stats);
  return total === 0 ? undefined : hit(stats) / total;
}

/** Of the notes you got right, how many were also in time. */
export function timingAccuracy(stats: PracticeStats): number | undefined {
  const total = hit(stats);
  return total === 0 ? undefined : stats.correct / total;
}

/** Bars with something to answer for, worst first. */
export function troubleSpots(stats: PracticeStats, limit = 5): BarStats[] {
  return [...stats.bars.values()]
    .filter((bar) => bar.errors > 0)
    .sort((a, b) => b.errors - a.errors || a.measureIndex - b.measureIndex)
    .slice(0, limit);
}

const VERDICT_LABELS: Record<Verdict, string> = {
  correct: 'In time',
  early: 'Early',
  late: 'Late',
  wrong: 'Wrong note',
  missed: 'Missed',
};

export const verdictLabel = (verdict: Verdict): string => VERDICT_LABELS[verdict];
