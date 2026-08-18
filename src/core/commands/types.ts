import type { Score } from '../score/types';
import type { Transport } from '../transport/transport';

/**
 * Everything the app can be told to do, named once.
 *
 * Both input surfaces — the computer keyboard and a pedal gesture on the
 * instrument — dispatch into this, so a command is defined and tested in one
 * place and the two bindings cannot drift apart (Phase 6b).
 */
export type Command =
  | 'playPause'
  | 'stop'
  | 'restartBar'
  | 'repeatBar'
  | 'previousBar'
  | 'nextBar'
  | 'restartSong'
  | 'tempoUp'
  | 'tempoDown'
  | 'toggleGuideOutput'
  | 'cycleHands'
  | 'findSong'
  | 'showHelp';

/** Every command, in the order the cheat sheet lists them. */
export const COMMANDS: readonly Command[] = [
  'playPause',
  'stop',
  'restartBar',
  'repeatBar',
  'previousBar',
  'nextBar',
  'restartSong',
  'tempoUp',
  'tempoDown',
  'toggleGuideOutput',
  'cycleHands',
  'findSong',
  'showHelp',
];

/** What the cheat sheet calls each one. */
export const COMMAND_LABELS: Record<Command, string> = {
  playPause: 'Play / pause',
  stop: 'Stop',
  restartBar: 'Restart this bar',
  repeatBar: 'Loop this bar on and off',
  previousBar: 'Previous bar',
  nextBar: 'Next bar',
  restartSong: 'Restart the piece',
  tempoUp: 'Faster',
  tempoDown: 'Slower',
  toggleGuideOutput: 'Guide to MIDI out on and off',
  cycleHands: 'Which hand the guide plays',
  findSong: 'Open the library',
  showHelp: 'Show these shortcuts',
};

/**
 * What a command acts on. The transport and score cover almost everything;
 * `showHelp` is the one command with nowhere in core to land, so the UI passes
 * a handler for it and core tests need none.
 */
export interface CommandContext {
  score: Score;
  transport: Transport;
  onShowHelp?: () => void;
  /** Opens or closes the library overlay. */
  onFindSong?: () => void;
}
