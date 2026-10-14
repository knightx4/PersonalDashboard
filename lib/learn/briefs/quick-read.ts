import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { toFeedCard, type FeedCard, type FeedCardRow } from '@/lib/learn/feed/card';
import { CARD_SELECT } from '@/lib/learn/feed/load';
import { orderQuickRead, QUICK_READ_STATUSES } from './cards';

/**
 * A brief's quick read (plan #2023.6): the Learn now cards written from its
 * sources, one at a time, at /learn/b/<id>/quick. Read through the person's
 * own session, so RLS keeps it to their rows.
 */

export type QuickReadBrief = { id: string; question: string; status: 'researching' | 'ready' | 'failed' };

export type QuickRead = { brief: QuickReadBrief; cards: FeedCard[] };

/** The brief and its cards, or null when there is no such brief of yours. */
export async function loadQuickRead(supabase: LearnSupabaseClient, briefId: string): Promise<QuickRead | null> {
  const { data: briefRow, error: briefError } = await supabase
    .from('briefs')
    .select('id, question, status')
    .eq('id', briefId)
    .maybeSingle();
  if (briefError) throw new Error(`Reading the brief failed: ${briefError.message}`);
  if (!briefRow) return null;
  const row = briefRow as { id: string; question: string; status: string };
  const status = row.status === 'ready' || row.status === 'failed' ? row.status : 'researching';
  const brief: QuickReadBrief = { id: row.id, question: row.question, status };

  const { data: readings, error: readingsError } = await supabase
    .from('readings')
    .select('id')
    .eq('brief_id', briefId)
    .order('position', { ascending: true });
  if (readingsError) throw new Error(`Reading the brief's sources failed: ${readingsError.message}`);
  const readingIds = ((readings ?? []) as { id: string }[]).map((reading) => reading.id);
  if (readingIds.length === 0) return { brief, cards: [] };

  const { data: rows, error: cardsError } = await supabase
    .from('feed_cards')
    .select(`${CARD_SELECT}, reading_id`)
    .eq('reason', 'researched')
    .in('reading_id', readingIds)
    .in('status', [...QUICK_READ_STATUSES])
    .order('written_at', { ascending: true });
  if (cardsError) throw new Error(`Reading the brief's cards failed: ${cardsError.message}`);

  const cards = ((rows ?? []) as unknown as (FeedCardRow & { reading_id: string | null })[]).flatMap((card) => {
    const shown = toFeedCard(card);
    return shown ? [{ readingId: card.reading_id, shown }] : [];
  });
  return { brief, cards: orderQuickRead(cards, readingIds).map((card) => card.shown) };
}
