import { useEffect, useRef, useState } from 'react';
import { createOsmdNotation } from '../adapters/notation/osmdAdapter';
import { notesInMeasure } from '../core/notation/position';
import type { NotationPort, WrittenPosition } from '../core/notation/types';
import type { Score } from '../core/score/types';

export type CreateNotation = (
  container: HTMLElement,
  options: { ticksPerQuarter: number },
) => Promise<NotationPort>;

/** Colour of the bar the cursor is on — the same accent the piano keys use. */
const HIGHLIGHT_COLOR = '#2f6f4f';

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2] as const;
const DEFAULT_ZOOM_STEP = ZOOM_STEPS.indexOf(1);

/**
 * How many lines of music are on screen at once. Enough to read ahead, few
 * enough that the line being played stays at the top instead of the page
 * scrolling out from under you.
 */
const VISIBLE_SYSTEMS = 3;

/**
 * The sheet music and the controls for moving around it.
 *
 * The position shown is a prop rather than local state: during playback the
 * transport owns it, and the bar buttons here are a seek request like any
 * other. Zoom stays local — that is a view preference, not a position.
 */
export function ScoreView({
  score,
  musicXml,
  position,
  onSeekBar,
  createNotation = createOsmdNotation,
}: {
  score: Score;
  musicXml: string;
  position: WrittenPosition;
  onSeekBar: (measureIndex: number) => void;
  createNotation?: CreateNotation;
}) {
  const bar = position.measureIndex;
  const container = useRef<HTMLDivElement>(null);
  // The factory is a test seam, not state: swapping it mid-mount is not a thing.
  const [create] = useState(() => createNotation);
  const [notation, setNotation] = useState<NotationPort | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [zoomStep, setZoomStep] = useState(DEFAULT_ZOOM_STEP);
  const lastBar = score.measures.length - 1;

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    let port: NotationPort | undefined;
    let cancelled = false;
    setNotation(undefined);
    setError(undefined);

    void (async () => {
      try {
        port = await create(element, { ticksPerQuarter: score.ticksPerQuarter });
        await port.load(musicXml);
        if (cancelled) return;
        setNotation(port);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
      port?.destroy();
    };
  }, [create, musicXml, score]);

  // The playhead moves every animation frame, the highlight only once a bar.
  useEffect(() => {
    notation?.showCursorAt(position);
  }, [notation, position]);

  useEffect(() => {
    notation?.setVisibleSystems(VISIBLE_SYSTEMS);
  }, [notation]);

  useEffect(() => {
    if (!notation) return;
    notation.highlight(
      notesInMeasure(score, bar).map((note) => ({ note, color: HIGHLIGHT_COLOR })),
    );
  }, [notation, score, bar]);

  useEffect(() => {
    notation?.setZoom(ZOOM_STEPS[zoomStep]!);
  }, [notation, zoomStep]);

  return (
    <section className="sheet-panel">
      <div className="sheet-controls">
        <div className="bar-nav">
          <button
            type="button"
            className="button"
            onClick={() => {
              onSeekBar(Math.max(0, bar - 1));
            }}
            disabled={bar === 0}
          >
            ◀ Previous bar
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              onSeekBar(Math.min(lastBar, bar + 1));
            }}
            disabled={bar >= lastBar}
          >
            Next bar ▶
          </button>
          <p className="bar-label">
            Bar {score.measures[bar]?.number ?? '?'} of {score.measures.length}
          </p>
        </div>

        <label className="bar-slider">
          <span className="visually-hidden">Bar</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, lastBar)}
            value={bar}
            onChange={(event) => {
              onSeekBar(Number(event.target.value));
            }}
          />
        </label>

        <div className="zoom">
          <button
            type="button"
            className="button"
            aria-label="Zoom out"
            onClick={() => {
              setZoomStep((step) => Math.max(0, step - 1));
            }}
            disabled={zoomStep === 0}
          >
            −
          </button>
          <span className="zoom-level">{Math.round(ZOOM_STEPS[zoomStep]! * 100)}%</span>
          <button
            type="button"
            className="button"
            aria-label="Zoom in"
            onClick={() => {
              setZoomStep((step) => Math.min(ZOOM_STEPS.length - 1, step + 1));
            }}
            disabled={zoomStep === ZOOM_STEPS.length - 1}
          >
            +
          </button>
        </div>
      </div>

      {error !== undefined && (
        <p role="alert" className="error">
          Could not render this score: {error}
        </p>
      )}
      {!notation && error === undefined && <p className="muted">Engraving the score…</p>}

      <div className="sheet" ref={container} data-testid="sheet" />
    </section>
  );
}
