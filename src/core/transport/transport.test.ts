import { beforeEach, describe, expect, it } from 'vitest';
import { RecordingMidiOutput } from '../midi/output';
import { attributes, backup, note, score, tempo } from '../score/musicxml/fixtures';
import { parseMusicXml } from '../score/musicxml/parseMusicXml';
import type { Score } from '../score/types';
import { FakeClock } from './clock';
import { Transport } from './transport';

/** Four quarter notes at 120bpm, so one note is 500ms. */
function scale(): Score {
  const measure = (pitches: string[]) =>
    attributes(1) + pitches.map((step) => note(step, 4, 1)).join('');
  return parseMusicXml(
    score([[tempo(120) + measure(['C', 'D', 'E', 'F']), measure(['G', 'A', 'B', 'C'])]]),
  );
}

/** Two staves, one note each, so the hands can be muted independently. */
function hands(): Score {
  return parseMusicXml(
    score([
      [
        tempo(120) +
          attributes(1, { staves: 2 }) +
          note('C', 5, 4, { staff: 1 }) +
          backup(4) +
          note('C', 3, 4, { staff: 2, voice: '2' }),
      ],
    ]),
  );
}

const LOOKAHEAD = 100;

let clock: FakeClock;
let output: RecordingMidiOutput;

beforeEach(() => {
  clock = new FakeClock(1000);
  output = new RecordingMidiOutput(() => clock.now());
});

function transport(current: Score = scale(), options = {}) {
  return new Transport({
    score: current,
    output,
    clock,
    lookaheadMs: LOOKAHEAD,
    ...options,
  });
}

/** Notes handed to the output that have not sounded yet. */
function pending() {
  return output.sent.filter((sent) => sent.startTime > clock.now());
}

/** Runs the scheduler as a real ticker would, in `step`-sized slices. */
function run(engine: Transport, ms: number, step = 25): void {
  engine.tick();
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    clock.advance(step);
    engine.tick();
  }
}

describe('Transport, playing', () => {
  it('starts stopped at the beginning', () => {
    const engine = transport();

    expect(engine.getState()).toBe('stopped');
    expect(engine.getPositionTick()).toBe(0);
  });

  it('schedules notes at the written tempo', () => {
    const engine = transport();

    engine.play();
    run(engine, 2000);

    expect(output.timeline()).toEqual([
      [1000, 60],
      [1500, 62],
      [2000, 64],
      [2500, 65],
      [3000, 67],
    ]);
  });

  it('schedules ahead of the clock, never behind it', () => {
    const engine = transport();

    engine.play();
    run(engine, 2000);

    for (const sent of output.sent) {
      expect(sent.startTime).toBeGreaterThanOrEqual(sent.sentAt);
      expect(sent.startTime).toBeLessThanOrEqual(sent.sentAt + LOOKAHEAD);
    }
  });

  it('gives each note the duration it is written with', () => {
    const engine = transport();

    engine.play();
    run(engine, 600);

    expect(output.sent[0]).toMatchObject({ midiNote: 60, startTime: 1000, endTime: 1500 });
  });

  it('tracks its position against the clock', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;

    engine.play();
    run(engine, 750);

    expect(engine.getPositionTick()).toBeCloseTo(1.5 * tpq, 6);
  });

  it('stops on its own at the end of the score', () => {
    const engine = transport();

    engine.play();
    run(engine, 5000);

    expect(engine.getState()).toBe('stopped');
    expect(output.sent).toHaveLength(8);
  });

  it('replays from the start when played again after finishing', () => {
    const engine = transport();

    engine.play();
    run(engine, 5000);
    output.sent.length = 0;
    engine.play();
    run(engine, 600);

    expect(output.timeline()[0]).toEqual([expect.any(Number), 60]);
    expect(engine.getPositionTick()).toBeLessThan(scale().ticksPerQuarter * 2);
  });
});

describe('Transport, pause and stop', () => {
  it('holds its position when paused', () => {
    const engine = transport();

    engine.play();
    run(engine, 750);
    engine.pause();
    const held = engine.getPositionTick();
    clock.advance(2000);

    expect(engine.getState()).toBe('paused');
    expect(engine.getPositionTick()).toBe(held);
  });

  it('resumes from where it paused', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;

    engine.play();
    run(engine, 750);
    engine.pause();
    clock.advance(5000);
    engine.play();

    expect(engine.getPositionTick()).toBeCloseTo(1.5 * tpq, 6);
  });

  it('silences notes queued but not yet sounded when paused', () => {
    // Without this, a note scheduled 100ms out still fires after you hit pause.
    const engine = transport();

    engine.play();
    run(engine, 400);
    expect(pending()).not.toHaveLength(0);
    engine.pause();

    expect(pending()).toHaveLength(0);
  });

  it('rewinds to the start on stop', () => {
    const engine = transport();

    engine.play();
    run(engine, 750);
    engine.stop();

    expect(engine.getState()).toBe('stopped');
    expect(engine.getPositionTick()).toBe(0);
    expect(pending()).toHaveLength(0);
  });

  it('schedules nothing while stopped or paused', () => {
    const engine = transport();

    engine.tick();
    clock.advance(1000);
    engine.tick();

    expect(output.sent).toHaveLength(0);
  });
});

describe('Transport, seeking', () => {
  it('plays from the tick it was seeked to', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;

    engine.seekTick(2 * tpq);
    engine.play();
    run(engine, 600);

    expect(output.timeline()[0]).toEqual([1000, 64]);
  });

  it('seeks to the start of a written measure', () => {
    const engine = transport();

    engine.seekMeasure(1);
    engine.play();
    run(engine, 100);

    expect(output.timeline()[0]).toEqual([1000, 67]);
  });

  it('keeps playing across a seek made mid-flight', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;

    engine.play();
    run(engine, 300);
    engine.seekTick(3 * tpq);
    run(engine, 100);

    expect(engine.getState()).toBe('playing');
    expect(output.sent.at(-1)).toMatchObject({ midiNote: 65 });
  });

  it('drops notes queued for the place it seeked away from', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;

    engine.play();
    run(engine, 400);
    engine.seekTick(6 * tpq);

    // The D that was queued for 1500 belongs to the bar we just left.
    expect(pending().map((sent) => sent.midiNote)).not.toContain(62);
  });

  it('refuses to seek outside the score', () => {
    const engine = transport();

    engine.seekTick(-500);
    expect(engine.getPositionTick()).toBe(0);

    engine.seekTick(1e9);
    expect(engine.getPositionTick()).toBe(scale().durationTicks);
  });
});

describe('Transport, tempo scaling', () => {
  it('plays at half speed', () => {
    const engine = transport(scale(), { speed: 0.5 });

    engine.play();
    run(engine, 2000);

    expect(output.timeline().slice(0, 3)).toEqual([
      [1000, 60],
      [2000, 62],
      [3000, 64],
    ]);
  });

  it('takes a new speed mid-flight without jumping position', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;

    engine.play();
    run(engine, 750);
    const before = engine.getPositionTick();
    engine.setSpeed(2);
    const after = engine.getPositionTick();

    expect(after).toBeCloseTo(before, 6);
    run(engine, 250);
    // At double speed, 250ms covers a whole quarter note.
    expect(engine.getPositionTick()).toBeCloseTo(2.5 * tpq, 6);
  });

  it('keeps a sounding note sounding across a speed change', () => {
    // Re-anchoring cancels everything queued, so a held note has to be re-sent
    // or the guide would fall silent until the next note begins.
    const engine = transport();

    engine.play();
    run(engine, 250);
    output.sent.length = 0;
    engine.setSpeed(2);

    expect(output.sent).toContainEqual(expect.objectContaining({ midiNote: 60 }));
  });

  it('rejects a speed of zero or less', () => {
    expect(() => transport().setSpeed(0)).toThrow(/speed/);
  });
});

describe('Transport, looping', () => {
  it('repeats the looped range instead of playing on', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;
    engine.setLoop({ startTick: 0, endTick: 2 * tpq });

    engine.play();
    run(engine, 2000);

    expect(output.timeline()).toEqual([
      [1000, 60],
      [1500, 62],
      [2000, 60],
      [2500, 62],
      [3000, 60],
    ]);
  });

  it('loops a bar range', () => {
    const engine = transport();
    engine.setLoopMeasures(1, 1);

    engine.play();
    run(engine, 3000);

    expect(output.timeline().map(([, midiNote]) => midiNote)).toEqual([67, 69, 71, 60, 67, 69, 71]);
  });

  it('never finishes while looping', () => {
    const engine = transport();
    engine.setLoop({ startTick: 0, endTick: scale().ticksPerQuarter });

    engine.play();
    run(engine, 10_000);

    expect(engine.getState()).toBe('playing');
  });

  it('jumps into the loop when playing from outside it', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;

    engine.seekTick(0);
    engine.setLoop({ startTick: 4 * tpq, endTick: 5 * tpq });
    engine.play();
    run(engine, 100);

    expect(output.timeline()[0]).toEqual([1000, 67]);
  });

  it('cuts a note short at the loop boundary rather than ringing over the jump', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;
    engine.setLoop({ startTick: 0, endTick: tpq / 2 });

    engine.play();
    run(engine, 100);

    expect(output.sent[0]).toMatchObject({ startTime: 1000, endTime: 1250 });
  });

  it('plays on to the end once the loop is cleared', () => {
    const engine = transport();
    const tpq = scale().ticksPerQuarter;
    engine.setLoop({ startTick: 0, endTick: tpq });

    engine.play();
    run(engine, 600);
    engine.setLoop(undefined);
    run(engine, 4500);

    expect(engine.getState()).toBe('stopped');
  });
});

describe('Transport, muting a hand', () => {
  it('plays both hands by default', () => {
    const engine = transport(hands());

    engine.play();
    run(engine, 100);

    expect(output.timeline().map(([, midiNote]) => midiNote)).toEqual([48, 72]);
  });

  it('leaves out the hand you are practising', () => {
    const engine = transport(hands());
    engine.setSelection({ muted: new Set(['P1/1']), soloed: new Set() });

    engine.play();
    run(engine, 100);

    expect(output.timeline().map(([, midiNote]) => midiNote)).toEqual([48]);
  });

  it('silences a hand muted mid-flight without stopping the other', () => {
    const engine = transport(hands());

    engine.play();
    run(engine, 100);
    output.sent.length = 0;
    engine.setSelection({ muted: new Set(['P1/1']), soloed: new Set() });

    expect(output.sent.map((sent) => sent.midiNote)).toEqual([48]);
  });
});

describe('Transport, the guide switch', () => {
  it('sends the guide out by default', () => {
    const engine = transport();

    expect(engine.isGuideAudible()).toBe(true);
  });

  it('schedules nothing while the guide is switched off', () => {
    const engine = transport();
    engine.setGuideAudible(false);

    engine.play();
    run(engine, 2000);

    expect(output.sent).toEqual([]);
  });

  it('keeps time while silent, so the cursor still tracks the music', () => {
    const engine = transport();
    engine.setGuideAudible(false);

    engine.play();
    run(engine, 1000);

    expect(engine.getPositionTick()).toBe(scale().tempoMap.ticksPerQuarter * 2);
  });

  it('silences a note already sounding when switched off mid-flight', () => {
    const engine = transport();

    engine.play();
    // Far enough in that the next note is queued but has not sounded.
    run(engine, 425);
    expect(pending().length).toBeGreaterThan(0);

    engine.setGuideAudible(false);

    expect(output.panics.length).toBeGreaterThan(0);
    expect(pending()).toEqual([]);
  });

  it('picks the guide back up mid-flight, mid-note', () => {
    const engine = transport();
    engine.setGuideAudible(false);
    engine.play();
    // Half way through the second note: nothing has been sent at all.
    run(engine, 750);
    expect(output.sent).toEqual([]);

    engine.setGuideAudible(true);

    // The note under the playhead resumes rather than waiting for the next one,
    // the same way un-muting a hand does.
    expect(output.sent.map((sent) => sent.midiNote)).toEqual([62]);
  });

  it('does not re-anchor when set to what it already is', () => {
    const engine = transport();

    engine.play();
    run(engine, 100);
    const panics = output.panics.length;
    engine.setGuideAudible(true);

    expect(output.panics.length).toBe(panics);
  });

  it('still counts you in with the guide off', () => {
    const engine = transport(scale(), { countInBeats: 2, clickChannel: 9 });
    engine.setGuideAudible(false);

    engine.play();
    run(engine, 1200);

    // The click is a metronome, not the guide: it is how you know when to come
    // in on a part you are playing yourself.
    expect(output.sent.map((sent) => sent.channel)).toEqual([9, 9]);
  });
});

describe('Transport, count-in', () => {
  it('delays the music by the count-in and clicks the beats', () => {
    const engine = transport(scale(), { countInBeats: 2, clickChannel: 9 });

    engine.play();
    run(engine, 1200);

    const clicks = output.sent.filter((sent) => sent.channel === 9);
    expect(clicks.map((click) => click.startTime)).toEqual([1000, 1500]);
    // The music starts after the count-in, not underneath it.
    expect(output.sent.find((sent) => sent.channel !== 9)?.startTime).toBe(2000);
  });

  it('accents the first beat of the count-in', () => {
    const engine = transport(scale(), { countInBeats: 4, clickChannel: 9 });

    engine.play();
    engine.tick();

    const clicks = output.sent.filter((sent) => sent.channel === 9);
    expect(clicks[0]!.velocity).toBeGreaterThan(clicks[1]!.velocity);
  });

  it('counts in at the playing speed, not the written one', () => {
    const engine = transport(scale(), { countInBeats: 2, clickChannel: 9, speed: 2 });

    engine.play();
    engine.tick();

    const clicks = output.sent.filter((sent) => sent.channel === 9);
    expect(clicks.map((click) => click.startTime)).toEqual([1000, 1250]);
  });

  it('does not count in again when resuming from pause', () => {
    const engine = transport(scale(), { countInBeats: 2, clickChannel: 9 });

    engine.play();
    run(engine, 1200);
    engine.pause();
    output.sent.length = 0;
    engine.play();
    engine.tick();

    expect(output.sent.filter((sent) => sent.channel === 9)).toHaveLength(0);
  });
});

describe('Transport, change notifications', () => {
  it('tells listeners when the state changes', () => {
    const engine = transport();
    const seen: string[] = [];
    engine.onChange(() => seen.push(engine.getState()));

    engine.play();
    engine.pause();
    engine.stop();

    expect(seen).toEqual(['playing', 'paused', 'stopped']);
  });

  it('tells listeners when it finishes on its own', () => {
    const engine = transport();
    let changes = 0;
    engine.onChange(() => changes++);

    engine.play();
    run(engine, 5000);

    expect(changes).toBeGreaterThanOrEqual(2);
    expect(engine.getState()).toBe('stopped');
  });

  it('stops notifying after unsubscribe', () => {
    const engine = transport();
    let changes = 0;
    const unsubscribe = engine.onChange(() => changes++);

    unsubscribe();
    engine.play();

    expect(changes).toBe(0);
  });
});

describe('Transport, teardown', () => {
  it('silences the output when closed', () => {
    const engine = transport();

    engine.play();
    run(engine, 400);
    engine.close();

    expect(pending()).toHaveLength(0);
    expect(engine.getState()).toBe('stopped');
  });

  it('schedules nothing after being closed', () => {
    const engine = transport();

    engine.play();
    engine.close();
    output.sent.length = 0;
    run(engine, 1000);

    expect(output.sent).toHaveLength(0);
  });
});
