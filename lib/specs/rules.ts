/**
 * The rules a spec keeps, read from its `## Rules` section.
 *
 * A rule is one sentence about what is always true of the app, with the check
 * that holds it on the line below (docs/SPEC-LAYER-SPEC.md, Part 1):
 *
 *     **R1.** Every comment thread is stored in `core.conversations`.
 *     Checked by: count `thread-tables`, baseline 6, target 1.
 *
 *     **R2.** Every write Dash makes to the person's rows has a `core.dash_actions` row.
 *     Checked by: test `tests/dash-actions-recorded.test.ts`.
 *
 *     **R3.** A Dash reply says what it could not do instead of guessing.
 *     Checked by: audit.
 *
 *     **R4.** No surface scrolls sideways at 390 pixels.
 *     Checked by: test `tests/interaction/no-sideways-scroll.test.ts`, pending #1537.
 *
 * A test or count whose check is still to be built ends with `pending #N`, N
 * being the plan step that builds it. A pending count may leave out its
 * baseline, since nothing measures it yet.
 *
 * Pure, with no server-only import, so tests/spec-rules.test.ts can hold every
 * spec to it and /dev/specs can list the same rules it checked. Whether a named
 * test or counter exists is a question about the repository, so `ruleProblems`
 * takes what it needs to answer it rather than reading the disk itself.
 */
import { splitSections } from './sections';

/**
 * Set when the check is still to be built: the plan step that builds it, or
 * true when the rule says `pending` without naming one, which `ruleProblems`
 * fails.
 */
export type Pending = number | true;

export type RuleCheck =
  | {
      kind: 'count';
      /** The counter's name in scripts/spec-counts.ts. */
      counter: string;
      /**
       * The count when the rule was written. Not compared with the baseline
       * file. Absent only on a pending count, which nothing measures yet.
       */
      baseline?: number;
      /** Where the rule wants the count to end up; absent when it is only held. */
      target?: number;
      pending?: Pending;
    }
  | {
      kind: 'test';
      /** Repository-relative: `tests/…` or `lib/…`. */
      path: string;
      pending?: Pending;
    }
  | { kind: 'audit' };

export type SpecRule = {
  /** The number after R: `**R3.**` is 3. */
  number: number;
  /** The rule's sentence, as written, without its `**Rn.**` label. */
  sentence: string;
  /** null when the `Checked by:` line is missing or does not parse. */
  check: RuleCheck | null;
  /** The `Checked by:` line as written, for saying what is wrong with it. */
  checkLine: string | null;
};

export type ParsedRules = {
  /** False when the spec has no `## Rules` section at all. */
  hasSection: boolean;
  rules: SpecRule[];
};

const RULE_START = /^\*\*R(\d+)\.\*\*\s*(.*)$/;
const CHECKED_BY = /^Checked by:\s*(.*?)\s*$/i;
const COUNT = /^count\s+`([^`]+)`(?:\s*,\s*baseline\s+(\d+))?(?:\s*,\s*target\s+(\d+))?$/i;
const TEST = /^test\s+`([^`]+)`$/i;
const AUDIT = /^audit$/i;
/** The trailing `, pending #N` of a check still to be built. */
const PENDING = /\s*,\s*pending(?:\s+#(\d+))?$/i;

/** Reads what follows `Checked by:`; null when it is none of the three kinds. */
export function parseCheck(text: string): RuleCheck | null {
  let t = text.trim().replace(/\s*\.$/, '');
  let pending: Pending | undefined;
  const mark = PENDING.exec(t);
  if (mark) {
    pending = mark[1] !== undefined ? Number(mark[1]) : true;
    t = t.slice(0, mark.index);
  }
  const withPending = pending !== undefined ? { pending } : {};

  const count = COUNT.exec(t);
  if (count) {
    return {
      kind: 'count',
      counter: count[1].trim(),
      ...(count[2] !== undefined ? { baseline: Number(count[2]) } : {}),
      ...(count[3] !== undefined ? { target: Number(count[3]) } : {}),
      ...withPending,
    };
  }
  const test = TEST.exec(t);
  if (test) return { kind: 'test', path: test[1].trim(), ...withPending };
  // The audit is never pending: it reads whatever the spec says.
  if (AUDIT.test(t) && pending === undefined) return { kind: 'audit' };
  return null;
}

/**
 * The rules in one spec's markdown.
 *
 * A rule runs from its `**Rn.**` label to the `Checked by:` line, so a sentence
 * that wraps onto a second line is still one sentence. Anything inside a code
 * fence is an example, not a rule, and is skipped, which is also why the
 * example in SPEC-LAYER-SPEC.md is not read as that spec's rules.
 */
export function parseRules(markdown: string): ParsedRules {
  const section = splitSections(markdown).find((s) => s.heading.trim().toLowerCase() === 'rules');
  if (!section) return { hasSection: false, rules: [] };

  const rules: SpecRule[] = [];
  let current: SpecRule | null = null;
  let fenced = false;

  for (const raw of section.body.split('\n')) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const start = RULE_START.exec(line);
    if (start) {
      current = {
        number: Number(start[1]),
        sentence: start[2].trim(),
        check: null,
        checkLine: null,
      };
      rules.push(current);
      continue;
    }
    if (!current) continue;

    const checked = CHECKED_BY.exec(line);
    if (checked && current.checkLine === null) {
      current.checkLine = line;
      current.check = parseCheck(checked[1]);
      continue;
    }
    // A wrapped sentence, until its check line has been read.
    if (line !== '' && current.checkLine === null) {
      current.sentence = `${current.sentence} ${line}`.trim();
    }
  }

  return { hasSection: true, rules };
}

/** What `ruleProblems` needs to know about the repository. */
export type RuleContext = {
  /** True when a repository-relative file exists. */
  fileExists: (path: string) => boolean;
  /** The registered counters, by name, with their targets. */
  counters: ReadonlyMap<string, { target?: number }>;
};

/**
 * Everything wrong with one spec's rules, each a sentence naming the rule.
 *
 * Empty when every rule names a check that exists: a test file under `tests/`
 * or `lib/` that vitest runs, a counter scripts/spec-counts.ts defines with the
 * same target, or the audit. A pending check passes while it is missing, as
 * long as it names the plan step that builds it, and fails once it exists, so
 * the step that builds it also takes the mark off.
 */
export function ruleProblems(parsed: ParsedRules, ctx: RuleContext): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();

  for (const rule of parsed.rules) {
    const label = `R${rule.number}`;
    if (seen.has(rule.number)) problems.push(`${label} is numbered twice.`);
    seen.add(rule.number);

    if (rule.sentence === '') problems.push(`${label} has no sentence.`);

    if (rule.checkLine === null) {
      problems.push(`${label} has no "Checked by:" line.`);
      continue;
    }
    const check = rule.check;
    if (!check) {
      problems.push(
        `${label} has a check that is not a count, a test or the audit: "${rule.checkLine}".`,
      );
      continue;
    }

    if (check.kind === 'audit') continue;

    const pending = check.pending;
    if (pending === true) {
      problems.push(`${label} is pending without the plan step that builds its check.`);
      continue;
    }

    if (check.kind === 'test') {
      if (!/^(tests|lib)\/.+\.test\.tsx?$/.test(check.path)) {
        problems.push(
          `${label} names ${check.path}, which is not a .test.ts or .test.tsx file under tests/ or lib/, so vitest does not run it.`,
        );
      } else if (pending !== undefined) {
        if (ctx.fileExists(check.path)) {
          problems.push(
            `${label} is pending on #${pending}, and ${check.path} exists; take the pending mark off.`,
          );
        }
      } else if (!ctx.fileExists(check.path)) {
        problems.push(`${label} names the test ${check.path}, which does not exist.`);
      }
    } else {
      const counter = ctx.counters.get(check.counter);
      if (pending !== undefined) {
        if (counter) {
          problems.push(
            `${label} is pending on #${pending}, and scripts/spec-counts.ts defines ${check.counter}; take the pending mark off and give its baseline.`,
          );
        }
      } else if (check.baseline === undefined) {
        problems.push(
          `${label} gives ${check.counter} no baseline, which only a pending count may leave out.`,
        );
      } else if (!counter) {
        problems.push(
          `${label} names the counter ${check.counter}, which scripts/spec-counts.ts does not define.`,
        );
      } else if (counter.target !== check.target) {
        problems.push(
          `${label} gives ${check.counter} a target of ${check.target ?? 'none'}, and the counter's is ${counter.target ?? 'none'}.`,
        );
      }
    }
  }

  return problems;
}
