/**
 * The free Dash tools that do not yet call what their buttons call (plan
 * #2473.1): for each tool, the buttons (as the server action's `file#export`)
 * whose function, named in the tool's `runs` (./runs.ts), the tool does not
 * reach. lib/dash/runs.test.ts holds the list to the code in both
 * directions, so a pair comes off it as soon as it holds.
 *
 * It may only get shorter. The `dash-tools-off-their-button` counter in
 * scripts/spec-counts.ts counts the pairs, and the gate refuses a count that
 * rises: a new write tool starts out calling its button's function, or says
 * why no button does what it does. Steps #2473.2 to #2473.9 worked it down,
 * workspace by workspace, to empty.
 */
export const DRIFTED_BUTTONS: Readonly<Record<string, readonly string[]>> = {};

/** Every listed pair, as `tool file#export`. */
export function driftedPairs(): string[] {
  return Object.entries(DRIFTED_BUTTONS).flatMap(([tool, actions]) => actions.map((action) => `${tool} ${action}`));
}
