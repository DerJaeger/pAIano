import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writtenPositionAt } from '../core/notation/position';
import type { WrittenPosition } from '../core/notation/types';
import { readMusicXmlSource } from '../core/score/mxl';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import type { Score } from '../core/score/types';
import { DEFAULT_BINDINGS, type Bindings } from '../core/commands/bindings';
import { FileSystemLibrary } from '../adapters/library/fileSystemLibrary';
import { LibrarySidebar } from './LibrarySidebar';
import { useLibrary } from './useLibrary';
import { feedbackHighlights } from './feedback';
import { MidiPanel } from './MidiPanel';
import { PracticePanel } from './PracticePanel';
import { ScoreSummary } from './ScoreSummary';
import { ScoreView } from './ScoreView';
import { ShortcutHelp } from './ShortcutHelp';
import { TransportPanel } from './TransportPanel';
import { openWebMidi } from '../adapters/midi/webMidiAdapter';
import { useMidi, type OpenMidi } from './useMidi';
import { readSetting, writeSetting } from './settings';
import { useCommands } from './useCommands';
import { usePractice, usePracticeState } from './usePractice';
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
  const session = usePractice(opened?.score, transport, midi.input);
  const practice = usePracticeState(session);
  const feedback = useMemo(() => feedbackHighlights(practice.results), [practice.results]);
  // Without an instrument there is no transport, but the score is still worth
  // reading, so browsing bars keeps working on its own.
  const [browsedBar, setBrowsedBar] = useState(0);

  // One port for the life of the app; `restore` re-opens the stored handle.
  const port = useMemo(() => new FileSystemLibrary(), []);
  const library = useLibrary(port);
  const [openPath, setOpenPath] = useState<string | undefined>(undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readSetting('sidebarCollapsed', false),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  // While the finder has the keyboard, a letter is a search term, not a command.
  const [finderFocused, setFinderFocused] = useState(false);

  useEffect(() => {
    void port.restore();
  }, [port]);

  const [helpOpen, setHelpOpen] = useState(false);
  const [bindings, setBindings] = useState<Bindings>(() =>
    readSetting('bindings', DEFAULT_BINDINGS),
  );
  const rebind = useCallback((next: Bindings) => {
    setBindings(next);
    writeSetting('bindings', next);
  }, []);
  // Commands need a transport to drive, so there is nothing to dispatch into
  // until a score is open and an instrument is connected.
  const commandContext = useMemo(
    () =>
      opened && transport
        ? {
            score: opened.score,
            transport,
            onShowHelp: () => {
              setHelpOpen((open) => !open);
            },
            onFindSong: () => {
              setSidebarCollapsed(false);
              // After the render that un-collapses it, or there is no input yet.
              requestAnimationFrame(() => searchRef.current?.focus());
            },
            onToggleSidebar: () => {
              setSidebarCollapsed((collapsed) => {
                writeSetting('sidebarCollapsed', !collapsed);
                return !collapsed;
              });
            },
          }
        : undefined,
    [opened, transport],
  );
  useCommands(commandContext, midi.input, bindings, !helpOpen && !finderFocused);

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

  function openBytes(bytes: Uint8Array, name: string): void {
    setError(undefined);
    setFileName(name);
    setBrowsedBar(0);
    try {
      const musicXml = readMusicXmlSource(bytes);
      setOpened({ score: parseMusicXml(musicXml), musicXml });
    } catch (cause) {
      setOpened(undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function openFile(file: File): Promise<void> {
    openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  }

  /** Opening from the library also records it, which feeds Recent and Most played. */
  async function openFromLibrary(path: string): Promise<void> {
    const bytes = await library.open(path);
    if (bytes) {
      setOpenPath(path);
      openBytes(bytes, path);
    }
  }

  return (
    <main className={`app with-library${sidebarCollapsed ? ' rail' : ''}`}>
      <header>
        <h1>Web PianoBooster</h1>
        <p className="tagline">
          Practise piano with your MIDI keyboard. Everything runs in your browser — your files never
          leave your machine.
        </p>
      </header>

      <LibrarySidebar
        library={library}
        open={(path) => {
          void openFromLibrary(path);
        }}
        onFocusChange={setFinderFocused}
        openPath={openPath}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => {
          setSidebarCollapsed((collapsed) => {
            writeSetting('sidebarCollapsed', !collapsed);
            return !collapsed;
          });
        }}
        searchRef={searchRef}
      />

      <div className="app-main">
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
            <PracticePanel
              score={opened.score}
              session={session}
              practice={practice}
              transport={transport}
              onSeekBar={seekBar}
            />
            <ScoreView
              score={opened.score}
              musicXml={opened.musicXml}
              position={position}
              feedback={feedback}
              input={midi.input}
              onSeekBar={seekBar}
            />
            <ScoreSummary score={opened.score} />
          </>
        )}
      </div>

      {helpOpen && (
        <ShortcutHelp
          bindings={bindings}
          onRebind={rebind}
          onClose={() => {
            setHelpOpen(false);
          }}
        />
      )}
    </main>
  );
}
