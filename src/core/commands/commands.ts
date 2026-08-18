import { measureIndexAt } from '../notation/position';
import { tracksOf } from '../score/tracks';
import { fasterThan, slowerThan } from '../transport/speeds';
import type { Command, CommandContext } from './types';

/**
 * Runs one command. The single definition of what each one means, so the
 * keyboard and the pedal cannot end up disagreeing about "restart bar".
 *
 * Every command is a no-op when it has nothing to act on rather than an error:
 * these arrive from a key press or a pedal tap, where the player has no way to
 * know the command was inapplicable and no interest in being told.
 */
export function runCommand(command: Command, context: CommandContext): void {
  const { transport, score } = context;

  switch (command) {
    case 'playPause':
      if (transport.getState() === 'playing') transport.pause();
      else transport.play();
      return;

    case 'stop':
      transport.stop();
      return;

    case 'restartSong':
      // Seeking rather than stopping: restarting mid-practice should not also
      // make you press play again.
      transport.seekTick(0);
      return;

    case 'restartBar':
      transport.seekMeasure(currentBar(context));
      return;

    case 'previousBar':
      transport.seekMeasure(Math.max(0, currentBar(context) - 1));
      return;

    case 'nextBar':
      transport.seekMeasure(Math.min(score.measures.length - 1, currentBar(context) + 1));
      return;

    case 'repeatBar': {
      if (transport.getLoop()) transport.setLoop(undefined);
      else {
        const bar = currentBar(context);
        transport.setLoopMeasures(bar, bar);
      }
      return;
    }

    case 'tempoUp':
      transport.setSpeed(fasterThan(transport.getSpeed()));
      return;

    case 'tempoDown':
      transport.setSpeed(slowerThan(transport.getSpeed()));
      return;

    case 'toggleGuideOutput':
      transport.setGuideAudible(!transport.isGuideAudible());
      return;

    case 'cycleHands':
      cycleHands(context);
      return;

    case 'findSong':
      context.onFindSong?.();
      return;

    case 'showHelp':
      context.onShowHelp?.();
      return;
  }
}

/** The written bar the playhead is in; the last one once the piece has run out. */
function currentBar({ score, transport }: CommandContext): number {
  return measureIndexAt(score, transport.getPositionTick()) ?? score.measures.length - 1;
}

/**
 * Both hands → the first muted → the second muted → both again.
 *
 * Only meaningful for a two-track score: with one track there is no "other
 * hand" to hear, and muting the only one would leave the command looking
 * broken. More than two and the checkboxes are the honest interface.
 */
function cycleHands({ score, transport }: CommandContext): void {
  const tracks = tracksOf(score);
  if (tracks.length !== 2) return;

  const muted = transport.getSelection().muted;
  const next = muted.has(tracks[0]!.id)
    ? tracks[1]!.id
    : muted.size === 0
      ? tracks[0]!.id
      : undefined;

  transport.setSelection({
    muted: new Set(next === undefined ? [] : [next]),
    soloed: transport.getSelection().soloed,
  });
}
