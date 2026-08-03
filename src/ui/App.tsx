import { useState } from 'react';
import { readMusicXmlSource } from '../core/score/mxl';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import type { Score } from '../core/score/types';
import { MidiPanel } from './MidiPanel';
import { ScoreSummary } from './ScoreSummary';

/**
 * The shell so far: connect a keyboard (Phase 2) and open a score (Phase 1).
 * The notation view (Phase 3) and transport (Phase 4) land on top of this.
 */
export function App() {
  const [score, setScore] = useState<Score | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string | undefined>(undefined);

  async function openFile(file: File): Promise<void> {
    setError(undefined);
    setFileName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setScore(parseMusicXml(readMusicXmlSource(bytes)));
    } catch (cause) {
      setScore(undefined);
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

      <MidiPanel />

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

      {score && <ScoreSummary score={score} />}
    </main>
  );
}
