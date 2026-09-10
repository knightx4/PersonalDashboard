import baseline from '@/scripts/ui-baseline.json';
import { scopeForFile, UI_SCOPES, type UiScope } from '@/lib/ui-review/scope';

/**
 * What the mechanical gate knows about each module.
 *
 * `npm run check:ui` counts a violation per file per rule and holds the total
 * at or below scripts/ui-baseline.json, so the baseline is the standing count:
 * anything above it fails the push, and anything below it is re-recorded. That
 * makes it the honest number to show beside a module, and it is read at build
 * time rather than by running the gate, which a page cannot do.
 *
 * The number says nothing about whether a module has been looked at. That is
 * the whole reason the review exists: zero here and never reviewed is the
 * common case, not a contradiction.
 */

/** `<rule id> <path>` -> how many of that rule that file is excused. */
const RECORDED = baseline as Record<string, number>;

/** Known violations per scope, with a zero for every scope the gate counts. */
export function violationsByScope(): Record<UiScope, number> {
  const counts = Object.fromEntries(UI_SCOPES.map((scope) => [scope, 0])) as Record<
    UiScope,
    number
  >;

  for (const [key, count] of Object.entries(RECORDED)) {
    // The key is the rule id, a space, then the path -- the shape `tally()`
    // writes in scripts/check-ui.ts.
    const file = key.slice(key.indexOf(' ') + 1);
    counts[scopeForFile(file)] += count;
  }

  return counts;
}
