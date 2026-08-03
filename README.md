# Web PianoBooster

A browser-based piano practice trainer in the spirit of
[PianoBooster](https://github.com/pianobooster/PianoBooster): load a score, see the notation, play
along on a MIDI keyboard, get real-time feedback.

Fully client-side. No backend, no upload — your files stay on your machine.

See [PLAN.md](PLAN.md) for the full product plan and delivery phases.

## Status

| Phase                          | State                                                           |
| ------------------------------ | --------------------------------------------------------------- |
| 0 — Foundations                | ✅ Vite + React + TS strict, Vitest, ESLint/Prettier, CI, Pages |
| 1 — Score core                 | ✅ MusicXML/`.mxl` → timed note stream                          |
| 2 — MIDI input                 | ✅ device picker, live keys-down, sustain pedal                 |
| 3 — Notation view (OSMD)       | ⬜ next                                                         |
| 4 — Transport & guide playback | ⬜                                                              |
| 5 — Practice engine            | ⬜                                                              |
| 6 — Library                    | ⬜                                                              |

Today the app connects to a MIDI keyboard and lights up the keys you play (sustain pedal included),
and opens a MusicXML or `.mxl` file to show what the parser understood: parts, measures,
repeat-expanded duration, tempo map and the note stream. The two halves meet in Phase 5.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration (Vitest)
npm run test:e2e   # Playwright, Chromium with a stubbed MIDI keyboard
npm run lint       # ESLint
npm run typecheck  # tsc
npm run build      # production build into dist/
```

`npm run test:e2e` needs the browser once: `npx playwright install chromium`.

## Architecture

`src/core/**` is pure TypeScript with no DOM, Audio, MIDI or Node globals — all browser
capabilities sit behind ports with fakes for tests. See
[docs/adr/0001-architecture.md](docs/adr/0001-architecture.md).

```
src/
  core/
    xml/         ordered XML reader (MusicXML is order-sensitive)
    score/       Score model, tempo map, .mxl container
      musicxml/  parser, repeat expansion, fixture corpus
    midi/        message decoding, keyboard state, input port + fake
  adapters/
    midi/        Web MIDI  → MidiInputPort
    audio/       AudioContext clock, for timestamping input
  ui/            React shell
tests/           Playwright journeys
```

## Browser support

Chromium-first. Firefox 108+ works with the Web MIDI site-permission add-on. **Safari is
unsupported** — it has no Web MIDI implementation. Web MIDI also requires a secure context
(https or localhost).
