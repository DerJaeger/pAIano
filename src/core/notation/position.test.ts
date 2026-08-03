import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../score/musicxml/parseMusicXml';
import { attributes, note, repeatBackward, repeatForward, score } from '../score/musicxml/fixtures';
import {
  measureIndexAt,
  noteRefKey,
  noteRefOf,
  notesInMeasure,
  writtenPositionAt,
} from './position';

/** Two bars of quarter notes, the pair wrapped in a repeat: |: C4 … :| */
const repeated = parseMusicXml(
  score([
    [
      `${repeatForward()}${attributes(1)}${note('C', 4, 1)}${note('D', 4, 1)}${note('E', 4, 1)}${note('F', 4, 1)}`,
      `${note('G', 4, 4)}${repeatBackward()}`,
    ],
  ]),
);

const tpq = repeated.ticksPerQuarter;

describe('writtenPositionAt', () => {
  it('maps the start of the piece to the first measure', () => {
    expect(writtenPositionAt(repeated, 0)).toEqual({
      measureIndex: 0,
      pass: 0,
      tickInMeasure: 0,
    });
  });

  it('maps a point inside a measure to an offset from its start', () => {
    expect(writtenPositionAt(repeated, 2 * tpq)).toEqual({
      measureIndex: 0,
      pass: 0,
      tickInMeasure: 2 * tpq,
    });
  });

  it('maps the repeat back onto the same written measure, one pass later', () => {
    expect(writtenPositionAt(repeated, 8 * tpq)).toEqual({
      measureIndex: 0,
      pass: 1,
      tickInMeasure: 0,
    });
  });

  it('has nothing to show past the end of the piece', () => {
    expect(writtenPositionAt(repeated, repeated.durationTicks)).toBeUndefined();
    expect(measureIndexAt(repeated, -1)).toBeUndefined();
  });

  it('follows the played measures across the whole timeline', () => {
    const perBar = Array.from({ length: 4 }, (_, bar) => measureIndexAt(repeated, bar * 4 * tpq));
    expect(perBar).toEqual([0, 1, 0, 1]);
  });
});

describe('notesInMeasure', () => {
  it('lists what is written in the bar, in time order', () => {
    expect(notesInMeasure(repeated, 0)).toEqual([
      { measureIndex: 0, midiNote: 60, tickInMeasure: 0 },
      { measureIndex: 0, midiNote: 62, tickInMeasure: tpq },
      { measureIndex: 0, midiNote: 64, tickInMeasure: 2 * tpq },
      { measureIndex: 0, midiNote: 65, tickInMeasure: 3 * tpq },
    ]);
  });

  it('counts a repeated measure once — it is only written once', () => {
    const played = repeated.events.filter((event) => event.measureIndex === 0);
    expect(played).toHaveLength(8);
    expect(notesInMeasure(repeated, 0)).toHaveLength(4);
  });

  it('is empty for a bar with no notes', () => {
    expect(notesInMeasure(repeated, 7)).toEqual([]);
  });
});

describe('noteRefOf', () => {
  it('gives a note on the repeat the same reference as on the first pass', () => {
    const [first, second] = repeated.events.filter((event) => event.midiNote === 60);
    expect(second!.startTick).toBeGreaterThan(first!.startTick);
    expect(noteRefOf(repeated, second!)).toEqual(noteRefOf(repeated, first!));
  });
});

describe('noteRefKey', () => {
  it('separates notes by bar, pitch and position', () => {
    const key = noteRefKey({ measureIndex: 3, midiNote: 60, tickInMeasure: 480 });
    expect(key).toBe('3:60:480');
    expect(key).not.toBe(noteRefKey({ measureIndex: 3, midiNote: 60, tickInMeasure: 0 }));
  });
});
