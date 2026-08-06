import { describe, expect, it } from 'vitest';
import {
  attributes,
  backup,
  note,
  repeatBackward,
  repeatForward,
  score,
} from '../score/musicxml/fixtures';
import { parseMusicXml } from '../score/musicxml/parseMusicXml';
import { ALL_TRACKS } from '../score/tracks';
import { expectedChords } from './expectations';

/** The parser normalises to its own resolution, so ticks are quoted in quarters. */
const QUARTER = 96;

/** Two staves: a right-hand line over a held left-hand note. */
function hands() {
  return parseMusicXml(
    score([
      [
        attributes(1, { staves: 2 }) +
          note('C', 5, 1, { staff: 1 }) +
          note('E', 5, 1, { staff: 1 }) +
          note('G', 5, 2, { staff: 1 }) +
          backup(4) +
          note('C', 3, 4, { staff: 2, voice: '2' }),
      ],
    ]),
  );
}

const notes = (chords: ReturnType<typeof expectedChords>) =>
  chords.map((chord) => [chord.startTick, chord.notes.map((n) => n.midiNote)] as const);

describe('expectedChords', () => {
  it('expects every note when the guide plays everything', () => {
    expect(notes(expectedChords(hands(), ALL_TRACKS))).toEqual([
      [0, [48, 72]],
      [QUARTER, [76]],
      [2 * QUARTER, [79]],
    ]);
  });

  it('expects only the hand the guide has been told to leave out', () => {
    const muted = { muted: new Set(['P1/1']), soloed: new Set<string>() };

    expect(notes(expectedChords(hands(), muted))).toEqual([
      [0, [72]],
      [QUARTER, [76]],
      [2 * QUARTER, [79]],
    ]);
  });

  it('numbers notes so each one has its own identity', () => {
    const chords = expectedChords(hands(), ALL_TRACKS);

    expect(chords.flatMap((chord) => chord.notes.map((n) => n.index))).toEqual([0, 1, 2, 3]);
  });

  it('locates each note in its written bar, so feedback can be drawn on it', () => {
    const chords = expectedChords(hands(), ALL_TRACKS);
    const third = chords[2]!.notes[0]!;

    expect(third).toMatchObject({
      measureIndex: 0,
      tickInMeasure: 2 * QUARTER,
      pass: 0,
      trackId: 'P1/1',
    });
  });

  it('expects a repeated bar again on the second pass', () => {
    const repeated = parseMusicXml(
      score([[repeatForward() + attributes(1) + note('C', 4, 4) + repeatBackward()]]),
    );

    expect(notes(expectedChords(repeated, ALL_TRACKS))).toEqual([
      [0, [60]],
      [4 * QUARTER, [60]],
    ]);
    // The same written note, so the same place on the page, played twice.
    expect(expectedChords(repeated, ALL_TRACKS).map((c) => c.pass)).toEqual([0, 1]);
  });

  it('asks for a doubled unison only once — you have one finger for it', () => {
    const doubled = parseMusicXml(
      score([
        [
          attributes(1) +
            note('C', 4, 4, { voice: '1' }) +
            backup(4) +
            note('C', 4, 4, { voice: '2' }),
        ],
      ]),
    );

    expect(notes(expectedChords(doubled, ALL_TRACKS))).toEqual([[0, [60]]]);
  });
});
