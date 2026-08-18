import type { CatalogCache } from '../../core/library/cache';
import type { Catalog } from '../../core/library/types';
import { idbGet, idbPut } from './idb';

/**
 * The catalog in IndexedDB, beside the directory handle but independent of it.
 *
 * Independent on purpose: this is our own data, so it reads back with no file
 * permission whatsoever. That is what lets the sidebar be full on a cold start
 * while the folder is still waiting to be reconnected.
 */
const KEY = 'catalog';

export class IdbCatalogCache implements CatalogCache {
  async read(): Promise<Catalog | undefined> {
    try {
      return await idbGet<Catalog>(KEY);
    } catch {
      // A cache we cannot read just means a rescan; never a broken app.
      return undefined;
    }
  }

  async write(catalog: Catalog): Promise<void> {
    try {
      await idbPut(KEY, catalog);
    } catch {
      // Same: the library still works, it just rebuilds next time.
    }
  }
}
