/**
 * How many screen steps the person sent back, or complained about, each week
 * against how many shipped (plan #2215.5, docs/UI-QUALITY-SPEC.md Part 7).
 *
 * A screen step shipped in the week of its first passing design check (a
 * `ui_checks` row with a step and a passing verdict). It counts as sent back
 * in a week when:
 *  - `sendScreenBack` ran on it, which leaves a "Sent back <date> from the
 *    <surface> pictures: ..." line on the step's comment; or
 *  - a note was filed that week about a page the step changed, within 7 days
 *    of one of its passing checks, and its words are about how the page looks.
 * A step is counted once a week however many ways it qualifies.
 *
 * Nothing records "about how it looks", so that part is a word list
 * (`LOOK_WORDS`): it undercounts a note put in unusual words and counts a
 * note that mentions a word in passing. The page says so.
 *
 * Weeks run Monday to Sunday in UTC as in ./correction-share. Pure: rows in,
 * weeks out.
 */
import { surfacesOfNote, weekOf } from './correction-share';
import { PASSING_VERDICTS } from './ui-check-guard';

/** The first week drawn: the one holding 31 August 2026. */
export const SENT_BACK_FROM = '2026-08-31';

/**
 * The week of the audit behind plan #2215 (15 October 2026), marked on the
 * chart. Before it no session could send a screen back from its pictures:
 * 0 of 285 screen steps were, and look complaints ran about 9 a week before
 * the critic began on 4 October and about 4 a week after.
 */
export const AUDIT_WEEK = '2026-10-12';

/** How soon after a check passed a note still counts against the step. */
export const COMPLAINT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Words that make a note one about how a page looks. */
const LOOK_WORDS =
  /\b(look|looks|looking|ugly|spacing|spaced|padding|margin|font|fonts|colou?rs?|layout|align|aligned|alignment|overlap\w*|cut off|clipped|squashed|cramped|crowded|cluttered|too (?:big|small|large|wide|narrow|tall|dark|light|bright|faint|busy)|contrast|icons?|bold|sizes?|gap|truncated|wraps?|wrapping|overflow\w*|off[- ]screen|misaligned|unreadable|hard to read)\b/i;

/** True when a note's words are about how a page looks. */
export function isLookNote(body: string): boolean {
  return LOOK_WORDS.test(body);
}

/** As much of a `ui_checks` row as this reads. */
export type CheckRow = {
  step: number | null;
  surface: string;
  verdict: string;
  created_at: string;
};

/** As much of a `plan_items` row as this reads: a step whose comment holds a sent-back line. */
export type StepComment = { number: number; comment: string | null };

/** As much of a `feedback_items` row as this reads. */
export type LookNoteRow = { created_at: string; page_path: string | null; body: string };

/** One week of the measure. */
export type SentBackWeek = {
  /** The week's Monday, `YYYY-MM-DD`. */
  week: string;
  /** Screen steps whose first passing check was that week. */
  shipped: number;
  /** Steps sent back, or complained about, that week. */
  sentBack: number;
};

/** The dates `sendScreenBack` wrote on a comment, as `YYYY-MM-DD`. */
export function sentBackDates(comment: string | null): string[] {
  if (!comment) return [];
  return [...comment.matchAll(/^Sent back (\d{4}-\d{2}-\d{2}) from the /gm)].map((m) => m[1]);
}

/**
 * Each week from `from` to the week holding `now`, oldest first. No passing
 * check on record means no weeks; a week with nothing shipped has a zero,
 * and `sentBackShare` gives it no share.
 */
export function sentBackWeeks(
  checks: readonly CheckRow[],
  steps: readonly StepComment[],
  notes: readonly LookNoteRow[],
  now: Date,
  from: string = SENT_BACK_FROM,
): SentBackWeek[] {
  const passes = new Map<number, { surface: string; at: number }[]>();
  for (const row of checks) {
    if (row.step === null || !PASSING_VERDICTS.includes(row.verdict)) continue;
    const at = Date.parse(row.created_at);
    if (Number.isNaN(at)) continue;
    const list = passes.get(row.step);
    if (list) list.push({ surface: row.surface, at });
    else passes.set(row.step, [{ surface: row.surface, at }]);
  }
  if (passes.size === 0) return [];

  const weeks = new Map<string, SentBackWeek>();
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= now.getTime(); at += 7 * DAY_MS) {
    const week = weekOf(at);
    weeks.set(week, { week, shipped: 0, sentBack: 0 });
  }

  for (const list of passes.values()) {
    const first = Math.min(...list.map((pass) => pass.at));
    const week = weeks.get(weekOf(first));
    if (week) week.shipped += 1;
  }

  const counted = new Set<string>();
  const count = (step: number, week: string) => {
    const row = weeks.get(week);
    if (!row || !passes.has(step) || counted.has(`${step}:${week}`)) return;
    counted.add(`${step}:${week}`);
    row.sentBack += 1;
  };

  for (const step of steps) {
    for (const date of sentBackDates(step.comment)) {
      count(step.number, weekOf(Date.parse(`${date}T00:00:00Z`)));
    }
  }

  const window = COMPLAINT_DAYS * DAY_MS;
  for (const note of notes) {
    if (!isLookNote(note.body)) continue;
    const at = Date.parse(note.created_at);
    if (Number.isNaN(at)) continue;
    const surfaces = surfacesOfNote(note.page_path);
    if (surfaces.length === 0) continue;
    for (const [step, list] of passes) {
      if (list.some((pass) => surfaces.includes(pass.surface) && pass.at <= at && pass.at >= at - window)) {
        count(step, weekOf(at));
      }
    }
  }
  return [...weeks.values()];
}

/** The week's share as a whole percentage, or null for a week that shipped nothing. */
export function sentBackShare(week: SentBackWeek): number | null {
  return week.shipped === 0 ? null : Math.round((week.sentBack / week.shipped) * 100);
}
