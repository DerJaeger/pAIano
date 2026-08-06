# ADR-0005 — The practice engine judges in musical time, and waits by pausing

- Status: accepted
- Builds on [ADR-0004](0004-transport.md)
- Date: 2026-08-06

## Context

Phase 5 is the point of the app: play along and be told, fairly, how it went. That needs
three decisions that the rest of the phase falls out of — what "on time" means, how
**Follow You** holds the music back, and how the app knows which notes are yours to play.

## Decision

### 1. Tolerance is measured in ticks, not milliseconds

The matcher's windows are fractions of a quarter note: on time within **0.3 quarters**,
and a press counts as a given note at all within **1 quarter** either side.

Milliseconds would have been the obvious choice — input timestamps and the transport
clock are both in them (ADR-0004). But practising at half speed would then get _stricter_
in musical terms, exactly when a learner needs it not to be, and the same tolerance would
mean a demisemiquaver at one tempo and a whole beat at another. Ticks make the window mean
the same musical thing everywhere, and they cost nothing: the transport already reports
its position in ticks, so the matcher never sees a clock at all.

The consequence is that the matcher is a pure function of `(press, position)` with no time
source, which is why the nasty cases — a rolled chord, an extra finger, the same note
written twice in a bar, a wrong octave — are a table of presses in a unit test.

### 2. A press claims the nearest unplayed note of that pitch, within the window

One rule, and the awkward cases fall out of it rather than being special-cased. A chord
can be taken in any order. A trill on one key matches successive written instances. The
second of two identical notes played first still matches the nearer one. And a note in the
wrong octave is simply a pitch the score does not have here — `wrong`, with the note it
was standing in for still owed, rather than a near-miss the engine tries to be clever
about.

Note-offs and the sustain pedal are not judged at all. What you release, and what the
pedal holds on for you, is not something a score can be strict about without being unfair.

### 3. Follow You waits by pausing the transport and seeking back

Rather than teaching `Transport` a fourth state, `PracticeSession` pauses it and seeks to
the pending chord's own tick. The seek is the part that matters: the ticker only notices
every 25ms, so pausing alone would park the music a few milliseconds _past_ the beat and
the chord would sound clipped when it resumed.

That leaves the transport with no idea it is being gated, which is the trade: the
play/pause button reads "Play" during a wait. In exchange, pressing play during a wait
means something useful — it gives up on that chord (counted missed) and moves on, which is
how you skip a note you cannot get. The session distinguishes its own pause/play calls
from yours with a flag, so the two cannot be confused.

Nothing is ever `missed` in Follow You unless you skip it, and nothing is ever `late`: the
music is parked on the beat you are playing, so a note you took ten seconds over is still
on time. Follow You is about notes; Play Along is about notes _and_ timing.

### 4. Muting the guide is how you say a hand is yours

There is no separate "which hand am I practising" control. The notes you are expected to
play are exactly the ones the guide leaves out, so the mute checkboxes from Phase 4 do
both jobs and cannot drift out of step with each other. With nothing muted the guide
doubles you and every note counts, which is the sensible reading of a score with nothing
taken away.

### 5. A seek forgives; a loop re-arms

Jumping to a bar clears everything from that point on — the whole reason to loop a bar is
to play it a second time — and forgets what the jump skipped rather than counting it
against you. The cut is at the seek point exactly, with no window either side: jumping to
bar 3 means bar 2 does not count, however close to it you landed.

The session spots a jump by watching its own position rather than being told: backwards is
unambiguous, and forwards needs to exceed a whole matching window, which a ticker interval
cannot cover at any speed the transport allows.

## Consequences

- Reaching the end of the piece flushes the remaining notes' windows, which extend past
  the final barline. Without that the last note of a run would never get a verdict.
- Stats reset when a run starts, when the mode changes, and when you change hands — each
  of those is a different thing being judged, and a summary that mixed them would mean
  nothing. They survive the end of a run, so the summary is there to read afterwards.
- `early`/`late` share a colour on the page. The distinction is in the numbers, and three
  shades of "nearly" on a stave is noise.
- A wrong note is not written anywhere, so there is nothing to recolour on the sheet. It
  shows in the running figures and against the bar the playhead was in.
- Velocity is still ignored: `NoteEvent` carries no dynamics (ADR-0004), so playing a
  passage at the wrong volume is not something we can score yet.
- The heatmap counts anything that is not `correct` as an error, timing included. In
  Follow You that makes it uniformly green by construction, which is honest — that mode
  does not judge timing.
