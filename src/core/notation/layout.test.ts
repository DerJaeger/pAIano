import { describe, expect, it } from 'vitest';
import { pitchYOnSystem, playheadAt, systemWindow, type SheetLayout } from './layout';
import { diatonicStepOf } from './pitch';

/**
 * Four systems of two measures each, 100px apart, every measure 200px wide
 * with four quarter-note entries 40px apart (ticksPerQuarter = 4).
 *
 * Each system carries a grand staff: a treble staff whose middle line (B4) is
 * at 20px into the system and a bass staff whose middle line (D3) is at 60px,
 * with 5px between one line-or-space and the next.
 */
const grandStaff = (systemIndex: number, topPx: number) => [
  {
    systemIndex,
    staffIndex: 0,
    centerStep: diatonicStepOf(71),
    stepPx: 5,
    stepZeroPx: topPx + 20 + diatonicStepOf(71) * 5,
  },
  {
    systemIndex,
    staffIndex: 1,
    centerStep: diatonicStepOf(50),
    stepPx: 5,
    stepZeroPx: topPx + 60 + diatonicStepOf(50) * 5,
  },
];

const layout: SheetLayout = {
  heightPx: 380,
  staves: [0, 1, 2, 3].flatMap((index) => grandStaff(index, index * 100)),
  systems: [
    { topPx: 0, heightPx: 80 },
    { topPx: 100, heightPx: 80 },
    { topPx: 200, heightPx: 80 },
    { topPx: 300, heightPx: 80 },
  ],
  measures: [0, 1, 2, 3, 4, 5, 6, 7].map((measureIndex) => ({
    measureIndex,
    systemIndex: Math.floor(measureIndex / 2),
    leftPx: (measureIndex % 2) * 200,
    rightPx: (measureIndex % 2) * 200 + 200,
    durationTicks: 16,
    entries: [0, 4, 8, 12].map((tickInMeasure) => ({
      tickInMeasure,
      xPx: (measureIndex % 2) * 200 + 20 + tickInMeasure * 10,
    })),
  })),
};

describe('systemWindow', () => {
  it('puts the system holding the measure at the top', () => {
    expect(systemWindow(layout, 2, 2)).toEqual({ topPx: 100, heightPx: 200 });
  });

  it('measures the window down to the top of the first system left out', () => {
    expect(systemWindow(layout, 0, 2)).toEqual({ topPx: 0, heightPx: 200 });
  });

  it('runs to the bottom of the sheet when the last system is in view', () => {
    expect(systemWindow(layout, 6, 2)).toEqual({ topPx: 200, heightPx: 180 });
  });

  it('stops scrolling rather than showing blank space past the end', () => {
    expect(systemWindow(layout, 7, 3)).toEqual({ topPx: 100, heightPx: 280 });
  });

  it('shows the whole sheet when it is shorter than the window', () => {
    const single: SheetLayout = { ...layout, systems: [{ topPx: 0, heightPx: 80 }], heightPx: 80 };
    expect(systemWindow(single, 0, 3)).toEqual({ topPx: 0, heightPx: 80 });
  });

  it('has nothing to show without a layout', () => {
    expect(
      systemWindow({ systems: [], measures: [], staves: [], heightPx: 0 }, 0, 3),
    ).toBeUndefined();
  });

  it('falls back to the top for a measure the renderer did not draw', () => {
    expect(systemWindow(layout, 99, 2)).toEqual({ topPx: 0, heightPx: 200 });
  });
});

describe('playheadAt', () => {
  const at = (measureIndex: number, tickInMeasure: number) =>
    playheadAt(layout, { measureIndex, tickInMeasure, pass: 0 });

  it('sits on the first note of a measure at its downbeat', () => {
    expect(at(0, 0)).toEqual({ xPx: 20, topPx: 0, heightPx: 80, systemIndex: 0 });
  });

  it('sits on each following note in turn', () => {
    expect(at(0, 4)?.xPx).toBe(60);
    expect(at(0, 8)?.xPx).toBe(100);
  });

  it('slides between two notes rather than jumping', () => {
    expect(at(0, 2)?.xPx).toBe(40);
    expect(at(0, 5)?.xPx).toBe(70);
  });

  it('runs from the last note out to the end of the bar', () => {
    expect(at(0, 14)?.xPx).toBe(170);
    expect(at(0, 16)?.xPx).toBe(200);
  });

  it('follows the measure onto its own system', () => {
    expect(at(3, 0)).toEqual({ xPx: 220, topPx: 100, heightPx: 80, systemIndex: 1 });
  });

  it('has nothing to show past the end or before the start', () => {
    expect(playheadAt(layout, undefined)).toBeUndefined();
    expect(at(99, 0)).toBeUndefined();
  });

  it('spans the bar evenly when the renderer reported no entries', () => {
    const empty: SheetLayout = {
      ...layout,
      measures: [{ ...layout.measures[0]!, entries: [] }],
    };
    expect(playheadAt(empty, { measureIndex: 0, tickInMeasure: 8, pass: 0 })?.xPx).toBe(100);
  });
});

describe('pitchYOnSystem', () => {
  const y = (systemIndex: number, midiNote: number) =>
    pitchYOnSystem(layout, systemIndex, diatonicStepOf(midiNote));

  it('puts the middle line of the staff where the ruler says it is', () => {
    expect(y(0, 71)).toBe(20); // B4, treble middle line
    expect(y(0, 50)).toBe(60); // D3, bass middle line
  });

  it('climbs half a space per step, so higher notes are higher up', () => {
    expect(y(0, 72)).toBe(15); // C5, the space above B4
    expect(y(0, 69)).toBe(25); // A4, the space below
    expect(y(0, 83)!).toBeLessThan(y(0, 60)!);
  });

  it('draws a sharp on the line of its letter', () => {
    expect(y(0, 61)).toBe(y(0, 60));
  });

  it('takes the staff the note is nearest — the hand that would play it', () => {
    // Middle C is a ledger line either way; either staff is a fair answer, but
    // a high note belongs to the right hand and a low one to the left.
    expect(y(0, 84)).toBe(staffY(0, 84, 20, 71));
    expect(y(0, 36)).toBe(staffY(0, 36, 60, 50));
  });

  it('follows the system the playhead is on', () => {
    expect(y(2, 71)).toBe(220);
  });

  it('has nowhere to draw on a line the renderer left empty', () => {
    expect(pitchYOnSystem({ ...layout, staves: [] }, 0, diatonicStepOf(60))).toBeUndefined();
  });
});

/** Where a note lands on the staff whose middle line is `middleMidi` at `middlePx`. */
function staffY(systemIndex: number, midiNote: number, middlePx: number, middleMidi: number) {
  const steps = diatonicStepOf(midiNote) - diatonicStepOf(middleMidi);
  return systemIndex * 100 + middlePx - steps * 5;
}
