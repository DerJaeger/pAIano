import { describe, expect, it } from 'vitest';
import { parseMusicXml } from './parseMusicXml';
import {
  attributes,
  backup,
  endingStart,
  endingStop,
  forward,
  note,
  repeatBackward,
  repeatForward,
  rest,
  score,
  soundDirective,
  tempo,
} from './fixtures';
import type { NoteEvent, Score } from '../types';

/** Notes as [midi, startQuarter, durationQuarters] — readable musical assertions. */
function quarters(parsed: Score): [number, number, number][] {
  const ppq = parsed.ticksPerQuarter;
  return parsed.events.map((event) => [
    event.midiNote,
    event.startTick / ppq,
    event.durationTicks / ppq,
  ]);
}

function seconds(parsed: Score, event: NoteEvent): number {
  return parsed.tempoMap.tickToSeconds(event.startTick);
}

describe('parseMusicXml — pitches and rhythm', () => {
  it('reads a single note', () => {
    const parsed = parseMusicXml(score([[attributes(1) + note('C', 4, 4)]]));
    expect(parsed.title).toBe('Fixture');
    expect(quarters(parsed)).toEqual([[60, 0, 4]]);
  });

  it('converts steps, octaves and accidentals to MIDI note numbers', () => {
    const parsed = parseMusicXml(
      score([
        [attributes(1) + note('C', 4, 1) + note('A', 0, 1) + note('F#', 5, 1) + note('Bb', 3, 1)],
      ]),
    );
    expect(parsed.events.map((e) => e.midiNote)).toEqual([60, 21, 78, 58]);
  });

  it('places consecutive notes end to end and skips rests', () => {
    const parsed = parseMusicXml(
      score([[attributes(2) + note('C', 4, 2) + rest(2) + note('E', 4, 4)]]),
    );
    expect(quarters(parsed)).toEqual([
      [60, 0, 1],
      [64, 2, 2],
    ]);
  });

  it('stacks a chord on one onset', () => {
    const parsed = parseMusicXml(
      score([
        [
          attributes(1) +
            note('C', 4, 4) +
            note('E', 4, 4, { chord: true }) +
            note('G', 4, 4, { chord: true }) +
            note('C', 5, 4),
        ],
      ]),
    );
    expect(quarters(parsed)).toEqual([
      [60, 0, 4],
      [64, 0, 4],
      [67, 0, 4],
      [72, 4, 4],
    ]);
  });

  it('rewinds the cursor on backup so two staves overlap', () => {
    const parsed = parseMusicXml(
      score([
        [
          attributes(1, { staves: 2 }) +
            note('C', 5, 4, { staff: 1 }) +
            backup(4) +
            note('C', 3, 4, { staff: 2, voice: '5' }),
        ],
      ]),
    );
    expect(quarters(parsed)).toEqual([
      [48, 0, 4],
      [72, 0, 4],
    ]);
    expect(parsed.events.map((e) => e.staff)).toEqual([2, 1]);
  });

  it('advances silently on forward', () => {
    const parsed = parseMusicXml(score([[attributes(1) + forward(2) + note('D', 4, 2)]]));
    expect(quarters(parsed)).toEqual([[62, 2, 2]]);
  });

  it('keeps triplets exact by deriving ticks-per-quarter from divisions', () => {
    // divisions=3 → an eighth-note triplet is 1 division each.
    const triplet = (step: string) =>
      note(step, 4, 1, { type: 'eighth', timeMod: [3, 2] as [number, number] });
    const parsed = parseMusicXml(
      score([[attributes(3) + triplet('C') + triplet('D') + triplet('E') + note('F', 4, 9)]]),
    );
    const ppq = parsed.ticksPerQuarter;
    expect(ppq % 3).toBe(0);
    expect(parsed.events.map((e) => e.startTick)).toEqual([0, ppq / 3, (2 * ppq) / 3, ppq]);
    // No rounding drift: the triplet group sums to exactly one quarter.
    expect(parsed.events[3]!.startTick).toBe(ppq);
  });

  it('drops grace notes rather than mistiming the notes around them', () => {
    const parsed = parseMusicXml(
      score([[attributes(1) + note('B', 3, 0, { grace: true }) + note('C', 4, 4)]]),
    );
    expect(quarters(parsed)).toEqual([[60, 0, 4]]);
  });
});

describe('parseMusicXml — ties', () => {
  it('merges a tie across a barline into one held note', () => {
    const parsed = parseMusicXml(
      score([
        [attributes(1) + note('C', 4, 4, { tie: 'start' }), note('C', 4, 4, { tie: 'stop' })],
      ]),
    );
    expect(quarters(parsed)).toEqual([[60, 0, 8]]);
  });

  it('merges a chain of three tied notes', () => {
    const parsed = parseMusicXml(
      score([
        [
          attributes(1) + note('G', 4, 4, { tie: 'start' }),
          note('G', 4, 4, { tie: 'continue' }),
          note('G', 4, 2, { tie: 'stop' }) + rest(2),
        ],
      ]),
    );
    expect(quarters(parsed)).toEqual([[67, 0, 10]]);
  });

  it('does not merge a repeated note that is not tied', () => {
    const parsed = parseMusicXml(score([[attributes(1) + note('C', 4, 2) + note('C', 4, 2)]]));
    expect(quarters(parsed)).toEqual([
      [60, 0, 2],
      [60, 2, 2],
    ]);
  });

  it('keeps ties in different voices apart', () => {
    const parsed = parseMusicXml(
      score([
        [
          attributes(1, { staves: 2 }) +
            note('C', 4, 4, { voice: '1', staff: 1, tie: 'start' }) +
            backup(4) +
            note('C', 4, 4, { voice: '5', staff: 2 }),
          note('C', 4, 4, { voice: '1', staff: 1, tie: 'stop' }),
        ],
      ]),
    );
    const held = parsed.events.filter((e) => e.voice === '1');
    expect(held).toHaveLength(1);
    expect(held[0]!.durationTicks).toBe(parsed.ticksPerQuarter * 8);
    expect(parsed.events.filter((e) => e.voice === '5')).toHaveLength(1);
  });
});

describe('parseMusicXml — structure', () => {
  it('reads parts, staves and hand hints', () => {
    const parsed = parseMusicXml(
      score([[attributes(1, { staves: 2 }) + note('C', 4, 4, { staff: 1 })]], {
        parts: [{ id: 'P1', name: 'Piano' }],
      }),
    );
    const part = parsed.parts[0]!;
    expect(part.id).toBe('P1');
    expect(part.name).toBe('Piano');
    expect(part.staffCount).toBe(2);
    expect(part.hands.get(1)).toBe('right');
    expect(part.hands.get(2)).toBe('left');
  });

  it('merges two parts into shared measures', () => {
    const parsed = parseMusicXml(
      score([[attributes(1) + note('C', 5, 4)], [attributes(1) + note('C', 3, 4)]]),
    );
    expect(parsed.measures).toHaveLength(1);
    expect(parsed.events.map((e) => [e.partId, e.midiNote])).toEqual([
      ['P2', 48],
      ['P1', 72],
    ]);
  });

  it('reads measure numbers, time and key signatures', () => {
    const parsed = parseMusicXml(
      score([[attributes(1, { beats: 3, beatType: 4, fifths: -2 }) + note('C', 4, 3)]]),
    );
    expect(parsed.measures[0]).toMatchObject({
      number: '1',
      time: { beats: 3, beatType: 4 },
      keyFifths: -2,
      startTick: 0,
      durationTicks: parsed.ticksPerQuarter * 3,
    });
  });

  it('treats a short first measure as a pickup rather than padding it', () => {
    const parsed = parseMusicXml(score([[attributes(1) + note('G', 4, 1), note('C', 4, 4)]]));
    expect(parsed.measures[0]!.durationTicks).toBe(parsed.ticksPerQuarter);
    expect(parsed.measures[1]!.startTick).toBe(parsed.ticksPerQuarter);
    expect(quarters(parsed)).toEqual([
      [67, 0, 1],
      [60, 1, 4],
    ]);
  });

  it('gives every event a stable id and its written measure', () => {
    const parsed = parseMusicXml(
      score([[attributes(1) + note('C', 4, 4, { id: 'note-42' }), note('D', 4, 4)]]),
    );
    expect(parsed.events[0]!.xmlId).toBe('note-42');
    expect(parsed.events[1]!.xmlId).toMatch(/^P1-m1-n\d+$/);
    expect(parsed.events.map((e) => e.measureIndex)).toEqual([0, 1]);
  });

  it('rejects a document that is not score-partwise', () => {
    expect(() => parseMusicXml('<?xml version="1.0"?><score-timewise/>')).toThrow(/score-partwise/);
  });
});

describe('parseMusicXml — repeats on the timeline', () => {
  it('replays the notes of a repeated section', () => {
    const parsed = parseMusicXml(
      score([
        [repeatForward() + attributes(1) + note('C', 4, 4) + repeatBackward(), note('D', 4, 4)],
      ]),
    );
    expect(quarters(parsed)).toEqual([
      [60, 0, 4],
      [60, 4, 4],
      [62, 8, 4],
    ]);
    expect(parsed.events.map((e) => e.pass)).toEqual([0, 1, 0]);
    expect(parsed.durationTicks).toBe(parsed.ticksPerQuarter * 12);
  });

  it('plays first and second endings in the right order', () => {
    const parsed = parseMusicXml(
      score([
        [
          repeatForward() + attributes(1) + note('C', 4, 4),
          endingStart('1') + note('D', 4, 4) + endingStop('1') + repeatBackward(),
          endingStart('2') + note('E', 4, 4) + endingStop('2'),
        ],
      ]),
    );
    expect(quarters(parsed)).toEqual([
      [60, 0, 4],
      [62, 4, 4],
      [60, 8, 4],
      [64, 12, 4],
    ]);
  });

  it('follows a D.C. al Fine', () => {
    const parsed = parseMusicXml(
      score([
        [
          attributes(1) + note('C', 4, 4) + soundDirective('fine="yes"'),
          note('D', 4, 4) + soundDirective('dacapo="yes"'),
        ],
      ]),
    );
    expect(quarters(parsed)).toEqual([
      [60, 0, 4],
      [62, 4, 4],
      [60, 8, 4],
    ]);
  });
});

describe('parseMusicXml — tempo', () => {
  it('defaults to 120 bpm', () => {
    const parsed = parseMusicXml(score([[attributes(1) + note('C', 4, 4)]]));
    expect(parsed.tempoMap.bpmAt(0)).toBe(120);
  });

  it('reads a tempo direction and applies it from its position', () => {
    const parsed = parseMusicXml(
      score([[tempo(60) + attributes(1) + note('C', 4, 4), tempo(120) + note('D', 4, 4)]]),
    );
    expect(seconds(parsed, parsed.events[0]!)).toBeCloseTo(0);
    expect(seconds(parsed, parsed.events[1]!)).toBeCloseTo(4);
    expect(parsed.tempoMap.tickToSeconds(parsed.durationTicks)).toBeCloseTo(6);
  });

  it('replays tempo changes on each pass through a repeat', () => {
    const parsed = parseMusicXml(
      score([
        [
          repeatForward() + tempo(60) + attributes(1) + note('C', 4, 4),
          tempo(240) + note('D', 4, 4) + repeatBackward(),
        ],
      ]),
    );
    // Pass 1: 4s + 1s. Pass 2 restores 60 bpm: 4s + 1s.
    expect(parsed.tempoMap.tickToSeconds(parsed.durationTicks)).toBeCloseTo(10);
  });
});
