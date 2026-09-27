/**
 * Reading what the suggestion calls report, before anything is stored.
 *
 * The model is told the rules; these check them. An outreach suggestion must
 * name a candidate it was given, and a posting must carry a link that is a
 * web address and not one already suggested or applied for. Text is trimmed
 * to the column limits and has the person's banned constructions taken out
 * where that can be done without rewriting (the em dash, above all).
 */
import type { Candidate } from './candidates';

export const MAX_OUTREACH = 3;
export const MAX_OPENINGS = 5;

export const CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export type OutreachSuggestion = {
  candidate: Candidate;
  headline: string;
  why: string;
  move: string;
  channel: Channel;
  message: string;
};

export type OpeningSuggestion = {
  company: string;
  title: string;
  url: string;
  location: string | null;
  why: string;
  move: string;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/**
 * Takes out what the person asked never to see, where it can go without a
 * rewrite: an em dash becomes a comma, or a hyphen between numbers. Phrases
 * are left, since cutting one out of a sentence would break it; the prompt
 * lists them so they are rarely there.
 */
export function cleanText(value: string): string {
  return value
    .replace(/(\d)\s*—\s*(\d)/g, '$1-$2')
    .replace(/\s*—\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}

function clean(value: unknown, max: number): string | null {
  const read = text(value, max);
  return read === null ? null : cleanText(read);
}

export function parseOutreachPayload(raw: unknown, candidates: readonly Candidate[]): OutreachSuggestion[] {
  const list = (raw as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return [];
  const byRef = new Map(candidates.map((candidate) => [candidate.ref, candidate]));
  const used = new Set<string>();
  const out: OutreachSuggestion[] = [];

  for (const entry of list) {
    if (out.length >= MAX_OUTREACH) break;
    const item = entry as Record<string, unknown>;
    const ref = typeof item.ref === 'string' ? item.ref.trim() : '';
    const candidate = byRef.get(ref);
    if (!candidate || used.has(ref)) continue;
    const headline = clean(item.headline, 300);
    const why = clean(item.why, 1000);
    const move = clean(item.move, 1500);
    const message = clean(item.message, 4000);
    if (!headline || !why || !move || !message) continue;
    const channel = CHANNELS.includes(item.channel as Channel) ? (item.channel as Channel) : 'other';
    used.add(ref);
    out.push({ candidate, headline, why, move, channel, message });
  }
  return out;
}

/** A company and title reduced to what two spellings of the same role share. */
export function roleKey(company: string, title: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|co)\b\.?/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(company)}|${norm(title)}`;
}

function webAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function parseOpeningsPayload(
  raw: unknown,
  taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string> },
): OpeningSuggestion[] {
  const list = (raw as { openings?: unknown } | null)?.openings;
  if (!Array.isArray(list)) return [];
  const urls = new Set(taken.urls);
  const roles = new Set(taken.roles);
  const out: OpeningSuggestion[] = [];

  for (const entry of list) {
    if (out.length >= MAX_OPENINGS) break;
    const item = entry as Record<string, unknown>;
    const company = clean(item.company, 200);
    const title = clean(item.title, 250);
    const url = webAddress(item.url);
    const why = clean(item.why, 1000);
    const move = clean(item.move, 1500);
    if (!company || !title || !url || !why || !move) continue;
    const key = roleKey(company, title);
    if (urls.has(url) || roles.has(key)) continue;
    urls.add(url);
    roles.add(key);
    out.push({ company, title, url, location: clean(item.location, 200), why, move });
  }
  return out;
}

/** An email message split into its subject line and body, as the prompt asks it written. */
export function splitSubject(message: string): { subject: string | null; body: string } {
  const match = /^subject:\s*(.+)\n+/i.exec(message);
  if (!match) return { subject: null, body: message };
  return { subject: match[1].trim(), body: message.slice(match[0].length).trim() };
}
