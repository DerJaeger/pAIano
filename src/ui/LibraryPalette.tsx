import { useEffect, useMemo, useRef, useState } from 'react';
import { favourites, historyOf, mostPlayed, recent } from '../core/library/catalog';
import { rankPaths, type Range } from '../core/library/fuzzy';
import { displayNameOf, folderOf } from '../core/library/scoreFiles';
import type { ScoreEntry } from '../core/library/types';
import type { Library } from './useLibrary';

/** Splits a name into matched and unmatched pieces, for highlighting. */
function highlight(text: string, ranges: readonly Range[]) {
  const pieces: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) pieces.push({ text: text.slice(at, from), match: false });
    pieces.push({ text: text.slice(from, to), match: true });
    at = to;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), match: false });
  return pieces;
}

/** Sections shown when nothing has been typed, in the order you would look. */
function browseList(library: Library): { heading: string; entry: ScoreEntry }[] {
  const { catalog } = library;
  const rows: { heading: string; entry: ScoreEntry }[] = [];
  const seen = new Set<string>();
  const add = (heading: string, entries: readonly ScoreEntry[]) => {
    for (const entry of entries) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      rows.push({ heading, entry });
    }
  };
  add('Favourites', favourites(catalog));
  add('Recent', recent(catalog));
  add('Most played', mostPlayed(catalog));
  add('All pieces', catalog.entries);
  return rows;
}

/**
 * The library, as an overlay you summon and dismiss.
 *
 * It is a palette rather than a sidebar because opening a piece is a thing you
 * do occasionally and then want out of the way — and because that makes the
 * whole interaction keyboard-shaped: summon it, type, arrow to the one you
 * meant, Enter. Escape leaves whatever you were already playing alone.
 */
export function LibraryPalette({
  library,
  onOpen,
  onOpenFile,
  onClose,
}: {
  library: Library;
  onOpen: (path: string) => void;
  /** Firefox has no File System Access API, so it opens one file at a time. */
  onOpenFile: (file: File) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const { catalog, access, rootName } = library;

  const searching = query.trim() !== '';
  const byPath = useMemo(
    () => new Map(catalog.entries.map((entry) => [entry.path, entry])),
    [catalog.entries],
  );

  const rows = useMemo(() => {
    if (!searching) return browseList(library).map((row) => ({ ...row, ranges: [] as Range[] }));
    return rankPaths(
      query,
      catalog.entries.map((entry) => entry.path),
    )
      .slice(0, 60)
      .map((hit, index) => {
        const entry = byPath.get(hit.path);
        return entry
          ? { heading: index === 0 ? 'Best matches' : '', entry, ranges: hit.ranges }
          : undefined;
      })
      .filter((row): row is { heading: string; entry: ScoreEntry; ranges: readonly Range[] } =>
        Boolean(row),
      );
    // `library` is intentionally out of the deps: only the catalog and the query
    // change what is listed, and library's identity changes on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searching, catalog, byPath]);

  // Typing changes what is listed, so the highlight goes back to the top rather
  // than sitting on whatever happened to be at that index before.
  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Keep the highlighted row on screen when the arrows walk past the fold.
  // Guarded because it is pure polish, and jsdom has no implementation of it.
  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const choose = (path: string) => {
    onOpen(path);
    onClose();
  };

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((at) => Math.min(Math.max(at + step, 0), Math.max(rows.length - 1, 0)));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows[selected];
      if (row) choose(row.entry.path);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // Leaves whatever you were playing exactly as it was.
      onClose();
    }
  }

  let lastHeading = '';

  return (
    <div
      className="palette-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Library"
      onClick={onClose}
    >
      <div
        className="palette"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={onKeyDown}
      >
        {rootName === undefined ? (
          <div className="palette-empty">
            <p>
              {access === 'unsupported'
                ? 'This browser cannot remember a folder, so scores are opened one at a time.'
                : 'Point this at your music folder once. It is remembered after that.'}
            </p>
            {access === 'unsupported' ? (
              <label className="button">
                Open a score
                <input
                  type="file"
                  accept=".musicxml,.xml,.mxl"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      onOpenFile(file);
                      onClose();
                    }
                  }}
                />
              </label>
            ) : (
              <button
                type="button"
                className="button"
                onClick={() => {
                  void library.pickRoot();
                }}
              >
                Choose music folder
              </button>
            )}
          </div>
        ) : (
          <>
            <input
              // A callback ref, not a mount effect: the input does not exist
              // until the root name has been read back, which is asynchronous.
              ref={(node) => {
                node?.focus();
              }}
              className="palette-search"
              type="search"
              placeholder="Find a piece…"
              aria-label="Find a piece"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />

            {access !== 'granted' && (
              <div className="palette-reconnect">
                <span>
                  Your browser asks once a session before a page may read <b>{rootName}</b>.
                </span>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    void library.reconnect();
                  }}
                >
                  Reconnect
                </button>
              </div>
            )}

            {library.error !== undefined && <p className="error">{library.error}</p>}

            <ul className="palette-list" ref={listRef}>
              {rows.map((row, index) => {
                const entry = row.entry;
                const name = displayNameOf(entry);
                // Ranges are offsets into the path, so they only line up with a
                // name that *is* the path; a parsed title is a different string.
                const ranges = name === entry.path ? row.ranges : [];
                const history = historyOf(catalog, entry.path);
                const heading = row.heading !== lastHeading ? row.heading : '';
                lastHeading = row.heading;

                return (
                  <li key={entry.path}>
                    {heading !== '' && <h3>{heading}</h3>}
                    <div
                      className={`palette-row${index === selected ? ' selected' : ''}`}
                      role="option"
                      aria-selected={index === selected}
                      tabIndex={-1}
                      onMouseEnter={() => {
                        setSelected(index);
                      }}
                      onClick={() => {
                        choose(entry.path);
                      }}
                    >
                      <span className="palette-name">
                        {highlight(name, ranges).map((piece, at) =>
                          piece.match ? (
                            <mark key={at}>{piece.text}</mark>
                          ) : (
                            <span key={at}>{piece.text}</span>
                          ),
                        )}
                      </span>
                      <span className="palette-where">
                        {entry.composer ?? folderOf(entry.path)}
                        {history.playCount > 0 && (
                          <span className="palette-plays"> · played {history.playCount}×</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className={`palette-star${history.favourite ? ' on' : ''}`}
                        aria-label={`${history.favourite ? 'Unstar' : 'Star'} ${name}`}
                        aria-pressed={history.favourite}
                        onClick={(event) => {
                          event.stopPropagation();
                          library.toggleFavourite(entry.path);
                        }}
                      >
                        {history.favourite ? '★' : '☆'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="palette-footer">
              <span>
                {rows.length} of {catalog.entries.length} in {rootName}
                {library.busy && ' · scanning…'}
              </span>
              <span>↑↓ choose · ↵ open · esc close</span>
              <button
                type="button"
                className="palette-rescan"
                onClick={() => {
                  void library.rescan();
                }}
              >
                Rescan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
