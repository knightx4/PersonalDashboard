/**
 * What /dev/specs says about each of a spec's rules: holding, failing, waiting
 * on its check, or a count against its target.
 *
 * The page cannot run the gate. It cannot run vitest, and on the deployed site
 * the repository is not there to measure: the counters walk `app/`, `lib/` and
 * the migrations, none of which is in the server bundle. So the numbers come
 * from scripts/spec-baseline.json, read at build time the way lib/ui-review/
 * gate.ts reads the design-law baseline. `npm run check:specs` writes a fall
 * into that file and fails a rise, so the value in it is the count at the last
 * commit that passed the gate, and the page says so rather than calling it the
 * count now.
 *
 * A named test is shown as holding because the gate runs it and fails the
 * push when it fails. That is all the page can know, and the wording says
 * "the gate runs it" rather than "passes".
 *
 * Pure: the caller hands over the baseline and the registered counters, so a
 * test can hold the wording without the repository's own numbers.
 */
import { ruleProblems, type ParsedRules, type RuleCheck, type SpecRule } from './rules';

export type RuleStateKind = 'holding' | 'failing' | 'pending' | 'audit' | 'counting';

export type RuleState = {
  rule: SpecRule;
  kind: RuleStateKind;
  /** One line saying where the rule stands, for the person to read. Names in backticks are code. */
  summary: string;
  /** The plan step that builds the check, when it is still to be built. */
  pendingStep: number | null;
  /** For a count the baseline has: the recorded value and the target. */
  count: { counter: string; value: number; target: number | null; written: number | null } | null;
  /** What ruleProblems found wrong with this rule, each one sentence. */
  problems: string[];
};

export type RuleStateContext = {
  /** scripts/spec-baseline.json: counter name to its recorded value. */
  baseline: Readonly<Record<string, number>>;
  /** The counters scripts/spec-counts.ts registers, by name, with their targets. */
  counters: ReadonlyMap<string, { target?: number }>;
};

/**
 * Whether a named test file is there, as the page can answer it.
 *
 * ruleProblems asks this to catch a test that is named and missing, or built
 * and still marked pending. The deployed page has no `tests/` to look in, and
 * tests/spec-rules.test.ts asks the same question of the real files in the
 * gate, so a spec on main has already passed it. The answer given here is the
 * one that passed: a named test is there and a pending one is not. Every other
 * problem ruleProblems knows about is still found.
 */
function asTheGateLeftIt(parsed: ParsedRules): (path: string) => boolean {
  const named = new Set(
    parsed.rules.flatMap((r) =>
      r.check?.kind === 'test' && r.check.pending === undefined ? [r.check.path] : [],
    ),
  );
  return (path) => named.has(path);
}

function pendingOf(check: RuleCheck | null): number | null {
  if (!check || check.kind === 'audit') return null;
  return typeof check.pending === 'number' ? check.pending : null;
}

export function ruleStates(parsed: ParsedRules, ctx: RuleStateContext): RuleState[] {
  const problems = ruleProblems(parsed, {
    fileExists: asTheGateLeftIt(parsed),
    counters: ctx.counters,
  });

  return parsed.rules.map((rule): RuleState => {
    const label = `R${rule.number}`;
    const mine = problems.filter((p) => p === label || p.startsWith(`${label} `));
    const check = rule.check;
    const pendingStep = pendingOf(check);
    const base = { rule, pendingStep, count: null, problems: mine };

    if (mine.length > 0 || !check) {
      return { ...base, kind: 'failing', summary: "The gate cannot read this rule's check." };
    }
    if (check.kind === 'audit') {
      return { ...base, kind: 'audit', summary: 'Read by the weekly audit.' };
    }
    if (pendingStep !== null) {
      return { ...base, kind: 'pending', summary: `Its check is still to be built, in #${pendingStep}.` };
    }
    if (check.kind === 'test') {
      return { ...base, kind: 'holding', summary: `Held by \`${check.path}\`, which the gate runs.` };
    }

    const value = Object.hasOwn(ctx.baseline, check.counter) ? ctx.baseline[check.counter] : null;
    if (value === null) {
      return {
        ...base,
        kind: 'failing',
        summary: `\`${check.counter}\` has no recorded count. Running \`npm run check:specs\` records it.`,
      };
    }
    const target = check.target ?? null;
    const count = { counter: check.counter, value, target, written: check.baseline ?? null };
    if (target === null) {
      return { ...base, count, kind: 'holding', summary: `Held at ${value}.` };
    }
    if (value <= target) {
      return { ...base, count, kind: 'holding', summary: `At its target of ${target}.` };
    }
    const fell = count.written !== null && value < count.written ? `, down from ${count.written}` : '';
    return { ...base, count, kind: 'counting', summary: `${value} now${fell}, target ${target}.` };
  });
}
