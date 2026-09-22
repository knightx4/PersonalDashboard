/**
 * Reading the article list off Wikipedia's Level 3 vital articles page.
 *
 * The check in docs/LEARN-AREAS-SPEC.md places every one of these articles
 * into a field, so it needs the list itself: each article's title and the
 * headings it sat under. The page is fetched as wikitext through the action
 * API, and this reads it.
 *
 * The page is a hand-edited list, so the parse is deliberately plain. A heading
 * line opens a section; a list line (`#` or `*`) contributes the first article
 * link on it. Links into other namespaces -- `Wikipedia:`, `File:`,
 * `Category:` -- are not articles and are skipped.
 *
 * Pure. The fetch is the caller's, so this can be tested against a fixture.
 */

/**
 * The page's title. It moved from `Level/3` to `Level 3` in 2026 and the old
 * title is now a redirect, which `redirects=1` below follows, so a later move
 * does not quietly return a one-line redirect page.
 */
export const LEVEL3_PAGE = 'Wikipedia:Vital_articles/Level_3';

export function level3RequestUrl(): string {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', LEVEL3_PAGE);
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'wikitext');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  return url.toString();
}

/**
 * Fewer than this and the parse has gone wrong rather than the page having
 * shrunk. The page holds a thousand by definition; the margin is for articles
 * listed twice and the odd line in a shape this does not read. Refusing below
 * it is what keeps a broken parse from being placed and read as a finding.
 */
export const MIN_ARTICLES = 900;

export type Level3Article = { title: string; section: string };

const HEADING = /^(={2,6})\s*(.+?)\s*\1\s*$/;
const LIST_LINE = /^[#*]+/;
const LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const OTHER_NAMESPACE = /^(wikipedia|wp|file|image|category|template|help|portal|special|talk|user):/i;

/** A heading as a reader would say it: no counts, no markup. */
function cleanHeading(raw: string): string {
  return raw
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\([^)]*\)/g, '')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstArticleLink(line: string): string | null {
  for (const match of line.matchAll(LINK)) {
    const title = match[1].replace(/_/g, ' ').replace(/^:/, '').trim();
    if (!title || OTHER_NAMESPACE.test(title)) continue;
    return title.charAt(0).toUpperCase() + title.slice(1);
  }
  return null;
}

/**
 * Every article on the page, in page order, each once.
 *
 * `section` joins the open headings outermost first. The page's own title
 * heading and anything above the first `==` heading contribute nothing.
 */
export function parseLevel3(wikitext: string): Level3Article[] {
  const open: string[] = [];
  const seen = new Set<string>();
  const articles: Level3Article[] = [];

  for (const rawLine of wikitext.split(/\r?\n/)) {
    const line = rawLine.trim();

    const heading = HEADING.exec(line);
    if (heading) {
      const depth = heading[1].length - 2;
      open.length = depth;
      open[depth] = cleanHeading(heading[2]);
      continue;
    }

    if (!LIST_LINE.test(line) || open.length === 0) continue;

    const title = firstArticleLink(line);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({ title, section: open.filter(Boolean).join(' > ') });
  }

  return articles;
}

/** The wikitext out of the API's answer, or null when it is not there. */
export function wikitextFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { parse?: { wikitext?: unknown } };
    const text = parsed.parse?.wikitext;
    return typeof text === 'string' && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
