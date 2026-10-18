import type postgres from 'postgres';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { isLicenceMode, mayShowText } from '@/lib/learn/catalogue/structure';

/**
 * Figures stored with a course (plan #2321.4): the images found on the pages
 * fetched for a structure document, kept in `learn.catalogue_figures` with
 * their alt text, the page they were on and the licence they are shown under.
 *
 * A figure is offered to the lesson writer, and drawn, only when its
 * document's licence mode is `show`. A structure_only or never_feed document's
 * figures are stored and never read out.
 */

/** An image as a provider found it. */
export type FoundFigure = {
  imageUrl: string;
  altText: string;
  /** The page it was found on. */
  pageUrl: string;
  licence: string;
};

/** The most images kept for one document. */
export const MAX_FIGURES_PER_DOCUMENT = 12;

/** A figure the writer may name, with what the figure shows under it. */
export type OfferedFigure = {
  id: string;
  imageUrl: string;
  altText: string;
  pageUrl: string;
  licence: string;
  /** "15.431 Venture Capital, Spring 2011, MIT OpenCourseWare". */
  course: string;
};

/** Replace a document's figures with these. Returns how many were written. */
export async function storeCatalogueFigures(
  sql: postgres.Sql,
  itemId: string,
  figures: readonly FoundFigure[],
): Promise<number> {
  const rows = figures.slice(0, MAX_FIGURES_PER_DOCUMENT).map((figure, position) => ({
    item_id: itemId,
    image_url: figure.imageUrl,
    alt_text: figure.altText,
    page_url: figure.pageUrl,
    licence: figure.licence,
    position,
  }));
  await sql.begin(async (tx) => {
    await tx`delete from learn.catalogue_figures where item_id = ${itemId}`;
    if (rows.length > 0) {
      await tx`insert into learn.catalogue_figures ${tx(rows, 'item_id', 'image_url', 'alt_text', 'page_url', 'licence', 'position')}
               on conflict (item_id, image_url) do nothing`;
    }
  });
  return rows.length;
}

export type FigureRow = {
  id: string;
  image_url: string;
  alt_text: string;
  page_url: string;
  licence: string;
};

export type FigureDocument = {
  licence_mode: string | null;
  institution: string | null;
  course_code: string | null;
  term: string | null;
  title: string;
};

/** The course as a credit line reads it. */
export function courseCredit(doc: Pick<FigureDocument, 'course_code' | 'term' | 'title'>, provider: string): string {
  const head = [doc.course_code, doc.title].filter(Boolean).join(' ');
  return [head, doc.term, provider].filter(Boolean).join(', ');
}

/**
 * The figures a document may show: none unless its licence mode is `show`.
 * Pure, and the one place that rule is applied on the way to a lesson.
 */
export function offerableFigures(rows: readonly FigureRow[], doc: FigureDocument | null, provider: string): OfferedFigure[] {
  if (!doc || !isLicenceMode(doc.licence_mode) || !mayShowText(doc.licence_mode)) return [];
  const course = courseCredit(doc, provider);
  return rows.map((row) => ({
    id: row.id,
    imageUrl: row.image_url,
    altText: row.alt_text,
    pageUrl: row.page_url,
    licence: row.licence,
    course,
  }));
}

/**
 * The figures of the catalogue item a lesson's source came from, that may be
 * shown. Never throws: a failed read is no figures.
 */
export async function loadOfferableFigures(learn: LearnSupabaseClient, itemId: string): Promise<OfferedFigure[]> {
  try {
    const [figures, structure, item] = await Promise.all([
      learn.from('catalogue_figures').select('id, image_url, alt_text, page_url, licence').eq('item_id', itemId).order('position'),
      learn.from('catalogue_structures').select('licence_mode, institution, course_code, term').eq('item_id', itemId).maybeSingle(),
      learn.from('catalogue_items').select('title, provider_id').eq('id', itemId).maybeSingle(),
    ]);
    if (figures.error || structure.error || item.error || !structure.data || !item.data) return [];
    const providerId = (item.data as { provider_id: string }).provider_id;
    const provider = await learn.from('catalogue_providers').select('name').eq('id', providerId).maybeSingle();
    const doc: FigureDocument = { ...(structure.data as Omit<FigureDocument, 'title'>), title: (item.data as { title: string }).title };
    return offerableFigures((figures.data ?? []) as FigureRow[], doc, (provider.data as { name: string } | null)?.name ?? '');
  } catch {
    return [];
  }
}
