import type { Page } from '@playwright/test';

/**
 * Stubs `showDirectoryPicker` with an in-memory music folder.
 *
 * The app no longer has a file input — the library replaced it — so this is how
 * an end-to-end test gets a score open. It exercises the real adapter, the real
 * catalog and the real palette; only the folder is fake.
 */
export type FolderFile = string | { base64: string };

export async function stubMusicFolder(
  page: Page,
  files: Record<string, FolderFile>,
): Promise<void> {
  await page.addInitScript((tree: Record<string, FolderFile>) => {
    /** Text for a fixture written inline, bytes for a real `.mxl` from disk. */
    function bytesOf(contents: FolderFile): Uint8Array {
      if (typeof contents === 'string') return new TextEncoder().encode(contents);
      const binary = atob(contents.base64);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }

    function fileHandle(name: string, contents: FolderFile) {
      const bytes = bytesOf(contents);
      return {
        kind: 'file' as const,
        name,
        getFile: () =>
          Promise.resolve({
            name,
            size: bytes.length,
            lastModified: 1,
            arrayBuffer: () => Promise.resolve(bytes.buffer),
          }),
      };
    }

    /** Builds a directory handle for everything under `prefix`. */
    function directoryHandle(name: string, prefix: string) {
      const handle = {
        kind: 'directory' as const,
        name,
        queryPermission: () => Promise.resolve('granted'),
        requestPermission: () => Promise.resolve('granted'),
        // An async generator is what the real API hands back, so the adapter's
        // `for await` works unchanged; nothing in here actually needs to wait.
        // eslint-disable-next-line @typescript-eslint/require-await
        async *entries(): AsyncGenerator<[string, unknown]> {
          const seen = new Set<string>();
          for (const path of Object.keys(tree)) {
            if (!path.startsWith(prefix)) continue;
            const rest = path.slice(prefix.length);
            const slash = rest.indexOf('/');
            if (slash === -1) {
              yield [rest, fileHandle(rest, tree[path]!)];
            } else {
              const folder = rest.slice(0, slash);
              if (seen.has(folder)) continue;
              seen.add(folder);
              yield [folder, directoryHandle(folder, `${prefix}${folder}/`)];
            }
          }
        },
        getDirectoryHandle: (child: string) =>
          Promise.resolve(directoryHandle(child, `${prefix}${child}/`)),
        getFileHandle: (child: string) => {
          const contents = tree[`${prefix}${child}`];
          return contents === undefined
            ? Promise.reject(new DOMException('not found', 'NotFoundError'))
            : Promise.resolve(fileHandle(child, contents));
        },
      };
      return handle;
    }

    const root = directoryHandle('music', '');
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: () => Promise.resolve(root),
    });
  }, files);
}

/** Opens the library, types enough to find `query`, and takes the top match. */
export async function openPiece(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: /Open a piece/ }).click();
  const palette = page.getByRole('dialog', { name: 'Library' });
  const choose = palette.getByRole('button', { name: 'Choose music folder' });
  if (await choose.isVisible().catch(() => false)) await choose.click();
  await palette.getByRole('searchbox', { name: 'Find a piece' }).fill(query);
  await palette.getByRole('searchbox', { name: 'Find a piece' }).press('Enter');
}
