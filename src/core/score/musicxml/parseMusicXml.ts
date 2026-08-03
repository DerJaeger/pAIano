import {
  attr,
  child,
  childNumber,
  childText,
  children,
  childrenOf,
  descendants,
  has,
  nameOf,
  numAttr,
  parseXml,
  textOf,
  type XmlNode,
} from '../../xml/xml';
import { PiecewiseTempoMap } from '../tempoMap';
import type { Hand, Measure, NoteEvent, Part, PlaybackStep, Score, TimeSignature } from '../types';
import { expandRepeats } from './repeats';
import { emptyStructure, type MeasureStructure, type RawMeasure, type RawNote } from './structure';

const DEFAULT_TIME: TimeSignature = { beats: 4, beatType: 4 };
const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Ticks-per-quarter is derived from the file, but kept in a sane range. */
const MIN_TICKS_PER_QUARTER = 96;
const MAX_TICKS_PER_QUARTER = 30720;

/**
 * Parses a MusicXML document (score-partwise) into the `Score` model.
 *
 * Known limitations, each deliberate for now: grace notes are dropped (they
 * carry no duration), and ornaments are not realised — we play what is written.
 */
export function parseMusicXml(source: string): Score {
  const root = parseXml(source)[0];
  if (root === undefined || nameOf(root) !== 'score-partwise') {
    // score-timewise is vanishingly rare in the wild and MuseScore never emits it.
    throw new Error(
      `Unsupported document: expected a <score-partwise> root, got <${root === undefined ? 'nothing' : (nameOf(root) ?? '?')}>`,
    );
  }

  const ticksPerQuarter = chooseTicksPerQuarter(root);
  const partNodes = children(root, 'part');
  if (partNodes.length === 0) throw new Error('Score contains no parts');

  const partNames = readPartNames(root);
  const parts: Part[] = [];
  const measures: RawMeasure[] = [];

  for (const partNode of partNodes) {
    const partId = attr(partNode, 'id') ?? `P${parts.length + 1}`;
    const staffCount = readPart(partNode, partId, ticksPerQuarter, measures);
    parts.push({
      id: partId,
      name: partNames.get(partId) ?? partId,
      staffCount,
      hands: handMap(staffCount),
    });
  }

  return assemble(readTitle(root), parts, measures, ticksPerQuarter);
}

/**
 * Reads one part into the shared `measures` accumulator, returning its staff
 * count. Measures are keyed by index, so parts merge into the same bars.
 */
function readPart(
  partNode: XmlNode,
  partId: string,
  ticksPerQuarter: number,
  measures: RawMeasure[],
): number {
  let divisions = 1;
  let time = DEFAULT_TIME;
  let keyFifths = 0;
  let staffCount = 1;
  let transposeSemitones = 0;
  let noteCounter = 0;

  children(partNode, 'measure').forEach((measureNode, measureIndex) => {
    const measure = (measures[measureIndex] ??= {
      index: measureIndex,
      number: attr(measureNode, 'number') ?? String(measureIndex + 1),
      durationTicks: 0,
      time,
      keyFifths,
      notes: [],
      tempos: [],
      structure: emptyStructure(),
    });

    const toTicks = (durationDivisions: number): number =>
      Math.round((durationDivisions * ticksPerQuarter) / divisions);

    let cursor = 0;
    let lastNoteStart = 0;
    let maxCursor = 0;

    for (const node of childrenOf(measureNode)) {
      switch (nameOf(node)) {
        case 'attributes': {
          divisions = childNumber(node, 'divisions') ?? divisions;
          staffCount = Math.max(staffCount, childNumber(node, 'staves') ?? 1);
          const keyNode = child(node, 'key');
          if (keyNode) keyFifths = childNumber(keyNode, 'fifths') ?? keyFifths;
          const timeNode = child(node, 'time');
          if (timeNode) {
            time = {
              beats: childNumber(timeNode, 'beats') ?? time.beats,
              beatType: childNumber(timeNode, 'beat-type') ?? time.beatType,
            };
          }
          const transposeNode = child(node, 'transpose');
          if (transposeNode) {
            transposeSemitones =
              (childNumber(transposeNode, 'chromatic') ?? 0) +
              12 * (childNumber(transposeNode, 'octave-change') ?? 0);
          }
          // Attributes may appear mid-measure; the first one wins for display.
          if (measure.notes.length === 0) {
            measure.time = time;
            measure.keyFifths = keyFifths;
          }
          break;
        }
        case 'note': {
          const note = readNote(node, {
            partId,
            measureIndex,
            noteIndex: noteCounter++,
            transposeSemitones,
            toTicks,
            cursor,
            lastNoteStart,
          });
          if (note === undefined) break; // grace note or otherwise durationless
          if (note.midiNote !== null) measure.notes.push(note);
          if (!isChordNote(node)) {
            lastNoteStart = cursor;
            cursor += note.durationTicks;
          }
          maxCursor = Math.max(maxCursor, cursor);
          break;
        }
        case 'backup':
          cursor = Math.max(0, cursor - toTicks(childNumber(node, 'duration') ?? 0));
          break;
        case 'forward':
          cursor += toTicks(childNumber(node, 'duration') ?? 0);
          maxCursor = Math.max(maxCursor, cursor);
          break;
        case 'direction':
          readSound(node, measure, cursor);
          break;
        case 'sound':
          applySound(node, measure, cursor);
          break;
        case 'barline':
          readBarline(node, measure.structure);
          break;
        default:
          break;
      }
    }

    measure.durationTicks = Math.max(measure.durationTicks, maxCursor);
  });

  return staffCount;
}

interface NoteContext {
  partId: string;
  measureIndex: number;
  noteIndex: number;
  transposeSemitones: number;
  toTicks: (divisions: number) => number;
  cursor: number;
  lastNoteStart: number;
}

function readNote(node: XmlNode, context: NoteContext): RawNote | undefined {
  if (has(node, 'grace')) return undefined;
  const durationDivisions = childNumber(node, 'duration');
  if (durationDivisions === undefined) return undefined;

  const isChord = isChordNote(node);
  const pitchNode = child(node, 'pitch') ?? child(node, 'unpitched');
  const midiNote =
    pitchNode && !has(node, 'rest') ? pitchToMidi(pitchNode) + context.transposeSemitones : null;

  const ties = children(node, 'tie').map((tie) => attr(tie, 'type'));
  const notations = child(node, 'notations');
  const tied = notations ? descendants(notations, 'tied').map((t) => attr(t, 'type')) : [];
  const tieTypes = [...ties, ...tied];

  return {
    midiNote,
    startTick: isChord ? context.lastNoteStart : context.cursor,
    durationTicks: context.toTicks(durationDivisions),
    partId: context.partId,
    staff: childNumber(node, 'staff') ?? 1,
    voice: childText(node, 'voice') ?? '1',
    tieStart: tieTypes.includes('start'),
    tieStop: tieTypes.includes('stop'),
    xmlId:
      attr(node, 'id') ??
      `${context.partId}-m${context.measureIndex}-n${String(context.noteIndex)}`,
  };
}

function isChordNote(node: XmlNode): boolean {
  return has(node, 'chord');
}

function pitchToMidi(pitchNode: XmlNode): number {
  const step = (childText(pitchNode, 'step') ?? 'C').toUpperCase();
  const octave = childNumber(pitchNode, 'octave') ?? 4;
  const alter = childNumber(pitchNode, 'alter') ?? 0;
  const semitone = STEP_SEMITONES[step];
  if (semitone === undefined) throw new Error(`Unknown pitch step "${step}"`);
  return (octave + 1) * 12 + semitone + alter;
}

function readSound(directionNode: XmlNode, measure: RawMeasure, cursor: number): void {
  for (const sound of children(directionNode, 'sound')) applySound(sound, measure, cursor);
}

function applySound(sound: XmlNode, measure: RawMeasure, cursor: number): void {
  const tempo = numAttr(sound, 'tempo');
  if (tempo !== undefined && tempo > 0) {
    const duplicate = measure.tempos.some((t) => t.offsetTicks === cursor && t.bpm === tempo);
    if (!duplicate) measure.tempos.push({ offsetTicks: cursor, bpm: tempo });
  }
  const structure = measure.structure;
  if (isYes(attr(sound, 'dacapo'))) structure.dacapo = true;
  if (attr(sound, 'dalsegno') !== undefined) structure.dalsegno = true;
  if (attr(sound, 'segno') !== undefined) structure.segno = true;
  if (attr(sound, 'coda') !== undefined) structure.coda = true;
  if (attr(sound, 'tocoda') !== undefined) structure.toCoda = true;
  if (isYes(attr(sound, 'fine'))) structure.fine = true;
}

function isYes(value: string | undefined): boolean {
  return value !== undefined && value !== 'no';
}

function readBarline(node: XmlNode, structure: MeasureStructure): void {
  const repeat = child(node, 'repeat');
  if (repeat) {
    const direction = attr(repeat, 'direction');
    if (direction === 'forward') structure.forwardRepeat = true;
    if (direction === 'backward') {
      structure.backwardRepeat = true;
      const times = numAttr(repeat, 'times');
      if (times !== undefined && times >= 2) structure.repeatTimes = times;
    }
  }
  const ending = child(node, 'ending');
  if (ending) {
    const type = attr(ending, 'type');
    if (type === 'start') {
      structure.endingStart = (attr(ending, 'number') ?? '1')
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n));
    } else if (type === 'stop' || type === 'discontinue') {
      structure.endingStop = true;
    }
  }
}

/**
 * Picks a ticks-per-quarter that represents every `<divisions>` value in the
 * file exactly, so tuplets and dotted rhythms never accumulate rounding error.
 */
function chooseTicksPerQuarter(root: XmlNode): number {
  const values = descendants(root, 'divisions')
    .map((node) => Number(textOf(node)))
    .filter((value) => Number.isInteger(value) && value > 0);

  let ppq = values.reduce<number>((acc, value) => lcm(acc, value), 1);
  if (ppq > MAX_TICKS_PER_QUARTER) return MAX_TICKS_PER_QUARTER;
  // Scale up by a whole factor so ticks stay exact but usefully fine-grained.
  const factor = Math.max(1, Math.ceil(MIN_TICKS_PER_QUARTER / ppq));
  ppq *= factor;
  return Math.min(ppq, MAX_TICKS_PER_QUARTER);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function readTitle(root: XmlNode): string {
  const work = child(root, 'work');
  const workTitle = work ? childText(work, 'work-title') : undefined;
  if (workTitle) return workTitle;
  const credit = children(root, 'credit')[0];
  const creditWords = credit ? childText(credit, 'credit-words') : undefined;
  return creditWords ?? 'Untitled';
}

function readPartNames(root: XmlNode): Map<string, string> {
  const names = new Map<string, string>();
  const partList = child(root, 'part-list');
  if (!partList) return names;
  for (const scorePart of children(partList, 'score-part')) {
    const id = attr(scorePart, 'id');
    if (id !== undefined) names.set(id, childText(scorePart, 'part-name') ?? id);
  }
  return names;
}

/** Staff 1 is the right hand, staff 2 the left — the piano-score convention. */
function handMap(staffCount: number): ReadonlyMap<number, Hand> {
  const hands = new Map<number, Hand>();
  for (let staff = 1; staff <= staffCount; staff++) {
    hands.set(staff, staff === 1 ? 'right' : 'left');
  }
  return hands;
}

/** Turns written measures into the expanded, tie-merged, timed `Score`. */
function assemble(
  title: string,
  parts: Part[],
  rawMeasures: RawMeasure[],
  ticksPerQuarter: number,
): Score {
  // A measure with no content at all still occupies its notated length.
  const fallbackLength = (measure: RawMeasure): number =>
    Math.round((measure.time.beats * 4 * ticksPerQuarter) / measure.time.beatType);

  const measures: Measure[] = [];
  let writtenTick = 0;
  for (const raw of rawMeasures) {
    const durationTicks = raw.durationTicks > 0 ? raw.durationTicks : fallbackLength(raw);
    measures.push({
      index: raw.index,
      number: raw.number,
      startTick: writtenTick,
      durationTicks,
      time: raw.time,
      keyFifths: raw.keyFifths,
    });
    writtenTick += durationTicks;
  }

  const playbackOrder: PlaybackStep[] = [];
  let expandedTick = 0;
  for (const step of expandRepeats(rawMeasures.map((m) => m.structure))) {
    const durationTicks = measures[step.measureIndex]!.durationTicks;
    playbackOrder.push({ ...step, startTick: expandedTick, durationTicks });
    expandedTick += durationTicks;
  }

  const events = flattenEvents(rawMeasures, playbackOrder);
  const tempoChanges = playbackOrder.flatMap((step) =>
    rawMeasures[step.measureIndex]!.tempos.map((tempo) => ({
      tick: step.startTick + tempo.offsetTicks,
      bpm: tempo.bpm,
    })),
  );

  return {
    title,
    parts,
    measures,
    playbackOrder,
    tempoMap: new PiecewiseTempoMap(ticksPerQuarter, tempoChanges),
    events,
    ticksPerQuarter,
    durationTicks: expandedTick,
  };
}

/**
 * Emits one `NoteEvent` per sounding note on the expanded timeline, merging
 * tied notes into a single held event.
 */
function flattenEvents(
  rawMeasures: readonly RawMeasure[],
  playbackOrder: readonly PlaybackStep[],
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const openTies = new Map<string, NoteEvent>();

  for (const step of playbackOrder) {
    const raw = rawMeasures[step.measureIndex]!;
    const ordered = [...raw.notes].sort((a, b) => a.startTick - b.startTick);
    for (const note of ordered) {
      if (note.midiNote === null) continue;
      const key = `${note.partId}|${note.staff}|${note.voice}|${note.midiNote}`;
      const startTick = step.startTick + note.startTick;
      const open = openTies.get(key);

      if (note.tieStop && open !== undefined) {
        open.durationTicks = startTick + note.durationTicks - open.startTick;
        if (!note.tieStart) openTies.delete(key);
        continue;
      }

      const event: NoteEvent = {
        midiNote: note.midiNote,
        startTick,
        durationTicks: note.durationTicks,
        partId: note.partId,
        staff: note.staff,
        voice: note.voice,
        measureIndex: step.measureIndex,
        pass: step.pass,
        xmlId: note.xmlId,
      };
      events.push(event);
      if (note.tieStart) openTies.set(key, event);
      else openTies.delete(key);
    }
  }

  events.sort((a, b) => a.startTick - b.startTick || a.midiNote - b.midiNote);
  return events;
}
