import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { embedOne } from '@/lib/learn/embed/embed';
import { DRAFT_SYSTEM, DRAFT_TOOL, draftPrompt, readDraftReport } from '@/lib/learn/levels/draft';
import { draftingRecord, type DraftSources, type DraftedFromBrief } from '@/lib/learn/levels/draft-sources';
import {
  DRAFT_REQUEST_COLUMNS,
  DRAFTING_STALE_MS,
  draftRoutineBrief,
  readDraftRequest,
  type DraftAfter,
  type DraftRequest,
} from '@/lib/learn/levels/draft-request';
import { asEmerging } from '@/lib/learn/briefs/topics';
import { approveDrafts, loadFieldOptions, loadMapTopics, saveDraft, settleWanted } from '@/lib/learn/levels/store';
import { addToSubjectLens } from '@/lib/learn/levels/lens-store';
import {
  draftedDocuments,
  withDocumentCanonicality,
  type CanonText,
  type StoredSourceRef,
} from '@/lib/learn/levels/stored-sources';
import { settleBriefTopic } from '@/lib/learn/briefs/topics-store';
import { fireFeatureRoutine, goalsRoutine } from '@/lib/feedback/routine';
import { collectSpend } from '@/lib/learn/spend';
import { recordSpend } from '@/lib/core/spend/record';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * Drafting a topic, through the routine (learn 0193).
 *
 * A press that drafts a topic no longer calls the API. runTopicDraft writes a
 * request with everything the prompt is given besides the map, and what the
 * press would have done with the draft (`after`), and fires the goals routine
 * with the learn-drafts skill. The routine's session reads the prompt through
 * scripts/learn-drafts.ts, writes the draft itself, and hands it to
 * keepRoutineDraft, which checks it with the parser the API reply went
 * through and keeps it exactly as the API path did: settled against the
 * stored documents, emerging when from a brief, its scope embedded, saved as
 * a draft, then approved, targeted and linked as `after` says.
 *
 * Why: the API path was a pair of Sonnet calls of about 50,000 input tokens
 * each, about a dollar a topic, and a subject's preparation drafts forty.
 * Topic drafting was $124 of Learn's $150 in the month to 28 October 2026.
 *
 * One draft, not the pair the API path compared (plan #2138.11): the record's
 * overlap is left empty and says the routine wrote one.
 */
export type DraftRunResult =
  /** Queued for the routine; `fired` is false when the routine could not be started, and the request waits for the next one. */
  | { ok: true; requestId: string; fired: boolean; detail: string }
  | { ok: false; detail: string };

/**
 * A run with no signed-in person (the territory drafter, plan #2172.6) runs on
 * the service role, which sees every account, so it names the owner, and a
 * preparation names its run so its step can find its own requests.
 */
export type DraftRunOptions = {
  owner?: string;
  preparationId?: string;
  /** Queue without firing the routine; the caller fires it once for many (fireDraftRoutine). */
  hold?: boolean;
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
    brief?: DraftedFromBrief;
    after?: DraftAfter;
  },
  options: DraftRunOptions = {},
): Promise<DraftRunResult> {
  const goal = input.goal.trim();
  if (!goal) return { ok: false, detail: 'Name what you want to know.' };
  const row = {
    user_id: userId,
    goal,
    input: {
      scope: input.scope ?? null,
      sources: input.sources ?? null,
      documents: input.documents ?? [],
      canon: input.canon ?? [],
      brief: input.brief ?? null,
    },
    after_draft: input.after ?? {},
    preparation_id: options.preparationId ?? null,
  };
  const { data, error } = await client.from('topic_draft_requests').insert(row).select('id').single();
  let requestId = (data as { id: string } | null)?.id ?? null;
  if (error?.code === '23505') {
    // Asked again while one waits: the waiting one stands.
    const { data: open } = await client
      .from('topic_draft_requests')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['queued', 'drafting'])
      .ilike('goal', goal.replace(/[%_\\]/g, (c) => `\\${c}`))
      .limit(1)
      .maybeSingle();
    requestId = (open as { id: string } | null)?.id ?? null;
  } else if (error) {
    return { ok: false, detail: `Could not queue the draft: ${error.message}` };
  }
  if (!requestId) return { ok: false, detail: 'Could not queue the draft.' };
  if (options.hold) return { ok: true, requestId, fired: false, detail: 'Queued for Dash.' };
  const fired = await fireDraftRoutine(client, userId);
  return { ok: true, requestId, fired: fired.ok, detail: fired.detail };
}

/**
 * Start the routine on the person's waiting drafts, unless a session is
 * already working them (a request taken within the hour), which drains the
 * queue to its end, new requests included. Never throws.
 */
export async function fireDraftRoutine(
  client: LearnSupabaseClient,
  userId: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const since = new Date(Date.now() - DRAFTING_STALE_MS).toISOString();
    const [{ count: waiting }, { count: working }] = await Promise.all([
      client.from('topic_draft_requests').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'queued'),
      client
        .from('topic_draft_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'drafting')
        .gte('taken_at', since),
    ]);
    if (!waiting) return { ok: true, detail: 'Nothing is waiting to be drafted.' };
    if (working) return { ok: true, detail: 'Dash is already drafting; this one is next in its queue.' };
    const routine = goalsRoutine();
    if (!routine.id) return { ok: false, detail: 'Queued, but no goals routine is set (CLAUDE_GOALS_ROUTINE_ID), so it waits.' };
    const fired = await fireFeatureRoutine({ apiKey: routine.token, routineId: routine.id, text: draftRoutineBrief(userId, waiting) });
    if (!fired.ok) return { ok: false, detail: `Queued, but the routine did not start: ${fired.error}` };
    return { ok: true, detail: 'Dash is drafting it in a routine; it lands on Topics in a few minutes.' };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The routine did not start.' };
  }
}

/** The prompt the routine's session drafts from: the system, the user message, and the tool whose input it writes. */
export async function draftRequestPrompt(
  client: LearnSupabaseClient,
  request: DraftRequest,
): Promise<{ system: string; prompt: string; tool: typeof DRAFT_TOOL }> {
  const [map, fields] = await Promise.all([loadMapTopics(client, request.userId), loadFieldOptions(client)]);
  const prompt = draftPrompt({
    goal: request.goal,
    scope: request.input.scope,
    map,
    fields,
    sources: request.input.sources,
  });
  return { system: DRAFT_SYSTEM, prompt, tool: DRAFT_TOOL };
}

/** Take the oldest waiting request (or one drafting past the stale mark) for this session. */
export async function takeDraftRequest(client: LearnSupabaseClient, userId: string): Promise<DraftRequest | null> {
  const stale = new Date(Date.now() - DRAFTING_STALE_MS).toISOString();
  const { data, error } = await client
    .from('topic_draft_requests')
    .select('id, status')
    .eq('user_id', userId)
    .or(`status.eq.queued,and(status.eq.drafting,taken_at.lt.${stale})`)
    .order('requested_at')
    .limit(5);
  if (error) throw new Error(`Reading the queue failed: ${error.message}`);
  for (const candidate of (data ?? []) as { id: string; status: string }[]) {
    // Taken only if still as read, so two sessions never draft one request.
    let take = client
      .from('topic_draft_requests')
      .update({ status: 'drafting', taken_at: new Date().toISOString() })
      .eq('id', candidate.id)
      .eq('user_id', userId)
      .eq('status', candidate.status);
    if (candidate.status === 'drafting') take = take.lt('taken_at', stale);
    const { data: taken } = await take.select(DRAFT_REQUEST_COLUMNS).maybeSingle();
    if (taken) return readDraftRequest(taken as Record<string, unknown>);
  }
  return null;
}

export async function failDraftRequest(client: LearnSupabaseClient, userId: string, requestId: string, detail: string) {
  const { error } = await client
    .from('topic_draft_requests')
    .update({ status: 'failed', error: detail.slice(0, 500), finished_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('user_id', userId);
  if (error) throw new Error(`Marking the request failed failed: ${error.message}`);
}

export type KeptDraft = { ok: true; topicId: string; name: string; approved: boolean } | { ok: false; detail: string };

/**
 * Keep the routine's draft of a request: check it, settle it, embed it, save
 * it, do what `after` says, and close the request. A report that does not
 * check fails the request with why, for the session to write again or leave.
 */
export async function keepRoutineDraft(
  client: LearnSupabaseClient,
  request: DraftRequest,
  report: unknown,
): Promise<KeptDraft> {
  const userId = request.userId;
  const { input } = request;
  const [map, fields] = await Promise.all([loadMapTopics(client, userId), loadFieldOptions(client)]);
  const result = readDraftReport(report, { map, fields, sources: input.sources });
  if (!result.ok) return { ok: false, detail: result.detail };

  const refs = input.documents;
  const settled = withDocumentCanonicality(result.draft, refs);
  const kept = input.brief ? asEmerging(settled) : settled;
  const record = draftingRecord(kept, null, 'only one draft was written, by the routine', input.sources);
  if (refs.length > 0) {
    record.documents = draftedDocuments(kept, refs);
    record.canon = [...input.canon];
  }
  if (input.brief) record.brief = input.brief;

  const embedding = collectSpend();
  const embedded = await embedOne(kept.scope, { inputType: 'document', onSpend: embedding.sink });
  // On the request's client: the script that calls this has no session to record through.
  const core = client.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;
  for (const r of embedding.reports) {
    await recordSpend(core, userId, { module: 'learn', operation: 'embed-topic-scope', model: r.model, usage: r.usage }).catch(
      (e: unknown) => console.error('[learn drafts] spend', e instanceof Error ? e.message : e),
    );
  }
  if (!embedded.ok && embedded.reason !== 'no-key') {
    console.error('[learn drafts] scope embedding', embedded.reason, embedded.detail);
  }

  const saved = await saveDraft(client, userId, {
    draft: kept,
    sources: input.sources,
    drafting: record,
    asked: request.goal,
    embedding: embedded.ok ? { vector: embedded.vector, model: embedded.model } : null,
  });
  const approved = await settleDraftAfter(client, userId, saved.id, request.after);

  const { error } = await client
    .from('topic_draft_requests')
    .update({ status: 'done', topic_id: saved.id, error: null, finished_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('user_id', userId);
  if (error) throw new Error(`Closing the request failed: ${error.message}`);
  return { ok: true, topicId: saved.id, name: kept.name, approved };
}

/** What the press would have done with the draft. Each part is logged and passed over on failure: the draft stays kept. */
export async function settleDraftAfter(
  client: LearnSupabaseClient,
  userId: string,
  topicId: string,
  after: DraftAfter,
): Promise<boolean> {
  const step = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[learn drafts] ${label}`, error instanceof Error ? error.message : error);
    }
  };
  if (after.wanted) {
    const wanted = after.wanted;
    await step('wanted', () => settleWanted(client, userId, { ...wanted, draftId: topicId }));
  }
  if (after.subjectLens) {
    const subject = after.subjectLens;
    await step('subject lens', () => addToSubjectLens(client, userId, subject, topicId));
  }
  if (after.refinesArticleId || after.lensTarget) {
    await step('territory', async () => {
      const { data: saved } = await client
        .from('topics')
        .update({ refines_article_id: after.refinesArticleId ?? null })
        .eq('id', topicId)
        .eq('user_id', userId)
        .select('ceiling')
        .single();
      if (!after.lensTarget) return;
      const { error } = await client.from('lens_targets').upsert(
        {
          user_id: userId,
          lens_id: after.lensTarget.lensId,
          topic_id: topicId,
          target_level: Math.min(after.lensTarget.target, (saved?.ceiling as number | undefined) ?? after.lensTarget.target),
        },
        { onConflict: 'lens_id,topic_id', ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    });
  }
  if (!after.approve) return false;
  let approved = false;
  await step('approve', async () => {
    const [done] = await approveDrafts(client, [topicId]);
    approved = Boolean(done);
    if (done) await settleBriefTopic(client, userId, topicId);
  });
  return approved;
}
