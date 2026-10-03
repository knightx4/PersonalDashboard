/**
 * The motion tokens, for code that times an animation (plan #1549).
 *
 * app/globals.css holds the same values as CSS: the durations as
 * `--motion-instant`, `--motion-quick`, `--motion-move` and `--motion-moment`,
 * and the easings as `--ease-out-soft`, `--ease-spring` and `--ease-sway`.
 * Tailwind gets them as `duration-instant` … `duration-moment` and
 * `ease-out-soft`, `ease-spring`, `ease-sway`. tests/motion-tokens.test.ts
 * fails when the two copies differ, so change both together.
 *
 * Every animation in the app takes its timing from these
 * (docs/UI-QUALITY-SPEC.md, Part 8, rule R7). A duration or easing written
 * out by hand is counted by `raw-motion-values` in scripts/spec-counts.ts,
 * which is held at 0. A longer piece is built from the tokens: the capture
 * flight is a move and a quick together, and a loop runs a whole number of
 * moments, or a simple fraction of them.
 */

/** The four durations, in milliseconds. */
export const MOTION_MS = {
  /** A state flipping: a hint appearing, a colour on hover. */
  instant: 90,
  /** A control answering a press, a hover, a toggle. The default. */
  quick: 160,
  /** Something moving to a new place or size on screen. */
  move: 260,
  /** A designed moment: a ring, a draw-in, a loop's beat. */
  moment: 600,
} as const;

export type MotionSpeed = keyof typeof MOTION_MS;

/**
 * The spring: a lightly damped spring (damping ratio 0.65) sampled into CSS
 * `linear()`. It overshoots by about 7% and is settled by the end of the
 * duration it is given, so it gives a little and stops. Meant for `move` and
 * `moment`; at `quick` the give is too short to see.
 */
export const SPRING_POINTS = [
  0, 0.038, 0.133, 0.26, 0.4, 0.538, 0.665, 0.776, 0.867, 0.939, 0.993, 1.03, 1.053, 1.065, 1.068,
  1.066, 1.059, 1.051, 1.041, 1.032, 1.023, 1.015, 1.009, 1.004, 1,
] as const;

/** The easings, as CSS timing functions. */
export const EASE = {
  /** Fast out of the gate, soft into place. Everything that is not a spring. */
  outSoft: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Into place with a little give. */
  spring: `linear(${SPRING_POINTS.join(', ')})`,
  /** Symmetric, for loops that go and come back: a breath, a pulse. */
  sway: 'cubic-bezier(0.42, 0, 0.58, 1)',
} as const;

/**
 * The spring's progress at `t` (0 to 1), for code that drives a value frame
 * by frame rather than handing CSS the curve: read between the same points
 * CSS `linear()` reads between, so both move the same way.
 */
export function springAt(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const at = t * (SPRING_POINTS.length - 1);
  const i = Math.floor(at);
  const a = SPRING_POINTS[i];
  const b = SPRING_POINTS[i + 1];
  return a + (b - a) * (at - i);
}

/**
 * The capture flight's length: a move and a quick together, since the eye
 * has the whole screen to cross.
 */
export const FLIGHT_MS = MOTION_MS.move + MOTION_MS.quick;
