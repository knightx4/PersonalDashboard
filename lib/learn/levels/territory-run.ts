import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';
import { roleRequirementSourceFrom } from '@/lib/learn/levels/role-sources';
import { territorySources, topicsLeft, type Territory } from '@/lib/learn/levels/territory';

/**
 * Drafts a territory a few topics at a time (plan #2172.6). Each call goes
 * down the topics not yet drafted, compiling each with the two-draft call
 * from plan #2138.11 from the territory's sources, until the time is used.
 * Each draft is then pointed at the Level 4 frame topic it refines and given
 * its target on the subject's lens. Nothing is approved here: every topic
 * waits as a draft, with its checks, for the person.
 *
 * Runs on the service role, so every read names the owner. A topic is found
 * again by the ask it was drafted from (`topics.asked`), so calling again
 * picks up where the last call stopped and never drafts a topic twice.
 */

/** A draft takes one to three minutes; start another only while this much of the call is left. */
const START_BEFORE_MS = 150_000;

export type TerritoryTick = {
  drafted: { ask: string; id: string; name: string }[];
  failed: { ask: string; detail: string }[];
  remaining: number;
};

export async function draftTerritoryTick(
  clients: { learn: LearnSupabaseClient; jobs: AppSupabaseClient },
  owner: string,
  territory: Territory,
  input: { anthropicApiKey: string; budgetMs: number; now?: () => number },
): Promise<TerritoryTick> {
  const now = input.now ?? Date.now;
  const started = now();
  const { learn, jobs } = clients;

  const roleSources = await Promise.all(territory.roles.map((phrase) => roleRequirementSourceFrom(jobs, phrase, owner)));
  const sources = territorySources(territory, roleSources);

  const { data: had, error } = await learn.from('topics').select('asked').eq('user_id', owner);
  if (error) throw new Error(`Reading the topics already drafted failed: ${error.message}`);
  const left = topicsLeft(territory, ((had ?? []) as { asked: string | null }[]).map((t) => t.asked));

  const [frames, lens] = await Promise.all([
    learn.from('area_check_articles').select('id, title').eq('level', 4).in('title', [...new Set(left.map((t) => t.frame))]),
    learn.from('lenses').select('id').eq('user_id', owner).eq('origin', 'subject').eq('name', territory.subjectLens).maybeSingle(),
  ]);
  if (frames.error) throw new Error(`Reading the frame topics failed: ${frames.error.message}`);
  const frameId = new Map(((frames.data ?? []) as { id: string; title: string }[]).map((f) => [f.title, f.id]));

  const core = learn.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;
  const ledger = async (operation: 'draft-topic' | 'embed-topic-scope', reports: SpendReport[]) => {
    for (const report of reports) {
      await recordSpend(core, owner, { module: 'learn', operation, model: report.model, usage: report.usage }).catch(
        (e: unknown) => console.error('[learn territory] spend', e instanceof Error ? e.message : e),
      );
    }
  };

  const out: TerritoryTick = { drafted: [], failed: [], remaining: left.length };
  for (const topic of left) {
    if (now() - started > Math.min(START_BEFORE_MS, input.budgetMs)) break;
    const result = await runTopicDraft(
      learn,
      owner,
      { goal: topic.ask, scope: topic.scope, sources, anthropicApiKey: input.anthropicApiKey },
      { owner, ledger },
    );
    if (!result.ok) {
      out.failed.push({ ask: topic.ask, detail: result.detail });
      continue;
    }
    const { data: saved } = await learn
      .from('topics')
      .update({ refines_article_id: frameId.get(topic.frame) ?? null })
      .eq('id', result.id)
      .eq('user_id', owner)
      .select('name, ceiling')
      .single();
    if (lens.data) {
      const { error: targetError } = await learn.from('lens_targets').upsert(
        {
          user_id: owner,
          lens_id: lens.data.id,
          topic_id: result.id,
          target_level: Math.min(topic.target, (saved?.ceiling as number | undefined) ?? topic.target),
        },
        { onConflict: 'lens_id,topic_id', ignoreDuplicates: true },
      );
      if (targetError) console.error('[learn territory] lens target', targetError.message);
    }
    out.drafted.push({ ask: topic.ask, id: result.id, name: (saved?.name as string | undefined) ?? topic.ask });
    out.remaining -= 1;
  }
  return out;
}
