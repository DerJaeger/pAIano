# ADR-0002 — MIDI input: one hub, audio-clock timestamps

- Status: accepted
- Date: 2026-08-03

## Context

Phase 2 needs device enumeration, hot-plug, note on/off and the sustain pedal, with
timestamps good enough that Phase 5 can judge whether a note was early or late. Web
MIDI hands us raw bytes and a `performance.now()` timestamp; the scheduler (Phase 4)
lives on the audio clock. Two clocks, and the answer must not depend on when React
happens to render.

## Decision

1. **`MidiInputHub` in core owns everything except `requestMIDIAccess`.** Device
   selection, auto-select, surviving an unplug, filtering by device and decoding are
   pure and tested once. `WebMidiInput` and `FakeMidiInput` both extend it, so the
   fake is not a re-implementation that can drift from the real thing.
2. **Timestamps are converted to audio seconds at the boundary**, by `AudioTimeline`.
   Each message carries a correlated `(performance, audio)` sample from
   `AudioContext.getOutputTimestamp()`; the offset is smoothed against jitter but
   snaps on a large jump (a suspended context), because smoothing across that would
   mistime everything for seconds. A timestamp of 0 — some drivers send nothing else —
   means "now".
3. **Note-on with velocity 0 is a note-off.** Most keyboards use running status and
   never send `0x8n`. Decoding this in one place means no downstream code has to know.
4. **The sustain pedal is modelled as state, not as a note property.** `KeyboardState`
   separates `keysDown` (fingers) from `sounding` (fingers plus what CC64 is holding),
   which is exactly the distinction the matcher will need: a note held by the pedal
   must not count as the player pressing it again.
5. **Connecting is a user gesture, not a page-load side effect.** Browsers prompt for
   MIDI permission and start an `AudioContext` suspended outside a gesture. The panel
   therefore has a Connect button, and failures are explained by reason —
   `unsupported` (Safari), `insecure-context`, `denied` — rather than silently doing
   nothing.
6. **We listen to every input, not just the selected one**, and filter in the hub.
   Switching devices is then instant and needs no re-subscription.
7. **No `sysex: true`.** We do not need it, and it triggers a scarier permission prompt.

## Consequences

- `MidiInputHub` deliberately exposes a driver half (`setDevices`, `syncClock`,
  `handleRawMessage`, `deliver`) alongside the consumer half. Consumers are typed as
  `MidiInputPort`, which hides it.
- Phase 4 will want the same `AudioContext` the clock was created from, so
  `createAudioClock()` returns the context rather than hiding it.
- Latency calibration is not implemented yet. When it lands it belongs in
  `AudioTimeline` as a constant offset, which is the only place that knows about
  input time.
