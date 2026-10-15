import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedOne } from '@/lib/learn/embed/embed';
import { draftTopic } from '@/lib/learn/levels/draft';
import { loadFieldOptions, loadMapTopics, saveDraft } from '@/lib/learn/levels/store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * One press of drafting: read the map, make the call, embed the scope, keep
 * the draft, and put both costs on the ledger. Shared by the topics page,
 * where a goal is named, and a draft's page, where a topic its links need is
 * drafted.
 *
 * The scope embedding is what finds a duplicate. When it cannot be made (no
 * key on this deployment, the provider down) the draft is still kept, and the
 * match falls back to the name alone; the trigger in learn 0133 leaves the
 * column empty for a later pass to fill.
 */
export type DraftRunResult = { ok: true; id: string } | { ok: false; detail: string };

export async function runTopicDraft(
  client: LearnSupabaseClient,
  userId: string,
  input: { goal: string; scope?: string | null; anthropicApiKey: string },
): Promise<DraftRunResult> {
  const [map, fields] = await Promise.all([loadMapTopics(client), loadFieldOptions(client)]);

  const drafting = collectSpend();
  const result = await draftTopic({
    goal: input.goal,
    scope: input.scope ?? null,
    map,
    fields,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: drafting.sink,
  });
  await recordLearnSpend(userId, 'draft-topic', drafting.reports);
  if (!result.ok) {
    // A too-broad goal is an answer to reword; a broken call is one to send again.
    return {
      ok: false,
      detail:
        result.reason === 'too-vague'
          ? result.detail
          : `Dash could not write the draft. ${result.detail} Press Draft the topic to send it again.`,
    };
  }

  const embedding = collectSpend();
  const embedded = await embedOne(result.draft.scope, { inputType: 'document', onSpend: embedding.sink });
  await recordLearnSpend(userId, 'embed-topic-scope', embedding.reports);
  if (!embedded.ok && embedded.reason !== 'no-key') {
    console.error('[learn topics] scope embedding', embedded.reason, embedded.detail);
  }

  const saved = await saveDraft(client, userId, {
    draft: result.draft,
    asked: input.goal,
    embedding: embedded.ok ? { vector: embedded.vector, model: embedded.model } : null,
  });
  return { ok: true, id: saved.id };
}
