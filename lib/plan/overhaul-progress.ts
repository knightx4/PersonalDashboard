/**
 * How far an overhaul has come, as the rule counts it is bringing down.
 *
 * An overhaul (plan_items.track = 'overhaul', plan #1511) comes from one spec,
 * and that spec's `## Contract` names the counted rules it brings to target
 * on a line of its own (.claude/skills/plan/reference/overhaul.md):
 *
 *     Rules: R1, R2, R3.
 *
 * Each rule's `Checked by:` line gives its counter, the count when the rule was
 * written and the target. The count now is scripts/spec-baseline.json's,
 * which `npm run check:specs` lowers on every commit that brings it down, so
 * it is the count at the last commit that passed the gate. The plan row shows
 * each as "thread tables 6 to 1: now 4" (plan #1516).
 *
 * Pure: the caller hands over the spec's markdown and the baseline, so a test
 * can hold the reading without the repository's own files. The reading of the
 * files and the database is in overhaul-progress-load.ts.
 */
import { splitSections } from '@/lib/specs/sections';
import { parseRules } from '@/lib/specs/rules';

export type OverhaulCount = {
  /** The rule's number in its spec: R1 is 1. */
  rule: number;
  /** The counter's name in scripts/spec-counts.ts. */
  counter: string;
  /** The counter's name as words: `thread-tables` is "thread tables". */
  label: string;
  /** The count when the rule was written. */
  start: number;
  target: number;
  /** The recorded count at the last commit that passed the gate. */
  now: number;
};

export type OverhaulProgress =
  /** Neither the feature's detail nor a spec change names a spec. */
  | { state: 'no-spec' }
  /** The spec is named, and its file could not be read. */
  | { state: 'missing'; spec: string }
  /** The spec has no `Rules:` line under `## Contract` yet. */
  | { state: 'no-contract'; spec: string }
  /**
   * The Contract names rules. `counts` holds the ones that read as a count
   * with a start, a target and a recorded value; `unread` names the rest
   * (`R4`), which the row says it cannot show rather than leaving out quietly.
   */
  | { state: 'counting'; spec: string; counts: OverhaulCount[]; unread: string[] };

const RULES_LINE = /^Rules:\s*(.*?)\s*\.?\s*$/i;

/**
 * The rule numbers on the Contract's `Rules:` line, in the order written.
 * Null when the spec has no `## Contract` section or no such line in it.
 * A line inside a code fence is an example and is skipped.
 */
export function contractRules(markdown: string): number[] | null {
  const section = splitSections(markdown).find(
    (s) => s.heading.trim().toLowerCase() === 'contract',
  );
  if (!section) return null;
  let fenced = false;
  for (const raw of section.body.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = RULES_LINE.exec(line);
    if (!match) continue;
    return [...match[1].matchAll(/R(\d+)/gi)].map((m) => Number(m[1]));
  }
  return null;
}

/** The overhaul's progress from its spec's markdown and the recorded counts. */
export function overhaulProgress(
  spec: string,
  markdown: string | null,
  baseline: Readonly<Record<string, number>>,
): OverhaulProgress {
  if (markdown === null) return { state: 'missing', spec };
  const numbers = contractRules(markdown);
  if (numbers === null) return { state: 'no-contract', spec };

  const rules = new Map(parseRules(markdown).rules.map((r) => [r.number, r]));
  const counts: OverhaulCount[] = [];
  const unread: string[] = [];
  for (const n of numbers) {
    const check = rules.get(n)?.check;
    const now =
      check?.kind === 'count' && Object.hasOwn(baseline, check.counter)
        ? baseline[check.counter]
        : undefined;
    if (
      check?.kind !== 'count' ||
      check.pending !== undefined ||
      check.baseline === undefined ||
      check.target === undefined ||
      now === undefined
    ) {
      unread.push(`R${n}`);
      continue;
    }
    counts.push({
      rule: n,
      counter: check.counter,
      label: check.counter.replaceAll('-', ' '),
      start: check.baseline,
      target: check.target,
      now,
    });
  }
  return { state: 'counting', spec, counts, unread };
}

/**
 * The spec files an overhaul's detail names, in the order they first appear.
 * A file is named as `docs/SPEC-LAYER-SPEC.md` or as the bare file name.
 */
export function specFilesNamedIn(detail: string | null, files: readonly string[]): string[] {
  if (!detail) return [];
  // Whole names only, so PLAN-SPEC.md is not found inside SOME-PLAN-SPEC.md.
  const at = (file: string) =>
    new RegExp(`(?<![\\w-])${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(detail)?.index ?? -1;
  return files
    .map((file) => ({ file, at: at(file) }))
    .filter((f) => f.at !== -1)
    .sort((a, b) => a.at - b.at)
    .map((f) => f.file);
}

/** One count as the row says it: "thread tables 6 to 1: now 4". */
export function countPhrase(count: OverhaulCount): string {
  return `${count.label} ${count.start} to ${count.target}: now ${count.now}`;
}
