import { isAudible, trackIdOf, type TrackSelection } from '../score/tracks';
import type { NoteEvent, Score } from '../score/types';
import type { ExpectedChord, ExpectedNote } from './types';

/**
 * The notes you are expected to play.
 *
 * Muting a track is how you say you will play it yourself, so the expectation
 * is exactly what the guide leaves out — one control, no second "which hand am
 * I practising" setting to keep in step with the first. With nothing muted the
 * guide doubles you and every note counts, which is the sensible reading of a
 * score with nothing taken away.
 */
export function expectedChords(score: Score, selection: TrackSelection): ExpectedChord[] {
  const yours = score.events.filter((event) => !isAudible(trackIdOf(event), selection));
  const events = yours.length > 0 ? yours : score.events;
  const measureStarts = measureStartTicks(score);

  const chords: ExpectedChord[] = [];
  let index = 0;

  for (const event of events) {
    const last = chords[chords.length - 1];
    const chord =
      last !== undefined && last.startTick === event.startTick ? last : startChord(chords, event);

    // Two voices writing the same pitch at the same instant is one key to press.
    if (chord.notes.some((note) => note.midiNote === event.midiNote)) continue;

    (chord.notes as ExpectedNote[]).push({
      index: index++,
      midiNote: event.midiNote,
      startTick: event.startTick,
      measureIndex: event.measureIndex,
      tickInMeasure: event.startTick - (measureStarts.get(passKey(event)) ?? 0),
      pass: event.pass,
      trackId: trackIdOf(event),
    });
  }

  return chords;
}

function startChord(chords: ExpectedChord[], event: NoteEvent): ExpectedChord {
  const chord: ExpectedChord = {
    startTick: event.startTick,
    measureIndex: event.measureIndex,
    pass: event.pass,
    notes: [],
  };
  chords.push(chord);
  return chord;
}

const passKey = (of: { measureIndex: number; pass: number }): string =>
  `${String(of.measureIndex)}:${String(of.pass)}`;

/** Where each pass through each written measure lands on the expanded timeline. */
function measureStartTicks(score: Score): Map<string, number> {
  const starts = new Map<string, number>();
  for (const step of score.playbackOrder) starts.set(passKey(step), step.startTick);
  return starts;
}
