import type { NoteEvent, Score } from '../score/types';
import type { NoteRef, WrittenPosition } from './types';

/**
 * Translating between the two coordinate systems in the app: playback runs on
 * the repeat-expanded timeline, the page shows each measure once. Everything
 * here is pure so the notation adapter stays a thin drawing layer.
 */

/** Stable identity for a note on the page — the key both sides agree on. */
export function noteRefKey(ref: NoteRef): string {
  return `${String(ref.measureIndex)}:${String(ref.midiNote)}:${String(ref.tickInMeasure)}`;
}

/** Where a point on the expanded timeline is written on the page. */
export function writtenPositionAt(score: Score, tick: number): WrittenPosition | undefined {
  const step = playbackStepAt(score, tick);
  if (step === undefined) return undefined;
  return {
    measureIndex: step.measureIndex,
    pass: step.pass,
    tickInMeasure: tick - step.startTick,
  };
}

/** The written measure sounding at `tick`, or `undefined` past the end. */
export function measureIndexAt(score: Score, tick: number): number | undefined {
  return playbackStepAt(score, tick)?.measureIndex;
}

/** Every distinct note written in a measure, whatever pass it was played on. */
export function notesInMeasure(score: Score, measureIndex: number): NoteRef[] {
  return distinctNotes(score, (event) => event.measureIndex === measureIndex);
}

/** Every distinct note on the page — each written note once, repeats included. */
export function allNoteRefs(score: Score): NoteRef[] {
  return distinctNotes(score, () => true);
}

function distinctNotes(score: Score, keep: (event: NoteEvent) => boolean): NoteRef[] {
  const seen = new Set<string>();
  const refs: NoteRef[] = [];
  for (const event of score.events) {
    if (!keep(event)) continue;
    const ref = noteRefOf(score, event);
    const key = noteRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/** Where an event of the expanded stream is written on the page. */
export function noteRefOf(score: Score, event: NoteEvent): NoteRef {
  const step = score.playbackOrder.find(
    (candidate) => candidate.measureIndex === event.measureIndex && candidate.pass === event.pass,
  );
  return {
    measureIndex: event.measureIndex,
    midiNote: event.midiNote,
    tickInMeasure: event.startTick - (step?.startTick ?? 0),
  };
}

/** Binary search over the expanded playback order, which is sorted by time. */
function playbackStepAt(score: Score, tick: number) {
  const order = score.playbackOrder;
  let low = 0;
  let high = order.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const step = order[middle]!;
    if (tick < step.startTick) high = middle - 1;
    else if (tick >= step.startTick + step.durationTicks) low = middle + 1;
    else return step;
  }
  return undefined;
}
