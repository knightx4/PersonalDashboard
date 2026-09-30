import { formatClock } from '@/lib/clock';
import { formatMoney } from '@/lib/money';
import type { Candidate, CandidateKind } from './facts';

/**
 * What the morning brief names (plan #1239): the rules shortlist and the
 * picks kept from it.
 *
 * The decision under the feature (#1238, answer B) splits the choice. Rules
 * put up to SHORTLIST_MAX candidates in front of Dash, each with a one-line
 * reason built from its facts and a link, and Dash picks one to three of them
 * (lib/day-brief/model.ts, choosePicks). Everything here is pure: the same
 * candidates give the same shortlist, and the same reply from Dash gives the
 * same picks. When there is no reply to use, the first PICKS_MAX of the
 * shortlist are the picks.
 *
 * Ordinary to-dos, overdue or due today, are on the shortlist only when
 * nothing else qualifies, and then only the oldest one: the Agenda page has
 * the rest.
 */

/** The most candidates Dash is shown. */
export const SHORTLIST_MAX = 8;
/** The most picks a brief names. */
export const PICKS_MAX = 3;
/** Where a pick with nothing of its own to link to goes, and where "everything else" is. */
export const AGENDA_HREF = '/todo';
const GOALS_HREF = '/goals';

/**
 * One thing the brief names, as stored in core.day_briefs.picks. The key is
 * the candidate's (lib/day-brief/facts.ts), so a pick can be found again.
 */
export type DayBriefPick = {
  key: string;
  kind: CandidateKind;
  title: string;
  /** Why it matters today, in one line built from its facts. */
  reason: string;
  /** Where it is; the Agenda or Goals when the thing has no page of its own. */
  href: string;
};

/** A candidate on the shortlist, with what the pick would carry. */
export type Shortlisted = { candidate: Candidate; pick: DayBriefPick };

/**
 * The order the kinds are shortlisted in, which is also the order the picks
 * fall back to: what cannot be moved today, then who is waiting on the
 * person, then what is waiting in the app. `todo` is never ranked against the
 * others; it is the fallback when there are none.
 */
export const KIND_ORDER: readonly Exclude<CandidateKind, 'todo'>[] = [
  'interview',
  'deadline',
  'bill',
  'reply',
  'goal-step',
  'dash-result',
  'price-rise',
];

type Context = { timezone: string };

const PERIOD_WORD: Record<string, string> = {
  week: 'a week',
  month: 'a month',
  quarter: 'a quarter',
  year: 'a year',
};

function amount(cents: number, currency: string | null): string {
  try {
    return formatMoney(cents, currency ?? 'USD');
  } catch {
    // An unknown currency code: the figure without the symbol still says it.
    return `${(cents / 100).toFixed(2)} ${currency ?? ''}`.trim();
  }
}

function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Why the candidate matters today, in one line. */
export function reasonFor(candidate: Candidate, context: Context): string {
  switch (candidate.kind) {
    case 'interview': {
      const when = candidate.at
        ? `Interview today at ${formatClock(candidate.at, { timeZone: context.timezone })}`
        : 'Interview today';
      return candidate.detail ? `${when} (${candidate.detail})` : when;
    }
    case 'deadline':
      return 'The return window closes today';
    case 'bill': {
      const when = candidate.dueIn === 0 ? 'today' : 'tomorrow';
      const price =
        candidate.amountCents != null ? amount(candidate.amountCents, candidate.currency) : null;
      if (candidate.event === 'trial_ending') {
        return price ? `The free trial ends ${when}, then ${price}` : `The free trial ends ${when}`;
      }
      if (candidate.event === 'renewal_notice') {
        return price ? `Renews ${when} for ${price}` : `Renews ${when}`;
      }
      return price ? `${price} due ${when}` : `Due ${when}`;
    }
    case 'price-rise': {
      const per = candidate.period
        ? ` ${PERIOD_WORD[candidate.period] ?? `a ${candidate.period}`}`
        : '';
      const from = amount(candidate.previousAmountCents, candidate.currency);
      const to = amount(candidate.amountCents, candidate.currency);
      const starts = candidate.startsOn ? `, from ${shortDay(candidate.startsOn)}` : '';
      return `Up from ${from} to ${to}${per}${starts}`;
    }
    case 'reply':
      if (candidate.daysWaiting === 0) return 'Waiting on your reply since today';
      if (candidate.daysWaiting === 1) return 'Waiting on your reply since yesterday';
      return `Waiting on your reply for ${candidate.daysWaiting} days`;
    case 'goal-step': {
      const others = candidate.waiting - candidate.dashWaiting;
      const wait = candidate.waiting === 1 ? 'waits' : 'wait';
      if (candidate.dashWaiting === 0)
        return `${plural(candidate.waiting, 'step')} ${wait} on this`;
      if (others === 0) return `${plural(candidate.dashWaiting, 'Dash step')} ${wait} on this`;
      return `${plural(candidate.waiting, 'step')} wait on this, ${candidate.dashWaiting} of them Dash's`;
    }
    case 'dash-result':
      return candidate.goalTitle
        ? `Dash finished this for "${candidate.goalTitle}" and you have not read it`
        : 'Dash finished this and you have not read it';
    case 'todo':
      if (!candidate.overdue) return 'Due today, and the oldest thing on your list';
      return candidate.dueOn
        ? `Overdue since ${shortDay(candidate.dueOn)}, the oldest thing on your list`
        : 'Overdue, the oldest thing on your list';
  }
}

/** Where the pick links: its own page, or the workspace it came from. */
function hrefFor(candidate: Candidate): string {
  if (candidate.href) return candidate.href;
  return candidate.kind === 'goal-step' || candidate.kind === 'dash-result'
    ? GOALS_HREF
    : AGENDA_HREF;
}

export function toPick(candidate: Candidate, context: Context): DayBriefPick {
  return {
    key: candidate.key,
    kind: candidate.kind,
    title: candidate.title,
    reason: reasonFor(candidate, context),
    href: hrefFor(candidate),
  };
}

/** Within a kind, the stronger first; the key settles every tie. */
function compareWithinKind(a: Candidate, b: Candidate): number {
  const byKey = a.key.localeCompare(b.key);
  if (a.kind === 'interview' && b.kind === 'interview') {
    return (a.at ?? '￿').localeCompare(b.at ?? '￿') || byKey;
  }
  if (a.kind === 'bill' && b.kind === 'bill') {
    return a.dueIn - b.dueIn || (b.amountCents ?? -1) - (a.amountCents ?? -1) || byKey;
  }
  if (a.kind === 'reply' && b.kind === 'reply') {
    return b.daysWaiting - a.daysWaiting || a.receivedAt.localeCompare(b.receivedAt) || byKey;
  }
  if (a.kind === 'goal-step' && b.kind === 'goal-step') {
    return b.waiting - a.waiting || b.dashWaiting - a.dashWaiting || byKey;
  }
  if (a.kind === 'dash-result' && b.kind === 'dash-result') {
    return b.closedAt.localeCompare(a.closedAt) || byKey;
  }
  if (a.kind === 'price-rise' && b.kind === 'price-rise') {
    return b.amountCents - b.previousAmountCents - (a.amountCents - a.previousAmountCents) || byKey;
  }
  if (a.kind === 'todo' && b.kind === 'todo') {
    return (
      (a.dueOn ?? '￿').localeCompare(b.dueOn ?? '￿') ||
      a.createdAt.localeCompare(b.createdAt) ||
      byKey
    );
  }
  return byKey;
}

/**
 * Up to SHORTLIST_MAX candidates for Dash to choose from, taken a round at a
 * time: the strongest of each kind in KIND_ORDER, then the second of each,
 * and so on. Twelve unread Dash results therefore take one place in the
 * first round rather than all eight. With nothing but to-dos, the shortlist
 * is the oldest to-do alone; with nothing at all, it is empty.
 */
export function shortlist(candidates: readonly Candidate[], context: Context): Shortlisted[] {
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });

  const byKind = KIND_ORDER.map((kind) =>
    unique.filter((candidate) => candidate.kind === kind).sort(compareWithinKind),
  );
  const out: Candidate[] = [];
  for (let round = 0; out.length < SHORTLIST_MAX; round += 1) {
    const taken = byKind
      .map((pile) => pile[round])
      .filter((candidate): candidate is Candidate => !!candidate);
    if (taken.length === 0) break;
    out.push(...taken.slice(0, SHORTLIST_MAX - out.length));
  }

  if (out.length === 0) {
    const oldest = unique
      .filter((candidate) => candidate.kind === 'todo')
      .sort(compareWithinKind)[0];
    if (oldest) out.push(oldest);
  }
  return out.map((candidate) => ({ candidate, pick: toPick(candidate, context) }));
}

/** The picks when Dash was not asked or gave nothing usable: the shortlist's first three. */
export function fallbackPicks(list: readonly Shortlisted[]): DayBriefPick[] {
  return list.slice(0, PICKS_MAX).map((entry) => entry.pick);
}

/**
 * The picks from Dash's choice: the keys it named that are on the shortlist,
 * in the order it named them, without repeats, at most PICKS_MAX. Null when
 * none of them is, so the caller falls back rather than naming nothing on a
 * day that had something.
 */
export function picksFromKeys(
  list: readonly Shortlisted[],
  keys: readonly string[],
): DayBriefPick[] | null {
  const byKey = new Map(list.map((entry) => [entry.pick.key, entry.pick]));
  const out: DayBriefPick[] = [];
  for (const key of keys) {
    const pick = byKey.get(key.trim());
    if (!pick || out.includes(pick)) continue;
    out.push(pick);
    if (out.length === PICKS_MAX) break;
  }
  return out.length > 0 ? out : null;
}

const KIND_LABEL: Record<CandidateKind, string> = {
  interview: 'Interview',
  deadline: 'Deadline',
  bill: 'Bill',
  'price-rise': 'Price rise',
  reply: 'Reply waiting',
  'goal-step': 'Goal step others wait on',
  'dash-result': "Dash's unread result",
  todo: 'To-do',
};

/** The facts beyond the reason that help Dash weigh a candidate. */
function extra(candidate: Candidate): string | null {
  if (candidate.kind === 'dash-result') return `result: ${candidate.result}`;
  if (candidate.kind === 'goal-step' && candidate.goalTitle) return `goal: ${candidate.goalTitle}`;
  return null;
}

/** The shortlist as Dash is given it: one block per candidate, keyed. */
export function shortlistPrompt(day: string, list: readonly Shortlisted[]): string {
  const lines = [`Today is ${day}. The shortlist:`];
  for (const { candidate, pick } of list) {
    lines.push(
      '',
      `key: ${pick.key}`,
      `kind: ${KIND_LABEL[candidate.kind]}`,
      `title: ${pick.title}`,
      `why: ${pick.reason}`,
    );
    const more = extra(candidate);
    if (more) lines.push(more);
  }
  return lines.join('\n');
}
