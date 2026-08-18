import { useMemo, useRef, useState } from 'react';
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

/**
 * The library: everything you own, three keystrokes from being open.
 *
 * The whole thing is built from the persisted catalog, which needs no file
 * permission — so on a cold start you can browse, search and star before the
 * folder is reconnected. Only opening a piece waits on that click.
 */
export function LibrarySidebar({
  library,
  open,
  onFocusChange,
  openPath,
  collapsed,
  onToggleCollapsed,
  searchRef,
}: {
  library: Library;
  open: (path: string) => void;
  /** Tells App the finder has the keyboard, so shortcuts stand down. */
  onFocusChange: (focused: boolean) => void;
  openPath: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const { catalog, access, rootName } = library;
  const listRef = useRef<HTMLUListElement>(null);

  const searching = query.trim() !== '';
  const results = useMemo(
    () =>
      rankPaths(
        query,
        catalog.entries.map((entry) => entry.path),
      ),
    [query, catalog.entries],
  );
  const byPath = useMemo(
    () => new Map(catalog.entries.map((entry) => [entry.path, entry])),
    [catalog.entries],
  );

  if (collapsed) {
    return (
      <div className="library-rail">
        <button
          type="button"
          className="button"
          aria-label="Show library"
          onClick={onToggleCollapsed}
        >
          ☰
        </button>
      </div>
    );
  }

  const row = (entry: ScoreEntry, ranges: readonly Range[] = []) => {
    const name = displayNameOf(entry);
    // Ranges are offsets into the path, so they only line up with a name that
    // is the path. A parsed title is a different string, and highlighting it
    // would point at the wrong letters.
    const showRanges = name === entry.path ? ranges : [];
    const history = historyOf(catalog, entry.path);

    return (
      <li key={entry.path}>
        <button
          type="button"
          className={`library-row${entry.path === openPath ? ' open' : ''}`}
          onClick={() => {
            open(entry.path);
          }}
        >
          <span className="library-name">
            {highlight(name, showRanges).map((piece, index) =>
              piece.match ? (
                <mark key={index}>{piece.text}</mark>
              ) : (
                <span key={index}>{piece.text}</span>
              ),
            )}
          </span>
          <span className="library-where">
            {entry.composer ?? folderOf(entry.path) ?? ''}
            {history.playCount > 0 && (
              <span className="library-plays"> · {history.playCount}×</span>
            )}
          </span>
        </button>
        <button
          type="button"
          className={`library-star${history.favourite ? ' on' : ''}`}
          aria-label={`${history.favourite ? 'Unstar' : 'Star'} ${name}`}
          aria-pressed={history.favourite}
          onClick={() => {
            library.toggleFavourite(entry.path);
          }}
        >
          {history.favourite ? '★' : '☆'}
        </button>
      </li>
    );
  };

  const section = (title: string, entries: readonly ScoreEntry[]) =>
    entries.length > 0 && (
      <section className="library-section">
        <h3>{title}</h3>
        <ul>{entries.map((entry) => row(entry))}</ul>
      </section>
    );

  return (
    <aside className="library" aria-label="Library">
      <div className="library-header">
        <h2>Library</h2>
        <button
          type="button"
          className="library-collapse"
          aria-label="Hide library"
          onClick={onToggleCollapsed}
        >
          ⟨
        </button>
      </div>

      {access === 'unsupported' && (
        <p className="muted">
          This browser cannot remember a folder, so scores are picked one session at a time. Chrome
          or Edge keeps your library between visits.
        </p>
      )}

      {rootName === undefined ? (
        <div className="library-empty">
          <p className="muted">
            Point this at your music folder once. It is remembered after that.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              void library.pickRoot();
            }}
          >
            Choose music folder
          </button>
        </div>
      ) : (
        <>
          {access !== 'granted' && (
            <div className="library-reconnect">
              <p className="muted">
                Your browser asks again each session before letting a page read <b>{rootName}</b>.
                Everything below still works — reconnect when you want to open something.
              </p>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void library.reconnect();
                }}
              >
                Reconnect {rootName}
              </button>
            </div>
          )}

          <input
            ref={searchRef}
            className="library-search"
            type="search"
            placeholder="Find a piece…"
            aria-label="Find a piece"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onFocus={() => {
              onFocusChange(true);
            }}
            onBlur={() => {
              onFocusChange(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                const first = results[0];
                if (first) open(first.path);
              }
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
          />

          {library.error !== undefined && <p className="error">{library.error}</p>}

          {searching ? (
            <section className="library-section">
              <h3>
                {results.length} match{results.length === 1 ? '' : 'es'}
              </h3>
              <ul ref={listRef}>
                {results.slice(0, 50).map((hit) => {
                  const entry = byPath.get(hit.path);
                  return entry ? row(entry, hit.ranges) : null;
                })}
              </ul>
            </section>
          ) : (
            <>
              {section('Favourites', favourites(catalog))}
              {section('Recent', recent(catalog))}
              {section('Most played', mostPlayed(catalog))}
              {section('All pieces', catalog.entries)}
            </>
          )}

          <div className="library-footer">
            <span className="muted">
              {catalog.entries.length} piece{catalog.entries.length === 1 ? '' : 's'} in {rootName}
              {library.busy && ' · scanning…'}
            </span>
            <button
              type="button"
              className="library-rescan"
              onClick={() => {
                void library.rescan();
              }}
            >
              Rescan
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
