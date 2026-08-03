import { describe, expect, it } from 'vitest';
import { PiecewiseTempoMap } from './tempoMap';

const PPQ = 480;

describe('PiecewiseTempoMap', () => {
  it('defaults to 120 bpm when no tempo is given', () => {
    const map = new PiecewiseTempoMap(PPQ, []);
    expect(map.bpmAt(0)).toBe(120);
    expect(map.tickToSeconds(PPQ)).toBeCloseTo(0.5);
  });

  it('converts ticks to seconds at a constant tempo', () => {
    const map = new PiecewiseTempoMap(PPQ, [{ tick: 0, bpm: 60 }]);
    expect(map.tickToSeconds(0)).toBe(0);
    expect(map.tickToSeconds(PPQ)).toBeCloseTo(1);
    expect(map.tickToSeconds(PPQ * 4)).toBeCloseTo(4);
  });

  it('applies a tempo change from its tick onwards', () => {
    // 4 quarters at 60 bpm (4s), then quarters at 120 bpm (0.5s each).
    const map = new PiecewiseTempoMap(PPQ, [
      { tick: 0, bpm: 60 },
      { tick: PPQ * 4, bpm: 120 },
    ]);
    expect(map.tickToSeconds(PPQ * 4)).toBeCloseTo(4);
    expect(map.tickToSeconds(PPQ * 5)).toBeCloseTo(4.5);
    expect(map.bpmAt(PPQ * 4 - 1)).toBe(60);
    expect(map.bpmAt(PPQ * 4)).toBe(120);
  });

  it('round-trips seconds back to ticks across a tempo change', () => {
    const map = new PiecewiseTempoMap(PPQ, [
      { tick: 0, bpm: 72 },
      { tick: PPQ * 3, bpm: 144 },
      { tick: PPQ * 9, bpm: 90 },
    ]);
    for (const tick of [0, 100, PPQ * 3, PPQ * 5, PPQ * 9, PPQ * 12.5]) {
      expect(map.secondsToTick(map.tickToSeconds(tick))).toBeCloseTo(tick, 6);
    }
  });

  it('sorts unordered changes and lets the last change at a tick win', () => {
    const map = new PiecewiseTempoMap(PPQ, [
      { tick: PPQ * 4, bpm: 100 },
      { tick: 0, bpm: 60 },
      { tick: PPQ * 4, bpm: 120 },
    ]);
    expect(map.bpmAt(0)).toBe(60);
    expect(map.bpmAt(PPQ * 4)).toBe(120);
  });

  it('extends the first tempo backwards to tick 0', () => {
    const map = new PiecewiseTempoMap(PPQ, [{ tick: PPQ * 8, bpm: 90 }]);
    expect(map.bpmAt(0)).toBe(90);
    expect(map.tickToSeconds(PPQ)).toBeCloseTo(60 / 90);
  });

  it('rejects nonsensical input', () => {
    expect(() => new PiecewiseTempoMap(0, [])).toThrow(/ticksPerQuarter/);
    expect(() => new PiecewiseTempoMap(PPQ, [{ tick: 0, bpm: 0 }])).toThrow(/bpm/);
  });
});
