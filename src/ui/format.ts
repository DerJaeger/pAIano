import { pitchClassName } from '../core/notation/pitch';

/** Scientific pitch notation, e.g. 60 → "C4". Enharmonics are not key-aware. */
export function noteName(midiNote: number): string {
  return `${pitchClassName(midiNote)}${String(Math.floor(midiNote / 12) - 1)}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

export function round(value: number, places = 2): string {
  const factor = 10 ** places;
  return String(Math.round(value * factor) / factor);
}
