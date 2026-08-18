# Web PianoBooster — Project Plan

A browser-based, fully client-side piano practice trainer in the spirit of
[PianoBooster](https://github.com/pianobooster/PianoBooster): load a score, see the notation,
play along on a MIDI keyboard, and get real-time feedback on whether you hit the right notes at
the right time.

No backend. No upload. Your files stay on your machine.

---

## 1. Product scope

### Core loop (MVP)
1. Pick a MIDI keyboard from the browser (Web MIDI).
2. Open a score from a local file or folder.
3. See the sheet music rendered, with a cursor tracking the current position.
4. Hear a guide track (soundfont piano) for the parts you're *not* playing.
5. Play along. Correct notes light up green, wrong/missed notes red.
6. Practice modes: **Listen** (play it for me), **Follow You** (wait for the right note before
   advancing), **Play Along** (fixed tempo, score me).
7. Per-hand selection (right / left / both), tempo scaling, loop a bar range, transpose.

### Deliberately out of MVP
- PDF display path (Phase 7)
- MuseScore.com integration (Phase 8)
- Recording/replay, MIDI export of your performance
- Multi-instrument beyond piano

---

## 2. Platform reality check

These constrain the design and are worth knowing before we write code:

| Capability | Status |
|---|---|
| **Web MIDI** (`navigator.requestMIDIAccess`) | Chrome/Edge/Opera/Samsung by default; Firefox 108+ via a one-time site-permission add-on. **Safari does not support it** and WebKit has no roadmap — Safari is out of scope, we detect and show a clear message. Requires a secure context (https or localhost). |
| **File System Access API** (folder picking, persistent handles in IndexedDB) | Chromium only. Firefox needs a fallback: `<input type="file" webkitdirectory>` (re-pick each session) plus drag-and-drop. |
| **Web Audio** | Universal. Master clock for all timing. |
| **Everything client-side** | Yes — the whole app is static files. Deployable to GitHub Pages. |

**Target:** Chromium-first, Firefox best-effort, Safari explicitly unsupported.

---

## 3. Architecture

The single most important decision for TDD: **the core is pure TypeScript with zero
DOM/Audio/MIDI dependencies**, and every browser API sits behind a port interface with a fake
implementation for tests.

```
┌─────────────────────────────────────────────────────────┐
│  UI (React)                                             │
│  device picker · library browser · sheet view · HUD     │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────┐
│  CORE  (pure, 100% unit-tested, no browser globals)     │
│                                                          │
│  score/      MusicXML → Score model, NoteEvent stream    │
│  transport/  clock, tempo map, position, looping         │
│  practice/   matcher, wait-mode gating, scoring          │
│  midi/       SMF parse/write, message encode/decode      │
└───┬──────────┬──────────┬──────────┬────────────────────┘
    │ ports    │          │          │
┌───▼───┐ ┌────▼─────┐ ┌──▼──────┐ ┌─▼──────────┐
│MidiIn │ │AudioSink │ │ Notation│ │ Library    │
│Port   │ │Port      │ │ Port    │ │ Port       │
├───────┤ ├──────────┤ ├─────────┤ ├────────────┤
│WebMIDI│ │soundfont │ │  OSMD   │ │FS Access / │
│adapter│ │adapter   │ │ adapter │ │input+IDB   │
└───────┘ └──────────┘ └─────────┘ └────────────┘
```

Each port gets a fake (`FakeMidiInput`, `FakeClock`, `RecordingAudioSink`) so the practice engine
can be driven deterministically in unit tests — no audio hardware, no keyboard, no timers.

### Timing model
- **Master clock is `performance.now()`** — _revised in Phase 4, [ADR-0004](docs/adr/0004-transport.md);
  originally `AudioContext.currentTime`._ Notes are scheduled ahead with a lookahead window
  (~150ms) refreshed by a 25ms ticker, and handed to the browser's MIDI stack with an absolute
  timestamp, which does the precise delivery. rAF only drives *visual* interpolation.
- Web MIDI input events arrive with `event.timeStamp` already in that domain, and
  `MIDIOutput.send(data, timestamp)` schedules in it, so there is no conversion anywhere.
- `Transport` in core is clock-agnostic: it takes a `now(): seconds` function. Tests inject a
  fake clock and step it manually.

### Score model
MusicXML is the **single source of truth** for both notation and timing. This sidesteps the hard
problem of aligning a separately-exported MIDI file to a separately-exported XML file (differing
repeats, pickup bars, ornaments). A paired `.mid` is optional and only used as an alternative
audio guide.

```ts
Score {
  parts: Part[]           // with a hand hint (staff 1/2 → right/left)
  measures: Measure[]     // bar numbers, time sigs, repeat structure
  tempoMap: TempoMap      // tick ↔ seconds, handles tempo changes
  events: NoteEvent[]     // flattened, repeat-expanded, sorted by time
}
NoteEvent { midiNote, startTick, durationTicks, partId, staff, voice, tie, xmlId }
```
`xmlId` links a core event back to the SVG element OSMD rendered, so highlighting is a lookup,
not a guess.

---

## 4. Tech choices

| Concern | Choice | Why |
|---|---|---|
| Build/stack | **Vite + React + TypeScript (strict)** | Fast HMR, best ecosystem fit for OSMD/pdf.js. |
| Notation | **OpenSheetMusicDisplay** (MusicXML → VexFlow → SVG) | Has a cursor API, per-note SVG handles, actively used for exactly this. |
| Guide audio | **MIDI out to your own instrument** — _revised in Phase 4, [ADR-0004](docs/adr/0004-transport.md)_ | Better sounds than anything we could ship, and genuinely offline: a soundfont library would fetch multi-MB samples from a CDN. Sits behind `MidiOutputPort`, so a browser-side synth stays an additive change for anyone without an instrument that accepts input. |
| MIDI device | **Web MIDI API** directly (thin adapter, no `webmidi.js` dep) | The API is small; a wrapper adds surface area we'd have to fake anyway. |
| SMF parsing | `@tonejs/midi` **or** hand-rolled | Decide in Phase 1 spike; hand-rolled is ~300 LOC and perfectly testable. |
| `.mscz` ingest | **webmscore** (libmscore in WASM) — *optional, Phase 6* | Reads `.mscz` natively and emits MusicXML/MIDI/SVG client-side. Caveat: based on MuseScore 3, lightly maintained, multi-MB WASM. Kept behind a lazy-loaded adapter so it can be dropped. |
| PDF | `pdf.js` — *Phase 7* | |
| Unit/integration tests | **Vitest** + Testing Library | |
| E2E | **Playwright** (Chromium) | Can fake Web MIDI by injecting a stub `navigator.requestMIDIAccess` before page load. |
| Lint/format | ESLint + Prettier, enforced in CI | |
| CI | GitHub Actions: typecheck → lint → test → build → deploy Pages | |

---

## 5. Delivery phases

Each phase is a branch → PR → merge, red-green-refactor throughout, and ends with something
demonstrable.

### Phase 0 — Foundations
- `git init`, conventional commits, `main` protected by CI.
- Vite + React + TS strict, Vitest, Playwright, ESLint/Prettier, GH Actions.
- `docs/adr/` for architecture decision records; ADR-0001 records the choices in §4.
- **Done when:** `npm test` runs a passing trivial test in CI and the app deploys to Pages.

### Phase 1 — Score core *(pure, no UI)*
- MusicXML parse → `Score` model: parts, staves, voices, ties, tuplets, key/time sigs.
- Repeat expansion (repeats, voltas, D.C./D.S./Coda) into a flat `NoteEvent[]`.
- `TempoMap`: tick ↔ seconds with tempo changes.
- SMF parser (if we keep the optional MIDI path).
- **Tests:** a corpus of small fixture `.musicxml` files (single note, chord, tie across barline,
  triplet, 1st/2nd ending, D.S. al Coda, pickup bar, tempo change) each with an expected event
  list. This is the highest-value test suite in the project — everything downstream trusts it.
- **Done when:** given a real MuseScore export, we produce a correct timed note stream.

### Phase 2 — MIDI input
- `MidiInputPort`: device enumeration, hot-plug, note on/off (incl. note-on velocity 0),
  sustain pedal CC64, timestamps normalized to audio time.
- `WebMidiAdapter` + `FakeMidiInput`.
- UI: device picker, live "keys currently down" indicator.
- **Done when:** pressing a key on your keyboard lights up on screen.

### Phase 3 — Notation view
- `NotationPort` + OSMD adapter: render, cursor to position, highlight/color a note by `xmlId`.
- Responsive layout, page/scroll mode, zoom.
- **Tests:** adapter is thin and covered by Playwright screenshot/DOM assertions; core stays
  untouched by OSMD types.
- **Done when:** a MuseScore export renders and a cursor can be driven to any bar.

### Phase 4 — Transport & guide playback ✅
- `Transport`: play/pause/stop/seek, tempo scaling, bar-range loop, count-in.
- Lookahead scheduler → `MidiOutputPort` → Web MIDI output adapter.
- Per-staff mute/solo (mute the hand you're practising).
- Cursor follows playback smoothly.
- **Tests:** transport driven by `FakeClock` against a `RecordingMidiOutput`, asserting exact
  scheduled (time, note) pairs. Fully deterministic.
- **Done when:** press play, hear the piece, watch the cursor track it.

Two decisions landed here and are recorded in [ADR-0004](docs/adr/0004-transport.md): the guide
plays out to your instrument rather than to a soundfont, and — with Web Audio out of the signal
path — `performance.now()` milliseconds replace the audio clock as the app's single time domain,
which is the domain both MIDI input and MIDI output scheduling already use.

A usability pass afterwards changed how the sheet is read: the view shows a **rolling window of
three systems** with the line being played at the top — rather than the whole piece, which scrolled
out from under you whenever you reached for pause — and the cursor became **our own playhead**,
interpolated between notes from the clock instead of stepping voice entry to voice entry. The
geometry arithmetic lives in `core/notation/layout.ts`; the OSMD adapter only reports pixel boxes.

### Phase 5 — Practice engine *(the heart)* ✅
- `Matcher`: for the expected notes at position *t*, classify incoming input as correct / wrong /
  early / late / missed, with a configurable timing tolerance and chord grouping.
- Modes: **Listen**, **Follow You** (transport gates until the required chord is fully held),
  **Play Along** (fixed tempo, accuracy + timing score).
- Feedback: note coloring, running accuracy, per-bar error heatmap, end-of-run summary.
- **Tests:** table-driven — feed scripted input event sequences through `FakeMidiInput` +
  `FakeClock`, assert exact classifications. Covers the nasty cases: rolled chords, extra notes,
  repeated same note, pedal-held notes, wrong octave.
- **Done when:** you can actually practise a piece and the feedback feels fair.

Three decisions are recorded in [ADR-0005](docs/adr/0005-practice-engine.md). Timing tolerance
is measured in **ticks, not milliseconds** — an eighth-note window stays an eighth-note window at
half speed, where a fixed millisecond window would get stricter exactly when a learner needs it
not to. A press claims the **nearest unplayed note of that pitch within the window**, and the
awkward cases fall out of that one rule rather than being special-cased. And **Follow You waits
by pausing the transport and seeking back to the chord's own tick**, rather than `Transport`
growing a fourth state — which also gives "press play instead of the note" a useful meaning:
skip the one you cannot get.

Which notes are yours to play is not a new setting: they are exactly the ones the guide has been
muted out of, so Phase 4's mute checkboxes do both jobs and cannot drift apart.

### Phase 6 — Library, control, and the practice/listen switch ⬅ **in progress**

Three strands. They ship together because they are the same complaint: once you are sitting at the
keyboard, every interaction still costs a trip to the mouse and a dialog.

#### 6a — The library
- **One music root.** Pick a folder once (e.g. `/home/user/music`); it is scanned recursively for
  scores, however deeply nested. The directory handle is persisted in IndexedDB and re-opened on
  the next startup — a permission re-prompt on return is the only friction, and we ask for it
  eagerly rather than at first click. Firefox, with no FS Access API, falls back to
  `<input webkitdirectory>` + drag-and-drop and re-picks each session; the UI states that plainly.
- **Retractable left sidebar** holding the whole library, collapsed to a rail when you want the
  sheet full-width. Its open/closed state persists. Sections:
  - **Find song** — a **fuzzy finder** over the indexed paths (title, composer, folder segments),
    ranked with match highlighting, keyboard-navigable, matching on subsequences rather than
    substrings so `bmin inv` finds `Bach/Inventions/Invention 15 in B minor.musicxml`.
  - **Recent** — last opened, most recent first.
  - **Favourites** — starred, user-ordered.
  - **Most played** — by session count, which means we finally record per-score play history
    alongside the existing per-score progress.
- **Learning sets** (user-defined collections) sit in the same sidebar.
- The scan builds a persisted index (path, mtime, parsed title/composer) so startup is instant and
  re-scanning is incremental; a manual "rescan" is available for files added outside the app.
- Optional `.mscz` support via lazy-loaded webmscore.
- **Core/port shape:** `LibraryPort` gains recursive enumeration; the index, the fuzzy ranker, and
  the recent/favourite/most-played ordering are **pure core** (`core/library/`) and unit-tested
  against a fake file tree — no browser API in a single one of those tests.
- **Done when:** point it at your MuseScore folder once, and on every later startup your library is
  just there and any piece is three keystrokes away.

#### 6b — Keyboard and pedal commands ✅
Practising means your hands are on the keys, so the transport has to be reachable without them
leaving. Two input surfaces, one command layer.

- **A `Command` enum in core** (`play/pause`, `stop`, `restart bar`, `repeat bar` (loop it),
  `previous bar`, `next bar`, `restart song`, `find song`, `toggle sidebar`, `tempo ±`,
  `toggle hands`, `toggle MIDI output`, …). Both surfaces below dispatch into it, so a command is
  defined and tested exactly once and the two bindings cannot drift.
- **Keyboard shortcuts** bound to it, with a discoverable cheat-sheet overlay (`?`) and a
  user-editable binding map persisted locally. Care needed: shortcuts must not fire while the fuzzy
  finder has focus.
- **MIDI-source commands** — a gesture on the instrument itself, for when even the computer
  keyboard is too far. Recognised only while **no note key is held**, so a gesture can never be
  mistaken for playing: e.g. sustain pedal tapped once → restart bar, twice → restart song, soft
  pedal held + sustain tap → previous bar. (The exact vocabulary is to be chosen during the phase;
  the examples are illustrative.) This lands as a pure `core/commands/gestureRecognizer.ts` — a
  state machine over the existing timestamped MIDI input stream, driven in tests by
  `FakeMidiInput` + `FakeClock`, table-driven over tap counts, timing windows, and the
  near-misses that must *not* trigger.
- Supersedes ideas 1 in [IDEAS.md](IDEAS.md).
- **Done when:** you can find, start, loop and restart a piece without touching the mouse — and
  restart the bar you just fluffed without lifting your hands off the keys at all.

Landed, minus `find song` and `toggle sidebar`, which have nothing to act on until 6a builds them.
Decisions are in [ADR-0007](docs/adr/0007-command-layer.md). The pedal vocabulary settled on **two
quick taps to restart the bar, three to restart the piece**, with a single tap deliberately
meaningless: it is the most natural gesture and so the one ordinary pedalling produces constantly.
And the guard against a command firing when it should not is a switch the owning component throws
(`useCommands(..., enabled)`), not focus-guessing — which was tried first and got it wrong in
exactly the case that matters, where the key press assigning a binding also ran the command it had
just been given. The fuzzy finder in 6a should use the same switch.

#### 6c — Guide output toggle ✅
- **One checkbox: "Send guide to MIDI out."** Off = practice (silent guide, you are the sound),
  on = listen along. Today the only way to switch is to unselect and re-select the output device,
  which is absurd for something you toggle every few minutes.
- It gates the scheduler's sends, not the device connection: the port stays open and selected, and
  flipping it mid-playback takes effect immediately and sends `all notes off` on the way down so
  nothing hangs. Bound to a command in 6b, and persisted.
- **Done when:** you can flip between practising and listening mid-piece, instantly, without
  touching the device picker.

Landed as `Transport.setGuideAudible()`. It re-anchors rather than only setting a flag, which is
what makes it immediate in both directions — the same machinery that mutes a hand mid-phrase, so
turning the guide off drops what is queued and turning it back on resumes the note under the
playhead rather than waiting for the next one. The count-in is deliberately left outside the gate:
it is a metronome, not the guide, and it is how you know when to come in on a part you are playing
yourself. Persisting it brought the first `localStorage` setting into the app (`ui/settings.ts`),
which 6b's binding map will reuse.

### Phase 7 — PDF path (option 1 from the brief)
- Pair a `.pdf` with a `.mid`, render pages with pdf.js, play the MIDI as the guide.
- Position feedback limited to a **manually calibrated per-page/per-system marker** — be honest
  that note-level sync is not achievable from a PDF without OMR. This path is for scores where no
  MusicXML exists.
- **Done when:** PDF + MIDI plays with page turns and a coarse position bar.

### Phase 8 — MuseScore.com integration (spike first, then decide)
Open question, needs a timeboxed investigation before any commitment:
- `developers.musescore.com` documents a REST API requiring a consumer key obtained by emailing
  `api@musescore.com`. It's legacy and widely reported as effectively closed to new registrations
  — **verify before planning against it.**
- Also CORS-hostile: a purely client-side app may be unable to call it at all without a proxy,
  which breaks the "no backend" property.
- Legal constraint we should respect: downloading paid/copyrighted scores off musescore.com
  outside their client violates their ToS. Scope any integration to **public-domain / OpenScore
  material and your own uploads**.
- Fallback that needs none of the above and delivers most of the value: **favourites and learning
  sets live in this app**, referencing local files. That's already Phase 6.

---

## 6. Testing strategy

- **TDD by default** — a failing test precedes the implementation for all core logic.
- **Unit (Vitest, fast, ~ms):** everything in `core/`. Target near-total coverage here; this is
  where correctness lives.
- **Fixture corpus:** hand-written minimal `.musicxml`/`.mid` files, each a named musical edge
  case. Grows every time we hit a real-world bug — every bug fix starts with a new fixture.
- **Adapter tests:** thin, mostly verifying we translate browser events into port events faithfully.
- **E2E (Playwright):** device selection with a stubbed Web MIDI, load fixture score, play,
  simulate correct/incorrect input, assert visual feedback. A handful of high-value journeys, not
  a pyramid inversion.
- **Golden/perf checks:** render a large score (e.g. a full sonata movement) and assert render
  time and scheduler jitter stay within budget.

---

## 7. Main risks

| Risk | Mitigation |
|---|---|
| MusicXML repeat expansion is genuinely fiddly | Own it in core, fixture-driven, done early in Phase 1 where it's cheap. |
| OSMD cursor/highlight API may not expose what we need | Spike it in Phase 0/3 before committing; `NotationPort` keeps a swap to Verovio possible. |
| Timing jitter makes scoring feel unfair | Audio-clock scheduling from day one; measure input latency and expose a calibration slider. |
| webmscore is a heavy, lightly maintained WASM dep | Optional, lazy-loaded, behind an adapter. MusicXML export from MuseScore is always the reliable path. |
| MuseScore API turns out to be unavailable | Phase 8 is a spike, not a commitment; local learning sets deliver the value regardless. |
| Safari users | Detect and tell them plainly, up front. |

---

## 8. Immediate next steps

Phases 0–5 are done: a MuseScore export parses, renders, plays out to your instrument, and judges
what you play. What is missing is everything *around* the practice loop — getting to a piece, and
controlling it without leaving the keyboard. That is Phase 6.

1. ~~**6c** — the guide-output checkbox.~~ Done: it gates the sends, not the connection, and
   established the "command, not a device reconnection" shape that 6b builds on.
2. ~~**6b** — the `Command` layer, keyboard bindings, then the MIDI gesture recognizer.~~ Done.
   `findSong` and `toggleSidebar` join the `Command` union as 6a builds something for them to do.
3. **6a** — the library: persisted root handle and recursive index, then the pure fuzzy ranker and
   recent/favourites/most-played ordering, then the sidebar UI on top of them.

**Settled (Chrome 151, Linux, 2026-08-18) — measured, not assumed.** A throwaway probe picked a
music folder, stored the handle in IndexedDB and indexed 84 scores, and Chrome was then fully
restarted:

- the **handle itself survives** a restart — so the folder is never re-picked, only re-authorised;
- **our own index is readable with no permission at all**, because it is our data in our IndexedDB;
- **permission comes back as `prompt`**, not `granted`, and `requestPermission()` needs a user
  gesture, so it cannot be restored silently on load;
- `requestPermission()` shows a **plain Allow bubble** naming the folder — not the directory
  picker — and returns `granted`;
- reading *before* asking throws **`NotAllowedError`**, rather than returning nothing. That is the
  signal the library layer catches and turns into the Reconnect prompt, so a stale permission can
  never look like an empty folder.

So "your library is just there" is true of everything except opening a file. The sidebar renders
the full library from the index on a cold start — browsing, search, favourites and most-played all
work with no permission — and carries a single **Reconnect folder** button that opening a score
also triggers if it has not been pressed yet. One click per browser session, and never a directory
picker again. This is what 6a builds; it is not a fallback path.
