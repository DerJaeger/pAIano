import { describe, expect, it } from 'vitest';
import { PiecewiseTempoMap } from '../score/tempoMap';
import { PlaybackTimeline } from './timeline';

const TPQ = 480;
/** 120bpm: one quarter is 500ms, so ticks and milliseconds line up nicely. */
const steady = new PiecewiseTempoMap(TPQ, [{ tick: 0, bpm: 120 }]);

function timeline(overrides: Partial<ConstructorParameters<typeof PlaybackTimeline>[1]> = {}) {
  return new PlaybackTimeline(steady, {
    fromTick: 0,
    startTime: 1000,
    endTick: 4 * TPQ,
    speed: 1,
    ...overrides,
  });
}

describe('PlaybackTimeline, playing straight through', () => {
  it('starts the first tick at the start time', () => {
    expect(timeline().tickAt(1000)).toBe(0);
  });

  it('advances one quarter note per 500ms at 120bpm', () => {
    expect(timeline().tickAt(1500)).toBe(TPQ);
    expect(timeline().tickAt(2000)).toBe(2 * TPQ);
  });

  it('reports nothing before it has started', () => {
    expect(timeline().tickAt(999)).toBeUndefined();
  });

  it('finishes at the end tick rather than running on', () => {
    // 4 quarters = 2000ms of music, started at 1000.
    expect(timeline().tickAt(2999)).toBeLessThan(4 * TPQ);
    expect(timeline().tickAt(3000)).toBeUndefined();
    expect(timeline().endTime).toBe(3000);
  });

  it('places a tick back on the clock', () => {
    expect(timeline().timeOf(TPQ, 0)).toBe(1500);
  });

  it('starts partway through when seeking', () => {
    const seeked = timeline({ fromTick: 2 * TPQ, startTime: 0 });

    expect(seeked.tickAt(0)).toBe(2 * TPQ);
    expect(seeked.endTime).toBe(1000);
  });
});

describe('PlaybackTimeline, tempo scaling', () => {
  it('covers the same music in half the time at double speed', () => {
    const fast = timeline({ speed: 2 });

    expect(fast.tickAt(1250)).toBe(TPQ);
    expect(fast.endTime).toBe(2000);
  });

  it('stretches the music at half speed', () => {
    expect(timeline({ speed: 0.5 }).endTime).toBe(5000);
  });
});

describe('PlaybackTimeline, tempo changes', () => {
  it('follows the tempo map rather than assuming one tempo', () => {
    const changing = new PiecewiseTempoMap(TPQ, [
      { tick: 0, bpm: 120 },
      { tick: TPQ, bpm: 60 },
    ]);
    const line = new PlaybackTimeline(changing, {
      fromTick: 0,
      startTime: 0,
      endTick: 2 * TPQ,
      speed: 1,
    });

    // One quarter at 120 (500ms), then one at 60 (1000ms).
    expect(line.tickAt(500)).toBe(TPQ);
    expect(line.endTime).toBe(1500);
  });
});

describe('PlaybackTimeline, looping', () => {
  const looping = () => timeline({ loop: { startTick: TPQ, endTick: 3 * TPQ }, endTick: 4 * TPQ });

  it('plays up to the loop end on the first lap, not the score end', () => {
    // Lap 0 runs 0 → 3 quarters: 1500ms of music from 1000.
    expect(looping().lap(0)).toMatchObject({ startTick: 0, endTick: 3 * TPQ, endTime: 2500 });
  });

  it('jumps back to the loop start for the next lap', () => {
    expect(looping().lap(1)).toMatchObject({
      startTick: TPQ,
      endTick: 3 * TPQ,
      startTime: 2500,
      endTime: 3500,
    });
  });

  it('reads a position on a later lap', () => {
    // 100ms into lap 1 is 100ms past the loop start.
    expect(looping().tickAt(2600)).toBeCloseTo(TPQ + 96, 6);
  });

  it('never finishes', () => {
    expect(looping().tickAt(1_000_000)).toBeDefined();
    expect(looping().endTime).toBe(Number.POSITIVE_INFINITY);
  });

  it('places a tick on the lap it is asked about, not the first one', () => {
    expect(looping().timeOf(TPQ, 1)).toBe(2500);
    expect(looping().timeOf(2 * TPQ, 1)).toBe(3000);
  });

  it('starts on the loop start when seeking outside the loop', () => {
    // Otherwise lap 0 would be a stretch of music the loop never revisits.
    const outside = timeline({
      fromTick: 0,
      loop: { startTick: 2 * TPQ, endTick: 3 * TPQ },
      clampToLoop: true,
    });

    expect(outside.lap(0)).toMatchObject({ startTick: 2 * TPQ, endTick: 3 * TPQ });
  });
});

describe('PlaybackTimeline, lap lookup', () => {
  it('finds which lap a moment falls on', () => {
    const looping = timeline({ loop: { startTick: 0, endTick: 2 * TPQ } });

    expect(looping.lapAt(1000)?.index).toBe(0);
    expect(looping.lapAt(2100)?.index).toBe(1);
    expect(looping.lapAt(3100)?.index).toBe(2);
  });

  it('has no lap before the start or after the end', () => {
    expect(timeline().lapAt(999)).toBeUndefined();
    expect(timeline().lapAt(3001)).toBeUndefined();
  });
});
