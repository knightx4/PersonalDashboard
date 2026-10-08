import type { CompanyStage } from '@/lib/jobs/suggest/preferences';

/**
 * The two free lists of hiring startups that startup discovery reads (plan
 * #1679), parsed into typed candidates.
 *
 * YC: yc-oss's mirror of YC's directory, `companies/hiring.json`, one entry
 * per company marked as hiring (about 1,500 in October 2026). The mirror is
 * unofficial, so every field is read defensively and an entry without a name
 * is skipped rather than failing the list.
 *
 * Hacker News: the monthly "Ask HN: Who is hiring?" thread by the
 * whoishiring account, found through the Algolia search API and read whole
 * through its items endpoint. Each top-level comment is one company's post.
 * The post is kept as it came (HTML and plain text) for the shortlist step to
 * read; only the first line is parsed here, for the filter.
 *
 * Pure, so the parsing is tested against saved copies of both feeds.
 */

export const YC_HIRING_URL = 'https://yc-oss.github.io/api/companies/hiring.json';
/** The newest stories by whoishiring; the hiring thread is among the first few. */
export const HN_THREAD_SEARCH_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10';
export function hnItemUrl(id: number): string {
  return `https://hn.algolia.com/api/v1/items/${id}`;
}

export type YcCandidate = {
  source: 'yc';
  /** yc-oss's numeric id. */
  ycId: number | null;
  name: string;
  slug: string | null;
  website: string | null;
  /** The website's host without `www.`, for matching against companies on file. */
  domain: string | null;
  oneLiner: string | null;
  description: string | null;
  /** YC's top-level industry, such as "B2B" or "Healthcare". */
  industry: string | null;
  /** Industry and sub-industry, as YC lists them. */
  industries: string[];
  tags: string[];
  /** YC's Early and Growth, and Public for a listed company; null when not given. */
  stage: CompanyStage | null;
  batch: string | null;
  teamSize: number | null;
  /** As YC writes them: "San Francisco, CA, USA; Remote". */
  locations: string | null;
  /** Countries and areas, with "Remote" and "Fully Remote" or "Partly Remote" when it hires remotely. */
  regions: string[];
  /** The company's page on ycombinator.com. */
  ycUrl: string | null;
};

export type HnCandidate = {
  source: 'hn';
  /** The comment's id. */
  hnId: number;
  threadId: number;
  author: string | null;
  postedAt: string | null;
  /** The first line of the post, plain text: usually "Company | Role | Place | Remote". */
  header: string;
  /** The company as the header's first part names it; a guess, refined by the shortlist. */
  company: string | null;
  /** The whole post as plain text, paragraphs separated by blank lines. */
  text: string;
  /** The post as HN serves it. */
  html: string;
  /** Every link in the post, in order. */
  links: string[];
  /** The post on news.ycombinator.com. */
  url: string;
};

export type HiringCandidate = YcCandidate | HnCandidate;

export type HnThread = { id: number; title: string; postedAt: string | null };

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((v): v is string => v !== null) : [];
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

/** The host of a website without `www.`, lower-cased; null when it is not a URL. */
export function websiteDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function ycStage(entry: Obj): CompanyStage | null {
  if (text(entry.status)?.toLowerCase() === 'public') return 'public';
  const stage = text(entry.stage)?.toLowerCase();
  if (stage === 'early') return 'early';
  if (stage === 'growth') return 'growth';
  return null;
}

/** yc-oss's hiring list as candidates, skipping entries with no name and repeats of one id. */
export function parseYcHiring(raw: unknown): YcCandidate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: YcCandidate[] = [];
  for (const item of raw) {
    const entry = obj(item);
    const name = entry && text(entry.name);
    if (!entry || !name) continue;
    const ycId = int(entry.id);
    const key = ycId !== null ? `id:${ycId}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const website = text(entry.website);
    out.push({
      source: 'yc',
      ycId,
      name,
      slug: text(entry.slug),
      website,
      domain: websiteDomain(website),
      oneLiner: text(entry.one_liner),
      description: text(entry.long_description),
      industry: text(entry.industry),
      industries: strings(entry.industries),
      tags: strings(entry.tags),
      stage: ycStage(entry),
      batch: text(entry.batch),
      teamSize: int(entry.team_size),
      locations: text(entry.all_locations),
      regions: strings(entry.regions),
      ycUrl: text(entry.url),
    });
  }
  return out;
}

/** The newest "Ask HN: Who is hiring?" thread in an Algolia search result; null when there is none. */
export function pickWhoIsHiringThread(raw: unknown): HnThread | null {
  const hits = obj(raw)?.hits;
  if (!Array.isArray(hits)) return null;
  const threads: (HnThread & { at: number })[] = [];
  for (const item of hits) {
    const hit = obj(item);
    const title = hit && text(hit.title);
    if (!hit || !title || !/^ask hn: who is hiring\?/i.test(title)) continue;
    const id = Number(hit.objectID ?? hit.story_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    threads.push({ id, title, postedAt: text(hit.created_at), at: int(hit.created_at_i) ?? 0 });
  }
  threads.sort((a, b) => b.at - a.at);
  const newest = threads[0];
  return newest ? { id: newest.id, title: newest.title, postedAt: newest.postedAt } : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** HN's comment HTML as plain text: paragraphs become blank lines, links their full href. */
export function hnHtmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi, (_, href: string) => href)
      .replace(/<p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hnLinks(html: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\s[^>]*href="([^"]*)"/gi)) {
    const href = decodeEntities(match[1]);
    if (/^https?:\/\//i.test(href) && !links.includes(href)) links.push(href);
  }
  return links;
}

/**
 * The company a post's header names: the part before the first `|`, dash or
 * opening bracket, without a URL. "Thunder Compute (YC S24) | C++ …" gives
 * "Thunder Compute". Null when nothing name-like is left.
 */
export function hnCompanyName(header: string): string | null {
  const first = header.split(/\s*\|\s*|\s+[—–-]\s+/)[0] ?? '';
  const name = first
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s*[([].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name && name.length <= 80 ? name : null;
}

/**
 * A top-level comment shorter than this is talk about the thread ("there used
 * to be 800+ posts here"), not a job post.
 */
export const HN_MIN_POST_CHARS = 150;

/** The posts in an Algolia item of a hiring thread: its top-level comments, without deleted ones or chatter. */
export function parseHnThread(raw: unknown): HnCandidate[] {
  const thread = obj(raw);
  const threadId = int(thread?.id);
  const children = thread?.children;
  if (!thread || threadId === null || !Array.isArray(children)) return [];
  const out: HnCandidate[] = [];
  const seen = new Set<number>();
  for (const item of children) {
    const comment = obj(item);
    const hnId = int(comment?.id);
    const html = comment && typeof comment.text === 'string' ? comment.text : '';
    if (!comment || hnId === null || seen.has(hnId) || !html.trim()) continue;
    if (comment.parent_id !== undefined && int(comment.parent_id) !== threadId) continue;
    const body = hnHtmlToText(html);
    if (body.length < HN_MIN_POST_CHARS) continue;
    seen.add(hnId);
    const header = body.split('\n')[0].trim().slice(0, 300);
    out.push({
      source: 'hn',
      hnId,
      threadId,
      author: text(comment.author),
      postedAt: text(comment.created_at),
      header,
      company: hnCompanyName(header),
      text: body,
      html,
      links: hnLinks(html),
      url: `https://news.ycombinator.com/item?id=${hnId}`,
    });
  }
  return out;
}
