/**
 * The practice engine's vocabulary. Pure data — the matcher, the scoring and
 * the session all speak in these, and none of them knows what a keyboard or a
 * cursor is.
 *
 * Everything here is measured in *ticks on the expanded timeline*, not in
 * milliseconds. Timing tolerance in musical time rather than clock time is what
 * makes practising at half speed forgiving in the same way the piece is: an
 * eighth-note window stays an eighth-note window however slowly you take it.
 */

/** How the transport and the player relate to each other. */
export type PracticeMode =
  /** Play it for me; nothing is judged. */
  | 'listen'
  /** The music waits at each chord until you have played it. */
  | 'followYou'
  /** Fixed tempo, and you are scored on notes and timing. */
  | 'playAlong';

/** One note you are expected to play. */
export interface ExpectedNote {
  /** Position in the session's flat note list. Stable identity for "played". */
  index: number;
  midiNote: number;
  /** Position on the expanded (repeat-unrolled) timeline. */
  startTick: number;
  /** Written measure, and offset within it — enough to find it on the page. */
  measureIndex: number;
  tickInMeasure: number;
  /** 0 on the first pass through the measure, 1 on the first repeat, etc. */
  pass: number;
  /** `partId/staff`, so feedback can be attributed to a hand. */
  trackId: string;
}

/**
 * Notes written to sound together. One press each, in any order — a chord you
 * roll is still the chord that was written.
 */
export interface ExpectedChord {
  startTick: number;
  measureIndex: number;
  pass: number;
  notes: readonly ExpectedNote[];
}

export type Verdict =
  /** The right note, close enough to the right time. */
  | 'correct'
  /** The right note, but ahead of its written time. */
  | 'early'
  /** The right note, but behind it. */
  | 'late'
  /** A note the score does not have anywhere near here. */
  | 'wrong'
  /** A written note whose window closed with nobody playing it. */
  | 'missed';

/** What the matcher decided about one press, or one note that never came. */
export interface Judgement {
  verdict: Verdict;
  midiNote: number;
  /** Where the playhead was when this was decided. */
  tick: number;
  /** The written note this concerns; absent only for a wrong note. */
  note: ExpectedNote | undefined;
  /** Signed ticks from the written time; negative is early. */
  offsetTicks: number | undefined;
  /** Written bar this happened in, for the per-bar heatmap. */
  measureIndex: number | undefined;
}
