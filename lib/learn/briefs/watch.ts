/**
 * The weekly check of a brief for newly published sources (plan #2023.8;
 * feature #2023, "Research a topic when you ask Dash").
 *
 * A brief with its watch switch on (off by default, decision #2023.7) is
 * checked once a week, or once a month after four checks in a row found
 * nothing. A check is one Haiku call with two web searches, asked for what
 * has been published since the last check and shown the links already on the
 * list. It ends by listing each new source with a line on what it changes in
 * the brief's answer, or with NOTHING NEW.
 *
 * This file has the timing, the prompt and the reading of the reply, and is
 * tested from fixtures. watch-run.ts makes the call and writes the rows;
 * inngest/learn/brief-watch.ts is the daily cron's stage.
 */

import { domainOf, pageUrl } from '@/lib/learn/essays/research';
import { readFoundKind, type Brief, type FoundKind, type SubQuestion } from './model';
import { kindFromDomain, type SearchResult } from './research';
import { dayLabel } from './view';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A watched brief is checked this often. */
export const WEEK_MS = 7 * DAY_MS;
/** And this often once it has gone quiet. */
export const MONTH_MS = 30 * DAY_MS;
/** Checks in a row that found nothing before the brief goes monthly. */
export const QUIET_LIMIT = 4;
/** Web searches one check may run. */
export const WATCH_SEARCHES = 2;
/** The most sources one check adds. */
export const NEW_MAX = 3;

const WHY_MAX = 300;
const SUMMARY_MAX = 2_000;
const CHANGE_MAX = 600;

export type WatchState = Pick<Brief, 'watchOn' | 'archivedAt' | 'status' | 'watchedAt' | 'quietChecks' | 'createdAt'>;

/** How long a brief waits between checks: a week, or a month once it has gone quiet. */
export function checkInterval(quietChecks: number): number {
  return quietChecks >= QUIET_LIMIT ? MONTH_MS : WEEK_MS;
}

/**
 * When the next check is due. A brief never checked counts from when it was
 * made, since its first run read what was published up to then.
 */
export function nextCheckAt(brief: Pick<WatchState, 'watchedAt' | 'quietChecks' | 'createdAt'>): number {
  const from = Date.parse(brief.watchedAt ?? brief.createdAt);
  return from + checkInterval(brief.quietChecks);
}

/** Whether the daily run checks this brief today. */
export function checkDue(brief: WatchState, now: number): boolean {
  if (!brief.watchOn || brief.archivedAt || brief.status !== 'ready') return false;
  return nextCheckAt(brief) <= now;
}

/** The quiet count after a check: back to none when it found something. */
export function quietAfter(quietChecks: number, added: number): number {
  return added > 0 ? 0 : quietChecks + 1;
}

/** What the rail says under the switch. */
export function watchLine(brief: Pick<WatchState, 'watchOn' | 'watchedAt' | 'quietChecks' | 'createdAt'>): string {
  const checked = brief.watchedAt ? `Last checked ${dayLabel(brief.watchedAt)}` : 'Not checked yet';
  if (!brief.watchOn) return checked;
  if (brief.quietChecks >= QUIET_LIMIT) return `${checked}. Nothing new ${brief.quietChecks} times in a row, so now monthly`;
  return checked;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export const WATCH_SYSTEM = `You are Dash, checking whether anything new has been published on a topic
someone asked you to research. They already have a brief answering their
question and a reading list. Your job is to find what has come out since the
date given, and only that.

You have at most ${WATCH_SEARCHES} web searches. Look for new rules, guidance,
consultations, enforcement, research and serious commentary on the topic,
preferring regulators and standard-setters, then professional bodies, firms
and the press. A page published before the date is not new, however good,
and a page already on the list is never listed again.

When you have finished, list each new source worth reading, at most ${NEW_MAX}, best
first. Each takes five lines:

SOURCE: <the page's address, exactly as the search returned it>
KIND: regulator | professional body | firm | press | vendor
WHY: <one sentence on what it answers for this question>
SUMMARY: <two or three sentences on what the page says>
CHANGES: <one sentence on what it changes in the answer below, or what it adds to it>

List only pages your searches returned. If nothing new was published since
the date, write NOTHING NEW and nothing else.`;

export function watchPrompt(input: {
  question: string;
  angle: string;
  subQuestions: readonly SubQuestion[];
  shortAnswer: string;
  since: string;
  known: readonly string[];
}): string {
  const parts = [`The question: ${input.question.trim()}`];
  if (input.angle.trim()) parts.push(`Why they want to know: ${input.angle.trim()}`);
  if (input.subQuestions.length > 0) {
    parts.push(`The sub-questions:\n${input.subQuestions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')}`);
  }
  if (input.shortAnswer.trim()) parts.push(`The answer so far:\n${input.shortAnswer.trim()}`);
  parts.push(`Look for what was published after ${input.since.slice(0, 10)}.`);
  parts.push(
    input.known.length > 0
      ? `Already on their list, so not new:\n${input.known.map((url) => `- ${url}`).join('\n')}`
      : 'Nothing is on their list yet.',
  );
  return parts.join('\n\n');
}

/** One source as the check listed it. */
export type WatchedSource = { url: string; kind: FoundKind | null; why: string; summary: string; change: string };

/**
 * The sources the check listed, in its order: a `SOURCE:` line opens one and
 * `KIND:`, `WHY:`, `SUMMARY:` and `CHANGES:` lines fill it. Any of the last
 * three may run on over several lines. NOTHING NEW reads as none.
 */
export function readWatchList(text: string): WatchedSource[] {
  const out: WatchedSource[] = [];
  let current: WatchedSource | null = null;
  let field: 'why' | 'summary' | 'change' | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\*\*/g, '').trim();
    const match = /^[-*\s]*(SOURCE|KIND|WHY|SUMMARY|CHANGES?)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      const key = match[1].toUpperCase();
      const value = match[2].trim();
      if (key === 'SOURCE') {
        const url = /https?:\/\/\S+/i.exec(value)?.[0].replace(/[>),.\]]+$/, '') ?? '';
        current = url ? { url: pageUrl(url), kind: null, why: '', summary: '', change: '' } : null;
        if (current) out.push(current);
        field = null;
      } else if (current && key === 'KIND') {
        current.kind = readFoundKind(value);
        field = null;
      } else if (current) {
        field = key === 'WHY' ? 'why' : key === 'SUMMARY' ? 'summary' : 'change';
        current[field] = value;
      }
    } else if (current && field && line) {
      current[field] = `${current[field]} ${line}`.trim();
    } else if (!line) {
      field = null;
    }
  }
  return out;
}

/**
 * When a search said a page was published, as a time, or null when it did
 * not say or said it in a way this cannot read. Search results give it as a
 * date ("April 30, 2025") or as an age ("3 days ago").
 */
export function publishedAt(pageAge: string | null, now: number): number | null {
  if (!pageAge) return null;
  const text = pageAge.trim().toLowerCase();
  const ago = /^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/.exec(text);
  if (ago) {
    const unit = { minute: 60_000, hour: 3_600_000, day: DAY_MS, week: WEEK_MS, month: MONTH_MS, year: 365 * DAY_MS }[
      ago[2] as 'minute'
    ];
    return now - Number(ago[1]) * unit;
  }
  if (text === 'yesterday') return now - DAY_MS;
  if (text === 'today') return now;
  const parsed = Date.parse(pageAge);
  return Number.isNaN(parsed) ? null : parsed;
}

/** A new source going on the list, with the line on what it changes. */
export type NewSource = {
  url: string;
  title: string;
  kind: FoundKind;
  why: string;
  summary: string | null;
  change: string;
};

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The sources a check adds, at most three: the ones it listed that a search
 * returned, over https, not already on the list by their link, and not dated
 * by the search to before the last check. A page the search gave no date for
 * is kept, since the model was asked for new pages only. A source with no
 * line on what it changes is left out: that line is what the brief shows.
 */
export function chooseNewSources(input: {
  listed: readonly WatchedSource[];
  results: readonly SearchResult[];
  known: readonly string[];
  since: number;
  now: number;
}): NewSource[] {
  const known = new Set(input.known.map(pageUrl));
  const resultByUrl = new Map(input.results.map((r) => [r.url, r]));
  const out: NewSource[] = [];
  for (const listed of input.listed) {
    if (out.length >= NEW_MAX) break;
    const url = listed.url;
    if (!/^https:\/\//i.test(url) || known.has(url) || out.some((s) => s.url === url)) continue;
    const result = resultByUrl.get(url);
    if (!result) continue;
    const published = publishedAt(result.pageAge, input.now);
    if (published !== null && published < input.since) continue;
    const change = oneLine(listed.change).slice(0, CHANGE_MAX);
    const why = oneLine(listed.why).slice(0, WHY_MAX) || change.slice(0, WHY_MAX);
    if (!change || !why) continue;
    out.push({
      url,
      title: (result.title || domainOf(url) || url).slice(0, 500),
      kind: listed.kind ?? kindFromDomain(domainOf(url)),
      why,
      summary: oneLine(listed.summary).slice(0, SUMMARY_MAX) || null,
      change,
    });
  }
  return out;
}
