/**
 * What a block may say. A blocked step is listed under what the person has to
 * do, so its ask has to name something they do. A step that only waits on time
 * or on a scheduled run asks nothing of them, and parking it as a block puts a
 * job on their list that has none. It stays in progress with a check-back
 * (scripts/plan.ts check-back), which shows as waiting on.
 *
 * An ask also never names a git branch. Branch deploys are off, so the person
 * cannot open one, and an ask that points at a branch asks them to look at
 * something they cannot see.
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

// Ways an ask names a git branch, matched against the lower-cased ask: a
// branch a session pushed by its name, or a branch spoken of as one.
const NAMES_A_BRANCH: RegExp[] = [
  /(^|[\s(`'"])(claude|origin)\/[\w.-]+/,
  /\bworktree-agent-[\w-]+/,
  /\b(on|in|from|to|onto|the|a|its|this|that|my|your|git|separate|own|work) branch(es)?\b/,
  /\bbranch(es)? (deploys?|previews?|named|called)\b/,
];

export function blockAskNamesBranch(ask: string): boolean {
  const text = ask.toLowerCase().replace(/\s+/g, ' ');
  return NAMES_A_BRANCH.some((pattern) => pattern.test(text));
}

// Ways an ask puts a design check to the person, matched against the
// lower-cased ask: the critic or a design check named, or a screen offered for
// accepting as it is.
const DESIGN_CHECK: RegExp[] = [
  /\b(design )?critic\b/,
  /\bdesign checks?\b/,
  /\baccept\b[^.?]{0,80}\b(as (it|they) (is|are)|as unchanged|as drawn)\b/,
];

/**
 * True for an ask that hands the person a design check. Since 12 October 2026
 * those are not theirs: a screen the critic would not pass after three rounds,
 * or surfaces a shared file reaches that nobody checked, are settled by the
 * session (`npm run ui-guard -- <n> --settle "<why>"`).
 */
export function blockAskIsDesignCheck(ask: string): boolean {
  const text = ask.toLowerCase().replace(/\s+/g, ' ');
  return DESIGN_CHECK.some((pattern) => pattern.test(text));
}

/**
 * The refusal for a block whose ask cannot stand, or null when the ask is
 * fine. Three are refused, whatever the block waits on unless said: an ask
 * that names a git branch; an ask that hands the person a design check; and
 * an ask that says nothing is needed from the person, unless the block waits
 * on other steps (`--on-steps`) and so shows as waiting on them.
 */
export function blockAskRefusal(ask: string, onSteps: boolean): string | null {
  if (blockAskNamesBranch(ask)) {
    return (
      'That ask names a git branch, and the person cannot open branches: branch deploys are ' +
      'off. Show them pictures instead. Merge the gallery drawing to main and link it as ' +
      '/preview?s=<id>, or point at the shots on the step\'s row in /dev/plan. Put the ' +
      'branch in --note, where the next session reads it.'
    );
  }
  if (blockAskIsDesignCheck(ask)) {
    return (
      'That ask puts a design check to the person, and those are not theirs to answer. ' +
      'Settle the surfaces yourself: npm run ui-guard -- <n> --settle "<why>", then merge ' +
      'and close the step with any open fixes in the close note. building.md, "Building a ' +
      'screen", has the rule.'
    );
  }
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
