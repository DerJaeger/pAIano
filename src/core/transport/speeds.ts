/**
 * The tempo steps the app offers, shared so the dropdown and the tempo-up/down
 * commands cannot drift onto different ladders.
 */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5] as const;

/** The next step up from `speed`, or `speed` itself at the top of the ladder. */
export function fasterThan(speed: number): number {
  return SPEEDS.find((step) => step > speed) ?? SPEEDS[SPEEDS.length - 1]!;
}

/** The next step down from `speed`, or `speed` itself at the bottom. */
export function slowerThan(speed: number): number {
  return [...SPEEDS].reverse().find((step) => step < speed) ?? SPEEDS[0];
}
