/**
 * Reading Wikipedia's Level 4 vital articles and the other names each one
 * goes by (plan #2016.1).
 *
 * The Level 4 list is about ten thousand articles spread over eleven section
 * pages linked from one index page. Each section page is a hand-edited list
 * in the same shape as the Level 3 page, so `parseLevel3` reads it; a section
 * that is split further transcludes its subpages, and those are read too.
 *
 * An article's other names are the redirects that point at it: "LBO" for
 * Leveraged buyout. A redirect to one section of an article names a part of
 * it rather than the whole, and a redirect that differs from the title only
 * in case, spacing or punctuation adds nothing a whole-word match would not
 * already find, so both are left out.
 *
 * Pure. The fetching is lib/learn/areas/topic-import.ts's, so this is tested
 * against fixtures.
 */

import { parseLevel3, type Level3Article } from '@/lib/learn/areas/level3';

export const LEVEL4_INDEX = 'Wikipedia:Vital articles/Level 4';

/** The index page lists eleven sections; fewer means the parse went wrong. */
export const LEVEL4_SECTIONS = 11;

/**
 * Fewer than this across all sections and the import refuses to write. The
 * list holds ten thousand by definition, with a margin for lines in a shape
 * this does not read.
 */
export const LEVEL4_MIN_ARTICLES = 9_000;

/** Titles per redirects query, the API's ceiling for an anonymous client. */
export const REDIRECT_BATCH = 50;

/** More than this many other names for one article are kept as the first ones. */
export const MAX_ALIASES = 60;

const WIKI = 'https://en.wikipedia.org';

/** A page's wikitext as stored, through index.php rather than the action API. */
export function rawPageUrl(title: string): string {
  const url = new URL(`${WIKI}/w/index.php`);
  url.searchParams.set('title', title.replace(/ /g, '_'));
  url.searchParams.set('action', 'raw');
  return url.toString();
}

/** The redirects into up to REDIRECT_BATCH articles, from `continueFrom` on. */
export function redirectsUrl(titles: string[], continueFrom: string | null = null): string {
  const url = new URL(`${WIKI}/w/api.php`);
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'redirects');
  url.searchParams.set('titles', titles.join('|'));
  url.searchParams.set('rdnamespace', '0');
  url.searchParams.set('rdprop', 'title|fragment');
  url.searchParams.set('rdlimit', 'max');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  // Asks the API to refuse rather than add to a lagging database, which is
  // what its etiquette asks of a batch job.
  url.searchParams.set('maxlag', '5');
  if (continueFrom) url.searchParams.set('rdcontinue', continueFrom);
  return url.toString();
}

const SECTION_LINK = /\[\[\s*(Wikipedia:Vital articles\/Level[ _]4\/[^\]|#]+?)\s*(?:\|([^\]]*))?\]\]/g;

/**
 * The section pages the index links to, in its order, each with the name the
 * index shows for it.
 */
export function parseLevel4Index(wikitext: string): { page: string; name: string }[] {
  const seen = new Set<string>();
  const sections: { page: string; name: string }[] = [];
  for (const match of wikitext.matchAll(SECTION_LINK)) {
    const page = match[1].replace(/_/g, ' ').trim();
    const rest = page.slice('Wikipedia:Vital articles/Level 4/'.length);
    // A link to a subpage of a section is the section's business, not the index's.
    if (!rest || rest.includes('/')) continue;
    if (seen.has(page)) continue;
    seen.add(page);
    sections.push({ page, name: (match[2] ?? rest).trim() || rest });
  }
  return sections;
}

const TRANSCLUSION = /\{\{\s*:?\s*(Wikipedia:Vital articles\/Level[ _]4\/[^}|]+?)\s*\}\}/g;

/** Subpages a section page pulls in whole, which hold more of its articles. */
export function transcludedPages(wikitext: string): string[] {
  const pages: string[] = [];
  for (const match of wikitext.matchAll(TRANSCLUSION)) {
    const page = match[1].replace(/_/g, ' ').trim();
    if (!pages.includes(page)) pages.push(page);
  }
  return pages;
}

/** "Total 1,926 articles." at the head of a section page, when it says. */
export function statedTotal(wikitext: string): number | null {
  const match = /Total\s+([\d,]+)\s+articles/i.exec(wikitext);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * One section page's articles, with `section` starting at the section's name
 * so it reads like the Level 3 rows ("People > Writers > Ancient").
 */
export function parseLevel4Section(wikitext: string, sectionName: string): Level3Article[] {
  return parseLevel3(wikitext).map((article) => {
    const inner = article.section
      .split(' > ')
      .filter((part) => part && part.toLowerCase() !== sectionName.toLowerCase());
    return { title: article.title, section: [sectionName, ...inner].join(' > ') };
  });
}

/** Lower case with everything but letters and digits removed. */
export function squash(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A redirect title that is bookkeeping rather than a name: an old subpage
 * ("United States/Introduction") or a code with a prefix ("ISO 3166-1:US").
 * A colon followed by a space is an ordinary title ("Star Wars: Episode IV").
 */
const NOT_A_NAME = /\/|:\S/;

/**
 * The names worth keeping for one article: no section redirects, no
 * bookkeeping titles, nothing that squashes to the title or to a name already
 * kept, and at most MAX_ALIASES. Shortest first, so an article with hundreds
 * of redirects keeps its acronyms ("USA", "LBO") over its long variants.
 */
export function cleanAliases(title: string, redirects: { title: string; fragment?: string }[]): string[] {
  const seen = new Set<string>([squash(title)]);
  const kept: string[] = [];
  for (const redirect of redirects) {
    if (redirect.fragment) continue;
    const name = redirect.title.trim();
    if (NOT_A_NAME.test(name)) continue;
    const key = squash(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(name);
  }
  return kept
    .map((name, order) => ({ name, order }))
    .sort((a, b) => a.name.length - b.name.length || a.order - b.order)
    .slice(0, MAX_ALIASES)
    .map((entry) => entry.name);
}

type RedirectPage = {
  title?: unknown;
  redirects?: { title?: unknown; fragment?: unknown }[];
};

export type RedirectAnswer = {
  /** Redirects per article title as the API names it, for this page of answers. */
  byTitle: Map<string, { title: string; fragment?: string }[]>;
  /**
   * The API's own spelling for a title it was asked about under another one:
   * normalised ("Leveraged_buyout") or followed through a redirect, when the
   * list links an article by an old name.
   */
  renamed: Map<string, string>;
  /** Where the next page of this query starts, or null when it is done. */
  next: string | null;
};

/** One answer from `redirectsUrl`, or null when it is not one. */
export function parseRedirects(body: string): RedirectAnswer | null {
  let parsed: {
    query?: {
      pages?: RedirectPage[];
      normalized?: { from?: unknown; to?: unknown }[];
      redirects?: { from?: unknown; to?: unknown }[];
    };
    continue?: { rdcontinue?: unknown };
    error?: unknown;
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || parsed.error || !parsed.query) return null;

  const byTitle = new Map<string, { title: string; fragment?: string }[]>();
  for (const page of parsed.query.pages ?? []) {
    if (typeof page.title !== 'string') continue;
    const list = (page.redirects ?? [])
      .filter((r): r is { title: string; fragment?: unknown } => typeof r.title === 'string')
      .map((r) => (typeof r.fragment === 'string' && r.fragment ? { title: r.title, fragment: r.fragment } : { title: r.title }));
    byTitle.set(page.title, list);
  }

  const renamed = new Map<string, string>();
  for (const step of [...(parsed.query.normalized ?? []), ...(parsed.query.redirects ?? [])]) {
    if (typeof step.from === 'string' && typeof step.to === 'string') renamed.set(step.from, step.to);
  }

  const next = typeof parsed.continue?.rdcontinue === 'string' ? parsed.continue.rdcontinue : null;
  return { byTitle, renamed, next };
}

/** Follow `renamed` from a title as the list gave it to the article's own. */
export function resolveTitle(title: string, renamed: Map<string, string>): string {
  let current = title;
  for (let i = 0; i < 3; i += 1) {
    const to = renamed.get(current);
    if (!to || to === current) break;
    current = to;
  }
  return current;
}
