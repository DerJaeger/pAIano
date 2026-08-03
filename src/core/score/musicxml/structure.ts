import type { TimeSignature } from '../types';

/**
 * The intermediate representation between raw MusicXML and the `Score`:
 * one entry per *written* measure, already converted to global ticks but not
 * yet repeat-expanded and not yet tie-merged.
 */

export interface RawNote {
  /** null for a rest. */
  midiNote: number | null;
  /** Offset from the start of the measure, in global ticks. */
  startTick: number;
  durationTicks: number;
  partId: string;
  staff: number;
  voice: string;
  tieStart: boolean;
  tieStop: boolean;
  xmlId: string;
}

/** Repeat/jump structure carried by a measure's barlines and sound directives. */
export interface MeasureStructure {
  forwardRepeat: boolean;
  backwardRepeat: boolean;
  /** Total number of times the section is played; MusicXML defaults to 2. */
  repeatTimes: number;
  /** Volta numbers this measure starts an ending for, e.g. [1] or [1, 2]. */
  endingStart: number[] | undefined;
  /** This measure carries the end of a volta bracket. */
  endingStop: boolean;
  segno: boolean;
  coda: boolean;
  dacapo: boolean;
  dalsegno: boolean;
  toCoda: boolean;
  fine: boolean;
}

export interface RawMeasure {
  index: number;
  number: string;
  /** Longest content across all parts, in global ticks. */
  durationTicks: number;
  time: TimeSignature;
  keyFifths: number;
  notes: RawNote[];
  /** Tempo directions, at an offset from the start of the measure. */
  tempos: { offsetTicks: number; bpm: number }[];
  structure: MeasureStructure;
}

export function emptyStructure(): MeasureStructure {
  return {
    forwardRepeat: false,
    backwardRepeat: false,
    repeatTimes: 2,
    endingStart: undefined,
    endingStop: false,
    segno: false,
    coda: false,
    dacapo: false,
    dalsegno: false,
    toCoda: false,
    fine: false,
  };
}
