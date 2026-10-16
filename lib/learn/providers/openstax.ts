import 'server-only';

import { fetchDocument } from './fetch';
import type { StructureDocumentInput, StructureUnit } from '@/lib/learn/catalogue/structure';

/**
 * OpenStax textbooks, kept by their tables of contents and nothing else (plan
 * #2247.8).
 *
 * An OpenStax book's chapter and section order says what a course in the
 * subject covers and in what order, and that is all this keeps. OpenStax asks
 * that its text not be given to a model, so a document from here is stored
 * `never_feed` whatever licence the book itself carries, and its raw text is
 * the headings: no paragraph of the book is fetched, parsed or kept. The
 * material path reads the mode (mayFeedText) before it uses a word.
 *
 * The model proposes a slug (`principles-macroeconomics-3e`); three JSON
 * documents OpenStax serves to anyone confirm and read it:
 *
 *   1. the CMS book record, `apps/cms/api/v2/pages/?type=books.Book&slug=`:
 *      the title, the book's id, its licence. No record, no book, which is
 *      how a made-up slug is refused.
 *   2. `rex/release.json`: which archive release is current and which
 *      version of the book it serves. Both change, so neither is stored.
 *   3. `<archive>/contents/<id>@<version>.json`: the book's tree of chapters
 *      and sections, titles only.
 *
 * Chapters are units, numbered sections their topics. Parts of a book are
 * looked through. Appendices are units; the preface, the answer key, the
 * references and the index are not. Chapter-end pages (key terms, review
 * questions, problems) are practice material and not topics.
 */

export const OPENSTAX_PROVIDER_SLUG = 'openstax';
const OPENSTAX_ORIGIN = 'https://openstax.org';

/** Kept for every OpenStax document, whatever the book's own licence says. */
export const OPENSTAX_LICENCE_MODE = 'never_feed' as const;

/** `principles-macroeconomics-3e`, or an openstax.org book address. Null for anything else. */
export function parseOpenstaxSlug(input: string): string | null {
  const text = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?openstax\.org\/(?:details\/)?books\//i, '')
    .replace(/[/?#].*$/, '');
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) ? text : null;
}

export type OpenstaxBook = {
  id: string;
  title: string;
  slug: string;
  licenceName: string | null;
  licenceUrl: string | null;
};

/** The book a CMS answer describes, or null when it describes none. */
export function bookFromCms(json: string, slug: string): OpenstaxBook | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const items = (data as { items?: unknown })?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items as Array<Record<string, unknown>>) {
    const itemSlug = (item.meta as { slug?: unknown } | undefined)?.slug;
    const id = item.cnx_id;
    if (itemSlug === slug && typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) && typeof item.title === 'string') {
      return {
        id,
        title: item.title,
        slug,
        licenceName: typeof item.license_name === 'string' ? item.license_name : null,
        licenceUrl: typeof item.license_url === 'string' ? item.license_url : null,
      };
    }
  }
  return null;
}

export type OpenstaxRelease = { archivePath: string; version: string };

/** The archive release and the version of one book it serves, or null. */
export function releaseFor(json: string, bookId: string): OpenstaxRelease | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const record = data as { archiveUrl?: unknown; books?: Record<string, { defaultVersion?: unknown }> };
  const archivePath = record?.archiveUrl;
  const version = record?.books?.[bookId]?.defaultVersion;
  // Both go into an address, so only the shapes OpenStax uses are let through.
  if (typeof archivePath !== 'string' || !/^\/apps\/archive\/[\w.-]+$/.test(archivePath)) return null;
  if (typeof version !== 'string' || !/^[0-9a-f]+$/i.test(version)) return null;
  return { archivePath, version };
}

type TreeNode = {
  title?: string;
  slug?: string;
  toc_type?: string;
  toc_target_type?: string;
  contents?: TreeNode[];
};

export type OpenstaxContents = { title: string; revised: string | null; contents: TreeNode[] };

export function parseContents(json: string): OpenstaxContents | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const record = data as { title?: unknown; revised?: unknown; tree?: { contents?: unknown } };
  if (typeof record?.title !== 'string' || !Array.isArray(record.tree?.contents)) return null;
  return {
    title: record.title,
    revised: typeof record.revised === 'string' ? record.revised : null,
    contents: record.tree.contents as TreeNode[],
  };
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

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "Chapter 1", "2.3" or "Appendix A" from a title's number span; null when it has none. */
function numberOf(title: string): string | null {
  const match = /<span class="os-number">([\s\S]*?)<\/span>\s*(?=<span class="os-divider|<span class="os-text)/i.exec(title);
  return match ? plain(match[1]) || null : null;
}

/** The title without its number. */
function textOf(title: string): string {
  const match = /<span class="os-text"[^>]*>([\s\S]*?)<\/span>/i.exec(title);
  return match ? plain(match[1]) : plain(title.replace(/<span class="os-number">[\s\S]*?<\/span>/i, ''));
}

/** A section a chapter lists as a topic: numbered sections, not its intro or its end-of-chapter pages. */
function isTopic(node: TreeNode): boolean {
  return node.toc_type === 'book-content' && node.toc_target_type === 'numbered-section';
}

function chapterUnit(node: TreeNode): StructureUnit | null {
  const title = node.title ?? '';
  const heading = textOf(title);
  if (!heading) return null;
  const topics = (node.contents ?? [])
    .filter(isTopic)
    .map((section) => {
      const number = numberOf(section.title ?? '');
      const text = textOf(section.title ?? '');
      return number ? `${number} ${text}` : text;
    })
    .filter((topic) => topic !== '');
  return { label: numberOf(title), heading, topics, readings: [] };
}

/**
 * Units from a book's tree, in book order: chapters (found through any parts
 * they sit in), then the appendices where the book puts them.
 */
export function unitsFromTree(nodes: TreeNode[]): StructureUnit[] {
  const units: StructureUnit[] = [];
  for (const node of nodes) {
    if (node.toc_type === 'chapter') {
      const unit = chapterUnit(node);
      if (unit) units.push(unit);
    } else if (node.toc_type === 'unit') {
      units.push(...unitsFromTree(node.contents ?? []));
    } else if (node.toc_type === 'book-content' && node.toc_target_type === 'appendix') {
      const unit = chapterUnit(node);
      if (unit) units.push(unit);
    }
  }
  return units;
}

/** The raw text kept: the title, then the table of contents. Headings only. */
export function rawTextFor(title: string, units: StructureUnit[]): string {
  const lines = [title, 'OpenStax', '', 'Contents'];
  for (const unit of units) {
    lines.push(`${unit.label ?? ''} ${unit.heading}`.trim());
    for (const topic of unit.topics) lines.push(`  ${topic}`);
  }
  return lines.join('\n') + '\n';
}

export type OpenstaxFailure = {
  ok: false;
  reason: 'bad-slug' | 'not-found' | 'no-chapters' | 'error';
  detail: string;
};
export type OpenstaxResult = { ok: true; document: StructureDocumentInput } | OpenstaxFailure;

/**
 * Assemble the document from the book record and the contents. The
 * `externalId` is the slug: a new edition has a new slug, and a revised
 * table of contents under the same slug changes the content hash.
 */
export function documentFromContents(book: OpenstaxBook, contentsJson: string, sourceUrl: string): OpenstaxResult {
  const contents = parseContents(contentsJson);
  if (!contents) return { ok: false, reason: 'error', detail: `${book.slug}: the contents were not readable.` };
  const units = unitsFromTree(contents.contents);
  if (units.length === 0) {
    return { ok: false, reason: 'no-chapters', detail: `${book.slug} lists no chapters.` };
  }
  return {
    ok: true,
    document: {
      providerSlug: OPENSTAX_PROVIDER_SLUG,
      externalId: book.slug,
      title: book.title,
      canonicalUrl: `${OPENSTAX_ORIGIN}/details/books/${book.slug}`,
      sourceUrl,
      author: 'OpenStax',
      institution: 'OpenStax',
      courseCode: null,
      term: null,
      licenceMode: OPENSTAX_LICENCE_MODE,
      rawText: rawTextFor(book.title, units),
      units,
    },
  };
}

/** Fetch and parse one book's table of contents. The slug may be given as an address. */
export async function fetchOpenstaxStructure(input: string): Promise<OpenstaxResult> {
  const slug = parseOpenstaxSlug(input);
  if (!slug) return { ok: false, reason: 'bad-slug', detail: `"${input}" is not an OpenStax book slug.` };

  const cms = await fetchDocument(
    `${OPENSTAX_ORIGIN}/apps/cms/api/v2/pages/?type=books.Book&fields=title,slug,cnx_id,license_name,license_url,book_state&slug=${slug}`,
  );
  if (!cms.ok) return { ok: false, reason: 'error', detail: cms.detail };
  const book = bookFromCms(cms.text, slug);
  if (!book) return { ok: false, reason: 'not-found', detail: `OpenStax has no book "${slug}".` };

  const release = await fetchDocument(`${OPENSTAX_ORIGIN}/rex/release.json`);
  if (!release.ok) return { ok: false, reason: 'error', detail: release.detail };
  const where = releaseFor(release.text, book.id);
  if (!where) return { ok: false, reason: 'error', detail: `${slug} is not in the current OpenStax release.` };

  const sourceUrl = `${OPENSTAX_ORIGIN}${where.archivePath}/contents/${book.id}@${where.version}.json`;
  const contents = await fetchDocument(sourceUrl);
  if (!contents.ok) return { ok: false, reason: 'error', detail: contents.detail };
  return documentFromContents(book, contents.text, sourceUrl);
}
