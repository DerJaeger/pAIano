import { describe, expect, it } from 'vitest';
import {
  emptyCatalog,
  favourites,
  mergeScan,
  mostPlayed,
  recent,
  recordOpened,
  recordPlayed,
  toggleFavourite,
} from './catalog';
import type { ScannedFile } from './types';

const file = (path: string, modifiedAt = 1, size = 100): ScannedFile => ({
  path,
  modifiedAt,
  size,
});

describe('mergeScan', () => {
  it('takes in everything the first time', () => {
    const catalog = mergeScan(emptyCatalog(), [file('a.musicxml'), file('b.musicxml')]);

    expect(catalog.entries.map((entry) => entry.path)).toEqual(['a.musicxml', 'b.musicxml']);
  });

  it('sorts by path, so the library reads the way the folder does', () => {
    const catalog = mergeScan(emptyCatalog(), [file('b/2.musicxml'), file('a/1.musicxml')]);

    expect(catalog.entries.map((entry) => entry.path)).toEqual(['a/1.musicxml', 'b/2.musicxml']);
  });

  it('keeps what it already parsed for a file that has not changed', () => {
    let catalog = mergeScan(emptyCatalog(), [file('a.musicxml')]);
    catalog = {
      ...catalog,
      entries: catalog.entries.map((entry) => ({
        ...entry,
        title: 'Invention 1',
        composer: 'Bach',
      })),
    };

    // The whole point of an incremental rescan: reopening 84 files to re-read
    // titles that cannot have changed is the slow part of startup.
    const rescanned = mergeScan(catalog, [file('a.musicxml')]);

    expect(rescanned.entries[0]?.title).toBe('Invention 1');
    expect(rescanned.needsParsing.map((entry) => entry.path)).toEqual([]);
  });

  it('re-reads a file whose size or date moved', () => {
    let catalog = mergeScan(emptyCatalog(), [file('a.musicxml', 1, 100)]);
    catalog = {
      ...catalog,
      entries: catalog.entries.map((entry) => ({ ...entry, title: 'stale' })),
    };

    const rescanned = mergeScan(catalog, [file('a.musicxml', 2, 100)]);

    expect(rescanned.entries[0]?.title).toBeUndefined();
    expect(rescanned.needsParsing.map((entry) => entry.path)).toEqual(['a.musicxml']);
  });

  it('drops a file that is no longer there', () => {
    const catalog = mergeScan(emptyCatalog(), [file('a.musicxml'), file('b.musicxml')]);

    const rescanned = mergeScan(catalog, [file('a.musicxml')]);

    expect(rescanned.entries.map((entry) => entry.path)).toEqual(['a.musicxml']);
  });

  it('keeps the history of a file that went missing and came back', () => {
    // A folder moved onto a different drive should not cost you your favourites.
    let catalog = mergeScan(emptyCatalog(), [file('a.musicxml')]);
    catalog = toggleFavourite(catalog, 'a.musicxml');

    catalog = mergeScan(catalog, []);
    catalog = mergeScan(catalog, [file('a.musicxml')]);

    expect(favourites(catalog).map((entry) => entry.path)).toEqual(['a.musicxml']);
  });
});

describe('the sidebar orderings', () => {
  function library() {
    return mergeScan(emptyCatalog(), [file('a.musicxml'), file('b.musicxml'), file('c.musicxml')]);
  }

  it('lists nothing as recent until something is opened', () => {
    expect(recent(library())).toEqual([]);
  });

  it('puts the most recently opened first', () => {
    let catalog = library();
    catalog = recordOpened(catalog, 'a.musicxml', 100);
    catalog = recordOpened(catalog, 'b.musicxml', 200);

    expect(recent(catalog).map((entry) => entry.path)).toEqual(['b.musicxml', 'a.musicxml']);
  });

  it('counts opening the same piece again as one entry, moved to the top', () => {
    let catalog = library();
    catalog = recordOpened(catalog, 'a.musicxml', 100);
    catalog = recordOpened(catalog, 'b.musicxml', 200);
    catalog = recordOpened(catalog, 'a.musicxml', 300);

    expect(recent(catalog).map((entry) => entry.path)).toEqual(['a.musicxml', 'b.musicxml']);
  });

  it('ranks most played by how often, not how recently', () => {
    let catalog = library();
    catalog = recordPlayed(catalog, 'a.musicxml');
    catalog = recordPlayed(catalog, 'a.musicxml');
    catalog = recordPlayed(catalog, 'b.musicxml');

    expect(mostPlayed(catalog).map((entry) => entry.path)).toEqual(['a.musicxml', 'b.musicxml']);
  });

  it('does not count merely opening a piece as playing it', () => {
    // Clicking through the library to see what a piece looks like must not
    // make it the piece you have played most.
    let catalog = library();
    catalog = recordOpened(catalog, 'a.musicxml', 100);
    catalog = recordOpened(catalog, 'a.musicxml', 200);

    expect(mostPlayed(catalog)).toEqual([]);
    expect(recent(catalog).map((entry) => entry.path)).toEqual(['a.musicxml']);
  });

  it('stars and unstars', () => {
    let catalog = toggleFavourite(library(), 'b.musicxml');
    expect(favourites(catalog).map((entry) => entry.path)).toEqual(['b.musicxml']);

    catalog = toggleFavourite(catalog, 'b.musicxml');
    expect(favourites(catalog)).toEqual([]);
  });

  it('ignores history for a piece no longer in the library', () => {
    let catalog = recordOpened(library(), 'a.musicxml', 100);

    catalog = mergeScan(catalog, [file('b.musicxml')]);

    expect(recent(catalog)).toEqual([]);
  });

  it('caps how many it returns, so a section stays a section', () => {
    let catalog = library();
    catalog = recordOpened(catalog, 'a.musicxml', 100);
    catalog = recordOpened(catalog, 'b.musicxml', 200);

    expect(recent(catalog, 1).map((entry) => entry.path)).toEqual(['b.musicxml']);
  });
});
