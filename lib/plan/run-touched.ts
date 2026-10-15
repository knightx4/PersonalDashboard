/**
 * What one plan run touched, for its page (plan #1964.2.4).
 *
 * A plan run keeps no table of the rows it changed, the way a goal run has
 * goals.history. What it does leave is evidence: the step it was sent at,
 * the steps beneath that step which closed while it was going, the lines it
 * wrote (which name steps by outline and link to pages), and the commits it
 * reported and pushed, whose subjects end with the step they built. This
 * reads all four into one list of rows, each with the reason it is there,
 * so the page can link every one.
 *
 * Pure, so the rules are tested without a database: the page reads the run,
 * its lines and the plan's rows, and hands them here.
 */
import { linkParts, isAppPath } from '@/lib/goals/result-links';
import { planRefHref, splitOnRefs, type RefReading } from '@/lib/comments/refs';
import { RUN_JOB_LABEL, type RunJob } from './run-end';

/** Where a plan run's own page is. */
export function planRunHref(runId: string): string {
  return `/dev/plan/runs/${runId}`;
}

/** "A step run" read as a name: "Step run". A job no label knows is "Run". */
export function planRunTitle(job: unknown): string {
  const label = (RUN_JOB_LABEL[job as RunJob] ?? 'A run').replace(/^an? /i, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** A plan row as this needs it: where it sits, what it is called, how it stands. */
export type TouchStep = {
  id: string;
  number: number;
  /** "1964.2.4", as the plan heads the row; null when no tree placed it. */
  outline: string | null;
  parentId: string | null;
  title: string;
  status: string;
  completedAt: string | null;
};

/** Why a row is on the list, in the words the page shows under it. */
export type TouchReason = 'sent' | 'closed' | 'named' | 'commit' | 'linked';

export const TOUCH_REASON_LABEL: Record<TouchReason, string> = {
  sent: 'Sent at',
  closed: 'Closed during the run',
  named: 'Named in its lines',
  commit: 'Named by a commit',
  linked: 'Linked in its lines',
};

export type TouchedRow =
  | { kind: 'step'; key: string; href: string; step: TouchStep; reason: TouchReason }
  | { kind: 'page'; key: string; href: string; title: string; reason: 'linked' };

/** A commit the run reported or pushed. */
export type TouchedCommit = { sha: string; subject: string | null };

export type RunTouched = { rows: TouchedRow[]; commits: TouchedCommit[] };

/** A line as this reads it: what kind, and what it says. */
export type TouchLine = { kind: string; body: string };

/** `Committed 4be1c09: the subject`, the line `plan.ts activity` is told to write after each commit. */
const COMMITTED = /\bcommitted\s+([0-9a-f]{7,40})\b[:\s-]*([^\n]*)/gi;

function time(iso: string | null | undefined): number {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : NaN;
}

/** The step's own page, by outline where it has one, as the plan names it. */
function stepHref(step: TouchStep): string {
  return planRefHref(step.outline ?? step.number);
}

/** The steps a text names, by outline and (when `reading` is `all`) by number. */
function namedSteps(
  text: string,
  reading: RefReading,
  byOutline: ReadonlyMap<string, TouchStep>,
  byNumber: ReadonlyMap<number, TouchStep>,
): TouchStep[] {
  const found: TouchStep[] = [];
  for (const part of splitOnRefs(text, undefined, reading)) {
    const step = part.outline
      ? byOutline.get(part.outline)
      : part.ref !== null
        ? byNumber.get(part.ref)
        : undefined;
    if (step) found.push(step);
  }
  return found;
}

/** Whether `a` and `b` name the same commit, one perhaps abbreviated. */
export function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

export function runTouched(input: {
  run: {
    planItemId: string | null;
    createdAt: string;
    /** When the run ended, or null while it is going. */
    endedAt: string | null;
    lastPush: { sha: string | null; subject: string | null } | null;
  };
  lines: readonly TouchLine[];
  steps: readonly TouchStep[];
}): RunTouched {
  const { run, lines, steps } = input;
  const byId = new Map(steps.map((step) => [step.id, step]));
  const byNumber = new Map(steps.map((step) => [step.number, step]));
  const byOutline = new Map(
    steps.filter((step) => step.outline).map((step) => [step.outline as string, step]),
  );

  const rows: TouchedRow[] = [];
  const seen = new Set<string>();
  const addStep = (step: TouchStep | undefined, reason: TouchReason) => {
    if (!step || seen.has(step.id)) return;
    seen.add(step.id);
    rows.push({ kind: 'step', key: step.id, href: stepHref(step), step, reason });
  };

  // The step the run was sent at, first: it is what the run was for.
  const sentAt = run.planItemId ? byId.get(run.planItemId) : undefined;
  addStep(sentAt, 'sent');

  // The rows beneath it that closed between the run's start and its end,
  // oldest first. A closure after the run ended is a later run's.
  if (sentAt) {
    const children = new Map<string, TouchStep[]>();
    for (const step of steps) {
      if (!step.parentId) continue;
      children.set(step.parentId, [...(children.get(step.parentId) ?? []), step]);
    }
    const beneath: TouchStep[] = [];
    const walk = (id: string) => {
      for (const child of children.get(id) ?? []) {
        beneath.push(child);
        walk(child.id);
      }
    };
    walk(sentAt.id);
    const from = time(run.createdAt);
    const until = run.endedAt ? time(run.endedAt) : Infinity;
    beneath
      .filter((step) => {
        const closed = time(step.completedAt);
        return Number.isFinite(closed) && closed >= from && closed <= until;
      })
      .sort((a, b) => time(a.completedAt) - time(b.completedAt))
      .forEach((step) => addStep(step, 'closed'));
  }

  // The commits: each one a line reported, then the push GitHub saw.
  const commits: TouchedCommit[] = [];
  const addCommit = (sha: string, subject: string | null) => {
    const held = commits.find((commit) => sameCommit(commit.sha, sha));
    if (held) {
      if (sha.length > held.sha.length) held.sha = sha;
      if (!held.subject && subject) held.subject = subject;
      return;
    }
    commits.push({ sha, subject: subject && subject.trim() ? subject.trim() : null });
  };
  for (const line of lines) {
    if (line.kind !== 'action') continue;
    for (const match of line.body.matchAll(COMMITTED)) addCommit(match[1], match[2] || null);
  }
  if (run.lastPush?.sha) addCommit(run.lastPush.sha, run.lastPush.subject);

  // The steps the lines name. Only outlines: in a line a bare `#3` is as
  // often a count as a step, and plan.ts names steps by outline.
  for (const line of lines) {
    for (const step of namedSteps(line.body, 'outlines', byOutline, byNumber)) addStep(step, 'named');
  }
  // The steps the commits name. A subject ends `(plan #1964.2.4)`, or
  // `(plan #1084)` in older ones, so a bare number is a step here.
  for (const commit of commits) {
    if (!commit.subject) continue;
    for (const step of namedSteps(commit.subject, 'all', byOutline, byNumber)) addStep(step, 'commit');
  }

  // The pages its lines link to inside the app. A link to a step's page is
  // that step, already listed when the tree placed it.
  const pages = new Set<string>();
  for (const line of lines) {
    for (const part of linkParts(line.body)) {
      if (!('href' in part) || !isAppPath(part.href)) continue;
      const step = stepFromHref(part.href, byOutline, byNumber);
      if (step) {
        addStep(step, 'linked');
        continue;
      }
      if (pages.has(part.href)) continue;
      pages.add(part.href);
      rows.push({ kind: 'page', key: part.href, href: part.href, title: part.text, reason: 'linked' });
    }
  }

  return { rows, commits };
}

/** The step a `/dev/plan/<number or outline>` link opens, if it is one. */
function stepFromHref(
  href: string,
  byOutline: ReadonlyMap<string, TouchStep>,
  byNumber: ReadonlyMap<number, TouchStep>,
): TouchStep | undefined {
  const match = /^\/dev\/plan\/([^/?#]+)\/?(?:[?#].*)?$/.exec(href);
  if (!match) return undefined;
  const raw = decodeURIComponent(match[1]).replace(/^#/, '');
  if (/^\d+$/.test(raw)) return byNumber.get(Number(raw));
  return byOutline.get(raw);
}
