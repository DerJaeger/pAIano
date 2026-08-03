import type { MeasureStructure } from './structure';

export interface ExpandedStep {
  measureIndex: number;
  /** 0 the first time this measure is played, 1 the second, etc. */
  pass: number;
}

/** Safety net: a malformed jump structure must fail loudly, not hang the app. */
const MAX_EXPANSION_FACTOR = 64;

/**
 * Unrolls repeats, voltas and D.C./D.S./Coda jumps into a flat play order.
 *
 * The rules implemented, which is what engraved piano music actually uses:
 *  - `|:` … `:|` repeats, honouring `times`, falling back to the start of the
 *    piece when there is no matching forward repeat.
 *  - Voltas: a measure starting an ending is skipped (together with the rest of
 *    its bracket) unless the current repetition number is listed.
 *  - D.C. / D.S. jump once and are then played *without* repeats, honouring
 *    `Fine` and `To Coda` only on that final pass — the standard convention.
 */
export function expandRepeats(measures: readonly MeasureStructure[]): ExpandedStep[] {
  const order: ExpandedStep[] = [];
  const limit = Math.max(measures.length * MAX_EXPANSION_FACTOR, 64);
  const passCounts = new Map<number, number>();
  const backwardTaken = new Map<number, number>();

  const segnoIndex = measures.findIndex((m) => m.segno);
  const codaIndex = measures.findIndex((m) => m.coda);

  let i = 0;
  let sectionStart = 0;
  let sectionPass = 1;
  /** True once a D.C./D.S. has been taken: repeats are no longer observed. */
  let afterJump = false;
  let jumpsTaken = 0;

  while (i >= 0 && i < measures.length) {
    if (order.length > limit) {
      throw new Error(
        `Repeat expansion did not terminate after ${limit} measures — the score's repeat structure is malformed`,
      );
    }
    const measure = measures[i]!;

    if (measure.forwardRepeat && sectionStart !== i) {
      sectionStart = i;
      sectionPass = 1;
    }

    // A volta bracket we are not on the right repetition for: skip the whole
    // bracket and re-test whatever ending follows it.
    if (
      !afterJump &&
      measure.endingStart !== undefined &&
      !measure.endingStart.includes(sectionPass)
    ) {
      i = endOfEndingBracket(measures, i) + 1;
      continue;
    }

    const pass = passCounts.get(i) ?? 0;
    passCounts.set(i, pass + 1);
    order.push({ measureIndex: i, pass });

    if (afterJump && measure.fine) break;
    if (afterJump && measure.toCoda && codaIndex >= 0) {
      i = codaIndex;
      continue;
    }

    if (!afterJump && measure.backwardRepeat) {
      const taken = backwardTaken.get(i) ?? 0;
      if (taken < measure.repeatTimes - 1) {
        backwardTaken.set(i, taken + 1);
        sectionPass++;
        i = sectionStart;
        continue;
      }
    }

    if (!afterJump && jumpsTaken === 0 && (measure.dacapo || measure.dalsegno)) {
      jumpsTaken++;
      afterJump = true;
      i = measure.dalsegno && segnoIndex >= 0 ? segnoIndex : 0;
      continue;
    }

    i++;
  }

  return order;
}

/**
 * The last measure of the volta bracket starting at `start`. A bracket that is
 * never closed runs to the end of the section rather than the end of the piece.
 */
function endOfEndingBracket(measures: readonly MeasureStructure[], start: number): number {
  for (let i = start; i < measures.length; i++) {
    const measure = measures[i]!;
    if (measure.endingStop || measure.backwardRepeat) return i;
    // Another ending starting means the previous bracket was left open.
    if (i > start && measure.endingStart !== undefined) return i - 1;
  }
  return measures.length - 1;
}
