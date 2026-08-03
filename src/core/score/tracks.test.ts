import { describe, expect, it } from 'vitest';
import { attributes, note, backup, score } from './musicxml/fixtures';
import { parseMusicXml } from './musicxml/parseMusicXml';
import { audibleTracks, isAudible, trackIdOf, tracksOf, type TrackSelection } from './tracks';

const NOTHING_SELECTED: TrackSelection = { muted: new Set(), soloed: new Set() };

/** One part, two staves: melody on top, bass underneath. The piano default. */
function grandStaff(parts: { id: string; name: string }[] = [{ id: 'P1', name: 'Piano' }]): string {
  const measure =
    attributes(4, { staves: 2 }) +
    note('C', 5, 4, { staff: 1 }) +
    backup(4) +
    note('C', 3, 4, { staff: 2, voice: '2' });
  return score(
    parts.map(() => [measure]),
    { parts },
  );
}

describe('tracksOf', () => {
  it('splits a grand staff into a right and a left hand', () => {
    const tracks = tracksOf(parseMusicXml(grandStaff()));

    expect(tracks.map((track) => [track.id, track.name])).toEqual([
      ['P1/1', 'Right hand'],
      ['P1/2', 'Left hand'],
    ]);
  });

  it('names a single-staff part after the part, with no hand', () => {
    const single = score([[attributes(4) + note('C', 4, 4)]]);

    const tracks = tracksOf(parseMusicXml(single));

    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.name).toBe('Piano');
    expect(tracks[0]!.hand).toBeUndefined();
  });

  it('qualifies hand names when several parts have a grand staff', () => {
    const tracks = tracksOf(
      parseMusicXml(
        grandStaff([
          { id: 'P1', name: 'Piano' },
          { id: 'P2', name: 'Harpsichord' },
        ]),
      ),
    );

    // Two tracks both called "Right hand" would be unusable in a mute UI.
    expect(tracks.map((track) => track.name)).toEqual([
      'Piano — right hand',
      'Piano — left hand',
      'Harpsichord — right hand',
      'Harpsichord — left hand',
    ]);
  });

  it('leaves out staves that carry no notes', () => {
    // MuseScore happily exports <staves>2</staves> for a single-line part.
    const emptySecondStaff = score([
      [attributes(4, { staves: 2 }) + note('C', 4, 4, { staff: 1 })],
    ]);

    expect(tracksOf(parseMusicXml(emptySecondStaff)).map((track) => track.id)).toEqual(['P1/1']);
  });

  it('counts the notes on each track', () => {
    const tracks = tracksOf(parseMusicXml(grandStaff()));

    expect(tracks.map((track) => track.noteCount)).toEqual([1, 1]);
  });
});

describe('trackIdOf', () => {
  it('matches the id of the track the event belongs to', () => {
    const parsed = parseMusicXml(grandStaff());
    const ids = new Set(tracksOf(parsed).map((track) => track.id));

    for (const event of parsed.events) expect(ids).toContain(trackIdOf(event));
  });
});

describe('isAudible', () => {
  it('plays everything when nothing is muted or soloed', () => {
    expect(isAudible('P1/1', NOTHING_SELECTED)).toBe(true);
  });

  it('drops a muted track and leaves the rest alone', () => {
    const selection = { ...NOTHING_SELECTED, muted: new Set(['P1/1']) };

    expect(isAudible('P1/1', selection)).toBe(false);
    expect(isAudible('P1/2', selection)).toBe(true);
  });

  it('plays only soloed tracks once anything is soloed', () => {
    const selection = { muted: new Set<string>(), soloed: new Set(['P1/2']) };

    expect(isAudible('P1/1', selection)).toBe(false);
    expect(isAudible('P1/2', selection)).toBe(true);
  });

  it('lets solo win over mute on the same track', () => {
    // Otherwise soloing a track you had muted earlier would silently do nothing.
    const selection = { muted: new Set(['P1/2']), soloed: new Set(['P1/2']) };

    expect(isAudible('P1/2', selection)).toBe(true);
  });
});

describe('audibleTracks', () => {
  it('keeps only the events whose track is audible', () => {
    const parsed = parseMusicXml(grandStaff());
    const leftMuted = { muted: new Set(['P1/2']), soloed: new Set<string>() };

    const events = audibleTracks(parsed.events, leftMuted);

    expect(events.map((event) => event.midiNote)).toEqual([72]);
  });
});
