import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { RunCell } from '@/lib/learn/levels/run';
import { themeOffers, type OfferTheme, type ThemeOffer } from '@/lib/learn/levels/theme-offer';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/**
 * Reading, making and declining the lens offered at the end of a run (plan
 * #2138.14). The rule is lib/learn/levels/theme-offer.ts.
 */

const CHUNK = 100;

/** The offers for a run's missed levels, strongest theme first. */
export async function loadThemeOffers(
  learn: LearnSupabaseClient,
  vault: VaultSupabaseClient,
  userId: string,
  missed: readonly RunCell[],
): Promise<ThemeOffer[]> {
  if (missed.length === 0) return [];
  const [topics, targets, placed, declines] = await Promise.all([
    learn.from('topics').select('id, ceiling, field_ids').eq('user_id', userId),
    learn.from('lens_targets').select('topic_id').eq('user_id', userId),
    learn.from('theme_fields').select('theme_id, field_id').eq('user_id', userId).not('field_id', 'is', null),
    learn.from('lens_offer_declines').select('theme_id').eq('user_id', userId),
  ]);
  for (const read of [topics, targets, placed, declines]) {
    if (read.error) throw new Error(`Reading what a lens could cover failed: ${read.error.message}`);
  }
  const topicRows = (topics.data ?? []) as Array<{ id: string; ceiling: number; field_ids: string[] | null }>;
  const topicFields = new Map(topicRows.map((t) => [t.id, t.field_ids ?? []]));
  const ceilings = new Map(topicRows.map((t) => [t.id, t.ceiling]));

  // Only themes placed in a field a missed topic carries can matter.
  const wanted = new Set<string>();
  for (const c of missed) for (const f of topicFields.get(c.topicId) ?? []) wanted.add(f);
  const placements = ((placed.data ?? []) as Array<{ theme_id: string; field_id: string }>).filter((p) =>
    wanted.has(p.field_id),
  );

  const named = new Map<string, { name: string; strength: number }>();
  const ids = [...new Set(placements.map((p) => p.theme_id))];
  for (let from = 0; from < ids.length; from += CHUNK) {
    const read = await vault.from('themes').select('id, name, strength').in('id', ids.slice(from, from + CHUNK));
    if (read.error) throw new Error(`Reading the themes' names failed: ${read.error.message}`);
    for (const t of (read.data ?? []) as Array<{ id: string; name: string; strength: number | string | null }>) {
      named.set(t.id, { name: t.name, strength: Number(t.strength ?? 0) });
    }
  }
  const themes: OfferTheme[] = placements.flatMap((p) => {
    const t = named.get(p.theme_id);
    return t ? [{ id: p.theme_id, name: t.name, fieldId: p.field_id, strength: t.strength }] : [];
  });

  return themeOffers({
    missed,
    topicFields,
    themes,
    lensTopics: new Set(((targets.data ?? []) as Array<{ topic_id: string }>).map((t) => t.topic_id)),
    declined: new Set(((declines.data ?? []) as Array<{ theme_id: string }>).map((d) => d.theme_id)),
    ceilings,
  });
}

/** Make the lens of an offer. Returns its id. A theme that already has one gets no second. */
export async function makeThemeLens(learn: LearnSupabaseClient, userId: string, offer: ThemeOffer): Promise<string> {
  const existing = await learn.from('lenses').select('id').eq('theme_id', offer.themeId).maybeSingle();
  if (existing.error) throw new Error(`Reading the theme's lens failed: ${existing.error.message}`);
  let lensId = (existing.data as { id: string } | null)?.id ?? null;
  if (!lensId) {
    const made = await learn
      .from('lenses')
      .insert({ user_id: userId, name: offer.themeName, origin: 'theme', theme_id: offer.themeId })
      .select('id')
      .single();
    if (made.error) throw new Error(`Making the lens failed: ${made.error.message}`);
    lensId = (made.data as { id: string }).id;
  }
  const { error } = await learn.from('lens_targets').upsert(
    offer.topics.map((t) => ({ user_id: userId, lens_id: lensId, topic_id: t.topicId, target_level: t.level })),
    { onConflict: 'lens_id,topic_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`Adding the topics to the lens failed: ${error.message}`);
  return lensId;
}

/** Remember that a theme's offer was declined, so it is not made again. */
export async function declineThemeLens(learn: LearnSupabaseClient, userId: string, themeId: string): Promise<void> {
  const { error } = await learn
    .from('lens_offer_declines')
    .upsert({ user_id: userId, theme_id: themeId }, { onConflict: 'user_id,theme_id', ignoreDuplicates: true });
  if (error) throw new Error(`Remembering that you declined failed: ${error.message}`);
}
