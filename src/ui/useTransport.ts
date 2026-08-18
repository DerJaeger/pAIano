import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { MidiOutputPort } from '../core/midi/output';
import type { Score } from '../core/score/types';
import { performanceClock, type Clock } from '../core/transport/clock';
import { Transport } from '../core/transport/transport';
import { readSetting } from './settings';

/**
 * How often the scheduler is asked to refill its lookahead window. Well under
 * the transport's own lookahead, so a browser that skips a few ticks (a busy
 * tab, a long layout) still hands every note over in good time.
 */
const TICK_MS = 25;

/**
 * Owns a `Transport` for as long as there is a score and somewhere to play it.
 *
 * The ticker is a plain interval on purpose: it only has to be *roughly* on
 * time, because the notes it queues carry absolute timestamps that the browser's
 * MIDI stack honours (ADR-0004).
 */
export function useTransport(
  score: Score | undefined,
  output: MidiOutputPort | undefined,
  clock: Clock = performanceClock,
): Transport | undefined {
  const [transport, setTransport] = useState<Transport | undefined>(undefined);

  useEffect(() => {
    if (!score || !output) {
      setTransport(undefined);
      return;
    }

    // The switch is read here rather than held in React state because the
    // transport is the one source of truth for it; storage only seeds a fresh
    // engine and records what the player last chose.
    const engine = new Transport({
      score,
      output,
      clock,
      guideAudible: readSetting('guideAudible', true),
    });
    setTransport(engine);
    const ticker = setInterval(() => {
      engine.tick();
    }, TICK_MS);

    return () => {
      clearInterval(ticker);
      engine.close();
    };
  }, [score, output, clock]);

  return transport;
}

/** Re-renders whenever the transport's discrete state changes. */
export function useTransportState(transport: Transport | undefined) {
  const subscribe = useCallback(
    (onChange: () => void) => transport?.onChange(onChange) ?? (() => undefined),
    [transport],
  );

  const state = useSyncExternalStore(subscribe, () => transport?.getState() ?? 'stopped');
  const speed = useSyncExternalStore(subscribe, () => transport?.getSpeed() ?? 1);
  const loop = useSyncExternalStore(subscribe, () => transport?.getLoop());
  const selection = useSyncExternalStore(subscribe, () => transport?.getSelection());
  const guideAudible = useSyncExternalStore(subscribe, () => transport?.isGuideAudible() ?? true);

  return { state, speed, loop, selection, guideAudible };
}

/**
 * The playhead, sampled per animation frame while playing.
 *
 * Position is read from the clock rather than pushed by the scheduler, so the
 * cursor moves smoothly between notes instead of jumping from one to the next.
 */
export function useTransportPosition(transport: Transport | undefined): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!transport) {
      setTick(0);
      return;
    }

    let frame = 0;
    const sample = () => {
      // Cancel first: `onChange` can fire mid-frame, and two chained rAF loops
      // would then run forever against one another.
      cancelAnimationFrame(frame);
      setTick(transport.getPositionTick());
      // Only chase the clock while it is moving; otherwise a change is enough.
      if (transport.getState() === 'playing') frame = requestAnimationFrame(sample);
    };

    sample();
    const unsubscribe = transport.onChange(sample);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [transport]);

  return tick;
}
