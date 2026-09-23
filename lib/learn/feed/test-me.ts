import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { StartedTrack } from '@/lib/learn/flow/offer';
import { generateChain } from '@/lib/learn/graph/generate';
import { existingConcepts, saveChain } from '@/lib/learn/graph/save';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Test me on this: start a track from a Learn now card (plan #808).
 *
 * The same path a track takes when the flow offers one from a theme
 * (`startTrackFromTheme`): one `generateChain` call, saved with `saveChain`,
 * no approval screen, every idea unknown. What differs is the goal. A card is
 * one section of one article, and "this" on the button is that section, so the
 * goal is the card's title ("Urbanization: Causes") and the track is the
 * article ("Urbanization"). A second card from the same article adds to the
 * same track rather than starting another, and the generator is told what that
 * track already holds so it does not write it twice.
 *
 * The theme a card was picked for is not the goal: a track on "planes of
 * reality" would test the theme, not the section on the screen.
 */
export async function startTrackFromCard(
  supabase: LearnSupabaseClient,
  userId: string,
  card: { title: string; article: string },
): Promise<StartedTrack> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: 'Starting a track needs ANTHROPIC_API_KEY to be set.' };

  // Read, not created: a track is only made once there is a chain to put in it.
  // The same case-insensitive match `saveChain` makes when it files the chain.
  const { data: subject } = await supabase
    .from('subjects')
    .select('id')
    .ilike('name', card.article)
    .maybeSingle();
  const existing = subject
    ? await existingConcepts(supabase, (subject as { id: string }).id).catch(() => [])
    : [];

  const spend = collectSpend();
  const result = await generateChain({
    goal: card.title,
    subject: card.article,
    existing,
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(userId, 'generate-chain', spend.reports);
  if (!result.ok) return { ok: false, detail: result.detail };

  try {
    const saved = await saveChain(supabase, userId, { ...result.chain, subject: card.article }, card.title, {
      origin: 'generated',
    });
    return { ok: true, subjectId: saved.subjectId, name: card.article };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'Could not save that track.' };
  }
}
