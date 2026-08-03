/**
 * The score model. Pure data — no DOM, no audio, no MIDI.
 *
 * MusicXML is the single source of truth for both notation and timing, so this
 * model has to carry enough information to (a) schedule audio, (b) drive a
 * notation cursor, and (c) link an event back to the rendered SVG.
 */

/** Which hand a staff is nominally played with. */
export type Hand = 'right' | 'left';

export interface Part {
  /** MusicXML part id, e.g. "P1". */
  id: string;
  name: string;
  /** Staff number (1-based) → hand hint. Staff 1 is right, staff 2 is left. */
  hands: ReadonlyMap<number, Hand>;
  staffCount: number;
}

export interface TimeSignature {
  beats: number;
  beatType: number;
}

export interface Measure {
  /** Index into `Score.measures`, 0-based, in written (unexpanded) order. */
  index: number;
  /** The number printed on the score. Pickup bars are usually "0" or "1". */
  number: string;
  startTick: number;
  durationTicks: number;
  time: TimeSignature;
  /** Sharps (positive) / flats (negative). */
  keyFifths: number;
}

export interface NoteEvent {
  midiNote: number;
  /** Position on the *expanded* (repeat-unrolled) timeline. */
  startTick: number;
  durationTicks: number;
  partId: string;
  staff: number;
  voice: string;
  /** Written measure this note belongs to. */
  measureIndex: number;
  /** 0 on the first pass through a measure, 1 on the first repeat, etc. */
  pass: number;
  /** Links back to the element OSMD rendered, so highlighting is a lookup. */
  xmlId: string;
}

export interface TempoChange {
  /** Position on the expanded timeline. */
  tick: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface Score {
  title: string;
  parts: Part[];
  /** Written measures, in score order — not expanded. */
  measures: Measure[];
  /** Written measure index for each pass of the expanded playback order. */
  playbackOrder: PlaybackStep[];
  tempoMap: TempoMap;
  /** Flattened, repeat-expanded, tie-merged, sorted by `startTick`. */
  events: NoteEvent[];
  /** Ticks per quarter note on the expanded timeline. */
  ticksPerQuarter: number;
  /** Total length of the expanded timeline. */
  durationTicks: number;
}

export interface PlaybackStep {
  measureIndex: number;
  pass: number;
  /** Where this measure lands on the expanded timeline. */
  startTick: number;
  durationTicks: number;
}

/** Structural interface only — the implementation lives in `tempoMap.ts`. */
export interface TempoMap {
  readonly ticksPerQuarter: number;
  readonly changes: readonly TempoChange[];
  tickToSeconds(tick: number): number;
  secondsToTick(seconds: number): number;
  bpmAt(tick: number): number;
}
