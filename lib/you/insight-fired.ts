import { TRIPWIRE_KINDS, type TripwireKind } from '@/lib/you/insight-signals';

/**
 * A tripwire that has fired on an insight (plan #2413.11), read back for the
 * Insights tab. The nightly check (you.compute_insight_signals, migrations-you
 * 0012) writes last_fired_at and fired_evidence; the evidence has a shape per
 * kind, read here defensively since it is jsonb. No model is called: the line
 * under the claim is worded from the evidence by this file.
 */

export type FiredTripwire = {
  kind: TripwireKind;
  firedAt: string;
  evidence: Record<string, unknown>;
};

/** What the deck shows under a card brought back: a headline and the evidence behind it. */
export type FiredLine = {
  /** One sentence naming what happened, for example "Three days building while ReSpark waits". */
  headline: string;
  /** The evidence the check recorded, one short line each. */
  details: string[];
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    : [];
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The tripwires on an insight as PostgREST embeds them; one of an unknown kind or never fired is dropped. */
export function firedFrom(value: unknown): FiredTripwire[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const entry = row as Record<string, unknown>;
    const kind = TRIPWIRE_KINDS.find((known) => known === entry.kind);
    const firedAt = text(entry.last_fired_at);
    if (!kind || !firedAt || !Number.isFinite(Date.parse(firedAt))) return [];
    const evidence =
      entry.fired_evidence && typeof entry.fired_evidence === 'object' && !Array.isArray(entry.fired_evidence)
        ? (entry.fired_evidence as Record<string, unknown>)
        : {};
    return [{ kind, firedAt, evidence }];
  });
}

/**
 * The tripwire that brings an insight back: the latest to fire after the
 * person's last mark, or at all when they have not marked it.
 */
export function firedSinceMark(
  fired: readonly FiredTripwire[],
  decidedAt: string | null | undefined,
): FiredTripwire | null {
  const marked = decidedAt ? Date.parse(decidedAt) : Number.NEGATIVE_INFINITY;
  let latest: FiredTripwire | null = null;
  for (const tripwire of fired) {
    const at = Date.parse(tripwire.firedAt);
    if (!(at > marked)) continue;
    if (!latest || at > Date.parse(latest.firedAt)) latest = tripwire;
  }
  return latest;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const WORD_NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const spelled = (n: number) => WORD_NUMBERS[n] ?? String(n);
const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** A company with its role, "ReSpark, Product Designer", or whichever is known. */
const roleName = (row: Record<string, unknown>) =>
  [text(row.company), text(row.role)].filter(Boolean).join(', ') || 'an application';

/** The headline and evidence lines for a fired tripwire, dates written by the given formatter ("17 Oct"). */
export function firedLine(tripwire: FiredTripwire, date: (iso: string) => string): FiredLine {
  const e = tripwire.evidence;
  if (tripwire.kind === 'building_while_waiting') {
    const waiting = records(e.waiting);
    const top = [...waiting].sort((a, b) => count(b.build_days_since) - count(a.build_days_since))[0];
    const days = top ? count(top.build_days_since) : 0;
    const others = waiting.length - 1;
    const headline =
      top && days > 0
        ? `${capital(spelled(days))} ${days === 1 ? 'day' : 'days'} building while ${text(top.company) || roleName(top)} waits${
            others > 0 ? ` and ${plural(others, 'other', 'others')}` : ''
          }`
        : 'You have been building while applications wait for a reply';
    const buildDays = Array.isArray(e.build_days) ? e.build_days.map((d) => text(d)).filter(Boolean) : [];
    return {
      headline,
      details: [
        ...waiting.map(
          (row) =>
            `${text(row.company) || roleName(row)}: sent ${date(text(row.submitted_at))}, no reply, ${plural(count(row.build_days_since), 'build day', 'build days')} since`,
        ),
        ...(buildDays.length ? [`Build days: ${buildDays.map(date).join(', ')}`] : []),
      ],
    };
  }
  if (tripwire.kind === 'deadline_during_building') {
    const deadlines = records(e.deadlines);
    const first = deadlines[0];
    const title = first ? text(first.title) : '';
    return {
      headline: title
        ? `A deadline passed, ${title}, on a day you were building`
        : 'A deadline passed on a day you were building',
      details: deadlines.map(
        (row) =>
          `${text(row.title) || 'Deadline'}: due ${date(text(row.day))}, ${plural(count(row.build_views), 'build page view', 'build page views')} that day`,
      ),
    };
  }
  if (tripwire.kind === 'rule_broken') {
    const applications = records(e.applications);
    const first = applications[0];
    const rule = first ? text(first.rule) : '';
    return {
      headline: first
        ? `You applied to ${roleName(first)}, against your rule${rule ? ` on ${rule}` : ''}`
        : 'You applied against one of your own rules',
      details: applications.map(
        (row) =>
          `${roleName(row)}: sent ${date(text(row.submitted_at))}${text(row.rule) ? `, breaks your rule on ${text(row.rule)}` : ''}`,
      ),
    };
  }
  const mentions = records(e.mentions);
  const words = Array.isArray(e.words) ? e.words.map(text).filter(Boolean) : [];
  const named = words.length ? words.join(', ') : 'this';
  return {
    headline: mentions.length
      ? `You have named ${named} ${plural(mentions.length, 'time', 'times')} lately and started nothing`
      : `You named ${named} again`,
    details: mentions.map((row) => {
      const source = text(row.source);
      const where =
        source === 'job_search.thoughts' ? 'A job thought' : source === 'goals.captures' ? 'A capture' : 'A private note';
      return `${where}, ${date(text(row.at))}`;
    }),
  };
}
