/**
 * Test environment patches.
 *
 * Node 26 defines its own experimental `localStorage` global that stays
 * `undefined` unless the process is started with `--localstorage-file`, and it
 * shadows the one jsdom provides. Tests that touch persisted settings would
 * otherwise fail against a global that a real browser always has, so we install
 * a working in-memory `Storage` when the environment has not given us one.
 */
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

if (typeof globalThis.localStorage !== 'object' || globalThis.localStorage === null) {
  // `defineProperty` rather than assignment: Node declares the global with only
  // a getter, so a plain assignment is silently dropped.
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
