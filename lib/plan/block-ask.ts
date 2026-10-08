/**
 * What a block may say. A blocked step is listed under what the person has to
 * do, so its ask has to name something they do. A step that only waits on time
 * or on a scheduled run asks nothing of them, and parking it as a block puts a
 * job on their list that has none. It stays in progress with a check-back
 * (scripts/plan.ts check-back), which shows as waiting on.
 */

// Ways an ask says nothing is needed from the person, matched against the
// lower-cased ask.
const NOTHING_NEEDED: RegExp[] = [
  /\bnothing\b[^.]{0,40}\b(needed|required|to do|to decide|to supply|to provide)\b/,
  /\bno (action|input|answer|decision|reply|response)\b[^.]{0,30}\b(needed|required|from you|from the person)\b/,
  /\b(you|the person) (do not|don't|does not|doesn't) (need|have) to\b/,
  /\b(just|only|simply) (waiting|wait|waits)\b/,
  /\bnothing (for you|from you)\b/,
];

export function blockAskSaysNothingNeeded(ask: string): boolean {
  const text = ask.toLowerCase().replace(/\s+/g, ' ');
  return NOTHING_NEEDED.some((pattern) => pattern.test(text));
}

/**
 * The refusal for a block whose ask says nothing is needed from the person,
 * or null when the ask is fine. A block that waits on other steps
 * (`--on-steps`) is not refused here: it shows as waiting on those steps.
 */
export function blockAskRefusal(ask: string, onSteps: boolean): string | null {
  if (onSteps) return null;
  if (!blockAskSaysNothingNeeded(ask)) return null;
  return (
    'That ask says nothing is needed from the person, and a block is listed under what ' +
    'they have to do. If the step only waits on time or a scheduled run, leave it ' +
    'in progress and add a check-back so it shows as waiting on: ' +
    'check-back "<what to look at>" --after 2h --from <n> --detail "what to check and what to do about each answer". ' +
    'Block it only when you can name what the person does.'
  );
}
