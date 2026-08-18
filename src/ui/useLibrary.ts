import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  emptyCatalog,
  mergeScan,
  recordOpened,
  recordPlayed,
  toggleFavourite as toggleFavouriteIn,
} from '../core/library/catalog';
import { readMetadata } from '../core/library/metadata';
import { isNotAllowed, type AccessState, type LibraryPort } from '../core/library/port';
import type { Catalog } from '../core/library/types';
import { readMusicXmlSource } from '../core/score/mxl';
import type { CatalogCache } from '../core/library/cache';
import { IdbCatalogCache } from '../adapters/library/idbCatalogCache';

/** Titles are read in batches so a long scan cannot freeze the page. */
const PARSE_BATCH = 12;

export interface Library {
  catalog: Catalog;
  access: AccessState;
  rootName: string | undefined;
  /** True while scanning or reading titles. */
  busy: boolean;
  error: string | undefined;
  pickRoot: () => Promise<void>;
  reconnect: () => Promise<void>;
  rescan: () => Promise<void>;
  toggleFavourite: (path: string) => void;
  /** Counts one play. The caller calls it once per session that actually ran. */
  markPlayed: (path: string) => void;
  /** Reads a score's bytes and records that it was opened. */
  open: (path: string) => Promise<Uint8Array | undefined>;
}

/**
 * Owns the library: the catalog, the permission, and the scan that keeps them
 * in step.
 *
 * The catalog is persisted separately from the directory handle and read back
 * with no permission at all — it is our data in our IndexedDB. That is what
 * makes the sidebar full on a cold start (measured, §8 of the plan): browsing,
 * searching and favourites all work before the folder is reconnected, and only
 * opening a file waits on the click.
 */
export function useLibrary(port: LibraryPort | undefined, cache?: CatalogCache): Library {
  // One cache for the life of the hook; tests hand in a memory one.
  const store = useMemo(() => cache ?? new IdbCatalogCache(), [cache]);
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [access, setAccess] = useState<AccessState>('prompt');
  const [rootName, setRootName] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const save = useCallback(
    (next: Catalog) => {
      setCatalog(next);
      void store.write(next);
    },
    [store],
  );

  /** Rescans, then reads titles for whatever changed. */
  const scan = useCallback(
    async (current: Catalog) => {
      if (!port) return;
      setBusy(true);
      setError(undefined);
      try {
        let next = mergeScan(current, await port.scan());
        save(next);

        // Titles are read after the list already exists, in batches, so the
        // sidebar is usable while the reading is still going on.
        for (let from = 0; from < next.needsParsing.length; from += PARSE_BATCH) {
          const batch = next.needsParsing.slice(from, from + PARSE_BATCH);
          const parsed = await Promise.all(
            batch.map(async (entry) => {
              try {
                return [
                  entry.path,
                  readMetadata(readMusicXmlSource(await port.read(entry.path))),
                ] as const;
              } catch {
                // A file that will not parse keeps its file name as its title.
                return [entry.path, {}] as const;
              }
            }),
          );
          const metadata = new Map(parsed);
          next = {
            ...next,
            entries: next.entries.map((entry) => ({ ...entry, ...metadata.get(entry.path) })),
          };
          save(next);
        }
      } catch (cause) {
        setError(
          isNotAllowed(cause)
            ? 'Reconnect your music folder to read it.'
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
      } finally {
        setBusy(false);
      }
    },
    [port, save],
  );

  // Held in a ref so the cold-start effect below can call the latest `scan`
  // without listing it as a dependency and re-running on every catalog change.
  const scanRef = useRef(scan);
  scanRef.current = scan;

  // The cold start, in the order that matters: show the library we already know
  // about first, then find out whether we may read the folder. The list must
  // never wait on a permission (§8 of the plan).
  useEffect(() => {
    if (!port) return;
    let cancelled = false;

    void (async () => {
      const stored = await store.read();
      if (cancelled) return;
      if (stored) setCatalog(stored);

      const state = await port.checkAccess().catch((): AccessState => 'prompt');
      if (cancelled) return;
      setAccess(state);
      setRootName(port.getRootName());

      // Already allowed — a reload within the session, or a browser that kept
      // the grant — so pick up anything that changed on disk.
      if (state === 'granted' && port.getRootName() !== undefined) {
        await scanRef.current(stored ?? emptyCatalog());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [port, store]);

  const pickRoot = useCallback(async () => {
    if (!port) return;
    try {
      const state = await port.pickRoot();
      setAccess(state);
      setRootName(port.getRootName());
      if (state === 'granted') await scan(emptyCatalog());
    } catch {
      // Cancelling the picker is a decision, not a failure.
    }
  }, [port, scan]);

  const reconnect = useCallback(async () => {
    if (!port) return;
    const state = await port.requestAccess();
    setAccess(state);
    if (state === 'granted') await scan(catalog);
  }, [port, scan, catalog]);

  const rescan = useCallback(() => scan(catalog), [scan, catalog]);

  const toggleFavourite = useCallback(
    (path: string) => {
      save(toggleFavouriteIn(catalog, path));
    },
    [catalog, save],
  );

  const markPlayed = useCallback(
    (path: string) => {
      save(recordPlayed(catalog, path));
    },
    [catalog, save],
  );

  const open = useCallback(
    async (path: string) => {
      if (!port) return undefined;
      try {
        const bytes = await port.read(path);
        save(recordOpened(catalog, path, Date.now()));
        return bytes;
      } catch (cause) {
        // The one place a lapsed permission is most likely to be noticed, so it
        // says what to do about it rather than what went wrong.
        setError(isNotAllowed(cause) ? 'Reconnect your music folder to open this.' : String(cause));
        if (isNotAllowed(cause)) setAccess('prompt');
        return undefined;
      }
    },
    [port, catalog, save],
  );

  return useMemo(
    () => ({
      catalog,
      access,
      rootName,
      busy,
      error,
      pickRoot,
      reconnect,
      rescan,
      toggleFavourite,
      markPlayed,
      open,
    }),
    [
      catalog,
      access,
      rootName,
      busy,
      error,
      pickRoot,
      reconnect,
      rescan,
      toggleFavourite,
      markPlayed,
      open,
    ],
  );
}
