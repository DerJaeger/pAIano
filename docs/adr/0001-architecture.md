# ADR-0001 — Ports-and-adapters core, MusicXML as the source of truth

- Status: accepted
- Date: 2026-08-03

## Context

Web PianoBooster needs real-time feedback on MIDI input against a rendered score,
entirely client-side. Every interesting piece of logic (timing, matching, scoring,
repeat expansion) is easy to get subtly wrong and hard to debug through a browser.

## Decision

1. **The core is pure TypeScript.** `src/core/**` touches no DOM, Audio, MIDI or
   Node global. Every browser capability sits behind a port interface with a fake
   implementation, so the practice engine can be driven deterministically in unit
   tests. ESLint enforces the "no globals in core" rule.
2. **MusicXML is the single source of truth** for both notation and timing. Aligning
   a separately exported `.mid` to a separately exported `.xml` (differing repeats,
   pickup bars, ornaments) is a hard problem we simply avoid. A paired `.mid` remains
   optional, as an alternative audio guide only.
3. **Ticks are derived from the file, not fixed.** `ticksPerQuarter` is the LCM of
   every `<divisions>` value in the document (scaled into a sane range), so triplets
   and dotted rhythms convert exactly and never accumulate rounding drift.
4. **Repeat expansion happens in core, early.** The parser emits both the written
   measures (for notation) and an expanded `playbackOrder` (for the transport), so
   downstream code never has to reason about voltas again.
5. **`AudioContext.currentTime` will be the master clock** (Phase 4), with a
   lookahead scheduler. `Transport` takes a `now(): seconds` function so tests can
   inject a fake clock. rAF drives visuals only.
6. **Tooling:** Vite + React + TypeScript (strict, plus `noUncheckedIndexedAccess`
   and `exactOptionalPropertyTypes`), Vitest for unit/integration, Playwright for
   E2E, ESLint + Prettier, GitHub Actions for CI and Pages deployment.
7. **Notation via OpenSheetMusicDisplay** behind a `NotationPort` (Phase 3), keeping
   a swap to Verovio possible if its cursor/highlight API falls short.

## Consequences

- The highest-value test suite is the MusicXML fixture corpus; every parser bug
  starts life as a new fixture.
- `.mxl` (MuseScore's default compressed export) is supported directly via `fflate`,
  so users never have to re-export as uncompressed MusicXML.
- Safari is out of scope: it has no Web MIDI support and no roadmap for it. We detect
  and say so plainly rather than degrading mysteriously.
- Grace notes and ornaments are not realised — we play what is written. Revisit if
  practising ornamented repertoire feels wrong.
