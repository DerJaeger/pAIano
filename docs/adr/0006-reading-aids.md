# ADR-0006 — Reading aids: note names, pitch colours, and the keys you are holding

- Status: accepted
- Date: 2026-08-06

## Context

Until now the only place a note was named was the practice panel's "waiting for…"
line, and the only thing the sheet said about your playing was the colour a note
turned _after_ it was judged. A beginner reading a score wants three things the
engraving alone does not give:

1. the name of the note under the cursor, without decoding the clef;
2. something other than height on a staff to tell two notes apart;
3. to see where the key they are pressing _right now_ lands on the page, whether or
   not it is the note that was wanted.

The third is the awkward one. Feedback colouring only ever has to find a note the
score already wrote — a lookup by `NoteRef` (ADR-0003). A key you are holding may be
a pitch nothing in the piece plays, in a bar that is all rests, so there is no drawn
note to hang it on: the renderer has to know where a pitch _would_ go.

## Decision

1. **All three are switches on the sheet, defaulting to a clean page.** They are aids
   you grow out of, so they are view state in `ScoreView` alongside zoom, not
   settings, not app state. "Show what I play" starts on because it costs nothing
   until you touch the keyboard; the other two start off.

2. **Pitch colours go through `highlight()`, not through OSMD's own colouring.** OSMD
   has a Boomwhacker mode, but it would fight the adapter's rule that a note not in
   the highlight set is black. Instead the whole score is handed over as one more
   layer of `NoteHighlight`s, under the practice feedback: same port, same
   replace-the-whole-set semantics, no new concept. The cost is that `highlight()` is
   now called with thousands of notes, so it diffs against what is painted rather
   than repainting everything.

   While colours are on, the current-bar highlight is dropped. Painting the bar you
   are playing a single green would take the colour off exactly the notes you are
   reading, and the playhead already says where you are.

3. **The pitch-to-height ruler is measured from notes OSMD drew, not derived from
   clefs.** For each staff on each system, the adapter reads back the notehead
   positions and the pitches OSMD spelled them with. Two notes one letter apart are
   drawn half a staff space apart, so one note fixes where every other pitch on that
   staff would go — no clef, key signature, octave mark or transposition to
   reinterpret, and no second implementation of OSMD's layout rules to keep in step
   with it. The reference is the median over the staff, so one odd note cannot tilt
   the ruler.

   Which staff a held key belongs on is the same measurement: the staff whose notes
   sit nearest that pitch, which on a grand staff is the hand that would have played
   it.

4. **Spelling lives in `core/notation/pitch.ts`, one spelling per pitch class.**
   Nothing upstream says whether MIDI 61 was meant as C♯ or D♭, and the two are
   written a step apart. One table decides, and the name in the practice panel, the
   name on the notehead and the line a held key is drawn on all follow it.

5. **Names and held-key bars are drawn as elements over the SVG**, like the playhead
   (ADR-0003 §3): a re-render cannot lose them, and they need no cooperation from
   OSMD.

## Consequences

- A held key's bar starts where the playhead stood when the key went down and
  stretches to where it stands now, so with the transport running it draws how long
  you held the note, and with it stopped it stays a stub. A seek, or the music
  turning onto the next line, restarts it rather than dragging it across the page.
- A system on which the renderer drew no notes at all — a line of rests — has no
  ruler, so no bars are drawn there. Rare, and the alternative is guessing.
- Enharmonics are not key-aware: in D♭ major the sheet will still say C♯. Making the
  spelling follow the key signature is a change to one module.
- Note names are one element per drawn note (~1900 on the sample arrangement).
  Building them takes about a second on a full score and nothing thereafter, so they
  are built once per render rather than per visible system.
