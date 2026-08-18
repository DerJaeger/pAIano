/**
 * Preferences that should outlive a reload — the ones you would be annoyed to
 * set again every session.
 *
 * Deliberately tiny and synchronous. Anything that needs to survive as a *file*
 * handle, or that grows past a few keys, belongs in IndexedDB with the library
 * index (Phase 6a); this is for switches.
 *
 * Every access is guarded: `localStorage` throws outright in private-mode
 * Firefox and in a blocked third-party context, and no preference is worth
 * taking the app down for.
 */

/** Namespaced so we cannot collide with anything else served from the origin. */
const PREFIX = 'web-pianobooster:';

export type SettingKey = 'guideAudible' | 'bindings' | 'lastScorePath';

export function readSetting<T>(key: SettingKey, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Unwritable, unreadable, or written by an older version in a shape we no
    // longer understand. The default is always a safe answer.
    return fallback;
  }
}

export function writeSetting<T>(key: SettingKey, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Nothing to do and nothing worth telling the player about.
  }
}
