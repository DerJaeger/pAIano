# ADR-0003 — Notation: OSMD behind a port, notes addressed structurally

- Status: accepted
- Date: 2026-08-03

## Context

Phase 3 needs a rendered score with a cursor that can be driven to any bar, and a way
to colour individual notes — the feedback channel Phase 5 will use. ADR-0001 chose
OpenSheetMusicDisplay and planned to link a `NoteEvent` back to the SVG through its
MusicXML `id` attribute (`NoteEvent.xmlId`).

That plan does not survive contact with OSMD 2.1: it does not carry the `id` attribute
of a `<note>` through to the `Note` it parses or to the SVG it draws. There is no
option to make it, and patching OSMD to add one is a maintenance burden we would carry
across every upgrade.

## Decision

1. **Notes are addressed structurally, not by `xmlId`.** A `NoteRef` is
   `{ measureIndex, midiNote, tickInMeasure }` in _written_-score coordinates. Both
   sides derive it from the same MusicXML document — our parser from the file, the
   adapter from OSMD's graphical model — so the index is a lookup, not a guess. The
   Playwright journey asserts on actual coloured noteheads, which is what pins the
   mapping down (`halfTone + 12` is MIDI; `Fraction.RealValue` is in whole notes).
   `NoteEvent.xmlId` stays in the model: it is still the honest identity of a note
   _in the file_, and a future renderer may well expose it.
2. **The port speaks written-score coordinates.** A renderer draws each measure once
   however often it is played, so the port takes a written measure index, and
   `core/notation/position.ts` translates from the repeat-expanded timeline. That
   translation is pure and unit-tested; the adapter stays a drawing layer.
3. **`highlight()` replaces the whole highlight set** rather than accumulating.
   Zooming or resizing makes OSMD redraw the SVG, which throws colours away, so the
   adapter keeps the requested set and reapplies it after every render. That is only
   possible if the caller's full intent is known, not a history of mutations.
4. **The adapter owns re-rendering** (`autoResize: false` plus a debounced
   `ResizeObserver`) for the same reason: an OSMD-initiated re-render would silently
   drop highlights and the cursor.
5. **OSMD is lazy-loaded.** It is ~1.3 MB minified — a separate chunk fetched when a
   score is first opened, so the app's own bundle stays small.
6. **The sheet keeps white paper in dark mode.** Engraving is black-on-white; the
   surrounding UI follows the system theme, the score does not.

## Consequences

- A note is identified by pitch and position, so two notes of the same pitch at the
  same offset in the same bar (a unison across voices) share a `NoteRef` and colour
  together. For practice feedback that is the right behaviour anyway — the player
  presses one key.
- Phase 4's cursor can move by calling `showCursorAt(measureIndexAt(score, tick))`;
  finer-grained (beat-level) cursor movement will need the OSMD iterator driven by
  timestamp, which is a strictly additive change to the port.
- Swapping OSMD for Verovio remains possible: `NoteRef` says nothing about either.
