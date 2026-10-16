import 'server-only';

import { fetchDocument } from './fetch';
import type { LicenceMode, StructureDocumentInput, StructureUnit } from '@/lib/learn/catalogue/structure';

/**
 * arXiv lecture notes and reviews, kept by their tables of contents (plan
 * #2247.5).
 *
 * For a research subfield no course exists, and the structure lives in a
 * paper: lecture notes, a review, a book posted as a preprint. The model
 * proposes an arXiv id; this module confirms it by reading two pages arXiv
 * serves to anyone:
 *
 *   1. `arxiv.org/abs/<id>`: title, authors, the abstract, the date and the
 *      licence link. A page with no title is not a paper, which is how a
 *      made-up id is refused.
 *   2. `arxiv.org/html/<id>`: the LaTeXML rendering. Its headings are the
 *      table of contents. Older papers have no rendering; they are refused
 *      with a reason rather than guessed at from the PDF.
 *
 * A paper with chapters gives one unit per chapter and the chapter's sections
 * as its topics. A paper without gives one unit per section and the
 * subsections as topics. Exercises, problems, checklists, the bibliography
 * and unnumbered front matter are not units.
 *
 * The abstract is kept at the head of the raw text, and the PDF link is the
 * material a reader opens (arxivPdfUrl). Both pages are parsed by pure
 * functions tested against excerpts of the real pages in fixtures/structure/.
 */

export const ARXIV_PROVIDER_SLUG = 'arxiv';
const ARXIV_HOST = 'arxiv.org';

/** `2301.00001` or `hep-th/9901001`, version suffix dropped. Null for anything else. */
export function parseArxivId(input: string): string | null {
  const text = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\//i, '')
    .replace(/^arxiv:/i, '')
    .replace(/\.pdf$/i, '')
    .replace(/\/+$/, '');
  const match = /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/.exec(text);
  return match ? match[1] : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Markup to the words a person reads; a formula becomes its TeX source. */
function plain(html: string): string {
  return decodeEntities(
    html
      .replace(/<math\b[^>]*\balttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, ' $1 ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContents(html: string, name: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (new RegExp(`\\bname="${name}"`, 'i').test(tag)) {
      const content = /\bcontent="([^"]*)"/i.exec(tag);
      if (content) out.push(decodeEntities(content[1]).trim());
    }
  }
  return out;
}

export type ArxivAbstractPage = {
  title: string;
  /** "First Last", in the order arXiv lists them. */
  authors: string[];
  abstract: string;
  pdfUrl: string | null;
  /** "2019/06/18" as arXiv writes it. */
  date: string | null;
  licenceUrl: string | null;
};

/** "Potts, Patrick P." to "Patrick P. Potts". */
function givenFirst(name: string): string {
  const [family, given] = name.split(/,\s*/, 2);
  return given ? `${given} ${family}` : family;
}

/** The abstract page, or null when it is not a paper's. */
export function parseAbstractPage(html: string): ArxivAbstractPage | null {
  const title = metaContents(html, 'citation_title')[0];
  if (!title) return null;
  const abstractBlock = /<blockquote class="abstract[^"]*">([\s\S]*?)<\/blockquote>/i.exec(html);
  const abstract = abstractBlock
    ? plain(abstractBlock[1].replace(/<span class="descriptor">[\s\S]*?<\/span>/i, ''))
    : '';
  const licence = /<div class="abs-license">\s*<a href="([^"]+)"/i.exec(html);
  return {
    title: plain(title),
    authors: metaContents(html, 'citation_author').map(givenFirst),
    abstract,
    pdfUrl: metaContents(html, 'citation_pdf_url')[0] ?? null,
    date: metaContents(html, 'citation_date')[0] ?? null,
    licenceUrl: licence ? decodeEntities(licence[1]) : null,
  };
}

/**
 * What the licence link allows.
 *
 * A Creative Commons licence or a public-domain dedication lets the text be
 * shown with attribution: `show`. arXiv's own licences (the non-exclusive
 * distribution licence most papers carry, the perpetual one, and a link that
 * is missing or unknown) grant arXiv the right to distribute and grant a
 * reader nothing, so the order and headings are kept and the text is not
 * shown or fed: `structure_only`. Recorded per paper because authors choose.
 */
export function licenceModeFor(licenceUrl: string | null): LicenceMode {
  if (licenceUrl && /creativecommons\.org\/(?:licenses\/by|publicdomain\/zero)/i.test(licenceUrl)) {
    return 'show';
  }
  return 'structure_only';
}

export type ArxivHeading = { level: string; tag: string | null; title: string };

/** The headings of a LaTeXML page in order: level (chapter, section, ...), number, title. */
export function headingsFromHtml(html: string): ArxivHeading[] {
  const out: ArxivHeading[] = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*\bclass="[^"]*\bltx_title_(\w+)[^"]*"[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const body = m[3];
    const tagMatch = /<span class="ltx_tag[^"]*">([\s\S]*?)<\/span>/i.exec(body);
    const tag = tagMatch ? plain(tagMatch[1]) : null;
    const title = plain(body.replace(/<span class="ltx_tag[^"]*">[\s\S]*?<\/span>/i, ''));
    if (title) out.push({ level: m[2], tag: tag || null, title });
  }
  return out;
}

/** Practice material and apparatus are neither a unit nor a topic. */
const NOT_CONTENT = /^(?:problems?|exercises?|checklist\b|references|bibliography|acknowledg|hints?:?$|solutions?$)/i;

/**
 * Units from the headings. Chapters are the units when the paper has numbered
 * ones; otherwise numbered sections are, and appendices follow them. Topics
 * are the numbered level beneath.
 */
export function unitsFromHeadings(headings: ArxivHeading[]): StructureUnit[] {
  const hasChapters = headings.some((h) => h.level === 'chapter' && h.tag !== null);
  const top = hasChapters ? ['chapter', 'appendix'] : ['section', 'appendix'];
  const below = hasChapters ? ['section'] : ['subsection', 'subsubsection'];

  const units: StructureUnit[] = [];
  let current: StructureUnit | null = null;
  for (const h of headings) {
    if (h.level === 'document') continue;
    if (h.level === 'bibliography') {
      current = null;
      continue;
    }
    if (top.includes(h.level)) {
      if (h.tag === null || NOT_CONTENT.test(h.title)) {
        current = null;
        continue;
      }
      current = { label: h.tag.replace(/\.$/, ''), heading: h.title, topics: [], readings: [] };
      units.push(current);
    } else if (current && below.includes(h.level) && h.tag !== null && !NOT_CONTENT.test(h.title)) {
      current.topics.push(h.title);
    }
  }
  return units;
}

export type ArxivFailure = {
  ok: false;
  reason: 'bad-id' | 'not-found' | 'no-html' | 'no-sections' | 'error';
  detail: string;
};
export type ArxivResult = { ok: true; document: StructureDocumentInput } | ArxivFailure;

/** The raw text kept: the citation, the abstract, then the table of contents. */
export function rawTextFor(page: ArxivAbstractPage, units: StructureUnit[]): string {
  const lines = [page.title, page.authors.join(', '), '', page.abstract, '', 'Contents'];
  for (const unit of units) {
    lines.push(`${unit.label ?? ''} ${unit.heading}`.trim());
    for (const topic of unit.topics) lines.push(`  ${topic}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Assemble the document from the two pages. The `externalId` is the id
 * without its version: a new version is the same paper, and a changed table
 * of contents changes the content hash.
 */
export function documentFromPages(id: string, abs: string, rendering: string): ArxivResult {
  const page = parseAbstractPage(abs);
  if (!page) return { ok: false, reason: 'not-found', detail: `arXiv has no paper ${id}.` };
  const units = unitsFromHeadings(headingsFromHtml(rendering));
  if (units.length === 0) {
    return { ok: false, reason: 'no-sections', detail: `${id} has no numbered sections in its HTML rendering.` };
  }
  return {
    ok: true,
    document: {
      providerSlug: ARXIV_PROVIDER_SLUG,
      externalId: id,
      title: page.title,
      canonicalUrl: `https://${ARXIV_HOST}/abs/${id}`,
      sourceUrl: `https://${ARXIV_HOST}/html/${id}`,
      author: page.authors.length > 0 ? page.authors.join(', ') : null,
      institution: 'arXiv',
      courseCode: `arXiv:${id}`,
      term: page.date ? page.date.slice(0, 4) : null,
      licenceMode: licenceModeFor(page.licenceUrl),
      rawText: rawTextFor(page, units),
      units,
    },
  };
}

/** The PDF a reader opens for the paper. */
export function arxivPdfUrl(id: string): string {
  return `https://${ARXIV_HOST}/pdf/${id}`;
}

/** Fetch and parse one paper. The id may be given as a URL or `arXiv:` form. */
export async function fetchArxivStructure(input: string): Promise<ArxivResult> {
  const id = parseArxivId(input);
  if (!id) return { ok: false, reason: 'bad-id', detail: `"${input}" is not an arXiv id.` };
  const abs = await fetchDocument(`https://${ARXIV_HOST}/abs/${id}`);
  if (!abs.ok) {
    return { ok: false, reason: abs.reason === 'not-found' ? 'not-found' : 'error', detail: abs.detail };
  }
  const rendering = await fetchDocument(`https://${ARXIV_HOST}/html/${id}`);
  if (!rendering.ok) {
    return rendering.reason === 'not-found'
      ? { ok: false, reason: 'no-html', detail: `${id} has no HTML rendering.` }
      : { ok: false, reason: 'error', detail: rendering.detail };
  }
  return documentFromPages(id, abs.text, rendering.text);
}
