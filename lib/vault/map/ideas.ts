import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * The Map's Ideas view (plan #2947.5): your own ideas and designs, ranked by
 * the scores Jev gave them in obsidian.position_scores.
 *
 * Reads only, through obsidian.idea_list and obsidian.idea_list_counts
 * (supabase/migrations-vault/0047). The sort and the combined score both live
 * in the database, so the number a row shows is the one it was sorted on.
 * A failed read throws; the page catches it and says the scores could not be
 * read, rather than drawing an empty list that looks like nothing is scored.
 */

export const IDEA_SORTS = ['combined', 'usefulness', 'novelty'] as const;
export type IdeaSort = (typeof IDEA_SORTS)[number];

export const IDEA_SORT_LABEL: Record<IdeaSort, string> = {
  combined: 'Combined',
  usefulness: 'Useful',
  novelty: 'Novel',
};

export const IDEA_PAGE_SIZE = 50;

export type MapView = 'themes' | 'ideas';

export type IdeaRow = {
  id: string;
  statement: string;
  usefulness: number;
  novelty: number;
  combined: number;
  /** The strongest theme the idea sits under, when it sits under one. */
  theme: { id: string; name: string } | null;
  /** One sentence it came from, in a note still in the vault. */
  source: { quote: string; path: string; title: string } | null;
};

export type IdeaCounts = {
  listed: number;
  requirements: number;
  othersIdeas: number;
  descriptions: number;
  unscored: number;
};

export type IdeaListPage = {
  rows: IdeaRow[];
  counts: IdeaCounts;
  sort: IdeaSort;
  page: number;
  pages: number;
};

/** The view, sort and page from the address, with anything unknown read as the default. */
export function mapAddress(params: {
  view?: string | string[];
  sort?: string | string[];
  page?: string | string[];
}): { view: MapView; sort: IdeaSort; page: number } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = one(params.view) === 'ideas' ? 'ideas' : 'themes';
  const rawSort = one(params.sort);
  const sort = (IDEA_SORTS as readonly string[]).includes(rawSort ?? '')
    ? (rawSort as IdeaSort)
    : 'combined';
  const n = Number.parseInt(one(params.page) ?? '', 10);
  return { view, sort, page: Number.isFinite(n) && n > 0 ? n : 1 };
}

/** The address of the Ideas view, leaving out what is the default. */
export function ideasHref(sort: IdeaSort, page = 1): string {
  const query = new URLSearchParams({ view: 'ideas' });
  if (sort !== 'combined') query.set('sort', sort);
  if (page > 1) query.set('page', String(page));
  return `/vault/map?${query.toString()}`;
}

type RawIdea = {
  position_id: string;
  statement: string;
  usefulness: number;
  novelty: number;
  combined: number;
  theme_id: string | null;
  theme_name: string | null;
  quote: string | null;
  note_path: string | null;
  note_title: string | null;
  total: number | string;
};

type RawCounts = {
  listed: number;
  requirements: number;
  others_ideas: number;
  descriptions: number;
  unscored: number;
};

/** One page of the list and the counts under it. A page past the end shows the last. */
export async function loadIdeaList(
  supabase: VaultSupabaseClient,
  sort: IdeaSort,
  page: number,
): Promise<IdeaListPage> {
  const counted = await supabase.rpc('idea_list_counts');
  if (counted.error) throw new Error(`Could not read the idea counts: ${counted.error.message}`);
  const counts = shapeCounts(((counted.data ?? []) as RawCounts[])[0]);

  const pages = Math.max(1, Math.ceil(counts.listed / IDEA_PAGE_SIZE));
  const at = Math.min(page, pages);
  if (counts.listed === 0) return { rows: [], counts, sort, page: 1, pages: 1 };

  const listed = await supabase.rpc('idea_list', {
    p_sort: sort,
    p_offset: (at - 1) * IDEA_PAGE_SIZE,
    p_limit: IDEA_PAGE_SIZE,
  });
  if (listed.error) throw new Error(`Could not read the scored ideas: ${listed.error.message}`);
  return { rows: shapeIdeas((listed.data ?? []) as RawIdea[]), counts, sort, page: at, pages };
}

export function shapeIdeas(rows: RawIdea[]): IdeaRow[] {
  return rows.map((r) => ({
    id: r.position_id,
    statement: r.statement,
    usefulness: r.usefulness,
    novelty: r.novelty,
    combined: r.combined,
    theme: r.theme_id && r.theme_name ? { id: r.theme_id, name: r.theme_name } : null,
    source:
      r.quote && r.note_path && r.note_title
        ? { quote: r.quote, path: r.note_path, title: r.note_title }
        : null,
  }));
}

function shapeCounts(raw: RawCounts | undefined): IdeaCounts {
  return {
    listed: raw?.listed ?? 0,
    requirements: raw?.requirements ?? 0,
    othersIdeas: raw?.others_ideas ?? 0,
    descriptions: raw?.descriptions ?? 0,
    unscored: raw?.unscored ?? 0,
  };
}
