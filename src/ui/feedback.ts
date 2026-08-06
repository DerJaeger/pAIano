import type { NoteHighlight } from '../core/notation/types';
import type { Judgement, Verdict } from '../core/practice/types';

/**
 * How a verdict looks on the page.
 *
 * Green and red carry the meaning, so the two of them are the ones a
 * red-green colour-blind reader most needs told apart — hence a distinctly
 * darker, browner red rather than the usual bright one, and amber (not a
 * lighter green) for a note that was right but out of time.
 */
export const VERDICT_COLORS: Record<Verdict, string> = {
  correct: '#1f8b4c',
  early: '#c77700',
  late: '#c77700',
  wrong: '#a3231b',
  missed: '#a3231b',
};

/** Notes to recolour on the sheet, given every note judged so far. */
export function feedbackHighlights(results: ReadonlyMap<number, Judgement>): NoteHighlight[] {
  const highlights: NoteHighlight[] = [];

  for (const judgement of results.values()) {
    const note = judgement.note;
    // A wrong note is not written anywhere, so there is nothing to recolour.
    if (note === undefined) continue;
    highlights.push({
      note: {
        measureIndex: note.measureIndex,
        midiNote: note.midiNote,
        tickInMeasure: note.tickInMeasure,
      },
      color: VERDICT_COLORS[judgement.verdict],
    });
  }

  return highlights;
}
