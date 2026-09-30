import type { AgendaPile } from '@/lib/todo/agenda/merge';
import type { DailyView } from '@/lib/goals/daily';
import { addDays } from '@/lib/todo/tasks/model';
import { formatClock } from '@/lib/clock';
import { isInterviewContext } from '@/lib/todo/agenda/sources';

/**
 * The morning brief's facts (plan #1123): what today holds, as short lines,
 * gathered from what the app already works out elsewhere.
 *
 * - The agenda (lib/todo/agenda) gives what is booked today with its time
 *   (interviews, events, subscribed calendars, and any appointment source
 *   added later), what is overdue, what is due today, and the dated things
 *   from other workspaces closing in the next seven days: return windows now,
 *   bills and deliveries once their sources are on the agenda. A new agenda
 *   source reaches the brief with no change here.
 * - The goals home (lib/goals/daily.ts) gives the question or next step of
 *   yours that a goal is waiting on.
 * - News gives one story and Learn the check question on the next card.
 *
 * Pure, and it takes the day and zone rather than reading the clock, so what
 * the brief says about a day is tested against rows written by hand. The
 * model only turns these lines into sentences; what they say is decided here.
 */

export type BriefFactKind = 'booked' | 'overdue' | 'today' | 'week' | 'goal' | 'news' | 'learn';

export type BriefFact = {
  kind: BriefFactKind;
  /** The line as the model is given it, with its time or day already in it. */
  text: string;
};

/** The hour, in the person's own zone, from which the day's brief is written. */
export const BRIEF_HOUR = 6;

/**
 * The last hour a missed brief is still written in. A brief that first
 * arrived in the evening would be about a day already spent, and #1124 sends
 * it to the phone as it is written.
 */
export const BRIEF_LAST_HOUR = 11;

/** How many lines of one kind the model is shown before the rest are counted. */
export const PER_KIND = 5;

/** What a day with nothing on says, in full. */
export const QUIET_LINE = 'Nothing is booked or due today.';

/** The kinds that make a day not quiet. A news story alone is not a day's plan. */
const ON: ReadonlySet<BriefFactKind> = new Set(['booked', 'overdue', 'today', 'week', 'goal']);

function partsIn(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/**
 * The day to write a brief for at `now` in `timezone`, or null outside the
 * morning window: before six, the brief would be about a day not yet begun,
 * and after the window a missed one stays missed.
 */
export function briefDay(timezone: string, now: Date): string | null {
  const { day, hour } = partsIn(timezone, now);
  return hour >= BRIEF_HOUR && hour <= BRIEF_LAST_HOUR ? day : null;
}

function clock(at: string, timezone: string): string {
  return formatClock(at, { timeZone: timezone });
}

function weekday(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/** At most PER_KIND lines, and one more saying how many were left out. */
function capped(kind: BriefFactKind, lines: string[], rest: (count: number) => string): BriefFact[] {
  const kept = lines.slice(0, PER_KIND).map((text) => ({ kind, text }));
  const left = lines.length - kept.length;
  return left > 0 ? [...kept, { kind, text: rest(left) }] : kept;
}

function entryTitle(entry: AgendaPile['entries'][number]): string {
  return entry.task?.title ?? entry.item?.title ?? '';
}

/**
 * What the agenda says about today and the week ahead.
 *
 * Today's context comes with its time, earliest first. Overdue and today's
 * entries are tasks and source items alike. From the later piles only source
 * items dated within seven days are kept: a return window or a bill is a date
 * the person cannot move, where a task due on Friday will be on Friday's brief.
 */
export function agendaFacts(piles: readonly AgendaPile[], today: string, timezone: string): BriefFact[] {
  const pile = (bucket: AgendaPile['bucket']) => piles.find((p) => p.bucket === bucket);

  const booked = [...(pile('today')?.context ?? [])]
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
    .map((entry) => {
      const when = entry.at ? clock(entry.at, timezone) : 'All day';
      return `${when}: ${entry.label}${entry.detail ? ` (${entry.detail})` : ''}`;
    });

  const overdue = (pile('overdue')?.entries ?? []).map(entryTitle).filter(Boolean);
  const dueToday = (pile('today')?.entries ?? []).map(entryTitle).filter(Boolean);

  const weekEnd = addDays(today, 7);
  const week = (['soon', 'later'] as const)
    .flatMap((bucket) => pile(bucket)?.entries ?? [])
    .filter((entry) => entry.item && entry.item.day && entry.item.day > today && entry.item.day < weekEnd)
    .sort((a, b) => (a.item!.day ?? '').localeCompare(b.item!.day ?? ''))
    .map((entry) => `${weekday(entry.item!.day!)}: ${entry.item!.title}`);

  return [
    ...capped('booked', booked, (n) => `and ${n} more booked today`),
    ...capped('overdue', overdue, (n) => `and ${n} more overdue`),
    ...capped('today', dueToday, (n) => `and ${n} more due today`),
    ...capped('week', week, (n) => `and ${n} more closing this week`),
  ];
}

/**
 * The one thing the goals are waiting on you for: a question first, since
 * nothing moves under it until it is answered; otherwise your next step on
 * the first goal that has one.
 */
export function goalFact(view: Pick<DailyView, 'goals' | 'waiting'>): BriefFact | null {
  const question = view.waiting.find((item) => item.kind === 'question');
  if (question) {
    return { kind: 'goal', text: `A question on your goal "${question.goalTitle}": ${question.title}` };
  }
  for (const daily of view.goals) {
    const next = daily.next.find((item) => item.kind === 'mine');
    if (next) return { kind: 'goal', text: `Your next step on "${daily.goal.title}": ${next.title}` };
  }
  return null;
}

export function newsFact(story: { headline: string; sender: string | null } | null): BriefFact | null {
  if (!story) return null;
  return { kind: 'news', text: story.sender ? `${story.headline} (from ${story.sender})` : story.headline };
}

export function learnFact(question: string | null): BriefFact | null {
  const text = question?.trim();
  return text ? { kind: 'learn', text } : null;
}

/** Whether the day has nothing on: nothing booked, due, closing or waiting. */
export function isQuiet(facts: readonly BriefFact[]): boolean {
  return !facts.some((fact) => ON.has(fact.kind));
}

const HEADINGS: Record<BriefFactKind, string> = {
  booked: 'Booked today',
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Closing this week',
  goal: 'Waiting on you in Goals',
  news: 'One news story',
  learn: "Today's Learn question",
};

/** The facts under their headings, for the model's user turn. */
export function factsPrompt(day: string, facts: readonly BriefFact[]): string {
  const lines = [`Today is ${weekday(day)} ${day}.`];
  for (const kind of Object.keys(HEADINGS) as BriefFactKind[]) {
    const ofKind = facts.filter((fact) => fact.kind === kind);
    if (ofKind.length === 0) continue;
    lines.push('', `${HEADINGS[kind]}:`, ...ofKind.map((fact) => `- ${fact.text}`));
  }
  return lines.join('\n');
}

/**
 * The brief without a model: one plain sentence per heading. Written when
 * there is no API key or the call fails, so the home page still opens on the
 * day rather than on nothing.
 */
export function plainBrief(facts: readonly BriefFact[]): string {
  if (isQuiet(facts)) return QUIET_LINE;
  const sentences: string[] = [];
  for (const kind of Object.keys(HEADINGS) as BriefFactKind[]) {
    const ofKind = facts.filter((fact) => fact.kind === kind).map((fact) => fact.text);
    if (ofKind.length > 0) sentences.push(`${HEADINGS[kind]}: ${ofKind.join('; ')}.`);
  }
  return sentences.join(' ');
}

/** The longest brief kept. Three or four sentences fit well inside it. */
export const MAX_BRIEF_CHARS = 900;

/**
 * The model's brief as the page may show it, or null when it is unusable:
 * empty, or too long to be the short account asked for. Dashes the model
 * used for rhythm become commas, as the writing guide asks.
 */
export function checkBrief(text: string): string | null {
  const cleaned = text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > MAX_BRIEF_CHARS) return null;
  return cleaned;
}

/*
 * Candidates (plan #1237): what could matter today, gathered from every
 * workspace for the brief to choose from (#1239 ranks them, #1240 writes the
 * notification from the picks). Each carries the facts that make it matter,
 * so the reason a pick is given ("5 Dash steps wait on this", "up from $12
 * to $15") is built from these and not asked of the model.
 *
 * Every function here is pure: the rows are read in inngest/core/day-brief.ts
 * and handed in, each kind on its own, so a source that fails costs only its
 * own candidates (collectCandidates).
 */

type CandidateBase = {
  /** Stable across the day's reads: the kind of row and its id. */
  key: string;
  /** What the thing is called, as the person would recognise it. */
  title: string;
  /** Where the thing itself is, or null when nothing links to it. */
  href: string | null;
};

/** The recurring_charges events that ask for money on the date they name. */
export const DUE_EVENTS = ['bill', 'renewal_notice', 'trial_ending'] as const;
export type DueEvent = (typeof DUE_EVENTS)[number];

export type Candidate =
  /** An interview today, from the job-interviews agenda source. */
  | (CandidateBase & { kind: 'interview'; at: string | null; detail: string | null })
  /** A dated thing from another workspace closing today: a return window. */
  | (CandidateBase & { kind: 'deadline'; day: string })
  /** A bill, renewal or trial end due today (dueIn 0) or tomorrow (dueIn 1). */
  | (CandidateBase & {
      kind: 'bill';
      event: DueEvent;
      dueOn: string;
      dueIn: 0 | 1;
      amountCents: number | null;
      currency: string | null;
    })
  /** A charge read since the last brief that costs more than the one before. */
  | (CandidateBase & {
      kind: 'price-rise';
      amountCents: number;
      previousAmountCents: number;
      currency: string | null;
      period: string | null;
      /** When the new price starts, where the email says. */
      startsOn: string | null;
    })
  /** An email waiting on the person's answer, filed as a task by lib/todo/replies. */
  | (CandidateBase & { kind: 'reply'; taskId: string; receivedAt: string; daysWaiting: number })
  /** The person's goal step with the most open steps waiting on it. */
  | (CandidateBase & {
      kind: 'goal-step';
      goalTitle: string | null;
      /** Open steps that depend on this one directly. */
      waiting: number;
      /** How many of those are Dash's. */
      dashWaiting: number;
    })
  /** A result Dash finished since the last brief that the person has not read. */
  | (CandidateBase & { kind: 'dash-result'; goalTitle: string | null; result: string; closedAt: string })
  /** An ordinary to-do, overdue or due today: kept only when nothing else qualifies (#1239). */
  | (CandidateBase & { kind: 'todo'; taskId: string; dueOn: string | null; overdue: boolean; createdAt: string });

export type CandidateKind = Candidate['kind'];

const DAY_MS = 86_400_000;

/** How far back the overnight reads go when there is no earlier brief. */
export const SINCE_DEFAULT_HOURS = 24;
/** And the furthest back they go after a gap, so a week off is not replayed. */
export const SINCE_MAX_HOURS = 48;

/**
 * Where "since the last brief" starts: the last brief's time, but never more
 * than two days back, and a day back when there is none.
 */
export function candidatesSince(lastBriefAt: string | null, now: Date): string {
  const floor = now.getTime() - SINCE_MAX_HOURS * 3_600_000;
  const last = lastBriefAt ? Date.parse(lastBriefAt) : NaN;
  const at = Number.isFinite(last) ? Math.max(last, floor) : now.getTime() - SINCE_DEFAULT_HOURS * 3_600_000;
  return new Date(at).toISOString();
}

export function taskHref(taskId: string): string {
  return `/todo/all?status=all&focus=${taskId}`;
}

export function goalStepHref(goalId: string | null, stepId: string): string | null {
  return goalId ? `/goals/${goalId}#step-${stepId}` : null;
}

/**
 * What the agenda gives: today's interviews, return windows closing today,
 * and the to-dos overdue or due today as the fallback kind.
 */
export function agendaCandidates(piles: readonly AgendaPile[], today: string): Candidate[] {
  const pile = (bucket: AgendaPile['bucket']) => piles.find((p) => p.bucket === bucket);
  const out: Candidate[] = [];

  for (const context of pile('today')?.context ?? []) {
    if (!isInterviewContext(context.key)) continue;
    out.push({
      kind: 'interview',
      key: context.key,
      title: context.label,
      href: context.link?.href ?? null,
      at: context.at,
      detail: context.detail,
    });
  }

  for (const bucket of ['overdue', 'today'] as const) {
    for (const entry of pile(bucket)?.entries ?? []) {
      if (entry.item?.source === 'return_deadlines' && entry.item.day === today) {
        out.push({
          kind: 'deadline',
          key: entry.key,
          title: entry.item.title,
          href: entry.item.link?.href ?? null,
          day: today,
        });
      } else if (entry.task && entry.task.status === 'open') {
        out.push({
          kind: 'todo',
          key: `task:${entry.task.id}`,
          taskId: entry.task.id,
          title: entry.task.title,
          href: taskHref(entry.task.id),
          dueOn: entry.task.dueOn,
          overdue: bucket === 'overdue',
          createdAt: entry.task.createdAt,
        });
      }
    }
  }
  return out;
}

/** An open reply task and when its email arrived (todo.reply_threads). */
export type ReplyRow = {
  task_id: string;
  title: string;
  /** The email's received_at; the thread's filing time when it is gone. */
  received_at: string;
};

/** Emails waiting on an answer, the longest-waiting first. */
export function replyCandidates(rows: readonly ReplyRow[], now: Date): Candidate[] {
  return [...rows]
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
    .map((row) => ({
      kind: 'reply' as const,
      key: `task:${row.task_id}`,
      taskId: row.task_id,
      title: row.title,
      href: taskHref(row.task_id),
      receivedAt: row.received_at,
      daysWaiting: Math.max(0, Math.floor((now.getTime() - Date.parse(row.received_at)) / DAY_MS)),
    }));
}

/** public.recurring_charges, with the payee from its recurring_payments row. */
export type ChargeCandidateRow = {
  id: string;
  payment_id: string | null;
  payee: string | null;
  event: string;
  amount_cents: number | null;
  previous_amount_cents: number | null;
  currency: string | null;
  period: string | null;
  due_on: string | null;
  created_at: string;
};

const RECURRING_HREF = '/shopping/recurring';

/**
 * Bills due today or tomorrow, and price rises read since `since`. One of
 * each per payment: the latest email about it speaks for it.
 */
export function chargeCandidates(
  rows: readonly ChargeCandidateRow[],
  today: string,
  since: string,
): Candidate[] {
  const tomorrow = addDays(today, 1);
  const latest = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const row of latest) {
    if (!(DUE_EVENTS as readonly string[]).includes(row.event)) continue;
    if (row.due_on !== today && row.due_on !== tomorrow) continue;
    const payment = `due:${row.payment_id ?? row.id}`;
    if (seen.has(payment)) continue;
    seen.add(payment);
    out.push({
      kind: 'bill',
      key: `bill:${row.id}`,
      title: row.payee ?? 'A bill',
      href: RECURRING_HREF,
      event: row.event as DueEvent,
      dueOn: row.due_on,
      dueIn: row.due_on === today ? 0 : 1,
      amountCents: row.amount_cents,
      currency: row.currency,
    });
  }

  for (const row of latest) {
    if (row.created_at < since) continue;
    if (row.amount_cents == null || row.previous_amount_cents == null) continue;
    if (row.amount_cents <= row.previous_amount_cents) continue;
    const payment = `rise:${row.payment_id ?? row.id}`;
    if (seen.has(payment)) continue;
    seen.add(payment);
    out.push({
      kind: 'price-rise',
      key: `price-rise:${row.id}`,
      title: row.payee ?? 'A subscription',
      href: RECURRING_HREF,
      amountCents: row.amount_cents,
      previousAmountCents: row.previous_amount_cents,
      currency: row.currency,
      period: row.period,
      startsOn: row.event === 'price_change' ? row.due_on : null,
    });
  }
  return out;
}

/** goals.items, the columns the candidates read. */
export type GoalCandidateItem = {
  id: string;
  parent_id: string | null;
  level: string;
  kind: string | null;
  status: string;
  title: string;
};

/** goals.dependencies: item_id waits on depends_on_id. */
export type GoalDependencyRow = { item_id: string; depends_on_id: string };

/** The goal an item sits under, walking up parent_id. */
function goalOf(items: ReadonlyMap<string, GoalCandidateItem>, id: string): GoalCandidateItem | null {
  let item = items.get(id);
  for (let depth = 0; item && item.level !== 'goal' && depth < 12; depth += 1) {
    item = item.parent_id ? items.get(item.parent_id) : undefined;
  }
  return item?.level === 'goal' ? item : null;
}

/**
 * The person's open step that the most open steps wait on, directly. Ties go
 * to the one more of Dash's steps wait on, then by title, so the same rows
 * give the same step. None when nothing waits on any of their steps.
 */
export function waitedOnStep(
  items: readonly GoalCandidateItem[],
  dependencies: readonly GoalDependencyRow[],
): Candidate | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const counts = new Map<string, { waiting: number; dashWaiting: number }>();

  for (const edge of dependencies) {
    const step = byId.get(edge.depends_on_id);
    const waiter = byId.get(edge.item_id);
    if (!step || !waiter) continue;
    if (step.level !== 'step' || step.kind !== 'mine' || step.status !== 'open') continue;
    if (waiter.status !== 'open') continue;
    const count = counts.get(step.id) ?? { waiting: 0, dashWaiting: 0 };
    count.waiting += 1;
    if (waiter.kind === 'claude') count.dashWaiting += 1;
    counts.set(step.id, count);
  }

  const best = [...counts.entries()].sort(
    ([a, ca], [b, cb]) =>
      cb.waiting - ca.waiting ||
      cb.dashWaiting - ca.dashWaiting ||
      byId.get(a)!.title.localeCompare(byId.get(b)!.title) ||
      a.localeCompare(b),
  )[0];
  if (!best) return null;

  const [id, count] = best;
  const goal = goalOf(byId, id);
  return {
    kind: 'goal-step',
    key: `goal-step:${id}`,
    title: byId.get(id)!.title,
    href: goalStepHref(goal?.id ?? null, id),
    goalTitle: goal?.title ?? null,
    waiting: count.waiting,
    dashWaiting: count.dashWaiting,
  };
}

/** A Dash step closed with a result nobody has marked read. */
export type DashResultRow = {
  id: string;
  title: string;
  result: string | null;
  result_url: string | null;
  closed_at: string | null;
};

/** The longest a result's opening line is carried. */
const RESULT_CHARS = 200;

function firstLine(text: string): string {
  const line = text.trim().split('\n').find((part) => part.trim())?.trim() ?? '';
  return line.length <= RESULT_CHARS ? line : `${line.slice(0, RESULT_CHARS - 1).trimEnd()}…`;
}

/** Dash's results finished since `since` and not yet read, the newest first. */
export function dashResultCandidates(
  rows: readonly DashResultRow[],
  items: readonly GoalCandidateItem[],
  since: string,
): Candidate[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return rows
    .filter((row) => row.closed_at && row.closed_at >= since && (row.result?.trim() || row.result_url))
    .sort((a, b) => b.closed_at!.localeCompare(a.closed_at!))
    .map((row) => {
      const goal = goalOf(byId, row.id);
      return {
        kind: 'dash-result' as const,
        key: `dash-result:${row.id}`,
        title: row.title,
        href: goalStepHref(goal?.id ?? null, row.id),
        goalTitle: goal?.title ?? null,
        result: row.result?.trim() ? firstLine(row.result) : (row.result_url ?? ''),
        closedAt: row.closed_at!,
      };
    });
}

/**
 * The candidates from every part that answered, in the order given. A part
 * that throws costs its own candidates and nothing else. Where two parts name
 * the same thing (a reply task is also a to-do on the agenda), the first
 * keeps it, so give the specific kinds before the agenda.
 */
export async function collectCandidates(
  parts: readonly (Promise<readonly Candidate[]> | readonly Candidate[])[],
): Promise<Candidate[]> {
  const settled = await Promise.allSettled(parts.map((part) => Promise.resolve(part)));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const candidate of result.value) {
      if (seen.has(candidate.key)) continue;
      seen.add(candidate.key);
      out.push(candidate);
    }
  }
  return out;
}
