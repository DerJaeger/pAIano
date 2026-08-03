# ADR-0004 — Transport: the guide plays out to MIDI, on a performance-time clock

- Status: accepted
- Supersedes the timing decision in [ADR-0002](0002-midi-input.md); supersedes the
  soundfont choice in [ADR-0001](0001-architecture.md) §4
- Date: 2026-08-03

## Context

Phase 4 needs a guide track: press play, hear the piece, watch the cursor track it,
and mute the hand you are practising.

ADR-0001 pencilled in a soundfont player over Web Audio, and ADR-0002 made
`AudioContext.currentTime` the master clock so that scheduling could be sample-accurate.
Both assumed the sound would be synthesised in the browser.

## Decision

### 1. The guide plays through your own instrument, over MIDI out

Rather than synthesising audio, the transport sends note-on/note-off to a `MIDIOutput`.
A digital piano already has better piano sounds than anything we would ship, and this
keeps the app genuinely offline — no multi-megabyte sample set fetched from a CDN, which
a soundfont library would have required.

`AudioSinkPort` from ADR-0001 becomes `MidiOutputPort`. It is still a port with a fake
(`RecordingMidiOutput`), so a browser-side synth remains an additive change for anyone
without an instrument that accepts incoming notes.

### 2. `performance.now()` milliseconds are the master clock

With no Web Audio in the signal path, an `AudioContext` would exist purely as a time
source. Worse, it would be the _wrong_ one: Web MIDI delivers input events stamped in
the `performance.now()` domain and `MIDIOutput.send(data, timestamp)` schedules in that
same domain, so an audio-time master would mean converting on the way in and converting
back on the way out.

So the whole app speaks one clock, behind a `Clock` port (`now(): number`, milliseconds).
`AudioTimeline` and `AudioClock` are deleted — this decision removes code rather than
adding it. Phase 5's matcher can compare an input timestamp against an expected note
time directly.

The precision argument for the audio clock does not transfer: we never sit in a timer
waiting to send. Notes are handed to the browser's MIDI stack **ahead of time with an
absolute timestamp**, and it does the precise delivery. That is why a 25ms `setInterval`
ticker filling a 150ms lookahead window is accurate enough to play music, and why a
janky frame cannot make a note late.

### 3. The tick ↔ clock mapping is an immutable list of laps

`PlaybackTimeline` maps score ticks to clock time for one uninterrupted stretch of
playing. Looping makes that a one-to-many relation, so it is expressed as a sequence of
_laps_: ticks rise monotonically within a lap, and the lap index says which time round.
The cursor, the scheduler and the loop boundary all read from that one structure.

Seeking, changing speed, moving the loop or muting a hand does not edit a schedule in
flight — it drops the queued notes and anchors a **new** timeline at the current
position. Nothing in `Transport` has to unpick a partially-delivered schedule, which is
where this kind of code usually goes wrong. Notes that were sounding across the
re-anchor are re-sent with their remaining duration, so muting one hand does not cut the
other off mid-phrase.

### 4. A track is a staff of a part

Mute/solo operates on `partId/staff`, named "Right hand" / "Left hand". For piano the
useful split is between hands _within_ one part, so part-level muting would be useless;
voices are an engraving detail no player thinks in.

### 5. Panic is sent twice

`MIDIOutput.clear()` is in the spec but unimplemented in Chrome, so notes already handed
over will still fire after a pause. The adapter therefore silences every channel
immediately **and** schedules a second silence just past the furthest timestamp it has
queued. Without the second one, pausing could leave a note hanging until you unplugged
the keyboard.

## Consequences

- Someone without a MIDI instrument that accepts input gets no guide track. The UI says
  so plainly and the rest of the app still works. A synth sink behind the same port is
  the fix if that turns out to matter.
- Many keyboards need "local control off" so the guide does not fight your own playing.
  That is a setting on the instrument, not something we can do for them.
- The guide has no dynamics: `NoteEvent` carries no velocity, so every note goes out at
  a fixed one. MusicXML dynamics are a parser change, and the port is ready for it.
- The count-in is a woodblock on the GM percussion channel (9), which any GM-compatible
  instrument will have. A keyboard with a non-GM patch there will click oddly.
- The cursor moves per animation frame by reading the clock, not by being pushed at each
  note, so it glides between notes instead of stepping. Cursor granularity is still one
  bar — that is the notation port's limit, noted in ADR-0003.
