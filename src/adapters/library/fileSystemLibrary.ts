import { isScoreFile } from '../../core/library/scoreFiles';
import { notAllowed, type AccessState, type LibraryPort } from '../../core/library/port';
import type { ScannedFile } from '../../core/library/types';
import { idbDelete, idbGet, idbPut } from './idb';

/**
 * The music root, backed by the File System Access API.
 *
 * Chromium only. The handle is kept in IndexedDB and re-opened on the next
 * startup — measured on Chrome 151 (§8 of the plan): the handle survives a full
 * browser restart, but its permission comes back as `prompt` and can only be
 * restored from a user gesture. So the folder is picked once, ever, and
 * reconnected with one click per session.
 */
const HANDLE_KEY = 'rootHandle';

/** How deep a music folder is allowed to nest before we stop descending. */
const MAX_DEPTH = 8;

export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export class FileSystemLibrary implements LibraryPort {
  private root: FileSystemDirectoryHandle | undefined;
  /** Started once, awaited by everything. See `loaded()`. */
  private loading: Promise<void> | undefined;

  /**
   * Reads the stored handle back, once, and makes every other method wait for
   * it.
   *
   * Lazily rather than from a startup call on purpose. When restoring was the
   * caller's job, `checkAccess()` could run first and answer `prompt` from a
   * handle that simply had not been read yet — so a reload looked exactly like
   * a revoked permission, and the library came back empty. Ordering that
   * subtle should not be something a caller can get wrong.
   */
  private loaded(): Promise<void> {
    this.loading ??= (async () => {
      if (!supportsFileSystemAccess()) return;
      this.root = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY).catch(() => undefined);
    })();
    return this.loading;
  }

  getRootName(): string | undefined {
    return this.root?.name;
  }

  async checkAccess(): Promise<AccessState> {
    if (!supportsFileSystemAccess()) return 'unsupported';
    await this.loaded();
    if (!this.root) return 'prompt';
    // queryPermission never prompts, which is what makes it safe on load.
    return await this.root.queryPermission({ mode: 'read' });
  }

  async requestAccess(): Promise<AccessState> {
    await this.loaded();
    if (!this.root) return 'prompt';
    return await this.root.requestPermission({ mode: 'read' });
  }

  async pickRoot(): Promise<AccessState> {
    const root = await window.showDirectoryPicker({ mode: 'read', id: 'music-root' });
    this.root = root;
    // Best effort: a browser that will not persist the handle still gets a
    // working library for this session, it just asks for the folder again next
    // time. Failing the pick over it would be the worse outcome.
    await idbPut(HANDLE_KEY, root).catch(() => undefined);
    return this.checkAccess();
  }

  async scan(): Promise<ScannedFile[]> {
    await this.loaded();
    if (!this.root) throw notAllowed();
    const files: ScannedFile[] = [];
    await walk(this.root, '', files, 0);
    return files;
  }

  async read(path: string): Promise<Uint8Array> {
    await this.loaded();
    if (!this.root) throw notAllowed();
    const segments = path.split('/');
    const fileName = segments.pop();
    if (fileName === undefined) throw new Error(`not a file path: ${path}`);

    let directory = this.root;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const file = await (await directory.getFileHandle(fileName)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async forget(): Promise<void> {
    await this.loaded();
    this.root = undefined;
    await idbDelete(HANDLE_KEY);
  }
}

/**
 * Walks the tree depth-first, collecting score files.
 *
 * Depth is capped because a music folder can contain a symlink loop or a
 * checkout of something enormous, and an unbounded walk would hang the app on
 * the one startup it is meant to make instant.
 */
async function walk(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  into: ScannedFile[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  for await (const [name, handle] of directory.entries()) {
    // Dot-directories are version control and editor state, never music.
    if (name.startsWith('.')) continue;

    if (handle.kind === 'directory') {
      await walk(handle, `${prefix}${name}/`, into, depth + 1);
    } else if (isScoreFile(name)) {
      const file = await handle.getFile();
      into.push({ path: `${prefix}${name}`, modifiedAt: file.lastModified, size: file.size });
    }
  }
}
