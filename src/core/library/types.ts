/**
 * The library as core sees it: paths and facts about them. Nothing here knows
 * that the File System Access API, IndexedDB or a browser exist — the adapter
 * in `src/adapters/library` does the touching of files, and hands core these.
 */

/** What a scan of the music root reports about one file, before it is read. */
export interface ScannedFile {
  /** Path relative to the music root, e.g. `Bach/Inventions/Invention 1.musicxml`. */
  path: string;
  /** Last-modified, ms since the epoch. With `size`, decides a rescan. */
  modifiedAt: number;
  size: number;
}

/** A file in the library, plus whatever we have managed to read out of it. */
export interface ScoreEntry extends ScannedFile {
  /** From the MusicXML, once parsed. Absent until then. */
  title?: string;
  composer?: string;
}

/** What the app remembers about your practice, per piece. */
export interface ScoreHistory {
  lastOpenedAt?: number;
  playCount: number;
  favourite: boolean;
}

/**
 * The whole library: what is on disk, and what you have done with it.
 *
 * History is keyed by path and kept for pieces that are not currently present,
 * so a folder that moves — or a drive that was not mounted at startup — does
 * not cost you your favourites.
 */
export interface Catalog {
  entries: readonly ScoreEntry[];
  history: Readonly<Record<string, ScoreHistory>>;
  /** Entries whose title and composer still need reading. Empty after a full parse. */
  needsParsing: readonly ScoreEntry[];
}
