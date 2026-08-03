import type { WrittenPosition } from './types';

/**
 * Where a renderer put things on the page, and the two questions the view asks
 * of that: which slice of the page to show, and where the playhead goes.
 *
 * The geometry is reported by the adapter in page pixels; the arithmetic on it
 * is here, pure, because that is where the behaviour worth testing lives —
 * "the current line sits at the top" and "the playhead slides between notes".
 */

/** One drawn line of music — every staff of one system. */
export interface SystemBox {
  topPx: number;
  heightPx: number;
}

/** A moment the renderer drew inside a measure, e.g. a note or a chord. */
export interface EntryBox {
  tickInMeasure: number;
  xPx: number;
}

export interface MeasureBox {
  /** Index into `Score.measures`, 0-based, in written order. */
  measureIndex: number;
  /** Index into `SheetLayout.systems`. */
  systemIndex: number;
  leftPx: number;
  rightPx: number;
  durationTicks: number;
  /** Ascending by tick. Empty if the renderer drew nothing in the bar. */
  entries: readonly EntryBox[];
}

export interface SheetLayout {
  systems: readonly SystemBox[];
  /** By written measure; a measure the renderer left out is simply absent. */
  measures: readonly MeasureBox[];
  /** Full height of the drawn page. */
  heightPx: number;
}

/** The slice of the page to show, in page coordinates. */
export interface SheetWindow {
  topPx: number;
  heightPx: number;
}

export interface Playhead {
  xPx: number;
  topPx: number;
  heightPx: number;
}

/**
 * The `count` systems to show with `measureIndex` on the first of them.
 *
 * Near the end of the piece the window stops rather than scrolling the last
 * line up into blank space, so the current line drifts down the view for the
 * final few systems — the alternative is a mostly-empty page.
 */
export function systemWindow(
  layout: SheetLayout,
  measureIndex: number,
  count: number,
): SheetWindow | undefined {
  if (layout.systems.length === 0 || count < 1) return undefined;

  const holding = layout.measures.find((measure) => measure.measureIndex === measureIndex);
  const first = Math.min(
    Math.max(0, holding?.systemIndex ?? 0),
    Math.max(0, layout.systems.length - count),
  );
  const topPx = layout.systems[first]!.topPx;
  const below = layout.systems[first + count];
  return { topPx, heightPx: (below?.topPx ?? layout.heightPx) - topPx };
}

/** Where the playhead stands for a point on the written score. */
export function playheadAt(
  layout: SheetLayout,
  position: WrittenPosition | undefined,
): Playhead | undefined {
  if (!position) return undefined;
  const measure = layout.measures.find(
    (candidate) => candidate.measureIndex === position.measureIndex,
  );
  const system = measure && layout.systems[measure.systemIndex];
  if (!measure || !system) return undefined;

  return {
    xPx: playheadX(measure, position.tickInMeasure),
    topPx: system.topPx,
    heightPx: system.heightPx,
  };
}

/**
 * Interpolates across the bar: the playhead rests on a note while it sounds and
 * slides to the next one, ending on the barline at the end of the measure.
 */
function playheadX(measure: MeasureBox, tickInMeasure: number): number {
  const tick = Math.min(Math.max(tickInMeasure, 0), measure.durationTicks);
  const first = measure.entries[0];
  if (!first) return lerp(measure.leftPx, measure.rightPx, tick / (measure.durationTicks || 1));
  if (tick <= first.tickInMeasure) return first.xPx;

  for (let index = 1; index < measure.entries.length; index++) {
    const next = measure.entries[index]!;
    if (tick > next.tickInMeasure) continue;
    const previous = measure.entries[index - 1]!;
    const span = next.tickInMeasure - previous.tickInMeasure;
    return lerp(previous.xPx, next.xPx, span === 0 ? 0 : (tick - previous.tickInMeasure) / span);
  }

  // Past the last note drawn: run out to the barline.
  const last = measure.entries[measure.entries.length - 1]!;
  const span = measure.durationTicks - last.tickInMeasure;
  return lerp(last.xPx, measure.rightPx, span <= 0 ? 0 : (tick - last.tickInMeasure) / span);
}

function lerp(from: number, to: number, fraction: number): number {
  return from + (to - from) * fraction;
}
