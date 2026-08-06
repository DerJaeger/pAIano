import type { ExpectedChord, ExpectedNote, Judgement, Verdict } from './types';

export interface MatcherOptions {
  /** What you are expected to play, sorted by `startTick`. */
  chords: readonly ExpectedChord[];
  /** Ticks either side of the written time that still count as on time. */
  toleranceTicks: number;
  /**
   * Ticks either side within which a press counts as that note *at all*.
   * Outside it the note is not late, it is a different note — and the written
   * one is owed until its own window closes.
   */
  windowTicks: number;
}

/**
 * Decides what you played, and what you owe.
 *
 * Pure and incremental: it is told where the playhead is and what keys went
 * down, and answers with a verdict per press plus the notes whose moment has
 * passed. No clock, no keyboard, no transport — which is what lets the nasty
 * cases (rolled chords, an extra finger, the same note written twice in a bar,
 * a jump back round a loop) be written as a table of presses in a unit test.
 *
 * The rule for a press is *nearest unplayed note of that pitch, within the
 * window*. That single rule covers a chord taken in any order, a trill on the
 * same key, and playing the second of two identical notes first — and it is
 * why a wrong octave is simply a note the score does not have here rather than
 * a near-miss the engine tries to be clever about.
 */
export class Matcher {
  private readonly chords: readonly ExpectedChord[];
  private readonly toleranceTicks: number;
  private readonly windowTicks: number;
  /** Indexes of expected notes that have been played, or given up on. */
  private readonly settled = new Set<number>();
  /** First chord whose window is still open. Only ever moves forward. */
  private from = 0;

  constructor(options: MatcherOptions) {
    this.chords = options.chords;
    this.toleranceTicks = options.toleranceTicks;
    this.windowTicks = options.windowTicks;
  }

  /** Judges a key going down, with the playhead at `tick`. */
  press(midiNote: number, tick: number): Judgement {
    const match = this.nearest(midiNote, tick);
    if (match === undefined) {
      return {
        verdict: 'wrong',
        midiNote,
        tick,
        note: undefined,
        offsetTicks: undefined,
        // Blame the bar the playhead is in; a wrong note has no written home.
        measureIndex: this.chords[this.from]?.measureIndex,
      };
    }

    this.settled.add(match.index);
    const offsetTicks = tick - match.startTick;
    return {
      verdict: timing(offsetTicks, this.toleranceTicks),
      midiNote,
      tick,
      note: match,
      offsetTicks,
      measureIndex: match.measureIndex,
    };
  }

  /**
   * Moves the playhead, reporting the notes whose window has closed unplayed.
   * Called every ticker tick, so it is cheap: the cursor into the chord list
   * only ever moves forward.
   */
  advanceTo(tick: number): Judgement[] {
    const missed: Judgement[] = [];
    while (this.from < this.chords.length) {
      const chord = this.chords[this.from]!;
      if (chord.startTick + this.windowTicks >= tick) break;
      missed.push(...this.giveUpOn(chord, tick));
      this.from++;
    }
    return missed;
  }

  /** The earliest chord with a note still owed, or `undefined` when none is. */
  pending(): ExpectedChord | undefined {
    for (let i = this.from; i < this.chords.length; i++) {
      const chord = this.chords[i]!;
      if (chord.notes.some((note) => !this.settled.has(note.index))) return chord;
    }
    return undefined;
  }

  /** The notes of the pending chord not yet played, ascending. */
  owed(): number[] {
    const chord = this.pending();
    if (chord === undefined) return [];
    return chord.notes
      .filter((note) => !this.settled.has(note.index))
      .map((note) => note.midiNote)
      .sort((a, b) => a - b);
  }

  /**
   * Gives up on the pending chord. This is what "press play instead of the
   * note" means in Follow You: the notes count as missed and the music moves on.
   */
  skipPending(tick: number): Judgement[] {
    const chord = this.pending();
    return chord === undefined ? [] : this.giveUpOn(chord, tick);
  }

  /**
   * Re-aims at `tick` after a seek or a loop jump, without blaming anyone.
   * Everything from here on is owed again — the whole point of looping a bar is
   * to play it a second time — and everything the jump skipped over is
   * forgotten rather than counted against you.
   *
   * The cut is at `tick` exactly, with no window either side: jumping to bar 3
   * means bar 2 does not count, however close to it you landed.
   */
  moveTo(tick: number): void {
    this.from = 0;
    while (this.from < this.chords.length && this.chords[this.from]!.startTick < tick) {
      this.from++;
    }
    for (let i = this.from; i < this.chords.length; i++) {
      for (const note of this.chords[i]!.notes) this.settled.delete(note.index);
    }
  }

  /** Forgets the whole run. */
  reset(): void {
    this.settled.clear();
    this.from = 0;
  }

  /** The unplayed note of this pitch closest to `tick`, within the window. */
  private nearest(midiNote: number, tick: number): ExpectedNote | undefined {
    let best: ExpectedNote | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = this.from; i < this.chords.length; i++) {
      const chord = this.chords[i]!;
      // Sorted by time, so once a chord is beyond the window so is every later one.
      if (chord.startTick - tick > this.windowTicks) break;
      const distance = Math.abs(chord.startTick - tick);
      if (distance > this.windowTicks || distance >= bestDistance) continue;

      for (const note of chord.notes) {
        if (note.midiNote !== midiNote || this.settled.has(note.index)) continue;
        best = note;
        bestDistance = distance;
        break;
      }
    }

    return best;
  }

  private giveUpOn(chord: ExpectedChord, tick: number): Judgement[] {
    const missed: Judgement[] = [];
    for (const note of chord.notes) {
      if (this.settled.has(note.index)) continue;
      this.settled.add(note.index);
      missed.push({
        verdict: 'missed',
        midiNote: note.midiNote,
        tick,
        note,
        offsetTicks: undefined,
        measureIndex: note.measureIndex,
      });
    }
    return missed;
  }
}

function timing(offsetTicks: number, toleranceTicks: number): Verdict {
  if (Math.abs(offsetTicks) <= toleranceTicks) return 'correct';
  return offsetTicks < 0 ? 'early' : 'late';
}
