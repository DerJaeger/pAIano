import type { Catalog } from './types';

/**
 * Where the catalog is kept between visits.
 *
 * A port, not a direct IndexedDB call, for two reasons: the library hook stays
 * testable without a browser database, and the thing that makes a cold start
 * feel instant — reading the catalog back with no file permission at all — is
 * then something a test can actually demonstrate.
 */
export interface CatalogCache {
  read(): Promise<Catalog | undefined>;
  write(catalog: Catalog): Promise<void>;
}

/** Survives only as long as the page. Used by tests, and as a last resort. */
export class MemoryCatalogCache implements CatalogCache {
  private catalog: Catalog | undefined;

  read(): Promise<Catalog | undefined> {
    return Promise.resolve(this.catalog);
  }

  write(catalog: Catalog): Promise<void> {
    this.catalog = catalog;
    return Promise.resolve();
  }
}
