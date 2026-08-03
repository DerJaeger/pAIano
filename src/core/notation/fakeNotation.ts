import type { NotationPort, NoteHighlight, WrittenPosition } from './types';

/**
 * A notation renderer that draws nothing and remembers everything, so UI tests
 * can assert what the app *asked* to be drawn without pulling in OSMD, SVG
 * layout or a real browser.
 */
export class FakeNotation implements NotationPort {
  loaded: string | undefined;
  cursor: WrittenPosition | undefined;
  visibleSystems: number | undefined;
  highlights: readonly NoteHighlight[] = [];
  zoom = 1;
  destroyed = false;
  /** Set to make `load` reject, for the error path. */
  failWith: Error | undefined;

  load(musicXml: string): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.loaded = musicXml;
    return Promise.resolve();
  }

  showCursorAt(position: WrittenPosition | undefined): void {
    this.cursor = position;
  }

  setVisibleSystems(count: number | undefined): void {
    this.visibleSystems = count;
  }

  highlight(notes: readonly NoteHighlight[]): void {
    this.highlights = notes;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
  }

  destroy(): void {
    this.destroyed = true;
  }
}
