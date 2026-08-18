/**
 * Finding a piece by typing a little of what you remember about it.
 *
 * Matching is on **subsequences, not substrings**, so `bmin inv` finds
 * `Bach/Inventions/Invention 15 in B minor.musicxml` — the way you actually
 * remember a piece is a few letters from the title and a few from the folder,
 * rarely in one run.
 *
 * A term is matched by trying **every** place its first letter occurs and
 * greedily completing from there, keeping whichever landing scores best. The
 * earliest landing is usually the wrong one — `noct` against
 * `Chopin/Nocturne.musicxml` would otherwise take the `n` of "Chopin" and
 * highlight `n`…`oct` rather than `Noct`.
 *
 * Completion after that first letter is still greedy, so the result is good
 * rather than provably optimal. That trade is deliberate: a library is a few
 * hundred short paths, and a rule you can follow beats one you cannot.
 */

/** Half-open `[from, to)` offsets into the path, merged into runs. */
export type Range = readonly [number, number];

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches on the same query. */
  score: number;
  /** Where the query landed, in order, for highlighting. */
  ranges: readonly Range[];
}

export interface RankedPath extends FuzzyMatch {
  path: string;
}

/** Characters after which a new word begins. */
const BOUNDARIES = new Set([' ', '/', '\\', '_', '-', '.', '(', '[']);

const CONSECUTIVE_BONUS = 8;
const BOUNDARY_BONUS = 10;
const FILENAME_BONUS = 4;
/** Small, so it only breaks ties between otherwise equal matches. */
const EARLINESS_WEIGHT = 0.1;
const LENGTH_WEIGHT = 0.05;

/**
 * Scores `query` against `path`, or `undefined` if it does not match at all.
 *
 * Whitespace splits the query into terms, each matched independently anywhere
 * in the path, so word order does not matter: `bmin inv` and `inv bmin` both
 * find the same piece.
 */
export function fuzzyMatch(query: string, path: string): FuzzyMatch | undefined {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  // An empty query matches everything: the finder opens showing your library,
  // not an empty list waiting to be earned.
  if (terms.length === 0) return { score: 0, ranges: [] };

  const haystack = path.toLowerCase();
  const fileNameStart = path.lastIndexOf('/') + 1;
  const hits: number[] = [];
  let score = 0;

  for (const term of terms) {
    const best = bestMatch(term, haystack, path, fileNameStart);
    if (!best) return undefined;
    score += best.score;
    hits.push(...best.positions);
  }

  score -= path.length * LENGTH_WEIGHT;
  return { score, ranges: toRanges(hits) };
}

/** Ranks paths best first, dropping the ones that do not match. */
export function rankPaths(query: string, paths: readonly string[]): RankedPath[] {
  const hits: RankedPath[] = [];
  for (const path of paths) {
    const match = fuzzyMatch(query, path);
    if (match) hits.push({ path, ...match });
  }
  // Path as the tie-break so the order never wobbles between keystrokes.
  return hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

/**
 * The best landing for `term`: every occurrence of its first letter is tried as
 * a starting point, and the highest-scoring completion wins.
 */
function bestMatch(
  term: string,
  haystack: string,
  path: string,
  fileNameStart: number,
): { positions: number[]; score: number } | undefined {
  let best: { positions: number[]; score: number } | undefined;

  for (
    let start = haystack.indexOf(term[0]!);
    start !== -1;
    start = haystack.indexOf(term[0]!, start + 1)
  ) {
    const positions = completeFrom(term, haystack, start);
    // No completion from here means none from any later start either: the
    // remaining letters simply are not there in order.
    if (!positions) break;
    const score = scoreOf(positions, path, fileNameStart);
    if (!best || score > best.score) best = { positions, score };
  }

  return best;
}

/** Greedy earliest match for the rest of `term`, with its first letter at `start`. */
function completeFrom(term: string, haystack: string, start: number): number[] | undefined {
  const positions = [start];
  let at = start + 1;
  for (const letter of term.slice(1)) {
    const found = haystack.indexOf(letter, at);
    if (found === -1) return undefined;
    positions.push(found);
    at = found + 1;
  }
  return positions;
}

function scoreOf(positions: readonly number[], path: string, fileNameStart: number): number {
  let score = 0;
  for (const [index, at] of positions.entries()) {
    if (index > 0 && at === positions[index - 1]! + 1) score += CONSECUTIVE_BONUS;
    if (at === 0 || BOUNDARIES.has(path[at - 1]!)) score += BOUNDARY_BONUS;
    if (at >= fileNameStart) score += FILENAME_BONUS;
  }
  return score - positions[0]! * EARLINESS_WEIGHT;
}

/** Adjacent hits collapse into one run, so highlighting is per word not per letter. */
function toRanges(hits: readonly number[]): Range[] {
  const sorted = [...new Set(hits)].sort((a, b) => a - b);
  const ranges: Range[] = [];
  for (const at of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === at) ranges[ranges.length - 1] = [last[0], at + 1];
    else ranges.push([at, at + 1]);
  }
  return ranges;
}
