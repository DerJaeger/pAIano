import { beforeEach, describe, expect, it } from 'vitest';
import { FakeMidiInput } from '../midi/fakeMidiInput';
import { RecordingMidiOutput } from '../midi/output';
import { attributes, backup, note, score, tempo } from '../score/musicxml/fixtures';
import { parseMusicXml } from '../score/musicxml/parseMusicXml';
import type { Score } from '../score/types';
import { FakeClock } from '../transport/clock';
import { Transport } from '../transport/transport';
import { PracticeSession } from './session';
import { accuracy } from './stats';
import type { PracticeMode } from './types';

/**
 * Phase 5's acceptance tests. Everything is deterministic: a clock the test
 * steps by hand, a keyboard the test plays, and an output that only remembers.
 * No timers, no hardware, no flake.
 */

/** C4 D4 E4 F4, one per beat at 120bpm — so a beat is 500ms and 96 ticks. */
function scale(): Score {
  return parseMusicXml(
    score([
      [
        tempo(120) +
          attributes(1) +
          note('C', 4, 1) +
          note('D', 4, 1) +
          note('E', 4, 1) +
          note('F', 4, 1),
      ],
    ]),
  );
}

/** A right-hand line over a held left-hand note, so a hand can be muted. */
function hands(): Score {
  return parseMusicXml(
    score([
      [
        tempo(120) +
          attributes(1, { staves: 2 }) +
          note('C', 5, 1, { staff: 1 }) +
          note('D', 5, 1, { staff: 1 }) +
          note('E', 5, 2, { staff: 1 }) +
          backup(4) +
          note('C', 3, 4, { staff: 2, voice: '2' }),
      ],
    ]),
  );
}

const BEAT_MS = 500;
const START = 1000;

let clock: FakeClock;
let output: RecordingMidiOutput;
let input: FakeMidiInput;

beforeEach(() => {
  clock = new FakeClock(START);
  output = new RecordingMidiOutput(() => clock.now());
  input = new FakeMidiInput();
});

interface Rig {
  transport: Transport;
  session: PracticeSession;
  /** Runs both engines forward as the app's ticker does. */
  run: (ms: number) => void;
}

function rig(mode: PracticeMode, current: Score = scale()): Rig {
  const transport = new Transport({ score: current, output, clock, lookaheadMs: 100 });
  const session = new PracticeSession({ score: current, transport, input, mode });

  const tick = () => {
    transport.tick();
    session.tick();
  };

  return {
    transport,
    session,
    run: (ms: number) => {
      tick();
      for (let elapsed = 0; elapsed < ms; elapsed += 25) {
        clock.advance(25);
        tick();
      }
    },
  };
}

const verdicts = (session: PracticeSession) =>
  [...session.getRecent()].reverse().map((judgement) => judgement.verdict);

describe('PracticeSession, listening', () => {
  it('judges nothing — Listen is the mode where the piece plays itself', () => {
    const { transport, session, run } = rig('listen');

    transport.play();
    input.press(61);
    run(2500);

    expect(session.getStats().wrong).toBe(0);
    expect(accuracy(session.getStats())).toBeUndefined();
  });
});

describe('PracticeSession, playing along', () => {
  it('calls the piece played in time correct', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    for (const midiNote of [60, 62, 64, 65]) {
      input.press(midiNote);
      run(BEAT_MS);
    }
    run(BEAT_MS);

    expect(verdicts(session)).toEqual(['correct', 'correct', 'correct', 'correct']);
    expect(accuracy(session.getStats())).toBe(1);
  });

  it('blames you for the notes you never played, right to the last one', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    run(3000);

    expect(session.getStats().missed).toBe(4);
    expect(accuracy(session.getStats())).toBe(0);
  });

  it('calls a note the score does not have wrong, and still owes the right one', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    input.press(61);
    input.press(60);
    run(BEAT_MS);

    expect(verdicts(session)).toEqual(['wrong', 'correct']);
  });

  it('marks a note played well behind the beat late without losing the run', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    run(300);
    input.press(60);

    expect(verdicts(session)).toEqual(['late']);
    expect(accuracy(session.getStats())).toBe(1);
  });

  it('does not judge you before the run has started', () => {
    const { session } = rig('playAlong');

    input.press(60);

    expect(session.getRecent()).toEqual([]);
  });

  it('records where each note went wrong, for the heatmap', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    run(3000);

    expect(session.getStats().bars.get(0)).toMatchObject({ notes: 4, errors: 4 });
  });

  it('starts a fresh score when the piece is played again', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    run(3000);
    expect(session.getStats().missed).toBe(4);

    transport.play();
    run(100);

    expect(session.getStats().missed).toBe(0);
  });
});

describe('PracticeSession, following you', () => {
  it('waits on the first note until you play it', () => {
    const { transport, session, run } = rig('followYou');

    transport.play();
    run(2000);

    expect(session.isWaiting()).toBe(true);
    expect(transport.getPositionTick()).toBe(0);
    expect(session.getOwed()).toEqual([60]);
  });

  it('moves on the moment the note arrives', () => {
    const { transport, session, run } = rig('followYou');

    transport.play();
    run(50);
    input.press(60);

    expect(session.isWaiting()).toBe(false);
    expect(transport.getState()).toBe('playing');

    run(600);

    // A beat later it is holding the next note instead.
    expect(session.isWaiting()).toBe(true);
    expect(session.getOwed()).toEqual([62]);
  });

  it('never blames you for being slow — waiting is the whole point', () => {
    const { transport, session, run } = rig('followYou');

    transport.play();
    run(5000);
    input.press(60);
    run(5000);

    expect(session.getStats().missed).toBe(0);
    expect(session.getStats().late).toBe(0);
    expect(session.getStats().correct).toBe(1);
  });

  it('holds a chord until every note of it is down', () => {
    const chorded = parseMusicXml(
      score([
        [
          tempo(120) +
            attributes(1) +
            note('C', 4, 4) +
            note('E', 4, 4, { chord: true }) +
            note('G', 4, 4, { chord: true }),
        ],
      ]),
    );
    const { transport, session, run } = rig('followYou', chorded);

    transport.play();
    run(50);
    input.press(64);
    input.press(60);

    expect(session.isWaiting()).toBe(true);
    expect(session.getOwed()).toEqual([67]);

    input.press(67);

    expect(session.isWaiting()).toBe(false);
  });

  it('takes pressing play instead of the note as giving up on it', () => {
    const { transport, session, run } = rig('followYou');

    transport.play();
    run(2000);
    expect(session.isWaiting()).toBe(true);

    transport.play();

    expect(session.isWaiting()).toBe(false);
    expect(session.getStats().missed).toBe(1);
    expect(session.getPending()?.startTick).toBe(96);
  });

  it('stops waiting when you stop the piece', () => {
    const { transport, session, run } = rig('followYou');

    transport.play();
    run(2000);
    transport.stop();

    expect(session.isWaiting()).toBe(false);
  });
});

describe('PracticeSession, moving around the score', () => {
  it('expects the bar again after you jump back to it', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    input.press(60);
    run(BEAT_MS);
    expect(session.getStats().correct).toBe(1);

    transport.seekTick(0);
    run(50);
    input.press(60);

    expect(session.getStats().correct).toBe(2);
    expect(session.getStats().missed).toBe(0);
  });

  it('does not blame you for what a jump forward skipped', () => {
    const { transport, session, run } = rig('playAlong');

    transport.play();
    transport.seekTick(2 * 96);
    run(50);

    expect(session.getStats().missed).toBe(0);
    expect(session.getPending()?.startTick).toBe(2 * 96);
  });
});

describe('PracticeSession, choosing what you play', () => {
  it('expects only the hand the guide was told to leave out', () => {
    const { transport, session, run } = rig('playAlong', hands());

    transport.setSelection({ muted: new Set(['P1/2']), soloed: new Set() });
    transport.play();
    input.press(48); // the left hand, which is now yours to play
    run(50);

    expect(verdicts(session)).toEqual(['correct']);
    // The right hand stayed with the guide, so playing it is not your note.
    input.press(72);
    expect(verdicts(session)).toEqual(['correct', 'wrong']);
  });

  it('starts the score over when you change hands mid-piece', () => {
    const { transport, session, run } = rig('playAlong', hands());

    transport.play();
    run(3000);
    expect(session.getStats().missed).toBeGreaterThan(0);

    transport.setSelection({ muted: new Set(['P1/1']), soloed: new Set() });

    expect(session.getStats().missed).toBe(0);
  });
});

describe('PracticeSession, switching modes', () => {
  it('aims at where the music is rather than flooding you with misses', () => {
    const { transport, session, run } = rig('listen');

    transport.play();
    run(1200);
    session.setMode('playAlong');
    run(50);

    expect(session.getStats().missed).toBe(0);
  });

  it('lets go of the music when you leave Follow You', () => {
    const { transport, session, run } = rig('followYou');

    transport.play();
    run(2000);
    expect(session.isWaiting()).toBe(true);

    session.setMode('playAlong');

    expect(session.isWaiting()).toBe(false);
    expect(transport.getState()).toBe('playing');
  });
});
