import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { FIGURE_NEEDS, type FigureNeed } from './kinds/wanted';

/**
 * A figure the subject's lessons asked for and the app cannot draw, one per
 * group of like asks (plan #2321.12). `asked` counts the lessons that asked,
 * across the person's subjects, as learn.figure_need_groups counts them.
 */
export type UnbuiltFigure = { key: string; need: FigureNeed; shows: string; why: string; asked: number };

/** What each need is called to the reader, ahead of what the figure would show. */
export const NEED_NAME: Record<FigureNeed, string> = {
  figure_kind: 'A kind of figure',
  data_source: 'A data source',
  model: 'A model',
  map_layer: 'A map layer',
};

/** Most asked first, then the earliest asked, so the order holds between visits. */
export function orderUnbuilt(groups: readonly (UnbuiltFigure & { firstAskedAt?: string })[]): UnbuiltFigure[] {
  return [...groups]
    .sort((a, b) => b.asked - a.asked || (a.firstAskedAt ?? '').localeCompare(b.firstAskedAt ?? ''))
    .map(({ key, need, shows, why, asked }) => ({ key, need, shows, why, asked }));
}

/**
 * The need groups that include a lesson of the subject. The view counts only
 * the lessons not yet served (plan #2321.11), so the list empties as the
 * daily backfill fills them; `asked` counts across all the person's subjects.
 */
export async function loadSubjectFigureNeeds(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<UnbuiltFigure[]> {
  const { data, error } = await learn
    .from('figure_need_groups')
    .select('key, need, shows, why, asked, first_asked_at')
    .eq('user_id', userId)
    .contains('subject_ids', [subjectId]);
  if (error) throw new Error(`Reading the unbuilt figures failed: ${error.message}`);
  const rows = (data ?? []) as { key: string; need: string; shows: string; why: string; asked: number; first_asked_at: string }[];
  return orderUnbuilt(
    rows.flatMap((row) =>
      (FIGURE_NEEDS as readonly string[]).includes(row.need)
        ? [{ key: row.key, need: row.need as FigureNeed, shows: row.shows, why: row.why, asked: row.asked, firstAskedAt: row.first_asked_at }]
        : [],
    ),
  );
}
