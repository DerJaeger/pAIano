/**
 * The notation port: everything the app needs from a sheet-music renderer,
 * expressed in the score model's own terms. No SVG, no OSMD types.
 *
 * Positions here are *written*-score coordinates (measure index into
 * `Score.measures`), not positions on the repeat-expanded timeline — a renderer
 * draws each measure once however often it is played.
 */

/** A note as a renderer can find it on the page. */
export interface NoteRef {
  /** Index into `Score.measures`, 0-based, in written order. */
  measureIndex: number;
  midiNote: number;
  /** Offset from the start of the written measure, in score ticks. */
  tickInMeasure: number;
}

/** Where a point on the expanded timeline lands in the written score. */
export interface WrittenPosition extends Omit<NoteRef, 'midiNote'> {
  /** 0 on the first pass through the measure, 1 on the first repeat, etc. */
  pass: number;
}

export interface NoteHighlight {
  note: NoteRef;
  /** Any CSS colour the renderer understands, e.g. `#2f6f4f`. */
  color: string;
}

export interface NotationPort {
  /** Renders a MusicXML document, replacing anything shown before. */
  load(musicXml: string): Promise<void>;
  /**
   * Puts the playhead on a point in the written score; `undefined` hides it.
   * Called once per animation frame during playback, so it slides between the
   * notes of a bar rather than stepping from one to the next.
   */
  showCursorAt(position: WrittenPosition | undefined): void;
  /**
   * Shows only `count` systems (drawn lines of music), the one under the
   * playhead at the top; `undefined` shows the whole sheet.
   */
  setVisibleSystems(count: number | undefined): void;
  /**
   * Replaces the whole highlight set — notes that are no longer listed go back
   * to their default colour. Replacing rather than accumulating keeps the
   * caller's intent restorable after a re-render (zoom, resize).
   */
  highlight(notes: readonly NoteHighlight[]): void;
  setZoom(zoom: number): void;
  destroy(): void;
}
