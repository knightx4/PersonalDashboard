import { decodeHtml, htmlLines } from '@/lib/learn/providers/ocw-structure';
import type { StructureDocumentInput, StructureUnit } from '@/lib/learn/catalogue/structure';

/**
 * Add a source on a subject's page (plan #2307.4): one press that puts a
 * document in the shared bank the preparation reads.
 *
 * The press takes an address or a search phrase. An address on a site the
 * bank already has a reader for (MIT OpenCourseWare, Open Yale Courses,
 * OpenStax, arXiv, the explainer and practical-skill allowlists) goes to that
 * reader, which keeps the site's own licence. Any other https page is read by
 * its headings and kept as an outline only. A phrase is searched the way the
 * preparation's pull_documents step searches, with the phrase as the subject.
 *
 * Whatever is stored is matched into the subject's weeks: every unit of an
 * added document joins match_weeks, since the person chose the document, with
 * its similarity to the subject so the territory still reads the closest
 * first (withAddedWeeks in structure-steps.ts). This file is the part with
 * no network or database in it; the run is add-source-run.ts.
 */

/** Longest thing the box takes: an address or a phrase. */
export const SOURCE_ASK_MAX = 2000;

export type SourceAsk = { kind: 'url'; url: string } | { kind: 'phrase'; phrase: string } | { kind: 'error'; error: string };

/**
 * What the person typed, as an address or a phrase. Anything with no space
 * that reads as host-and-path is an address; `http://` is read as `https://`,
 * since the bank fetches over https only.
 */
export function readSourceAsk(input: string): SourceAsk {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return { kind: 'error', error: 'Type an address or what to search for.' };
  if (text.length > SOURCE_ASK_MAX) return { kind: 'error', error: 'That is too long for an address or a search.' };
  if (/\s/.test(text)) return { kind: 'phrase', phrase: text };
  const withScheme = /^https?:\/\//i.test(text)
    ? text.replace(/^http:\/\//i, 'https://')
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(text)
      ? `https://${text}`
      : null;
  if (!withScheme) return { kind: 'phrase', phrase: text };
  try {
    const url = new URL(withScheme);
    url.hash = '';
    return { kind: 'url', url: url.href };
  } catch {
    return { kind: 'error', error: 'That address could not be read.' };
  }
}

/** The readers an address can go to; `web` is any page with no reader of its own. */
export type SourceReader = 'ocw' | 'yale' | 'openstax' | 'arxiv' | 'explainer' | 'practical' | 'web';

/** An OCW course page address, trimmed to the course: https://ocw.mit.edu/courses/<slug>/. */
export function ocwCourseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.hostname !== 'ocw.mit.edu') return null;
    const slug = /^\/courses\/([a-z0-9-]+)/i.exec(url.pathname)?.[1];
    return slug ? `https://ocw.mit.edu/courses/${slug}/` : null;
  } catch {
    return null;
  }
}

/**
 * Which reader an address goes to. The allowlist checks are passed in, so the
 * choice is tested without importing every provider.
 */
export function readerFor(
  url: string,
  known: { yale: (url: string) => boolean; openstax: (url: string) => boolean; arxiv: (url: string) => boolean; explainer: (url: string) => boolean; practical: (url: string) => boolean },
): SourceReader {
  if (ocwCourseUrl(url)) return 'ocw';
  if (known.yale(url)) return 'yale';
  if (known.openstax(url)) return 'openstax';
  if (known.arxiv(url)) return 'arxiv';
  if (known.explainer(url)) return 'explainer';
  if (known.practical(url)) return 'practical';
  return 'web';
}

// A page from any site ------------------------------------------------------

export const WEB_PROVIDER_SLUG = 'web';
/** Sections a page must have to be kept: one heading is a page, not an outline. */
export const MIN_WEB_SECTIONS = 2;
const MAX_WEB_SECTIONS = 80;
const MAX_TOPICS_PER_SECTION = 20;

const headingPlain = (fragment: string) => htmlLines(fragment).join(' ').replace(/\s*:$/, '').trim();

/** What a page says about itself that is not its content: menus, footers, sidebars. */
function pageBody(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(nav|footer|header|aside|form)\b[\s\S]*?<\/\1>/gi, '');
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(stripped)?.[2];
  return main ?? stripped;
}

export type WebSection = { heading: string; topics: string[] };

/**
 * A page's sections: its h2 headings with the h3s under each as topics, or
 * its h3s with the h4s when it has fewer than two h2s. Repeats and empty
 * headings are dropped. Pure.
 */
export function webSections(html: string): { title: string; sections: WebSection[]; text: string } {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = (h1 ? headingPlain(h1) : '') || (pageTitle ? decodeHtml(pageTitle).replace(/\s+/g, ' ').trim() : '');
  const body = pageBody(html);
  const headings = [...body.matchAll(/<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({
    depth: Number(m[1]),
    text: headingPlain(m[2]),
  }));
  const count = (depth: number) => headings.filter((h) => h.depth === depth && h.text).length;
  const level = count(2) >= MIN_WEB_SECTIONS ? 2 : 3;

  const sections: WebSection[] = [];
  let open: WebSection | null = null;
  for (const h of headings) {
    if (!h.text) continue;
    if (h.depth === level) {
      if (sections.some((s) => s.heading === h.text)) {
        open = null;
        continue;
      }
      open = { heading: h.text, topics: [] };
      sections.push(open);
    } else if (h.depth === level + 1 && open && open.topics.length < MAX_TOPICS_PER_SECTION && !open.topics.includes(h.text)) {
      open.topics.push(h.text);
    }
  }
  return { title, sections: sections.slice(0, MAX_WEB_SECTIONS), text: htmlLines(body).join('\n') };
}

/** The bank's key for a page: its address without the fragment, so one page is one document. */
export function webExternalId(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return `${u.hostname}${u.pathname}${u.search}`.replace(/\/$/, '');
}

export type WebDocument = { ok: true; document: StructureDocumentInput } | { ok: false; detail: string };

/** A page as the document the store keeps, outline only. */
export function webDocument(url: string, html: string): WebDocument {
  const page = webSections(html);
  if (page.sections.length < MIN_WEB_SECTIONS) {
    return { ok: false, detail: 'The page has no sections to read: it needs at least two headings that lay it out.' };
  }
  const host = new URL(url).hostname.replace(/^www\./, '');
  const units: StructureUnit[] = page.sections.map((s) => ({ label: null, heading: s.heading, topics: s.topics, readings: [] }));
  return {
    ok: true,
    document: {
      providerSlug: WEB_PROVIDER_SLUG,
      externalId: webExternalId(url),
      title: page.title || host,
      canonicalUrl: url,
      sourceUrl: url,
      institution: host,
      licenceMode: 'structure_only',
      rawText: [page.title || host, url, page.text].join('\n\n'),
      units,
    },
  };
}

/** The line a press leaves under the box. */
export function addedLine(input: { title: string; licence: string; units: number; weeksJoined: boolean; unchanged: boolean }): string {
  const units = `${input.units} ${input.units === 1 ? 'unit' : 'units'}`;
  const how = input.unchanged ? 'was already in the bank' : 'is in the bank';
  const weeks = input.weeksJoined ? ' Its weeks joined the matched weeks.' : ' Its weeks join the matched weeks when the preparation reaches that step.';
  return `${input.title} ${how}, ${units}, ${input.licence.toLowerCase()}.${weeks}`;
}
