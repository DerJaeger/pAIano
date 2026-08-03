import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCompressedMusicXml, readMusicXmlSource } from './mxl';
import { parseMusicXml } from './musicxml/parseMusicXml';
import type { Score } from './types';

/**
 * Phase 1's acceptance test: a real MuseScore export (Adele — Skyfall, piano
 * arrangement, exported from MuseScore 2.1 as a compressed .mxl) must produce a
 * correct timed note stream.
 *
 * `samples/` is git-ignored because it holds copyrighted arrangements, so this
 * suite skips when the file is absent (CI) and runs locally where it matters.
 */
const samplePath = fileURLToPath(new URL('../../../samples/adele-skyfall.mxl', import.meta.url));
const available = existsSync(samplePath);
const bytes = available ? new Uint8Array(readFileSync(samplePath)) : new Uint8Array();

let cached: Score | undefined;
const parsed = (): Score => (cached ??= parseMusicXml(readMusicXmlSource(bytes)));

describe.skipIf(!available)('a real MuseScore export', () => {
  it('is recognised and unpacked as a compressed container', () => {
    expect(isCompressedMusicXml(bytes)).toBe(true);
    expect(readMusicXmlSource(bytes)).toContain('<score-partwise');
  });

  it('reads the work title and the piano part', () => {
    const score = parsed();
    expect(score.title).toBe('Skyfall');
    expect(score.parts).toHaveLength(1);
    expect(score.parts[0]!.name).toBe('Piano');
    expect(score.parts[0]!.staffCount).toBe(2);
  });

  it('has 89 measures, all of them filled', () => {
    const score = parsed();
    expect(score.measures).toHaveLength(89);
    expect(score.measures.every((m) => m.durationTicks > 0)).toBe(true);
    // Measures tile the written timeline with no gaps or overlaps.
    score.measures.forEach((measure, i) => {
      const previous = score.measures[i - 1];
      expect(measure.startTick).toBe(
        previous === undefined ? 0 : previous.startTick + previous.durationTicks,
      );
    });
  });

  it('produces notes on both staves within the range of a piano', () => {
    const score = parsed();
    expect(score.events.length).toBeGreaterThan(500);
    expect(new Set(score.events.map((e) => e.staff))).toEqual(new Set([1, 2]));
    for (const event of score.events) {
      expect(event.midiNote).toBeGreaterThanOrEqual(21);
      expect(event.midiNote).toBeLessThanOrEqual(108);
      expect(event.durationTicks).toBeGreaterThan(0);
      expect(event.startTick).toBeGreaterThanOrEqual(0);
    }
  });

  it('emits events sorted by time and inside the piece', () => {
    const score = parsed();
    let previousTick = -1;
    for (const event of score.events) {
      expect(event.startTick).toBeGreaterThanOrEqual(previousTick);
      previousTick = event.startTick;
    }
    const last = score.events[score.events.length - 1]!;
    expect(last.startTick).toBeLessThan(score.durationTicks);
  });

  it('reads the three tempo changes and gives a plausible duration', () => {
    const score = parsed();
    expect(score.tempoMap.changes.map((c) => Math.round(c.bpm))).toEqual([70, 60, 80]);
    const totalSeconds = score.tempoMap.tickToSeconds(score.durationTicks);
    // 89 bars of a slow ballad: minutes, not seconds, and not an hour.
    expect(totalSeconds).toBeGreaterThan(120);
    expect(totalSeconds).toBeLessThan(400);
  });

  it('parses fast enough to stay interactive', () => {
    const started = performance.now();
    parseMusicXml(readMusicXmlSource(bytes));
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
