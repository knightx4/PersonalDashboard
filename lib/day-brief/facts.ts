import type { AgendaPile } from '@/lib/todo/agenda/merge';
import type { DailyView } from '@/lib/goals/daily';
import { addDays } from '@/lib/todo/tasks/model';

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
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
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
