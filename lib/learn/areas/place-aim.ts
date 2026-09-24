import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import { loadAreas } from '@/lib/learn/areas/load';
import { PLACE_MODEL, placeTracks } from '@/lib/learn/areas/place';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Placing learning goals into the areas (plan #898, 0045_aim_placement.sql).
 *
 * An open goal is placed the way a track is: one `placeTracks` call, given
 * its name and its line, answering a field, a whole domain, or that it spans
 * domains. The Level 3 goal covers every field and is never sent.
 *
 * Every open goal still unplaced goes in the one call, so a goal whose call
 * failed is tried again the next time any goal is saved or reworded.
 *
 * Never throws. A goal is worth having unplaced. The write lands only on a
 * row that is still open and unplaced, so a goal reworded while the call ran
 * (which clears its placement) is left for the next call rather than given
 * the old wording's field.
 */

export type AimToPlace = { id: string; name: string; about: string | null };

export type AimPlacementOutcome = { placed: number; failed: number };

/** The goals the next call sends: open, not a list, not placed yet. */
async function unplacedAims(supabase: LearnSupabaseClient): Promise<AimToPlace[]> {
  const { data, error } = await supabase
    .from('aims')
    .select('id, name, about')
    .is('archived_at', null)
    .is('list_source', null)
    .is('placed_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading the unplaced goals failed: ${error.message}`);
  return (data ?? []) as AimToPlace[];
}

export async function placeAims(
  supabase: LearnSupabaseClient,
  userId: string,
  options: { client?: Anthropic } = {},
): Promise<AimPlacementOutcome> {
  let aims: AimToPlace[] = [];
  try {
    aims = await unplacedAims(supabase);
    if (aims.length === 0) return { placed: 0, failed: 0 };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey && !options.client) return { placed: 0, failed: aims.length };

    // The model is asked by title, so two goals with one name are asked once
    // and both take the answer.
    const byTitle = new Map<string, AimToPlace[]>();
    for (const aim of aims) {
      const key = aim.name.toLowerCase();
      byTitle.set(key, [...(byTitle.get(key) ?? []), aim]);
    }
    const tracks = [...byTitle.values()].map(([first]) => ({
      title: first.name,
      context: first.about ?? `a subject to learn about: ${first.name}`,
    }));

    const { fields, domains, fieldIds, domainIds } = await loadAreas(supabase);
    const spend = collectSpend();
    const result = await placeTracks({
      tracks,
      fields,
      domains,
      anthropicApiKey: apiKey ?? '',
      client: options.client,
      onSpend: spend.sink,
    });
    await recordLearnSpend(userId, 'place-aim', spend.reports);
    if (!result.ok) {
      console.error('[learn place-aim]', result.detail);
      return { placed: 0, failed: aims.length };
    }

    let placed = 0;
    for (const placement of result.placements) {
      for (const aim of byTitle.get(placement.title.toLowerCase()) ?? []) {
        const update = supabase
          .from('aims')
          .update({
            field_id: placement.field ? (fieldIds.get(placement.field) ?? null) : null,
            domain_id: placement.domain ? (domainIds.get(placement.domain) ?? null) : null,
            placement_confidence: placement.confidence,
            placement_basis: placement.basis,
            placement_model: PLACE_MODEL,
            placed_at: new Date().toISOString(),
          })
          .eq('id', aim.id)
          .eq('name', aim.name)
          .is('archived_at', null)
          .is('placed_at', null);
        // Still worded as it was sent: a reword mid-call waits for the next one.
        const { data, error } = await (aim.about === null
          ? update.is('about', null)
          : update.eq('about', aim.about)
        ).select('id');
        if (error) console.error('[learn place-aim] write', error.message);
        else if ((data ?? []).length > 0) placed += 1;
      }
    }
    return { placed, failed: aims.length - placed };
  } catch (error) {
    console.error('[learn place-aim]', error instanceof Error ? error.message : error);
    return { placed: 0, failed: aims.length };
  }
}

/**
 * Place the unplaced goals once the response has gone.
 *
 * The call takes a few seconds and the Goals page does not wait for it: it
 * shows the goal as being placed and checks back. Called only from server
 * actions, where `after` may use the session's cookies for the spend record.
 */
export function placeAimsAfterResponse(supabase: LearnSupabaseClient, userId: string): void {
  after(() => placeAims(supabase, userId).then(() => undefined));
}
