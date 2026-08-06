import { useEffect, useState } from 'react';
import type { MidiInputPort } from '../core/midi/types';
import { PracticeSession } from '../core/practice/session';
import { EMPTY_STATS, type PracticeStats } from '../core/practice/stats';
import type { Judgement, PracticeMode } from '../core/practice/types';
import type { Score } from '../core/score/types';
import type { Transport } from '../core/transport/transport';

/** The same cadence the transport's scheduler runs at; the gate wants to be prompt. */
const TICK_MS = 25;

/**
 * Owns a `PracticeSession` for as long as there is a piece, a transport and a
 * keyboard to play it on. Without any one of those there is nothing to judge.
 */
export function usePractice(
  score: Score | undefined,
  transport: Transport | undefined,
  input: MidiInputPort | undefined,
): PracticeSession | undefined {
  const [session, setSession] = useState<PracticeSession | undefined>(undefined);

  useEffect(() => {
    if (!score || !transport || !input) {
      setSession(undefined);
      return;
    }

    const engine = new PracticeSession({ score, transport, input });
    setSession(engine);
    const ticker = setInterval(() => {
      engine.tick();
    }, TICK_MS);

    return () => {
      clearInterval(ticker);
      engine.close();
    };
  }, [score, transport, input]);

  return session;
}

export interface PracticeSnapshot {
  mode: PracticeMode;
  stats: PracticeStats;
  /** Newest first. */
  recent: readonly Judgement[];
  /** Verdict per expected note, keyed by its index — what colours the sheet. */
  results: ReadonlyMap<number, Judgement>;
  waiting: boolean;
  /** Notes of the chord being waited on that are not down yet. */
  owed: readonly number[];
}

const IDLE: PracticeSnapshot = {
  mode: 'listen',
  stats: EMPTY_STATS,
  recent: [],
  results: new Map(),
  waiting: false,
  owed: [],
};

/**
 * Everything the panel and the sheet read, refreshed on every judgement.
 *
 * A plain subscribe-and-copy rather than `useSyncExternalStore`, because half of
 * this is derived (`owed` is computed on demand) and a getter that returns a
 * fresh array each call is exactly what that hook cannot accept.
 */
export function usePracticeState(session: PracticeSession | undefined): PracticeSnapshot {
  const [snapshot, setSnapshot] = useState<PracticeSnapshot>(IDLE);

  useEffect(() => {
    if (!session) {
      setSnapshot(IDLE);
      return;
    }

    const read = () => {
      setSnapshot({
        mode: session.getMode(),
        stats: session.getStats(),
        recent: session.getRecent(),
        results: session.getResults(),
        waiting: session.isWaiting(),
        owed: session.getOwed(),
      });
    };

    read();
    return session.onChange(read);
  }, [session]);

  return snapshot;
}
