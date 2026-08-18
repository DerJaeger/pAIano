import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writtenPositionAt } from '../core/notation/position';
import type { WrittenPosition } from '../core/notation/types';
import { readMusicXmlSource } from '../core/score/mxl';
import { parseMusicXml } from '../core/score/musicxml/parseMusicXml';
import type { Score } from '../core/score/types';
import { DEFAULT_BINDINGS, type Bindings } from '../core/commands/bindings';
import { FileSystemLibrary } from '../adapters/library/fileSystemLibrary';
import { LibraryPalette } from './LibraryPalette';
import { useLibrary } from './useLibrary';
import { feedbackHighlights } from './feedback';
import { MidiPanel } from './MidiPanel';
import { PracticePanel } from './PracticePanel';
import { ScoreSummary } from './ScoreSummary';
import { ScoreView } from './ScoreView';
import { ShortcutHelp } from './ShortcutHelp';
import { TransportPanel } from './TransportPanel';
import { openWebMidi } from '../adapters/midi/webMidiAdapter';
import type { LibraryPort } from '../core/library/port';
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
export function App({
  open = openWebMidi,
  library: libraryPort,
}: { open?: OpenMidi; library?: LibraryPort } = {}) {
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
  // Injectable so tests can drive the library without a real file system.
  const port = useMemo(() => libraryPort ?? new FileSystemLibrary(), [libraryPort]);
  const library = useLibrary(port);
  // The overlay owns the keyboard while it is up, so shortcuts stand down.
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Pick up where you left off. It waits for the folder to be readable, which
  // on a cold start means after the one Reconnect click — the file simply
  // cannot be read before then, so there is nothing to do earlier.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || library.access !== 'granted') return;
    const last = readSetting<string | undefined>('lastScorePath', undefined);
    if (last === undefined || !library.catalog.entries.some((entry) => entry.path === last)) return;
    restoredRef.current = true;
    void openFromLibrary(last);
    // Only a change of access or of what is in the catalog can make this newly
    // possible; `openFromLibrary` is stable enough and re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.access, library.catalog.entries]);

  // One play per piece per session it actually ran in — not per click. An hour
  // of restarts on one bar is one play; browsing the library is none.
  const countedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!transport) return;
    const path = fileName;
    return transport.onChange(() => {
      if (path === undefined || countedRef.current === path) return;
      if (transport.getState() !== 'playing') return;
      countedRef.current = path;
      library.markPlayed(path);
    });
  }, [transport, fileName, library]);

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
  // Always present. The library and cheat-sheet commands have to work before
  // anything is open — that is when you reach for them — and the rest are
  // no-ops without a score, which `runCommand` handles.
  const commandContext = useMemo(
    () => ({
      score: opened?.score,
      transport,
      onShowHelp: () => {
        setHelpOpen((open) => !open);
      },
      onFindSong: () => {
        setLibraryOpen((open) => !open);
      },
    }),
    [opened, transport],
  );
  useCommands(commandContext, midi.input, bindings, !helpOpen && !libraryOpen);

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
      openBytes(bytes, path);
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
        <button
          type="button"
          className="button"
          onClick={() => {
            setLibraryOpen(true);
          }}
        >
          Open a piece <kbd>Alt</kbd>+<kbd>P</kbd>
        </button>
      </header>

      <MidiPanel connection={midi} />

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
      {libraryOpen && (
        <LibraryPalette
          library={library}
          onOpen={(path) => {
            void openFromLibrary(path);
          }}
          onOpenFile={(file) => {
            void openFile(file);
          }}
          onClose={() => {
            setLibraryOpen(false);
          }}
        />
      )}

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
