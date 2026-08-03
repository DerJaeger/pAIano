import type { Hand, NoteEvent, Score } from './types';

/**
 * A track is one staff of one part — the unit you mute when you want to
 * practise a hand while the guide plays the other one.
 *
 * Staff rather than part, because for piano the interesting split is between
 * hands within a single part, and part rather than voice, because voices are an
 * engraving detail no player thinks in.
 */
export interface Track {
  /** `partId/staff`. Matches `trackIdOf` on every event of that staff. */
  id: string;
  partId: string;
  staff: number;
  /** Only set for a multi-staff part; a one-line part is not "a hand". */
  hand: Hand | undefined;
  /** For the UI: "Right hand", or "Piano — right hand" when parts collide. */
  name: string;
  noteCount: number;
}

/** Which tracks the player has silenced. Empty sets mean "play everything". */
export interface TrackSelection {
  muted: ReadonlySet<string>;
  soloed: ReadonlySet<string>;
}

export const ALL_TRACKS: TrackSelection = { muted: new Set(), soloed: new Set() };

const HAND_NAMES: Record<Hand, string> = { right: 'Right hand', left: 'Left hand' };

/** The track an event belongs to. */
export function trackIdOf(event: NoteEvent): string {
  return `${event.partId}/${String(event.staff)}`;
}

/**
 * The mutable tracks of a score, in score order. Staves with no notes are left
 * out: exports routinely declare a staff the music never uses, and an
 * un-mutable "Left hand" row that does nothing is worse than no row.
 */
export function tracksOf(score: Score): Track[] {
  const counts = new Map<string, number>();
  for (const event of score.events) {
    const id = trackIdOf(event);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const multiPart = score.parts.length > 1;
  const tracks: Track[] = [];

  for (const part of score.parts) {
    for (let staff = 1; staff <= part.staffCount; staff++) {
      const id = `${part.id}/${String(staff)}`;
      const noteCount = counts.get(id);
      if (noteCount === undefined) continue;

      // A single-staff part is just the instrument; only a grand staff has hands.
      const hand = part.staffCount > 1 ? part.hands.get(staff) : undefined;
      tracks.push({
        id,
        partId: part.id,
        staff,
        hand,
        name: trackName(part.name, hand, multiPart),
        noteCount,
      });
    }
  }

  return tracks;
}

/** Whether a track sounds, given what is muted and soloed. */
export function isAudible(trackId: string, selection: TrackSelection): boolean {
  // Solo is an override, not a filter on top of mute: soloing a track you muted
  // earlier has to make a sound, or the button looks broken.
  if (selection.soloed.size > 0) return selection.soloed.has(trackId);
  return !selection.muted.has(trackId);
}

/** The events the guide should actually play. */
export function audibleTracks(
  events: readonly NoteEvent[],
  selection: TrackSelection,
): NoteEvent[] {
  return events.filter((event) => isAudible(trackIdOf(event), selection));
}

function trackName(partName: string, hand: Hand | undefined, multiPart: boolean): string {
  if (hand === undefined) return partName;
  // "Right hand" alone is ambiguous the moment a second part has one too.
  return multiPart ? `${partName} — ${hand} hand` : HAND_NAMES[hand];
}
