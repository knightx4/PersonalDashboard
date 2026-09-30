import 'server-only';

import { createVaultClient } from '@/lib/vault/auth/server';
import { courseHref } from '@/lib/vault/education';
import { rankHits } from '@/lib/search/rank';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';

/**
 * Courses from the vault's Education tab, in the command palette and Dash's
 * search (plan #1309).
 *
 * A course is looked for by its title, its code ("ECON 101") or when and
 * where it was taken, so the code, term, year and school all go in `match`.
 * A person has a few hundred courses at most, so they are read whole and
 * matched with the palette's own ranking rather than one ilike per column.
 */

const COLUMNS = 'id, school, code, title, term, year';

/** More than anyone's transcripts hold. */
const READ_LIMIT = 2000;

type CourseRow = {
  id: string;
  school: string;
  code: string | null;
  title: string;
  term: string | null;
  year: number | null;
};

export function courseHit(row: CourseRow): SearchHit {
  const when = row.term?.trim() || (row.year === null ? '' : String(row.year));
  return {
    module: 'vault',
    kind: 'course',
    id: row.id,
    title: row.code ? `${row.code} ${row.title}` : row.title,
    subtitle: ['Course', row.school, when].filter(Boolean).join(' · '),
    match: [row.term, row.year, row.school].filter((part) => part !== null && part !== '').join(' '),
    href: courseHref(row.id),
  };
}

async function readAll(ctx: SearchListContext, limit: number): Promise<SearchHit[]> {
  const supabase = await createVaultClient();
  const { data, error } = await supabase
    .from('courses')
    .select(COLUMNS)
    .eq('user_id', ctx.userId)
    .order('year', { ascending: false, nullsFirst: false })
    .order('position', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`courses: ${error.message}`);
  return ((data ?? []) as unknown as CourseRow[]).map(courseHit);
}

export const educationSearchSource: SearchSource = {
  id: 'education',
  module: 'vault',
  label: 'Education',
  kinds: ['course'],

  async find(ctx: SearchContext) {
    return rankHits(await readAll(ctx, READ_LIMIT), ctx.query).slice(0, ctx.limit);
  },
  async list(ctx: SearchListContext) {
    return readAll(ctx, ctx.limit);
  },
};
