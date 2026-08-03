import type { TempoChange, TempoMap } from './types';

const DEFAULT_BPM = 120;

/**
 * Piecewise-constant tempo, converting between ticks and seconds.
 *
 * Tempo changes are sparse (a handful per piece), so a linear scan with a
 * precomputed cumulative-seconds table is both simplest and fast enough.
 */
export class PiecewiseTempoMap implements TempoMap {
  readonly ticksPerQuarter: number;
  readonly changes: readonly TempoChange[];
  /** Seconds elapsed at the start of segment i. */
  private readonly secondsAt: readonly number[];

  constructor(ticksPerQuarter: number, changes: readonly TempoChange[]) {
    if (ticksPerQuarter <= 0) throw new Error('ticksPerQuarter must be positive');
    this.ticksPerQuarter = ticksPerQuarter;
    this.changes = normalize(changes);

    const secondsAt: number[] = [];
    let seconds = 0;
    this.changes.forEach((change, i) => {
      if (i > 0) {
        const previous = this.changes[i - 1]!;
        seconds += ((change.tick - previous.tick) / ticksPerQuarter) * (60 / previous.bpm);
      }
      secondsAt.push(seconds);
    });
    this.secondsAt = secondsAt;
  }

  tickToSeconds(tick: number): number {
    const i = this.segmentIndexForTick(tick);
    const segment = this.changes[i]!;
    return this.secondsAt[i]! + ((tick - segment.tick) / this.ticksPerQuarter) * (60 / segment.bpm);
  }

  secondsToTick(seconds: number): number {
    let i = 0;
    while (i + 1 < this.changes.length && this.secondsAt[i + 1]! <= seconds) i++;
    const segment = this.changes[i]!;
    return (
      segment.tick + ((seconds - this.secondsAt[i]!) * segment.bpm * this.ticksPerQuarter) / 60
    );
  }

  bpmAt(tick: number): number {
    return this.changes[this.segmentIndexForTick(tick)]!.bpm;
  }

  private segmentIndexForTick(tick: number): number {
    let i = 0;
    while (i + 1 < this.changes.length && this.changes[i + 1]!.tick <= tick) i++;
    return i;
  }
}

/**
 * Guarantees a change at tick 0, sorted order, and no duplicate ticks (a later
 * entry at the same tick wins — MusicXML can carry several tempo directions in
 * one measure).
 */
function normalize(changes: readonly TempoChange[]): TempoChange[] {
  const sorted = [...changes].sort((a, b) => a.tick - b.tick);
  const result: TempoChange[] = [];
  for (const change of sorted) {
    if (change.bpm <= 0) throw new Error(`bpm must be positive, got ${change.bpm}`);
    const last = result[result.length - 1];
    if (last && last.tick === change.tick) result[result.length - 1] = change;
    else if (last && last.bpm === change.bpm) continue;
    else result.push(change);
  }
  if (result.length === 0 || result[0]!.tick > 0) {
    result.unshift({ tick: 0, bpm: result[0]?.bpm ?? DEFAULT_BPM });
  }
  return result;
}
