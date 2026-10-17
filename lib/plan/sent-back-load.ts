import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PASSING_VERDICTS } from './ui-check-guard';
import {
  SENT_BACK_FROM,
  sentBackWeeks,
  type CheckRow,
  type LookNoteRow,
  type SentBackWeek,
  type StepComment,
} from './sent-back';

/** PostgREST hands back at most this many rows a request. */
const PAGE = 1000;

/** Every row a query gives, a page at a time. Null when a read fails. */
async function allRows<T>(
  read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) {
      console.error(`Could not read the sent-back count: ${error.message}`);
      return null;
    }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * The weeks /dev/ui charts for plan #2215.5: passing checks, the steps with a
 * sent-back line, and the notes filed from 31 August on. Null when a read
 * fails, so the page says it could not count rather than drawing zeros.
 */
export async function loadSentBackWeeks(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<SentBackWeek[] | null> {
  const checks = await allRows<CheckRow>((from, to) =>
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

  const steps = await allRows<StepComment>((from, to) =>
    supabase
      .from('plan_items')
      .select('number, comment')
      .eq('user_id', userId)
      .ilike('comment', '%Sent back %')
      .order('number')
      .range(from, to),
  );
  if (!steps) return null;

  const notes = await allRows<LookNoteRow>((from, to) =>
    supabase
      .from('feedback_items')
      .select('created_at, page_path, body')
      .eq('user_id', userId)
      .gte('created_at', `${SENT_BACK_FROM}T00:00:00Z`)
      .order('created_at')
      .range(from, to),
  );
  if (!notes) return null;
  return sentBackWeeks(checks, steps, notes, now);
}
