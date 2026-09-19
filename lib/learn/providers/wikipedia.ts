import 'server-only';

import { z } from 'zod';
import { fetchDocument } from './fetch';

/**
 * Wikipedia, the first provider in the catalogue.
 *
 * docs/LEARN-SOURCES-SPEC.md puts this first because it needs no credential
 * and its section structure gives segment boundaries without any transcript
 * work: one article is one `catalogue_items` row, one section is one
 * `catalogue_segments` row, and the anchor the section already has is what
 * addresses it.
 *
 * One request, to the MediaWiki action API:
 *
 *   action=query&prop=extracts|info&explaintext=1&exsectionformat=wiki
 *
 * `prop=extracts` with `explaintext` returns the whole article as plain text
 * with its headings still in wiki form (`== History ==`), which is the shape
 * this module splits on. The alternative -- `action=parse`, which returns
 * rendered HTML and an authoritative list of section anchors -- would need an
 * HTML parser this repository does not have, and the anchors it hands back are
 * derivable: MediaWiki's HTML5 heading ids are the heading text with spaces
 * turned into underscores, and a repeat gets `_2`. `anchorFor` below is that
 * rule, and it is the one place this module guesses at anything.
 *
 * The lead section is the exception with no anchor at all, because Wikipedia
 * gives it none -- the "(Top)" entry in an article's own contents links to the
 * page with no fragment. It is still stored, with its text, because it is the
 * best short statement of what the article is about and so the segment most
 * worth embedding.
 */

/** The `slug` on the seeded `catalogue_providers` row. */
export const WIKIPEDIA_PROVIDER_SLUG = 'wikipedia';

const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const ARTICLE_BASE = 'https://en.wikipedia.org/wiki/';

export type WikipediaSection = {
  /** Position in the article, from 0. The lead is 0. */
  ordinal: number;
  /** The fragment that addresses the section, or null for the lead. */
  anchor: string | null;
  heading: string | null;
  text: string;
};

export type WikipediaArticle = {
  /** The page title with underscores, which is what `external_id` holds. */
  externalId: string;
  title: string;
  canonicalUrl: string;
  lengthChars: number;
  sections: WikipediaSection[];
};

export type WikipediaFailure = {
  ok: false;
  /**
   * `not-found` is an article that does not exist, which is an ordinary answer
   * to a mistyped title. `unreadable` is an article that exists and has no
   * plain text to store, which is what a redirect page or a disambiguation
   * stub looks like from here.
   */
  reason: 'not-found' | 'unreadable' | 'blocked' | 'error';
  detail: string;
};

export type WikipediaResult = ({ ok: true } & WikipediaArticle) | WikipediaFailure;

function fail(reason: WikipediaFailure['reason'], detail: string): WikipediaFailure {
  return { ok: false, reason, detail };
}

/** The one request this provider makes. Exported so a test can read it. */
export function articleRequestUrl(title: string): string {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  // A title that redirects is followed here rather than stored twice.
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'extracts|info');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('exsectionformat', 'wiki');
  url.searchParams.set('titles', title);
  return url.toString();
}

/**
 * MediaWiki's heading id, restated.
 *
 * Spaces become underscores and a repeated heading gets a number, counting
 * from 2. Nothing else is escaped: ids have been HTML5 since MediaWiki 1.30,
 * so an apostrophe or an ampersand in a heading survives into the fragment.
 */
function anchorFor(heading: string, taken: Set<string>): string {
  const base = heading.replace(/\s+/g, '_');
  let anchor = base;
  for (let n = 2; taken.has(anchor); n += 1) anchor = `${base}_${n}`;
  taken.add(anchor);
  return anchor;
}

const HEADING = /^(={2,6})\s*(.+?)\s*\1\s*$/;

/**
 * Split a plain-text extract into one section per heading.
 *
 * A section with no text of its own is dropped rather than stored empty. That
 * is not a rare case: `References` and `External links` are lists, which the
 * extract strips, and a heading that exists only to hold subsections has
 * nothing under it either. Ordinals are assigned after that filter, so they
 * stay contiguous from 0 and the sweep can delete the tail of a re-swept
 * article by ordinal.
 */
export function sectionsFromExtract(extract: string): WikipediaSection[] {
  const taken = new Set<string>();
  const sections: WikipediaSection[] = [];

  let heading: string | null = null;
  let anchor: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text) return;
    sections.push({ ordinal: sections.length, anchor, heading, text });
  };

  for (const line of extract.split('\n')) {
    const match = HEADING.exec(line);
    if (!match) {
      buffer.push(line);
      continue;
    }
    flush();
    heading = match[2];
    anchor = anchorFor(heading, taken);
  }
  flush();

  return sections;
}

const Page = z.object({
  pageid: z.number().optional(),
  title: z.string(),
  missing: z.boolean().optional(),
  invalid: z.boolean().optional(),
  canonicalurl: z.string().optional(),
  extract: z.string().optional(),
});

const ApiResponse = z.object({
  error: z.object({ code: z.string(), info: z.string() }).optional(),
  query: z.object({ pages: z.array(Page) }).optional(),
});

/**
 * Turn the API's answer into an article, or say why it is not one.
 *
 * Pure, so the shapes that matter -- a missing page, a page with no text, a
 * body that is not what was asked for -- are testable without a network.
 */
export function parseArticleResponse(body: string): WikipediaResult {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return fail('error', 'the API answered with something that is not JSON');
  }

  const parsed = ApiResponse.safeParse(payload);
  if (!parsed.success) return fail('error', 'the API answered in an unexpected shape');
  if (parsed.data.error) return fail('error', parsed.data.error.info);

  const page = parsed.data.query?.pages[0];
  if (!page) return fail('not-found', 'the API returned no page');
  if (page.missing) return fail('not-found', `no article called ${page.title}`);
  if (page.invalid) return fail('not-found', `${page.title} is not a usable title`);

  const extract = page.extract?.trim() ?? '';
  if (!extract) return fail('unreadable', `${page.title} has no text to store`);

  const sections = sectionsFromExtract(extract);
  if (sections.length === 0) return fail('unreadable', `${page.title} split into no sections`);

  const externalId = page.title.replace(/\s+/g, '_');

  return {
    ok: true,
    externalId,
    title: page.title,
    canonicalUrl: page.canonicalurl ?? new URL(externalId, ARTICLE_BASE).toString(),
    lengthChars: extract.length,
    sections,
  };
}

/**
 * Fetch one article and split it.
 *
 * Through `fetchDocument`, which is where the address guard lives and the only
 * way out of this module to the web. Its refusals are narrowed to the four
 * this caller can say something useful about; everything else is `error` with
 * the detail it gave.
 */
export async function fetchWikipediaArticle(title: string): Promise<WikipediaResult> {
  const wanted = title.trim();
  if (!wanted) return fail('error', 'no article named');

  const fetched = await fetchDocument(articleRequestUrl(wanted));
  if (!fetched.ok) {
    if (fetched.reason === 'not-found') return fail('not-found', fetched.detail);
    if (fetched.reason === 'blocked') return fail('blocked', fetched.detail);
    return fail('error', `${fetched.reason}: ${fetched.detail}`);
  }
  if (fetched.contentType !== 'json') {
    return fail('error', `expected JSON, got ${fetched.contentType}`);
  }

  return parseArticleResponse(fetched.text);
}
