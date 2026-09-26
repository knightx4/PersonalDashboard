import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { storeArticleOverRest } from '@/lib/learn/catalogue/store-rest';
import type { Depth } from '@/lib/learn/feed/depth';
import { matchSection } from '@/lib/learn/feed/pass';
import type { CardToWrite } from '@/lib/learn/feed/write-card';
import type { LearnOperation } from '@/lib/learn/spend';
import { fetchWikipediaArticle } from '@/lib/learn/providers/wikipedia';
import { writePickedCard } from './feed-top-up';

/**
 * Make it a card, under the explanation of a phrase selected on a Learn now
 * card (plan #1057).
 *
 * The explanation named the Wikipedia article that teaches the phrase. This
 * fetches that article, stores it in the catalogue as the picking pass does,
 * picks the named section (the lead when it is not there) as a row with the
 * reason `asked`, and writes it into cards straight away with the top-up's own
 * writer. The card writer saves each idea as a concept with origin `feed`,
 * like every other Learn now idea.
 *
 * A write that fails leaves the row picked, and the next top-up writes it.
 *
 * The service role writes the catalogue, which the person's session cannot,
 * so every read and write here names the person.
 */

const OPERATION: LearnOperation = 'write-asked-card';
const EMBED_OPERATION: LearnOperation = 'embed-feed-ideas';

export type AskedCardInput = {
  phrase: string;
  /** The title of the card the phrase was selected on. */
  askedOn: string;
  article: string;
  section: string | null;
  depth: Depth | null;
};

export type AskedCardResult =
  | { ok: true; cardId: string }
  | { ok: false; detail: string };

type ExistingRow = { id: string; status: string; drop_reason: string | null };

export async function makeAskedCard(userId: string, input: AskedCardInput): Promise<AskedCardResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: 'Writing a card needs ANTHROPIC_API_KEY to be set.' };
  const learn = createLearnServiceSupabase();

  const article = await fetchWikipediaArticle(input.article);
  if (!article.ok) {
    return {
      ok: false,
      detail:
        article.reason === 'not-found' || article.reason === 'unreadable'
          ? `Wikipedia has no article called ${input.article} to write the card from.`
          : `Wikipedia could not be read: ${article.detail}`,
    };
  }
  const match = matchSection(article.sections, input.section);
  if (!match) return { ok: false, detail: `The article ${article.title} has no text to write a card from.` };

  const stored = await storeArticleOverRest(learn, article);
  const segment = stored.segments.find((row) => row.ordinal === match.section.ordinal);
  if (!segment) return { ok: false, detail: `The stored article ${article.title} is missing that section.` };

  // One card per section per person: a section already picked for them is
  // the card, whatever it was picked for.
  const { data: inserted, error: insertError } = await learn
    .from('feed_cards')
    .upsert(
      {
        user_id: userId,
        reason: 'asked',
        asked_phrase: input.phrase,
        asked_on: input.askedOn,
        item_id: stored.itemId,
        segment_id: segment.id,
        named_article: article.title,
        named_section: match.section.heading,
        pick_basis: `Asked for on the phrase "${input.phrase}".`,
        depth: input.depth,
      },
      { onConflict: 'user_id,segment_id,idea_index', ignoreDuplicates: true },
    )
    .select('id');
  if (insertError) return { ok: false, detail: `Picking the section failed: ${insertError.message}` };

  let cardId = ((inserted ?? []) as { id: string }[])[0]?.id ?? null;
  if (!cardId) {
    const { data: existing, error } = await learn
      .from('feed_cards')
      .select('id, status, drop_reason')
      .eq('user_id', userId)
      .eq('segment_id', segment.id)
      .eq('idea_index', 0)
      .maybeSingle();
    if (error || !existing) return { ok: false, detail: 'That section was picked already and could not be read.' };
    const row = existing as ExistingRow;
    if (row.status === 'dropped') {
      return { ok: false, detail: `A card from that section was not written: ${row.drop_reason ?? 'no reason kept'}` };
    }
    if (row.status !== 'picked') return { ok: true, cardId: row.id };
    cardId = row.id;
  }

  const card: CardToWrite = {
    id: cardId,
    segmentId: segment.id,
    reason: 'asked',
    themeName: null,
    aimName: null,
    askedPhrase: input.phrase,
    askedOn: input.askedOn,
    field: null,
    gap: null,
    article: article.title,
    section: match.section.heading,
    text: match.section.text,
    depth: input.depth,
  };
  const core = createCoreServiceSupabase();
  const result = await writePickedCard(learn, apiKey, userId, card, async (spend: SpendReport[], embedSpend: SpendReport[]) => {
    for (const report of spend) {
      await recordSpend(core, userId, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
    }
    for (const report of embedSpend) {
      await recordSpend(core, userId, { module: 'learn', operation: EMBED_OPERATION, model: report.model, usage: report.usage });
    }
  });
  if (result.outcome === 'ready') return { ok: true, cardId };
  if (result.outcome === 'dropped') return { ok: false, detail: `No card was written: ${result.reason}` };
  return {
    ok: false,
    detail: `Writing the card failed (${result.detail}). It is kept, and the next top-up of your deck writes it.`,
  };
}
