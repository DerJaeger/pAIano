import type {
  GraphicalMeasure,
  GraphicalNote,
  MusicSystem,
  OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import {
  pitchYOnSystem,
  playheadAt,
  systemWindow,
  type MeasureBox,
  type SheetLayout,
  type StaffRuler,
} from '../../core/notation/layout';
import {
  diatonicStep,
  diatonicStepOf,
  letterIndexOfSemitone,
  pitchClassName,
} from '../../core/notation/pitch';
import { noteRefKey } from '../../core/notation/position';
import type { NotationPort, NoteHighlight, WrittenPosition } from '../../core/notation/types';

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
 *    layout out in pixels and does the drawing and scrolling itself. Note names
 *    and the bars for keys you are holding are drawn the same way, as elements
 *    over the SVG rather than into it, so a redraw cannot lose them.
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

/** A note name, in OSMD units, sized to sit inside a notehead. */
const LABEL_UNITS = 0.8;

/** How thick a held key's bar is, and how short it may get, in OSMD units. */
const HELD_THICKNESS_UNITS = 0.45;
const HELD_MIN_WIDTH_UNITS = 1.8;

/** A note OSMD has drawn, as page geometry — where its name and its bar go. */
interface DrawnNote {
  key: string;
  midiNote: number;
  /** Line-or-space the notehead sits on; see `core/notation/pitch`. */
  step: number;
  staffIndex: number;
  systemIndex: number;
  xPx: number;
  yPx: number;
}

/** Where a held key first showed up, so its bar can grow from there. */
interface HeldSince {
  xPx: number;
  systemIndex: number;
}

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
  private drawn: readonly DrawnNote[] = [];
  private layout: SheetLayout | undefined;
  /** By `noteRefKey`, last request wins — the colour each note is painted now. */
  private colors = new Map<string, string>();
  private cursor: WrittenPosition | undefined;
  private visibleSystems: number | undefined;
  private noteLabels = false;
  private held: readonly number[] = [];
  private readonly heldSince = new Map<number, HeldSince>();
  private readonly heldBars = new Map<number, HTMLElement>();
  private rendered = false;
  private destroyed = false;
  private resizeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;
  private width: number;

  private readonly osmd: OpenSheetMusicDisplay;
  private readonly container: HTMLElement;
  private readonly playhead: HTMLElement;
  private readonly labels: HTMLElement;
  private readonly heldLayer: HTMLElement;
  private readonly options: OsmdNotationOptions;

  constructor(osmd: OpenSheetMusicDisplay, container: HTMLElement, options: OsmdNotationOptions) {
    this.osmd = osmd;
    this.container = container;
    this.options = options;
    this.osmd.Zoom = options.zoom ?? 1;
    this.width = container.clientWidth;

    // Appended by the first render, so the empty container stays empty until
    // there is something to draw on.
    this.labels = element(container, 'note-labels');
    this.heldLayer = element(container, 'held-notes');
    this.playhead = element(container, 'playhead');
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

  /**
   * Repainting every note on every call would be thousands of SVG writes a bar
   * once the whole score is coloured by pitch, so only the notes whose colour
   * actually changed are touched.
   */
  highlight(notes: readonly NoteHighlight[]): void {
    const wanted = new Map<string, string>();
    for (const { note, color } of notes) wanted.set(noteRefKey(note), color);

    for (const key of this.colors.keys()) {
      if (!wanted.has(key)) this.paint(key, DEFAULT_NOTE_COLOR);
    }
    for (const [key, color] of wanted) {
      if (this.colors.get(key) !== color) this.paint(key, color);
    }
    this.colors = wanted;
  }

  setNoteLabels(show: boolean): void {
    if (show === this.noteLabels) return;
    this.noteLabels = show;
    this.drawLabels();
  }

  showHeldNotes(midiNotes: readonly number[]): void {
    this.held = midiNotes;
    for (const midiNote of this.heldSince.keys()) {
      if (!midiNotes.includes(midiNote)) this.heldSince.delete(midiNote);
    }
    this.drawHeld();
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
    this.labels.remove();
    this.heldLayer.remove();
    this.container.style.removeProperty('height');
    this.osmd.clear();
  }

  /** Draws the sheet and restores everything the redraw threw away. */
  private render(): void {
    this.osmd.render();
    this.rendered = true;
    const pixelsPerUnit = UNIT_IN_PIXELS * this.osmd.Zoom;
    const sheet = readSheet(this.osmd, this.options.ticksPerQuarter, pixelsPerUnit);
    this.notes = sheet.notes;
    this.drawn = sheet.drawn;
    this.layout = sheet.layout;
    for (const [key, color] of this.colors) this.paint(key, color);
    // A render appends fresh SVG; keep our own layers the last children so they
    // stay on top of it.
    this.container.append(this.labels, this.heldLayer, this.playhead);
    this.drawLabels();
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
    // The bars grow with the playhead, so they are redrawn as it moves.
    this.drawHeld();

    if (this.visibleSystems === undefined) return;
    const window = systemWindow(this.layout, this.cursor?.measureIndex ?? 0, this.visibleSystems);
    if (!window) return;
    this.container.style.height = `${String(window.heightPx)}px`;
    this.container.scrollTop = window.topPx;
  }

  /** Writes the name of every drawn note over its notehead. */
  private drawLabels(): void {
    this.labels.replaceChildren();
    this.labels.hidden = !this.noteLabels;
    if (!this.noteLabels || !this.rendered) return;

    const pixelsPerUnit = UNIT_IN_PIXELS * this.osmd.Zoom;
    this.labels.style.fontSize = `${String(LABEL_UNITS * pixelsPerUnit)}px`;
    const document = this.container.ownerDocument;
    for (const note of this.drawn) {
      const label = document.createElement('span');
      label.className = 'note-label';
      label.textContent = pitchClassName(note.midiNote);
      label.style.left = `${String(note.xPx)}px`;
      label.style.top = `${String(note.yPx)}px`;
      this.labels.append(label);
    }
  }

  /**
   * Draws a bar across the staff for each key held down, at the pitch it was
   * played at. The bar starts where the playhead stood when the key went down
   * and stretches to where it stands now, so holding a note through a bar draws
   * how long you held it; with the transport stopped it stays a stub.
   */
  private drawHeld(): void {
    const layout = this.layout;
    const head = layout && playheadAt(layout, this.cursor);
    const drawnNow = new Set<number>();

    if (layout && head) {
      const pixelsPerUnit = UNIT_IN_PIXELS * this.osmd.Zoom;
      const thickness = HELD_THICKNESS_UNITS * pixelsPerUnit;

      for (const midiNote of this.held) {
        const yPx = pitchYOnSystem(layout, head.systemIndex, diatonicStepOf(midiNote));
        if (yPx === undefined) continue;

        // A seek, or the music turning onto the next line, restarts the bar
        // rather than stretching it back across the page.
        const since = this.heldSince.get(midiNote);
        const from =
          since && since.systemIndex === head.systemIndex && since.xPx <= head.xPx
            ? since
            : { xPx: head.xPx, systemIndex: head.systemIndex };
        this.heldSince.set(midiNote, from);
        drawnNow.add(midiNote);

        const bar = this.heldBar(midiNote);
        const width = Math.max(head.xPx - from.xPx, HELD_MIN_WIDTH_UNITS * pixelsPerUnit);
        bar.style.left = `${String(from.xPx)}px`;
        bar.style.top = `${String(yPx - thickness / 2)}px`;
        bar.style.height = `${String(thickness)}px`;
        bar.style.width = `${String(width)}px`;
      }
    }

    for (const [midiNote, bar] of this.heldBars) {
      if (drawnNow.has(midiNote)) continue;
      bar.remove();
      this.heldBars.delete(midiNote);
    }
  }

  private heldBar(midiNote: number): HTMLElement {
    const existing = this.heldBars.get(midiNote);
    if (existing) return existing;
    const bar = this.container.ownerDocument.createElement('div');
    bar.className = 'held-note';
    bar.dataset.note = String(midiNote);
    this.heldLayer.append(bar);
    this.heldBars.set(midiNote, bar);
    return bar;
  }

  private scheduleRender(): void {
    if (this.resizeTimer !== undefined) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = undefined;
      if (!this.destroyed && this.rendered) this.render();
    }, RESIZE_DEBOUNCE_MS);
  }

  private paint(key: string, color: string): void {
    for (const graphical of this.notes.get(key) ?? []) {
      graphical.setColor(color, {});
    }
  }
}

/** One of our own layers over the engraving, appended once there is a page. */
function element(container: HTMLElement, className: string): HTMLElement {
  const created = container.ownerDocument.createElement('div');
  created.className = className;
  return created;
}

/**
 * Reads the engraved page back out: the notes by `NoteRef`, where each of them
 * was drawn, and the page geometry the view asks questions of.
 *
 * OSMD lays out in its own unit — the staff line gap — and the SVG is scaled by
 * the zoom, so a page pixel is `unit × 10 × zoom`. A measure is drawn once per
 * staff (right hand, left hand); the measure boxes are merged, because the
 * playhead spans the whole system anyway, while the staves are kept apart,
 * because which of them a held key belongs on is the question they answer.
 */
function readSheet(
  osmd: OpenSheetMusicDisplay,
  ticksPerQuarter: number,
  pixelsPerUnit: number,
): { notes: Map<string, GraphicalNote[]>; drawn: DrawnNote[]; layout: SheetLayout } {
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

  const notes = new Map<string, GraphicalNote[]>();
  const drawn: DrawnNote[] = [];
  const measures = new Map<number, MeasureBox>();

  for (const staves of osmd.GraphicSheet.MeasureList) {
    for (const measure of staves) {
      // A staff can be absent from a measure (multi-rest, hidden instrument).
      if (!measure) continue;
      const systemIndex = systemIndices.get(measure.ParentMusicSystem);
      if (systemIndex === undefined) continue;
      const measureIndex = measure.parentSourceMeasure.measureListIndex;
      const staffIndex = measure.ParentStaff.idInMusicSheet;
      merge(measures, measureIndex, systemIndex, measure, ticksPerQuarter, pixelsPerUnit);

      for (const entry of measure.staffEntries) {
        const tickInMeasure = tickOf(entry.relInMeasureTimestamp.RealValue, ticksPerQuarter);
        for (const voiceEntry of entry.graphicalVoiceEntries) {
          for (const graphical of voiceEntry.notes) {
            const source = graphical.sourceNote;
            if (source.isRest()) continue;
            const midiNote = source.halfTone + MIDI_OFFSET;
            const key = noteRefKey({ measureIndex, midiNote, tickInMeasure });
            const existing = notes.get(key);
            if (existing) existing.push(graphical);
            else notes.set(key, [graphical]);

            const step = stepOf(graphical, midiNote);
            const at = graphical.PositionAndShape.AbsolutePosition;
            if (step !== undefined) {
              drawn.push({
                key,
                midiNote,
                step,
                staffIndex,
                systemIndex,
                xPx: at.x * pixelsPerUnit,
                yPx: at.y * pixelsPerUnit,
              });
            }
          }
        }
      }
    }
  }

  const last = boxes[boxes.length - 1];
  return {
    notes,
    drawn,
    layout: {
      systems: boxes,
      measures: [...measures.values()].sort((a, b) => a.measureIndex - b.measureIndex),
      staves: readStaves(drawn, pixelsPerUnit),
      heightPx: last ? last.topPx + last.heightPx : 0,
    },
  };
}

/**
 * Turns the notes OSMD drew into a pitch-to-height ruler per staff per system.
 *
 * Two notes one letter apart are drawn half a staff space apart, so a single
 * note fixes where every other pitch on that staff would go — no clef, octave
 * mark or transposition to interpret. The reference is the median of the notes
 * on the staff rather than the first, so one misread note cannot shift the
 * ruler; the same median in pitch says which staff a key belongs on, which for
 * a grand staff is which hand would have played it.
 */
function readStaves(drawn: readonly DrawnNote[], pixelsPerUnit: number): StaffRuler[] {
  const stepPx = pixelsPerUnit / 2;
  const byStaff = new Map<number, DrawnNote[]>();
  const byLine = new Map<string, DrawnNote[]>();
  for (const note of drawn) {
    group(byStaff, note.staffIndex, note);
    group(byLine, `${String(note.systemIndex)}:${String(note.staffIndex)}`, note);
  }

  const centers = new Map<number, number>(
    [...byStaff].map(([staffIndex, notes]) => [staffIndex, median(notes.map((note) => note.step))]),
  );

  return [...byLine.values()].map((notes) => {
    const first = notes[0]!;
    return {
      systemIndex: first.systemIndex,
      staffIndex: first.staffIndex,
      stepPx,
      stepZeroPx: median(notes.map((note) => note.yPx + note.step * stepPx)),
      centerStep: centers.get(first.staffIndex) ?? first.step,
    };
  });
}

/**
 * The line or space a drawn notehead sits on. OSMD spells the note itself, so
 * this asks it rather than guessing: an E♭ is on the E line, a D♯ on the D
 * line, and only the score knows which was written.
 */
function stepOf(graphical: GraphicalNote, midiNote: number): number | undefined {
  const letter = letterIndexOfSemitone(graphical.sourceNote.Pitch.FundamentalNote);
  return letter < 0 ? undefined : diatonicStep(midiNote, letter);
}

function group<K>(groups: Map<K, DrawnNote[]>, key: K, note: DrawnNote): void {
  const existing = groups.get(key);
  if (existing) existing.push(note);
  else groups.set(key, [note]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
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
