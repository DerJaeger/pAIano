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
| 3 — Notation view (OSMD)       | ✅ engraved score, cursor to any bar, per-note colouring        |
| 4 — Transport & guide playback | ✅ play/pause/seek, tempo, bar loop, count-in, per-hand mute    |
| 5 — Practice engine            | ✅ Listen / Follow you / Play along, scored feedback            |
| 6 — Library                    | ⬜ next                                                         |

Today the app connects to a MIDI keyboard and lights up the keys you play (sustain pedal included),
and opens a MusicXML or `.mxl` file: it engraves the score, and plays it back **through your own
instrument over MIDI out** — at any speed, looping the bar you are stuck on, with the hand you are
practising muted — while the cursor tracks the music.

And now you can practise against it. Pick a mode:

- **Listen** — play it for me; nothing is judged.
- **Follow you** — the music waits on each chord until you have played it, however long you take.
  Press play instead of the note to skip one you cannot get.
- **Play along** — fixed tempo, and you are scored on notes _and_ timing.

Notes you play turn green, amber for the right note out of time, red for wrong or missed, and a
bar-by-bar strip shows where the run fell apart — click a bar to go back and take it again. The
notes you are expected to play are the ones you muted the guide out of, so there is no second
setting to keep in step. See [ADR-0005](docs/adr/0005-practice-engine.md) for why the timing
window is measured in ticks rather than milliseconds.

Three switches above the sheet help while you are still learning to read it: **note
names** written on the noteheads, **colour by pitch** (a Boomwhacker-style colour per
pitch class, so a phrase reads as a pattern before it reads as positions on a staff),
and **show what I play** — every key you are holding drawn as a bar across the staff
at its own pitch, wherever the playhead stands, right note or not. See
[ADR-0006](docs/adr/0006-reading-aids.md) for how a pitch nothing in the piece plays
still finds its line.

**Send guide to MIDI out** switches between practising and listening without touching
the device picker: off, the guide is silent and you are the sound; on, it plays along
with you. It gates the notes rather than the connection, so it takes effect mid-piece
and the instrument stays selected either way. The count-in click is not gated by it —
it is a metronome, and it is how you know when to come in. The setting is remembered
between sessions.

Point the **library** at your music folder once and it is remembered: the sidebar indexes
every score under it, however deeply nested, and finds any of them by subsequence —
`bmin inv` reaches `Bach/Inventions/Invention 15 in B minor`. Chrome asks again each
session before a page may read the folder, so there is one **Reconnect** click per
session; the list, the search and your favourites all work before you make it, because
the index is our own data rather than the folder's.

Nothing needs the mouse. Space plays and pauses, the arrows step bars and tempo, and
`?` shows the rest — click any key in that list to move it somewhere you will
remember. Two quick taps of the **sustain pedal** restart the bar and three restart
the piece, recognised only with no note held down, so a gesture can never be mistaken
for playing. Both surfaces run the same commands; see
[ADR-0007](docs/adr/0007-command-layer.md) for why the pedal refuses to answer to a
single tap.

The guide needs an instrument that accepts incoming MIDI, and most keyboards want their
&ldquo;local control off&rdquo; setting so the guide does not fight your own playing.

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
    midi/        message decoding, keyboard state, input + output ports + fakes
    commands/    what the app can be told to do, and the two ways to say it
    library/     the index, the fuzzy ranker, and what you have played
    notation/    notation port + fake, written ↔ expanded positions, page geometry
    transport/   clock, tick ↔ time timeline, lookahead scheduler
    practice/    what you owe, what you played, how it scored
  adapters/
    library/     File System Access + IndexedDB: the folder that is remembered
    midi/        Web MIDI → MidiInputPort / MidiOutputPort
    notation/    OpenSheetMusicDisplay → NotationPort
  ui/            React shell
tests/           Playwright journeys
```

## Browser support

Chromium-first. Firefox 108+ works with the Web MIDI site-permission add-on. **Safari is
unsupported** — it has no Web MIDI implementation. Web MIDI also requires a secure context
(https or localhost).
