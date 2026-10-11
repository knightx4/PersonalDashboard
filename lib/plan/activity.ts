import { planRowId } from '@/lib/comments/refs';
import { sessionOrigin } from './origin';
import { flatten, type PlanNode } from './tree';
import type { PlanUpdate } from './updates';
import { RUN_JOB_LABEL, type RunJob, type RunStatus } from './run-end';
import { featureHref } from './feature-page';

/**
 * A feature's history, for the Activity tab on its page (plan #1667).
 *
 * Everything here is read from what is already stored, and nothing new is
 * recorded for it:
 *
 * - each row's own times: `created_at`, `started_at`, `completed_at` and,
 *   while it is blocked, `blocked_at`;
 * - the dated lines in each row's comment ("Done 2026-10-07: …", "Blocked …",
 *   "Answered …"), which are the close notes and the blocks a row has since
 *   come out of, and which the columns forget;
 * - the thread on each row, Dash's updates on the feature (`plan_updates`),
 *   the runs sent at its rows (`plan_runs`) and what Dash recorded doing to
 *   them (`core.dash_actions`).
 *
 * A dated line and a column that say the same thing are one entry: the
 * column gives the time, the line gives the note. A Dash action that matches
 * an entry marks it as Dash's rather than being listed twice.
 *
 * Pure, so the page and the tests read the same list.
 */

export type ActivityKind =
  | 'added'
  | 'started'
  | 'blocked'
  | 'closed'
  | 'dropped'
  | 'answered'
  | 'note'
  | 'comment'
  | 'run'
  | 'update'
  | 'dash';

/** The row an entry is about, and where it is on the feature's page. */
export type ActivitySubject = {
  number: number;
  title: string;
  href: string;
  /** The feature itself, which the page is already about. */
  isFeature?: boolean;
};

export type ActivityEntry = {
  /** Stable within one list, for React keys. */
  id: string;
  kind: ActivityKind;
  /** When it happened. A comment line carries only its day. */
  at: string;
  /** The time is a day and nothing finer: a dated comment line. */
  dayOnly: boolean;
  /** Who did it, where that is known. */
  who: 'you' | 'dash' | null;
  /** The opening words: "Closed", "Blocked", "You commented on". */
  verb: string;
  subject: ActivitySubject;
  /** What it said: a close note, a comment, an update's body. */
  detail: string | null;
  /** The commit a closed step shipped in. */
  sha: string | null;
  /** The update's health, on an update. */
  update?: PlanUpdate;
  /** How a run ended, on a run. */
  runStatus?: RunStatus;
};

/** A `plan_runs` row, as much of it as the tab says. */
export type ActivityRun = {
  id: string;
  stepId: string;
  job: RunJob;
  status: RunStatus;
  error: string | null;
  createdAt: string;
};

/** A `core.dash_actions` row on one of the feature's rows. */
export type ActivityDashAction = {
  id: string;
  /** The plan row's id, from `public.plan_items:<id>`. */
  stepId: string;
  kind: string;
  summary: string | null;
  createdAt: string;
};

/** The ref a Dash action on a plan row carries, and the row's id inside it. */
export const PLAN_ACTION_REF = 'public.plan_items:';

export function stepIdFromRef(ref: string | null): string | null {
  return ref && ref.startsWith(PLAN_ACTION_REF) ? ref.slice(PLAN_ACTION_REF.length) : null;
}

/** The comment-line verbs that a column also records, and the entry they make. */
const LINE_KINDS: Record<string, ActivityKind> = {
  Done: 'closed',
  Dropped: 'dropped',
  Blocked: 'blocked',
  Answered: 'answered',
};

/** The Dash action kinds that say the same thing as an entry from a column. */
const ACTION_KINDS: Record<string, ActivityKind> = {
  add_step: 'added',
  add_decision: 'added',
  close_step: 'closed',
  drop_step: 'dropped',
  block_step: 'blocked',
};

/** How near a Dash action has to be to an entry to be the same event. */
const SAME_EVENT_MS = 10 * 60 * 1000;

const VERB: Record<Exclude<ActivityKind, 'note' | 'comment' | 'run' | 'update' | 'dash'>, string> = {
  added: 'Added',
  started: 'Started',
  blocked: 'Blocked',
  closed: 'Closed',
  dropped: 'Dropped',
  answered: 'Answered',
};

/** A dated line: "Done 2026-10-07: …", "Claim expired 2026-09-30 14:02: …". */
const DATED_LINE = /^([A-Z][A-Za-z ]{0,40}?) (\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:[^:\n]{0,20})?:\s*(.*)$/;

type DatedLine = { verb: string; date: string; text: string };

/**
 * A row's comment as dated lines, oldest first. Undated lines after one are
 * its continuation; anything before the first is a stamp, not history.
 */
export function datedLines(comment: string | null): DatedLine[] {
  const lines: DatedLine[] = [];
  for (const raw of (comment ?? '').split('\n')) {
    const line = raw.trim();
    const match = DATED_LINE.exec(line);
    if (match) {
      lines.push({ verb: match[1], date: match[2], text: match[3].trim() });
    } else if (line && lines.length > 0 && !sessionOrigin(line)) {
      const last = lines[lines.length - 1];
      last.text = last.text ? `${last.text}\n${line}` : line;
    }
  }
  return lines;
}

/** Where on the feature's page an entry about this row takes you. */
export function subjectOf(feature: PlanNode, node: PlanNode): ActivitySubject {
  const onOverview =
    node.id === feature.id || (node.kind === 'decision' && node.parentId === feature.id);
  return {
    number: node.number,
    title: node.title,
    ...(node.id === feature.id ? { isFeature: true } : {}),
    href: onOverview
      ? featureHref(feature.number)
      : `${featureHref(feature.number)}?tab=steps#${planRowId(node.number)}`,
  };
}

const day = (iso: string) => iso.slice(0, 10);

/** The kind a closed row's completion is. */
function closeKind(node: PlanNode): ActivityKind | null {
  if (node.status === 'dropped') return 'dropped';
  if (node.status !== 'done') return null;
  return node.kind === 'decision' ? 'answered' : 'closed';
}

/**
 * Everything that happened to a feature and the rows beneath it, newest
 * first. `blockedAt` is each blocked row's `blocked_at`, by id, which the
 * plan's own load does not carry.
 */
export function featureActivity(
  feature: PlanNode,
  sources: {
    blockedAt?: Readonly<Record<string, string>>;
    updates?: readonly PlanUpdate[];
    runs?: readonly ActivityRun[];
    actions?: readonly ActivityDashAction[];
  } = {},
): ActivityEntry[] {
  const rows = flatten([feature]);
  const byId = new Map(rows.map((node) => [node.id, node]));
  const entries: ActivityEntry[] = [];

  const push = (entry: Omit<ActivityEntry, 'id'>) =>
    entries.push({ ...entry, id: `${entry.kind}-${entry.subject.number}-${entries.length}` });

  for (const node of rows) {
    const subject = subjectOf(feature, node);
    const lines = datedLines(node.comment);
    const used = new Set<number>();
    // The last line of a verb on the column's day is the column's note.
    const noteFor = (kind: ActivityKind, at: string): string | null => {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (used.has(i) || LINE_KINDS[lines[i].verb] !== kind || lines[i].date !== day(at)) continue;
        used.add(i);
        return lines[i].text || null;
      }
      return null;
    };

    const added = sessionOrigin(node.comment);
    push({
      kind: 'added',
      at: node.createdAt,
      dayOnly: false,
      who: added ? 'dash' : null,
      verb: VERB.added,
      subject,
      detail: null,
      sha: null,
    });
    if (node.startedAt && node.kind === 'build') {
      push({ kind: 'started', at: node.startedAt, dayOnly: false, who: null, verb: VERB.started, subject, detail: null, sha: null });
    }
    const blockedAt = sources.blockedAt?.[node.id];
    if (node.status === 'blocked' && blockedAt) {
      push({
        kind: 'blocked',
        at: blockedAt,
        dayOnly: false,
        who: null,
        verb: VERB.blocked,
        subject,
        detail: noteFor('blocked', blockedAt) ?? node.blockAsk,
        sha: null,
      });
    }
    const closed = closeKind(node);
    if (closed && node.completedAt) {
      push({
        kind: closed,
        at: node.completedAt,
        dayOnly: false,
        who: closed === 'answered' ? 'you' : null,
        verb: VERB[closed as keyof typeof VERB],
        subject,
        detail: (closed === 'answered' ? node.resolution : null) ?? noteFor(closed, node.completedAt),
        sha: closed === 'closed' ? node.commitSha : null,
      });
      if (closed === 'answered') noteFor('answered', node.completedAt);
    }
    // The dated lines no column accounts for: earlier blocks and closes,
    // claims that expired, notes.
    lines.forEach((line, index) => {
      if (used.has(index)) return;
      const kind = LINE_KINDS[line.verb] ?? 'note';
      push({
        kind,
        at: `${line.date}T00:00:00.000Z`,
        dayOnly: true,
        who: kind === 'answered' ? 'you' : null,
        verb: kind === 'note' ? line.verb : VERB[kind as keyof typeof VERB],
        subject,
        detail: line.text || null,
        sha: null,
      });
    });
    for (const turn of node.thread) {
      const mine = turn.author === 'me';
      push({
        kind: 'comment',
        at: turn.createdAt,
        dayOnly: false,
        who: mine ? 'you' : 'dash',
        verb: mine ? 'You commented on' : 'Dash replied on',
        subject,
        detail: turn.body,
        sha: null,
      });
    }
  }

  for (const run of sources.runs ?? []) {
    const node = byId.get(run.stepId);
    if (!node) continue;
    push({
      kind: 'run',
      at: run.createdAt,
      dayOnly: false,
      who: 'dash',
      verb: `${RUN_JOB_LABEL[run.job] ?? 'A run'} was sent at`,
      subject: subjectOf(feature, node),
      detail: run.status === 'failed' ? run.error : null,
      sha: null,
      runStatus: run.status,
    });
  }

  for (const update of sources.updates ?? []) {
    push({
      kind: 'update',
      at: update.createdAt,
      dayOnly: false,
      who: 'dash',
      verb: 'Dash’s update on',
      subject: subjectOf(feature, feature),
      detail: update.body,
      sha: null,
      update,
    });
  }

  for (const action of sources.actions ?? []) {
    const node = byId.get(action.stepId);
    if (!node) continue;
    const kind = ACTION_KINDS[action.kind];
    const at = Date.parse(action.createdAt);
    const same = kind
      ? entries.find(
          (entry) =>
            entry.kind === kind &&
            entry.subject.number === node.number &&
            (entry.dayOnly
              ? day(entry.at) === day(action.createdAt)
              : Math.abs(Date.parse(entry.at) - at) <= SAME_EVENT_MS),
        )
      : undefined;
    if (same) {
      same.who = 'dash';
      if (same.dayOnly) {
        same.at = action.createdAt;
        same.dayOnly = false;
      }
      continue;
    }
    push({
      kind: 'dash',
      at: action.createdAt,
      dayOnly: false,
      who: 'dash',
      verb: action.summary ?? action.kind.replace(/_/g, ' '),
      subject: subjectOf(feature, node),
      detail: null,
      sha: null,
    });
  }

  const listed = collapseAdded(feature, entries, rows);

  // Newest first. A dated line stands at the start of its day, so it is
  // listed after every timed entry that day: it says no more than the day.
  const sortKey = (entry: ActivityEntry) => Date.parse(entry.at);
  return listed.sort((a, b) => sortKey(b) - sortKey(a) || a.id.localeCompare(b.id));
}

/** How many rows added in the same minute are listed as one entry. */
export const ADDED_TOGETHER = 3;

/**
 * Rows added in the same minute, as shaping a feature adds them, are one
 * entry naming each: ten "Added" lines in a row said one thing ten times.
 */
function collapseAdded(
  feature: PlanNode,
  entries: ActivityEntry[],
  rows: readonly PlanNode[],
): ActivityEntry[] {
  const kindOf = new Map(rows.map((node) => [node.number, node.kind]));
  const byMinute = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    if (entry.kind !== 'added' || entry.dayOnly || entry.subject.isFeature) continue;
    const minute = entry.at.slice(0, 16);
    byMinute.set(minute, [...(byMinute.get(minute) ?? []), entry]);
  }
  const folded = new Set<ActivityEntry>();
  const together: ActivityEntry[] = [];
  for (const [minute, added] of byMinute) {
    if (added.length < ADDED_TOGETHER) continue;
    added.forEach((entry) => folded.add(entry));
    const ordered = [...added].sort((a, b) => a.subject.number - b.subject.number);
    together.push({
      id: `added-${minute}`,
      kind: 'added',
      at: ordered.reduce((first, entry) => (entry.at < first ? entry.at : first), ordered[0].at),
      dayOnly: false,
      who: added.every((entry) => entry.who === 'dash') ? 'dash' : null,
      verb: `Added ${addedWords(added.map((entry) => kindOf.get(entry.subject.number)))} to`,
      subject: { number: feature.number, title: feature.title, isFeature: true, href: `${featureHref(feature.number)}?tab=steps` },
      detail: ordered.map((entry) => `#${entry.subject.number} ${entry.subject.title}`).join('\n'),
      sha: null,
    });
  }
  return [...entries.filter((entry) => !folded.has(entry)), ...together];
}

/** "9 steps and a question", "3 steps", "2 questions". */
function addedWords(kinds: readonly (string | undefined)[]): string {
  const questions = kinds.filter((kind) => kind === 'decision').length;
  const steps = kinds.length - questions;
  const count = (n: number, one: string, many: string) =>
    n === 1 ? `a ${one}` : `${n} ${many}`;
  const parts = [
    steps > 0 ? count(steps, 'step', 'steps') : null,
    questions > 0 ? count(questions, 'question', 'questions') : null,
  ].filter(Boolean);
  return parts.join(' and ');
}

/** Entries by day, newest day first, for the tab's day headings. */
export function activityDays(
  entries: readonly ActivityEntry[],
): { day: string; entries: ActivityEntry[] }[] {
  const days: { day: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const d = day(entry.at);
    const last = days[days.length - 1];
    if (last && last.day === d) last.entries.push(entry);
    else days.push({ day: d, entries: [entry] });
  }
  return days;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `7 October 2026`, read off the stored day, in UTC as the rest of Dev is. */
export function dayHeading(day: string): string {
  const month = MONTH_NAMES[Number(day.slice(5, 7)) - 1];
  const date = Number(day.slice(8, 10));
  return month && date ? `${date} ${month} ${day.slice(0, 4)}` : day;
}
