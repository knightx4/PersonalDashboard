import 'server-only';

import type postgres from 'postgres';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { jevEnabledFor } from '@/lib/jev/enabled';
import {
  dayOf,
  pullForLitTopics,
  type LitTopic,
  type LitTopicPorts,
  type LitTopicSummary,
  type PriorPull,
  type PullOutcome,
} from '@/lib/learn/catalogue/lit-topic-pull';
import { liveGoalPullPorts, runProvider } from '@/lib/learn/catalogue/structure-pull-for-goal';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { topicStates, type TopicLink } from '@/lib/learn/evidence/topic-state';
import { classifyGoals } from '@/lib/learn/goal-kind-call';
import { loadTopicRows } from '@/lib/learn/map/topics-load';

/**
 * The live ports of the daily pull for topics that just lit (plan #2247.11).
 *
 * "Lit" is the map's own rule: lib/learn/evidence/topic-state.ts, over the
 * topics' evidence links. A topic lit only by ideas attached to it is not
 * seen here yet, because that needs each idea's state row; evidence links
 * are what the daily run already writes for notes, courses and work.
 */

type PullRow = { topic_id: string; pulled_on: string; outcome: PullOutcome };

export async function runLitTopicPulls(input: {
  learn: LearnSupabaseClient;
  catalogue: postgres.Sql;
  userId: string;
  anthropicApiKey: string;
  budgetMs: number;
  now?: Date;
}): Promise<LitTopicSummary> {
  const { learn, userId } = input;
  const now = input.now ?? new Date();
  const started = Date.now();
  const core = learn.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;
  const jevEnabled = await jevEnabledFor(core, userId);

  const ledger = async (operation: 'classify-goal-kind' | 'pull-lit-topic-structure', reports: SpendReport[]) => {
    for (const report of reports) {
      await recordSpend(core, userId, { module: 'learn', operation, model: report.model, usage: report.usage }).catch(
        (e: unknown) => console.error('[learn lit pulls] spend', e instanceof Error ? e.message : e),
      );
    }
  };

  const ports: LitTopicPorts = {
    litTopics: async () => {
      const rows = await loadTopicRows(learn, userId);
      const titleOf = new Map([...rows.level3, ...rows.level4].map((t) => [t.id, t.title]));
      const linksByTopic = new Map<string, TopicLink[]>();
      const litAt = new Map<string, string>();
      for (const r of rows.links) {
        const list = linksByTopic.get(r.target_id) ?? [];
        list.push({ kind: r.kind, ceiling: r.ceiling, similarity: r.similarity, foundAt: r.found_at, matchedBy: r.matched_by });
        linksByTopic.set(r.target_id, list);
        if (r.kind !== 'mention' && r.found_at > (litAt.get(r.target_id) ?? '')) litAt.set(r.target_id, r.found_at);
      }
      const nodes = [
        ...rows.level3.map((r) => ({ id: r.id, level: 3 as const, parentId: null })),
        ...rows.level4.map((r) => ({ id: r.id, level: 4 as const, parentId: r.parent_id })),
      ];
      const states = topicStates(nodes, [], linksByTopic, now);
      const out: LitTopic[] = [];
      for (const topic of rows.level4) {
        if (states.get(topic.id)?.state !== 'lit') continue;
        out.push({
          id: topic.id,
          title: topic.title,
          parentTitle: topic.parent_id ? (titleOf.get(topic.parent_id) ?? null) : null,
          litAt: litAt.get(topic.id) ?? null,
        });
      }
      return out;
    },
    history: async () => {
      const { data, error } = await learn
        .from('topic_structure_pulls')
        .select('topic_id, pulled_on, outcome')
        .eq('user_id', userId);
      if (error) throw new Error(`Reading the topic pulls failed: ${error.message}`);
      const prior = new Map<string, PriorPull>();
      const today = dayOf(now);
      let used = 0;
      for (const row of (data ?? []) as PullRow[]) {
        prior.set(row.topic_id, { outcome: row.outcome, pulledOn: row.pulled_on });
        if (row.pulled_on === today) used += 1;
      }
      return { prior, today: used };
    },
    classify: async (goal) => {
      const spent: SpendReport[] = [];
      const result = await classifyGoals({ goals: [goal], anthropicApiKey: input.anthropicApiKey, onSpend: (r) => spent.push(r) });
      await ledger('classify-goal-kind', spent);
      if (!result.ok) return result;
      return { ok: true, kind: result.answers[0]?.kind ?? null };
    },
    pull: async (provider, goal) => {
      const spent: SpendReport[] = [];
      try {
        return await runProvider(
          provider,
          liveGoalPullPorts({
            sql: input.catalogue,
            goal,
            anthropicApiKey: input.anthropicApiKey,
            jevEnabled,
            onSpend: (r) => spent.push(r),
          }),
        );
      } finally {
        await ledger('pull-lit-topic-structure', spent);
      }
    },
    record: async (line, day) => {
      const { error } = await learn.from('topic_structure_pulls').upsert(
        {
          user_id: userId,
          topic_id: line.topicId,
          pulled_on: day,
          kind: line.kind,
          provider: line.provider,
          outcome: line.outcome,
          item_id: line.itemId,
        },
        { onConflict: 'user_id,topic_id' },
      );
      if (error) throw new Error(`Recording the topic pull failed: ${error.message}`);
    },
    outOfTime: () => Date.now() - started > input.budgetMs,
  };

  return pullForLitTopics(ports, now);
}
