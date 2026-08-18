import { allNoteRefs } from '../core/notation/position';
import type { NoteHighlight } from '../core/notation/types';
import type { Score } from '../core/score/types';

/**
 * A colour per pitch class, so a run of notes reads as a pattern of colours
 * before it reads as positions on a staff.
 *
 * The order follows the Boomwhacker convention a beginner is most likely to
 * have met elsewhere — red C, round the colour wheel, one step per semitone —
 * but the yellows and greens are taken well down in lightness, because the
 * original set is meant for tubes of coloured plastic, not for 3mm noteheads on
 * white paper.
 */
export const PITCH_CLASS_COLORS = [
  '#d32f2f', // C
  '#e64a19', // C♯
  '#ef6c00', // D
  '#a97400', // E♭
  '#7f8400', // E
  '#4c8a1f', // F
  '#1f7a3d', // F♯
  '#00786e', // G
  '#0270ad', // A♭
  '#3f51b5', // A
  '#7b1fa2', // B♭
  '#b8175c', // B
] as const;

export function pitchColor(midiNote: number): string {
  return PITCH_CLASS_COLORS[((midiNote % 12) + 12) % 12]!;
}

/** The whole score in pitch colours — the bottom layer of the highlight set. */
export function pitchColorHighlights(score: Score): NoteHighlight[] {
  return allNoteRefs(score).map((note) => ({ note, color: pitchColor(note.midiNote) }));
}
