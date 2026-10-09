/**
 * Where a recommended role came from, as the row says it: the list or search
 * that found it, and the site its link is on. Every row carries one, so the
 * person can see which sources are worth their time and filter by one.
 * Pure, so the page and the gallery share it.
 */

export const OPENING_SOURCES = ['yc', 'hn', 'board', 'search', 'goal'] as const;
export type OpeningSource = (typeof OPENING_SOURCES)[number];

export const OPENING_SOURCE_LABELS: Record<OpeningSource, string> = {
  yc: 'YC startup list',
  hn: 'Hacker News hiring thread',
  board: 'a company you follow',
  search: "Dash's web search",
  goal: 'a goal step',
};

export function isOpeningSource(value: unknown): value is OpeningSource {
  return typeof value === 'string' && (OPENING_SOURCES as readonly string[]).includes(value);
}

/** Job sites by the end of their host, named as people know them. */
const SITES: [string, string][] = [
  ['greenhouse.io', 'Greenhouse'],
  ['lever.co', 'Lever'],
  ['ashbyhq.com', 'Ashby'],
  ['myworkdayjobs.com', 'Workday'],
  ['smartrecruiters.com', 'SmartRecruiters'],
  ['workable.com', 'Workable'],
  ['recruitee.com', 'Recruitee'],
  ['breezy.hr', 'Breezy'],
  ['bamboohr.com', 'BambooHR'],
  ['rippling.com', 'Rippling'],
  ['icims.com', 'iCIMS'],
  ['linkedin.com', 'LinkedIn'],
  ['wellfound.com', 'Wellfound'],
  ['ycombinator.com', 'YC'],
  ['workatastartup.com', 'Work at a Startup'],
  ['news.ycombinator.com', 'Hacker News'],
];

/** The job site a link is on, by name when it is a known one, else its host. */
export function siteOf(url: string | null): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  const known = SITES.find(([end]) => host === end || host.endsWith(`.${end}`));
  return known ? known[1] : host;
}

export type SourceView = { key: OpeningSource; label: string; site: string | null };

/**
 * The source of one role. A discovered startup's role says which list found
 * the startup (found_in reads "Found on YC" or "Found on Hacker News"); a row
 * with no origin was written by a goals run before origins were kept.
 */
export function openingSource(row: { origin: string | null; foundIn: string | null; url: string | null }): SourceView {
  const key: OpeningSource =
    row.origin === 'discovered'
      ? /hacker news/i.test(row.foundIn ?? '')
        ? 'hn'
        : 'yc'
      : row.origin === 'board' || row.origin === 'search'
        ? row.origin
        : 'goal';
  return { key, label: OPENING_SOURCE_LABELS[key], site: siteOf(row.url) };
}

/** The fact on the row: "From YC startup list · Ashby". */
export function sourceText(source: SourceView): string {
  return source.site ? `From ${source.label} · ${source.site}` : `From ${source.label}`;
}
