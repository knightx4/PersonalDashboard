/**
 * A feature session's lines sorted under the steps they are about, for the
 * runner card's open slot.
 *
 * A session writes one stream for its whole feature: claiming a step, sending
 * it to a builder, waiting, merging, running the gate. Read as one list, a
 * night of that is a hundred lines where the step being built is buried. So
 * each line goes under the step it names (`#2124.2`), and a line naming no
 * step goes under the one before it, since it carries on that thought. Lines
 * about running the gate and landing on main go under their own heading once
 * they start, and a line about another feature and none of this one is left
 * out and counted.
 *
 * Inside a step, a line said again straight after itself is drawn once with
 * a count, and a run of files written or edited is drawn as one line naming
 * them.
 *
 * Pure: the card hands it the lines and the plan's steps.
 */
import type { FeatureStep } from '@/lib/digest/night';
import type { RunActivity } from '@/lib/core/run-activities';

/** One drawn line: a line, said `repeats` times in a row, or a run of file changes. */
export type LineGroup = {
  /** The first line of the group, whose id keys it. */
  line: RunActivity;
  /** When the last line of the group was written. */
  at: string;
  /** The id of the last line of the group. */
  lastId: string;
  /** How many times the same line was written in a row. */
  repeats: number;
  /** The files a run of "Writing …" and "Editing …" lines touched, else empty. */
  files: string[];
  /** What a run of file changes reads as: "Wrote 2 files". Null otherwise. */
  summary: string | null;
};

export type StepBucket = {
  /** The step's ref, or 'start' and 'landing' for the two headings that are not steps. */
  key: string;
  ref: string | null;
  title: string;
  status: FeatureStep['status'] | null;
  groups: LineGroup[];
  /** Every line under it, before grouping. */
  count: number;
};

export type FeatureLines = {
  buckets: StepBucket[];
  /** Lines about other features and none of this one, left out. */
  hidden: number;
};

/**
 * A plan ref: `#2124`, `#2124.2`, `#2124.2.1`, or a step written without its
 * hash, as in "build plan step 2124.1". A bare number with no dot is not
 * read as one: it is a count or a year far more often.
 */
const REF = /#(\d+(?:\.\d+)*)(?![\d\w])|(?<![\w.#])(\d{3,}(?:\.\d+)+)(?![\d\w])/g;

/**
 * Plan rows are numbered in the hundreds and thousands. A shorter `#4` is
 * "gate run #4" or a list item, not another feature.
 */
const FEATURE_DIGITS = 3;

/** The lines that finish a feature rather than build a step. */
const LANDING = /\bgate\b|\bmerg\w* (?:the feature |it )?(?:in)?to main\b|\bland(?:s|ed|ing)?\b/i;

/** "Writing lib/you/details.ts" or "Editing tests/x.test.ts", as a session's actions read. */
const FILE_CHANGE = /^(Writing|Editing) (\S+)$/;

const START_TITLE = 'Before the first step';
const LANDING_TITLE = 'Landing the feature';

/** The step a ref belongs to: itself, or the nearest step above it. */
function stepFor(ref: string, known: ReadonlySet<string>): string | null {
  let at = ref;
  while (at.includes('.')) {
    if (known.has(`#${at}`)) return `#${at}`;
    at = at.slice(0, at.lastIndexOf('.'));
  }
  return null;
}

export function featureLines(
  lines: readonly RunActivity[],
  featureRef: string,
  steps: readonly FeatureStep[],
): FeatureLines {
  const feature = featureRef.replace(/^#/, '').split('.')[0];
  const known = new Set(steps.map((step) => step.ref));
  const under = new Map<string, RunActivity[]>();
  const put = (key: string, line: RunActivity) => under.set(key, [...(under.get(key) ?? []), line]);
  let hidden = 0;
  let current = 'start';

  for (const line of lines) {
    const refs = [...line.body.matchAll(REF)].map((match) => match[1] ?? match[2]);
    const mine = refs.filter((ref) => ref.split('.')[0] === feature);
    const step = mine.map((ref) => stepFor(ref, known)).find((found) => found !== null) ?? null;
    if (step) {
      current = step;
    } else if (
      mine.length === 0 &&
      refs.some((ref) => ref.split('.')[0].length >= FEATURE_DIGITS)
    ) {
      hidden += 1;
      continue;
    } else if (LANDING.test(line.body)) {
      current = 'landing';
    }
    put(current, line);
  }

  const bucket = (key: string, ref: string | null, title: string, status: StepBucket['status']) => {
    const held = under.get(key) ?? [];
    return { key, ref, title, status, groups: groupLines(held), count: held.length };
  };
  const buckets: StepBucket[] = [];
  if (under.has('start')) buckets.push(bucket('start', null, START_TITLE, null));
  for (const step of steps) buckets.push(bucket(step.ref, step.ref, step.title, step.status));
  if (under.has('landing')) buckets.push(bucket('landing', null, LANDING_TITLE, null));
  return { buckets, hidden };
}

/** Repeats folded into one line, and runs of file changes into one line naming the files. */
export function groupLines(lines: readonly RunActivity[]): LineGroup[] {
  const groups: LineGroup[] = [];
  const verbs: Set<string>[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    const change = line.kind === 'action' ? FILE_CHANGE.exec(line.body) : null;
    if (last && change && last.files.length > 0) {
      if (!last.files.includes(change[2])) last.files.push(change[2]);
      verbs[verbs.length - 1].add(change[1]);
      last.at = line.created_at;
      last.lastId = line.id;
      last.summary = filesSummary(verbs[verbs.length - 1], last.files.length);
      continue;
    }
    if (
      last &&
      !change &&
      last.files.length === 0 &&
      last.line.kind === line.kind &&
      last.line.body === line.body &&
      line.kind !== 'question' &&
      line.kind !== 'response'
    ) {
      last.repeats += 1;
      last.at = line.created_at;
      last.lastId = line.id;
      continue;
    }
    const files = change ? [change[2]] : [];
    verbs.push(new Set(change ? [change[1]] : []));
    groups.push({
      line,
      at: line.created_at,
      lastId: line.id,
      repeats: 1,
      files,
      summary: change ? filesSummary(verbs[verbs.length - 1], 1) : null,
    });
  }
  return groups;
}

function filesSummary(verbs: ReadonlySet<string>, n: number): string {
  const verb = verbs.size > 1 ? 'Changed' : verbs.has('Writing') ? 'Wrote' : 'Edited';
  return `${verb} ${n === 1 ? '1 file' : `${n} files`}`;
}
