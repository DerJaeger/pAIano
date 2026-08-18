/**
 * The parts of the File System Access API that TypeScript's DOM library does
 * not declare yet.
 *
 * Kept next to the only adapter that uses them, and deliberately minimal: just
 * the four members `FileSystemLibrary` calls, typed the way Chromium implements
 * them. `entries()` is declared over the handle union so `handle.kind` narrows.
 */
declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  }

  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite';
      /** Remembers the last folder per id, so the picker opens where you were. */
      id?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}

export {};
