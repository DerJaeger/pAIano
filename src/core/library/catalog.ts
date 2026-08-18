import type { Catalog, ScannedFile, ScoreEntry, ScoreHistory } from './types';

/** How many a sidebar section shows before it stops being a section. */
const SECTION_LIMIT = 10;

const NO_HISTORY: ScoreHistory = { playCount: 0, favourite: false };

export function emptyCatalog(): Catalog {
  return { entries: [], history: {}, needsParsing: [] };
}

/**
 * Folds a fresh scan into what we already knew.
 *
 * A file whose size and modified date are unchanged keeps the title and
 * composer we parsed last time, and is left out of `needsParsing`. That is what
 * makes startup instant: re-opening every file to re-read titles that cannot
 * have changed is the slow part, not the directory walk.
 *
 * Files that have vanished drop out of `entries` but keep their history, so
 * they come back with their favourites and play counts intact.
 */
export function mergeScan(catalog: Catalog, scanned: readonly ScannedFile[]): Catalog {
  const known = new Map(catalog.entries.map((entry) => [entry.path, entry]));
  const needsParsing: ScoreEntry[] = [];

  const entries = [...scanned]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const previous = known.get(file.path);
      const unchanged =
        previous !== undefined &&
        previous.modifiedAt === file.modifiedAt &&
        previous.size === file.size;

      const entry: ScoreEntry = unchanged ? { ...previous, ...file } : { ...file };
      if (entry.title === undefined) needsParsing.push(entry);
      return entry;
    });

  return { entries, history: catalog.history, needsParsing };
}

/** Records that a piece was opened, which is what Recent is ordered by. */
export function recordOpened(catalog: Catalog, path: string, at: number): Catalog {
  const previous = catalog.history[path] ?? NO_HISTORY;
  return {
    ...catalog,
    history: { ...catalog.history, [path]: { ...previous, lastOpenedAt: at } },
  };
}

/**
 * Records that a piece was actually played.
 *
 * Separate from opening on purpose: clicking a piece four times to look at it
 * must not make it your most-played piece. The caller counts one per session in
 * which the transport ran, so an hour of restarts on one bar is one play, and
 * browsing is none.
 */
export function recordPlayed(catalog: Catalog, path: string): Catalog {
  const previous = catalog.history[path] ?? NO_HISTORY;
  return {
    ...catalog,
    history: { ...catalog.history, [path]: { ...previous, playCount: previous.playCount + 1 } },
  };
}

export function toggleFavourite(catalog: Catalog, path: string): Catalog {
  const previous = catalog.history[path] ?? NO_HISTORY;
  return {
    ...catalog,
    history: { ...catalog.history, [path]: { ...previous, favourite: !previous.favourite } },
  };
}

export function historyOf(catalog: Catalog, path: string): ScoreHistory {
  return catalog.history[path] ?? NO_HISTORY;
}

/** Last opened first. */
export function recent(catalog: Catalog, limit = SECTION_LIMIT): ScoreEntry[] {
  return present(catalog)
    .filter((entry) => historyOf(catalog, entry.path).lastOpenedAt !== undefined)
    .sort(
      (a, b) =>
        (historyOf(catalog, b.path).lastOpenedAt ?? 0) -
        (historyOf(catalog, a.path).lastOpenedAt ?? 0),
    )
    .slice(0, limit);
}

/** Starred, in library order — user ordering is a later refinement. */
export function favourites(catalog: Catalog): ScoreEntry[] {
  return present(catalog).filter((entry) => historyOf(catalog, entry.path).favourite);
}

/** By how often, not how recently — the piece you keep coming back to. */
export function mostPlayed(catalog: Catalog, limit = SECTION_LIMIT): ScoreEntry[] {
  return present(catalog)
    .filter((entry) => historyOf(catalog, entry.path).playCount > 0)
    .sort((a, b) => historyOf(catalog, b.path).playCount - historyOf(catalog, a.path).playCount)
    .slice(0, limit);
}

/**
 * History is kept for absent files, so every ordering filters to what is
 * actually there — otherwise a section would offer you a piece that cannot open.
 */
function present(catalog: Catalog): ScoreEntry[] {
  return [...catalog.entries];
}
