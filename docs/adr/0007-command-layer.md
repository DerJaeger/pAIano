# ADR-0007 — One command layer, two input surfaces

- Status: accepted
- Date: 2026-08-18

## Context

Everything the transport can do was reachable only by mouse. Practising means
your hands are on the keys, so every loop, restart and tempo nudge cost a trip
away from the instrument and back — and the bar you just fluffed is exactly the
moment you least want to look away.

Two surfaces suggest themselves: the computer keyboard, and the instrument
itself for when even that is too far. Binding each one directly to transport
calls would define "restart bar" twice, in two places, with nothing keeping the
two definitions honest.

## Decision

1. **Commands are named once, in core.** `Command` is a string union and
   `runCommand` is the single definition of what each one does. Both surfaces
   dispatch into it, so a command is tested once and the two bindings cannot
   drift. Only `showHelp` has nowhere in core to land; the UI passes a handler
   for it, which keeps `CommandContext` honest about what is not core's job.

2. **Every command is a no-op when it cannot apply**, never an error. These
   arrive from a key press or a pedal tap, where the player has no way of
   knowing a command was inapplicable and no interest in being told.

3. **Default bindings are single unmodified keys, and never use ctrl or meta.**
   Your hands are coming off a piano; a two-finger chord on the computer
   keyboard defeats the point. Ctrl and meta belong to the browser and the OS,
   and taking one hostage is a worse bug than a shortcut being unbound.

4. **A pedal gesture must be something you would never play by accident.** The
   sustain pedal is a pedal first, so the recogniser is built to stay silent:

   - a **single tap is never a command** — it is the most natural gesture and so
     the most dangerous one, and ordinary pedalling is full of them;
   - a tap is **short**; holding the pedal at all is pedalling;
   - taps must come in **quick succession** to form one gesture;
   - **no note may be held** at any point during it.

   What is left — two or three deliberate quick taps with your hands off the
   keys — does not happen while playing a piece. Two taps restart the bar, three
   restart the piece.

5. **Each gesture chain is judged on its own.** A chain that was disqualified
   does not poison the next one; otherwise one ordinary pedal press would leave
   the recogniser deaf to the gesture that followed it.

6. **Anything that owns the keyboard switches the command layer off**, rather
   than the command layer trying to guess. The cheat sheet does this while
   binding a key, and Phase 6a's fuzzy finder will do the same. Focus-guessing
   was tried first and got it wrong in exactly the case that matters: the key
   press that assigns a binding also ran the command it had just been assigned.

## Consequences

- A gesture cannot be recognised at its final tap — a third may still be coming
  — so the recogniser is driven by a ticker as well as by the input stream, and
  a double tap acts about 400ms after the second tap. Slower than a key press,
  and worth it for a vocabulary that never fires while you are playing.
- The pedal vocabulary only covers two commands. The remaining ones are
  keyboard-only, which is the honest trade for gestures that stay safe.
- Rebinding a command **moves** it: the old key is freed, and the new key is
  taken from whatever held it. The defaults may still give one command two
  chords (`?` and `shift+/` are the same key on different layouts), but that is
  a default, not something rebinding preserves.
- Persisting the guide switch moved out of the checkbox and into `useTransport`,
  which watches the transport instead. Otherwise flipping it from the keyboard
  would not have been remembered, and the two surfaces would have disagreed
  about what "persisted" meant.
