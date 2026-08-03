import { useState } from 'react';
import { writtenPositionAt } from '../core/notation/position';
import type { WrittenPosition } from '../core/notation/types';
import { readMusicXmlSource } from '../core/score/mxl';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import type { Score } from '../core/score/types';
import { MidiPanel } from './MidiPanel';
import { ScoreSummary } from './ScoreSummary';
import { ScoreView } from './ScoreView';
import { TransportPanel } from './TransportPanel';
import { openWebMidi } from '../adapters/midi/webMidiAdapter';
import { useMidi, type OpenMidi } from './useMidi';
import { useTransport, useTransportPosition } from './useTransport';

interface OpenedScore {
  score: Score;
  /** The renderer parses the same document the score model came from. */
  musicXml: string;
}

/**
 * The shell: connect a keyboard (Phase 2), open a score (Phase 1), see it
 * engraved (Phase 3) and play it back through the keyboard (Phase 4).
 *
 * Position lives here because two things need it — the transport drives it and
 * the sheet displays it — and one owner beats keeping two in step.
 */
export function App({ open = openWebMidi }: { open?: OpenMidi } = {}) {
  const [opened, setOpened] = useState<OpenedScore | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);

  const midi = useMidi(open);
  const transport = useTransport(opened?.score, midi.output);
  const positionTick = useTransportPosition(transport);
  // Without an instrument there is no transport, but the score is still worth
  // reading, so browsing bars keeps working on its own.
  const [browsedBar, setBrowsedBar] = useState(0);
  const played = opened && transport ? writtenPositionAt(opened.score, positionTick) : undefined;
  const lastBar = opened ? opened.score.measures.length - 1 : 0;
  const position: WrittenPosition = played ?? {
    measureIndex: Math.min(browsedBar, lastBar),
    tickInMeasure: 0,
    pass: 0,
  };

  function seekBar(measureIndex: number): void {
    setBrowsedBar(measureIndex);
    transport?.seekMeasure(measureIndex);
  }

  async function openFile(file: File): Promise<void> {
    setError(undefined);
    setFileName(file.name);
    setBrowsedBar(0);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const musicXml = readMusicXmlSource(bytes);
      setOpened({ score: parseMusicXml(musicXml), musicXml });
    } catch (cause) {
      setOpened(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="app">
      <header>
        <h1>Web PianoBooster</h1>
        <p className="tagline">
          Practise piano with your MIDI keyboard. Everything runs in your browser — your files never
          leave your machine.
        </p>
      </header>

      <MidiPanel connection={midi} />

      <section
        className="dropzone"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void openFile(file);
        }}
      >
        <label className="button">
          Open a score
          <input
            type="file"
            accept=".musicxml,.xml,.mxl"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openFile(file);
            }}
          />
        </label>
        <p>…or drop a MusicXML (.musicxml / .xml) or compressed MuseScore export (.mxl) here.</p>
      </section>

      {error !== undefined && (
        <p role="alert" className="error">
          Could not read {fileName}: {error}
        </p>
      )}

      {opened && (
        <>
          <TransportPanel
            score={opened.score}
            transport={transport}
            output={midi.output}
            positionTick={positionTick}
          />
          <ScoreView
            score={opened.score}
            musicXml={opened.musicXml}
            position={position}
            onSeekBar={seekBar}
          />
          <ScoreSummary score={opened.score} />
        </>
      )}
    </main>
  );
}
