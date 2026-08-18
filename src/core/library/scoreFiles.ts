import type { ScoreEntry } from './types';

/**
 * What counts as a score.
 *
 * MusicXML only, deliberately: it is the single source of truth for both
 * notation and timing (see §3 of the plan). A music folder is full of `.mid`,
 * `.mscz` and `.pdf` besides, and listing a piece that dead-ends when you click
 * it is worse than not listing it at all.
 */
export const SCORE_EXTENSIONS = ['.musicxml', '.xml', '.mxl'] as const;

export function isScoreFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SCORE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** What to call a piece in a list: its own title, or failing that its file name. */
export function displayNameOf(entry: ScoreEntry): string {
  if (entry.title !== undefined && entry.title.trim() !== '') return entry.title;
  const fileName = entry.path.slice(entry.path.lastIndexOf('/') + 1);
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? fileName : fileName.slice(0, dot);
}

/** The folder a piece sits in, for the quieter second line of a list row. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}
