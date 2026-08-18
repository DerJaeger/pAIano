import { isScoreFile } from './scoreFiles';
import type { ScannedFile } from './types';

/**
 * The music root, as the rest of the app sees it.
 *
 * Only `src/adapters/library` knows that the File System Access API and
 * IndexedDB exist. Everything above this line is testable against `FakeLibrary`.
 */

/**
 * Whether we may read the folder — measured on Chrome 151, see §8 of the plan.
 *
 * A handle stored in IndexedDB survives a browser restart, but its permission
 * does not: it comes back as `prompt` and can only be restored from a user
 * gesture. `unsupported` is Firefox, which has no File System Access API and
 * re-picks each session.
 */
export type AccessState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export interface LibraryPort {
  /** The chosen folder's name, or `undefined` if none has been chosen. */
  getRootName(): string | undefined;
  /** The permission right now. Never prompts, so it is safe to call on load. */
  checkAccess(): Promise<AccessState>;
  /** Restores access. Must be called from a user gesture, or it is refused. */
  requestAccess(): Promise<AccessState>;
  /** Chooses a new music root. Must be called from a user gesture. */
  pickRoot(): Promise<AccessState>;
  /** Every score file under the root, recursively. Throws if access has lapsed. */
  scan(): Promise<ScannedFile[]>;
  /** One file's bytes, by the path `scan` reported. */
  read(path: string): Promise<Uint8Array>;
  /** Forgets the root entirely. */
  forget(): Promise<void>;
}

/** A file tree written by hand in a test: path → contents. */
export type FakeTree = Record<string, string>;

/**
 * An in-memory music root, so the library UI can be driven without a file
 * system, a permission prompt, or a browser that has the API at all.
 */
export class FakeLibrary implements LibraryPort {
  access: AccessState;
  rootName: string | undefined;
  /** Every `scan()` call, for asserting that a rescan was or was not made. */
  scans = 0;

  private tree: FakeTree;

  constructor(tree: FakeTree = {}, options: { access?: AccessState; rootName?: string } = {}) {
    this.tree = tree;
    this.access = options.access ?? 'granted';
    this.rootName = options.rootName ?? 'music';
  }

  getRootName(): string | undefined {
    return this.rootName;
  }

  checkAccess(): Promise<AccessState> {
    return Promise.resolve(this.access);
  }

  requestAccess(): Promise<AccessState> {
    // A fake grant, the way clicking Allow does.
    if (this.access === 'prompt') this.access = 'granted';
    return Promise.resolve(this.access);
  }

  pickRoot(): Promise<AccessState> {
    this.access = 'granted';
    this.rootName ??= 'music';
    return Promise.resolve(this.access);
  }

  scan(): Promise<ScannedFile[]> {
    this.scans++;
    if (this.access !== 'granted') return Promise.reject(notAllowed());
    return Promise.resolve(
      Object.entries(this.tree)
        .filter(([path]) => isScoreFile(path))
        .map(([path, contents]) => ({ path, modifiedAt: 1, size: contents.length })),
    );
  }

  read(path: string): Promise<Uint8Array> {
    if (this.access !== 'granted') return Promise.reject(notAllowed());
    const contents = this.tree[path];
    if (contents === undefined) return Promise.reject(new Error(`no such file: ${path}`));
    return Promise.resolve(new TextEncoder().encode(contents));
  }

  forget(): Promise<void> {
    this.rootName = undefined;
    this.access = 'prompt';
    return Promise.resolve();
  }

  /** Test helper: changes the tree, as editing the folder outside the app would. */
  setTree(tree: FakeTree): void {
    this.tree = tree;
  }
}

/**
 * The error a lapsed permission actually produces — verified against Chrome 151,
 * which throws `NotAllowedError` rather than returning an empty listing. The
 * library layer keys off this to tell "you have not reconnected" apart from
 * "your folder is empty".
 */
export function notAllowed(): DOMException {
  return new DOMException('The request is not allowed by the user agent', 'NotAllowedError');
}

export function isNotAllowed(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}
