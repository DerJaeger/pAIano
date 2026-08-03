import type {
  GraphicalMeasure,
  GraphicalNote,
  MusicSystem,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import {
  playheadAt,
  systemWindow,
  type MeasureBox,
  type SheetLayout,
} from '../../core/notation/layout';
import { noteRefKey } from '../../core/notation/position';
import type {
  NotationPort,
  NoteHighlight,
  NoteRef,
  WrittenPosition,
} from '../../core/notation/types';

/**
 * OpenSheetMusicDisplay behind `NotationPort`.
 *
 * Three things are worth knowing about the mapping:
 *
 * 1. OSMD does not carry the MusicXML `id` attribute through to what it draws,
 *    so a note is addressed structurally instead — written measure, pitch and
 *    offset in the bar (`NoteRef`). Both sides derive that from the same
 *    MusicXML, so the index is a lookup, not a guess.
 * 2. Any re-render (zoom, resize) redraws the SVG and drops note colours, so
 *    the adapter keeps the requested highlights and reapplies them afterwards.
 * 3. The playhead is ours, not OSMD's cursor. OSMD's steps from one voice entry
 *    to the next and scrolls the page under itself; we want a line that slides
 *    with the clock inside a fixed window of systems, so this reads OSMD's
 *    layout out in pixels and does the drawing and scrolling itself.
 */

/** OSMD counts half tones from C-1, MIDI from C-2. */
const MIDI_OFFSET = 12;

/** A `Fraction.RealValue` is in whole notes; a quarter note is 1/4 of that. */
const QUARTERS_PER_WHOLE = 4;

/** OSMD's layout unit — the gap between two staff lines — at zoom 1. */
const UNIT_IN_PIXELS = 10;

const DEFAULT_NOTE_COLOR = '#000000';

/** Re-layout is expensive; coalesce the flood of events from a window drag. */
const RESIZE_DEBOUNCE_MS = 150;

export interface OsmdNotationOptions {
  /** Ticks per quarter of the `Score` whose `NoteRef`s this port will be given. */
  ticksPerQuarter: number;
  zoom?: number;
}

export async function createOsmdNotation(
  container: HTMLElement,
  options: OsmdNotationOptions,
): Promise<NotationPort> {
  // OSMD is multi-megabyte: keep it out of the initial bundle.
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
  return new OsmdNotation(
    new OpenSheetMusicDisplay(container, {
      autoResize: false, // we own re-rendering, so highlights can be restored
      backend: 'svg',
      drawCredits: false, // the app shows the title and parts itself
      drawPartNames: false,
      followCursor: false, // the visible window is ours to scroll
    }),
    container,
    options,
  );
}

class OsmdNotation implements NotationPort {
  private notes = new Map<string, GraphicalNote[]>();
  private layout: SheetLayout | undefined;
  private highlights: readonly NoteHighlight[] = [];
  private cursor: WrittenPosition | undefined;
  private visibleSystems: number | undefined;
  private rendered = false;
  private destroyed = false;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;
  private width: number;

  private readonly osmd: OpenSheetMusicDisplay;
  private readonly container: HTMLElement;
  private readonly playhead: HTMLElement;
  private readonly options: OsmdNotationOptions;

  constructor(osmd: OpenSheetMusicDisplay, container: HTMLElement, options: OsmdNotationOptions) {
    this.osmd = osmd;
    this.container = container;
    this.options = options;
    this.osmd.Zoom = options.zoom ?? 1;
    this.width = container.clientWidth;

    // Appended by the first render, so the empty container stays empty until
    // there is something to draw on.
    this.playhead = container.ownerDocument.createElement('div');
    this.playhead.className = 'playhead';
    this.playhead.hidden = true;

    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            // Only a width change re-flows the systems.
            if (container.clientWidth === this.width) return;
            this.width = container.clientWidth;
            this.scheduleRender();
          });
    this.resizeObserver?.observe(container);
  }

  async load(musicXml: string): Promise<void> {
    await this.osmd.load(musicXml);
    if (this.destroyed) return;
    this.rendered = false;
    this.render();
  }

  showCursorAt(position: WrittenPosition | undefined): void {
    this.cursor = position;
    this.place();
  }

  setVisibleSystems(count: number | undefined): void {
    this.visibleSystems = count;
    if (count === undefined) this.container.style.removeProperty('height');
    this.place();
  }

  highlight(notes: readonly NoteHighlight[]): void {
    for (const previous of this.highlights) this.paint(previous.note, DEFAULT_NOTE_COLOR);
    this.highlights = notes;
    for (const next of notes) this.paint(next.note, next.color);
  }

  setZoom(zoom: number): void {
    this.osmd.Zoom = zoom;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    if (this.resizeTimer !== undefined) clearTimeout(this.resizeTimer);
    this.playhead.remove();
    this.container.style.removeProperty('height');
    this.osmd.clear();
  }

  /** Draws the sheet and restores everything the redraw threw away. */
  private render(): void {
    this.osmd.render();
    this.rendered = true;
    const pixelsPerUnit = UNIT_IN_PIXELS * this.osmd.Zoom;
    this.notes = indexNotes(this.osmd, this.options.ticksPerQuarter);
    this.layout = readLayout(this.osmd, this.options.ticksPerQuarter, pixelsPerUnit);
    for (const highlight of this.highlights) this.paint(highlight.note, highlight.color);
    // A render appends fresh SVG; keep the playhead the last child so it stays
    // on top of it.
    this.container.append(this.playhead);
    this.place();
  }

  /** Moves the playhead and the visible window to the current position. */
  private place(): void {
    if (!this.rendered || !this.layout) return;

    const head = playheadAt(this.layout, this.cursor);
    this.playhead.hidden = head === undefined;
    if (head) {
      this.playhead.style.left = `${String(head.xPx)}px`;
      this.playhead.style.top = `${String(head.topPx)}px`;
      this.playhead.style.height = `${String(head.heightPx)}px`;
    }

    if (this.visibleSystems === undefined) return;
    const window = systemWindow(this.layout, this.cursor?.measureIndex ?? 0, this.visibleSystems);
    if (!window) return;
    this.container.style.height = `${String(window.heightPx)}px`;
    this.container.scrollTop = window.topPx;
  }

  private scheduleRender(): void {
    if (this.resizeTimer !== undefined) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = undefined;
      if (!this.destroyed && this.rendered) this.render();
    }, RESIZE_DEBOUNCE_MS);
  }

  private paint(note: NoteRef, color: string): void {
    for (const graphical of this.notes.get(noteRefKey(note)) ?? []) {
      graphical.setColor(color, {});
    }
  }
}

/** Maps every drawn note onto the `NoteRef` the score model would give it. */
function indexNotes(
  osmd: OpenSheetMusicDisplay,
  ticksPerQuarter: number,
): Map<string, GraphicalNote[]> {
  const index = new Map<string, GraphicalNote[]>();

  for (const staves of osmd.GraphicSheet.MeasureList) {
    for (const measure of staves) {
      // A staff can be absent from a measure (multi-rest, hidden instrument).
      if (!measure) continue;
      const measureIndex = measure.parentSourceMeasure.measureListIndex;

      for (const entry of measure.staffEntries) {
        const tickInMeasure = tickOf(entry.relInMeasureTimestamp.RealValue, ticksPerQuarter);
        for (const voiceEntry of entry.graphicalVoiceEntries) {
          for (const graphical of voiceEntry.notes) {
            const source = graphical.sourceNote;
            if (source.isRest()) continue;
            const key = noteRefKey({
              measureIndex,
              midiNote: source.halfTone + MIDI_OFFSET,
              tickInMeasure,
            });
            const existing = index.get(key);
            if (existing) existing.push(graphical);
            else index.set(key, [graphical]);
          }
        }
      }
    }
  }

  return index;
}

/**
 * Reads the engraved page back out as plain pixel geometry.
 *
 * OSMD lays out in its own unit — the staff line gap — and the SVG is scaled by
 * the zoom, so a page pixel is `unit × 10 × zoom`. A measure is drawn once per
 * staff (right hand, left hand); the boxes are merged, because the playhead
 * spans the whole system anyway.
 */
function readLayout(
  osmd: OpenSheetMusicDisplay,
  ticksPerQuarter: number,
  pixelsPerUnit: number,
): SheetLayout {
  const systems: MusicSystem[] = [];
  for (const page of osmd.GraphicSheet.MusicPages) systems.push(...page.MusicSystems);

  const systemIndices = new Map<MusicSystem, number>(
    systems.map((system, index) => [system, index]),
  );
  const boxes = systems.map((system) => {
    const shape = system.PositionAndShape;
    const topPx = (shape.AbsolutePosition.y + shape.BorderTop) * pixelsPerUnit;
    return { topPx, heightPx: (shape.BorderBottom - shape.BorderTop) * pixelsPerUnit };
  });

  const measures = new Map<number, MeasureBox>();
  for (const staves of osmd.GraphicSheet.MeasureList) {
    for (const measure of staves) {
      if (!measure) continue;
      const systemIndex = systemIndices.get(measure.ParentMusicSystem);
      if (systemIndex === undefined) continue;
      const measureIndex = measure.parentSourceMeasure.measureListIndex;
      merge(measures, measureIndex, systemIndex, measure, ticksPerQuarter, pixelsPerUnit);
    }
  }

  const last = boxes[boxes.length - 1];
  return {
    systems: boxes,
    measures: [...measures.values()].sort((a, b) => a.measureIndex - b.measureIndex),
    heightPx: last ? last.topPx + last.heightPx : 0,
  };
}

/** Folds one staff's drawing of a measure into the box for the whole system. */
function merge(
  measures: Map<number, MeasureBox>,
  measureIndex: number,
  systemIndex: number,
  measure: GraphicalMeasure,
  ticksPerQuarter: number,
  pixelsPerUnit: number,
): void {
  const shape = measure.PositionAndShape;
  const leftPx = (shape.AbsolutePosition.x + shape.BorderLeft) * pixelsPerUnit;
  const rightPx = (shape.AbsolutePosition.x + shape.BorderRight) * pixelsPerUnit;
  const entries = new Map<number, number>(
    measures.get(measureIndex)?.entries.map((entry) => [entry.tickInMeasure, entry.xPx] as const) ??
      [],
  );

  for (const entry of measure.staffEntries) {
    const tick = tickOf(entry.relInMeasureTimestamp.RealValue, ticksPerQuarter);
    const xPx = entry.PositionAndShape.AbsolutePosition.x * pixelsPerUnit;
    // Staves share a tick column; the leftmost x is where the beat starts.
    entries.set(tick, Math.min(entries.get(tick) ?? xPx, xPx));
  }

  const existing = measures.get(measureIndex);
  measures.set(measureIndex, {
    measureIndex,
    systemIndex,
    leftPx: Math.min(existing?.leftPx ?? leftPx, leftPx),
    rightPx: Math.max(existing?.rightPx ?? rightPx, rightPx),
    durationTicks: tickOf(measure.parentSourceMeasure.Duration.RealValue, ticksPerQuarter),
    entries: [...entries]
      .map(([tickInMeasure, xPx]) => ({ tickInMeasure, xPx }))
      .sort((a, b) => a.tickInMeasure - b.tickInMeasure),
  });
}

function tickOf(wholeNotes: number, ticksPerQuarter: number): number {
  return Math.round(wholeNotes * QUARTERS_PER_WHOLE * ticksPerQuarter);
}
