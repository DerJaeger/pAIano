// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The handle sitting in IndexedDB from a previous visit. */
const stored = {
  kind: 'directory' as const,
  name: 'music',
  queryPermission: vi.fn(() => Promise.resolve('granted' as const)),
  requestPermission: vi.fn(() => Promise.resolve('granted' as const)),
  entries: async function* () {
    // An empty folder is enough: these tests are about the handle, not the walk.
  },
  getDirectoryHandle: vi.fn(),
  getFileHandle: vi.fn(),
};

const idbGet = vi.fn(() => Promise.resolve(stored));

vi.mock('./idb', () => ({
  idbGet: () => idbGet(),
  idbPut: () => Promise.resolve(),
  idbDelete: () => Promise.resolve(),
}));

const { FileSystemLibrary } = await import('./fileSystemLibrary');

beforeEach(() => {
  idbGet.mockClear();
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    value: () => Promise.resolve(stored),
  });
});

describe('FileSystemLibrary, coming back to a stored folder', () => {
  it('reads the stored handle without being told to first', async () => {
    // The regression this guards: when restoring was a separate call the
    // caller had to make first, `checkAccess` could answer from a handle that
    // had not been read yet — so a reload looked just like a revoked
    // permission, and the library came back empty.
    const library = new FileSystemLibrary();

    expect(await library.checkAccess()).toBe('granted');
    expect(library.getRootName()).toBe('music');
  });

  it('reads the handle once, however many callers ask', async () => {
    const library = new FileSystemLibrary();

    await Promise.all([library.checkAccess(), library.checkAccess(), library.scan()]);

    expect(idbGet).toHaveBeenCalledTimes(1);
  });

  it('says prompt when nothing was ever stored', async () => {
    idbGet.mockResolvedValueOnce(undefined as never);
    const library = new FileSystemLibrary();

    expect(await library.checkAccess()).toBe('prompt');
  });

  it('reports unsupported where the API does not exist', async () => {
    // @ts-expect-error deleting an optional global for the Firefox case
    delete window.showDirectoryPicker;
    const library = new FileSystemLibrary();

    expect(await library.checkAccess()).toBe('unsupported');
  });
});
