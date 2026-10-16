import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedOne } from '@/lib/learn/embed/embed';
import { draftTopic } from '@/lib/learn/levels/draft';
import {
  NO_SOURCES,
  bothOrEither,
  draftingRecord,
  pickDraft,
  type DraftSources,
} from '@/lib/learn/levels/draft-sources';
import { loadFieldOptions, loadMapTopics, saveDraft } from '@/lib/learn/levels/store';
import {
  draftedDocuments,
  withDocumentCanonicality,
  type CanonText,
  type StoredSourceRef,
} from '@/lib/learn/levels/stored-sources';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import type { SpendReport } from '@/lib/core/spend/pricing';

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
 *
 * The call runs twice, side by side (plan #2138.11). How far the two drafts
 * agree is the stability check; the one more of whose rows cite a source is
 * kept, and the sources and the checks a draft alone can give go on the topic
 * as `drafting`. Both calls go on the ledger under draft-topic, so a draft
 * costs twice what one call did. When one call fails the other is kept and
 * the overlap says why it is missing.
 *
 * When some of the sources are stored documents (plan #2247.10), `documents`
 * says which source ids they are. Both drafts are then read back against
 * them: the topic row cites every document its levels and links cite, each
 * row's canonicality follows the count of independent documents it cites, and
 * the documents and the territory's canon go on the topic's `drafting`.
 */
export type DraftRunResult = { ok: true; id: string } | { ok: false; detail: string };

/**
 * How a run with no signed-in person does the two things that otherwise read
 * the session: whose topics the call is told about, and where the cost goes.
 * The territory drafter (plan #2172.6) runs on the service role, which sees
 * every account, so it names the owner and brings its own ledger.
 */
export type DraftRunOptions = {
  owner?: string;
  ledger?: (operation: 'draft-topic' | 'embed-topic-scope', reports: SpendReport[]) => Promise<void>;
};

export async function runTopicDraft(
  client: LearnSupabaseClient,
  userId: string,
  input: {
    goal: string;
    scope?: string | null;
    sources?: DraftSources;
    documents?: readonly StoredSourceRef[];
    canon?: readonly CanonText[];
    anthropicApiKey: string;
  },
  options: DraftRunOptions = {},
): Promise<DraftRunResult> {
  // Each operation spelled out, so the paid-action check can read what this records.
  const ledger =
    options.ledger ??
    ((operation, reports) =>
      operation === 'draft-topic'
        ? recordLearnSpend(userId, 'draft-topic', reports)
        : recordLearnSpend(userId, 'embed-topic-scope', reports));
  const [map, fields] = await Promise.all([loadMapTopics(client, options.owner), loadFieldOptions(client)]);
  const given = input.sources ?? NO_SOURCES;

  const drafting = collectSpend();
  const call = () =>
    draftTopic({
      goal: input.goal,
      scope: input.scope ?? null,
      map,
      fields,
      sources: given,
      anthropicApiKey: input.anthropicApiKey,
      onSpend: drafting.sink,
    });
  const [first, second] = await Promise.all([call(), call()]);
  await ledger('draft-topic', drafting.reports);

  const result = bothOrEither(first, second);
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

  const refs = input.documents ?? [];
  const draft = withDocumentCanonicality(result.draft, refs);
  const other = result.other ? withDocumentCanonicality(result.other, refs) : null;
  const kept = other ? pickDraft(draft, other, given) : draft;
  const record = draftingRecord(kept, kept === draft ? other : draft, result.failed, given);
  if (refs.length > 0) {
    record.documents = draftedDocuments(kept, refs);
    record.canon = [...(input.canon ?? [])];
  }

  const embedding = collectSpend();
  const embedded = await embedOne(kept.scope, { inputType: 'document', onSpend: embedding.sink });
  await ledger('embed-topic-scope', embedding.reports);
  if (!embedded.ok && embedded.reason !== 'no-key') {
    console.error('[learn topics] scope embedding', embedded.reason, embedded.detail);
  }

  const saved = await saveDraft(client, userId, {
    draft: kept,
    sources: given,
    drafting: record,
    asked: input.goal,
    embedding: embedded.ok ? { vector: embedded.vector, model: embedded.model } : null,
  });
  return { ok: true, id: saved.id };
}
