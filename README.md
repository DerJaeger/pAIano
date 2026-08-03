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
| 2 — MIDI input                 | ⬜ next                                                         |
| 3 — Notation view (OSMD)       | ⬜                                                              |
| 4 — Transport & guide playback | ⬜                                                              |
| 5 — Practice engine            | ⬜                                                              |
| 6 — Library                    | ⬜                                                              |

Today the app opens a MusicXML or `.mxl` file and shows what the parser understood: parts, measures,
repeat-expanded duration, tempo map and the note stream.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit + integration (Vitest)
npm run lint       # ESLint
npm run typecheck  # tsc
npm run build      # production build into dist/
```

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
  ui/            React shell
```

## Browser support

Chromium-first. Firefox 108+ works with the Web MIDI site-permission add-on. **Safari is
unsupported** — it has no Web MIDI implementation. Web MIDI also requires a secure context
(https or localhost).
