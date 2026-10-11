import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PASSING_VERDICTS } from './ui-check-guard';
import { correctionWeeks, weekOf, type ChangeRow, type CorrectionWeek, type NoteRow } from './correction-share';

/** PostgREST hands back at most this many rows a request. */
const PAGE = 1000;

/** Every row a query gives, a page at a time. */
async function allRows<T>(
  read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) {
      console.error(`Could not read the correction measure: ${error.message}`);
      return null;
    }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * The weeks /dev/ui charts (plan #1543): every passing design check a step
 * recorded, and the notes filed from the week of the first one on. Null when
 * either read fails, so the page can say it could not count rather than
 * drawing a week of zeros.
 */
export async function loadCorrectionWeeks(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<CorrectionWeek[] | null> {
  const checks = await allRows<ChangeRow>((from, to) =>
    supabase
      .from('ui_checks')
      .select('step, surface, verdict, created_at')
      .eq('user_id', userId)
      .not('step', 'is', null)
      .in('verdict', [...PASSING_VERDICTS])
      .order('created_at')
      .range(from, to),
  );
  if (!checks) return null;
  if (checks.length === 0) return [];

  const since = `${weekOf(Date.parse(checks[0].created_at))}T00:00:00Z`;
  const notes = await allRows<NoteRow>((from, to) =>
    supabase
      .from('feedback_items')
      .select('created_at, page_path')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at')
      .range(from, to),
  );
  if (!notes) return null;
  return correctionWeeks(checks, notes, now);
}
