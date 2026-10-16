import 'server-only';

import type postgres from 'postgres';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpend } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { catalogueSql } from '@/lib/learn/catalogue/connection';
import { embedCatalogueSegments } from '@/lib/learn/catalogue/embed-sweep';
import { liveGoalPullPorts, runProvider, wiredProviders } from '@/lib/learn/catalogue/structure-pull-for-goal';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { isGoalKind } from '@/lib/learn/goal-kind';
import { GOAL_KIND_MODEL, classifyGoals } from '@/lib/learn/goal-kind-call';
import { findStoredUnits, liveStoredUnitPorts } from '@/lib/learn/levels/stored-sources-run';
import { finishStep, type StepHandler } from './run';
import type { PreparationStepKey } from './steps';
import { classifyStep, matchStep, pullStep, type PulledDocument, type SubjectKindRow } from './structure-steps';

/**
 * The steps whose code is on main, by key (plan #2276).
 *
 * A key missing here is skipped by the runner with the plan step that builds
 * it, so the run still reaches its end. classify, pull_documents and
 * match_weeks are here from #2276.3; compile_territory arrives with #2276.4,
 * draft_topics and write_units with #2276.5.
 */
export type PreparationDeps = {
  learn: LearnSupabaseClient;
  userId: string;
  anthropicApiKey: string | undefined;
  /** The catalogue connection; the live one unless a test gives its own. */
  catalogue?: () => postgres.Sql;
};

/** Units embedded per pass over the bank, as the territory draft does after a pull. */
const EMBED_PER_PASS = 600;
const EMBED_PASSES = 5;

type Operation = 'classify-goal-kind' | 'propose-structure-sources' | 'match-structure-units';

export function liveHandlers(deps: PreparationDeps): Partial<Record<PreparationStepKey, StepHandler>> {
  const { learn, userId } = deps;
  const sql = () => (deps.catalogue ?? catalogueSql)();
  const core = learn.schema(CORE_SCHEMA) as unknown as CoreSupabaseClient;

  const ledger = async (operation: Operation, reports: SpendReport[]) => {
    for (const report of reports) {
      await recordSpend(core, userId, { module: 'learn', operation, model: report.model, usage: report.usage }).catch(
        (e: unknown) => console.error('[learn prepare] spend', e instanceof Error ? e.message : e),
      );
    }
  };

  const readKind = async (subjectId: string): Promise<SubjectKindRow> => {
    const { data, error } = await learn
      .from('subjects')
      .select('kind, kind_by, kind_reason')
      .eq('user_id', userId)
      .eq('id', subjectId)
      .maybeSingle();
    if (error) throw new Error(`Reading the subject's kind failed: ${error.message}`);
    const row = data as { kind: string | null; kind_by: string | null; kind_reason: string | null } | null;
    return {
      kind: isGoalKind(row?.kind) ? row.kind : null,
      by: row?.kind_by === 'person' ? 'person' : row?.kind_by === 'model' ? 'model' : null,
      reason: row?.kind_reason ?? null,
    };
  };

  const classify = classifyStep({
    read: readKind,
    async classify({ name, note }) {
      if (!deps.anthropicApiKey) return { ok: false, detail: 'No ANTHROPIC_API_KEY is set.' };
      const spent: SpendReport[] = [];
      const result = await classifyGoals({
        goals: [{ name, about: note }],
        anthropicApiKey: deps.anthropicApiKey,
        onSpend: (r) => spent.push(r),
      });
      await ledger('classify-goal-kind', spent);
      if (!result.ok) return result;
      const answer = result.answers[0];
      return answer ? { ok: true, kind: answer.kind, reason: answer.reason } : { ok: false, detail: 'The call returned no kind.' };
    },
    async write(subjectId, answer) {
      // Only a row with no kind: a kind the person set, or one already chosen, is never replaced.
      const { data, error } = await learn
        .from('subjects')
        .update({
          kind: answer.kind,
          kind_reason: answer.reason,
          kind_by: 'model',
          kind_model: GOAL_KIND_MODEL,
          kind_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('id', subjectId)
        .is('kind_by', null)
        .select('id');
      if (error) throw new Error(`Saving the subject's kind failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
  });

  const pull = pullStep(
    {
      wired: wiredProviders,
      async run(provider, subject) {
        const spent: SpendReport[] = [];
        const jevEnabled = await jevEnabledFor(core, userId);
        const ports = liveGoalPullPorts({
          sql: sql(),
          goal: { name: subject.name, about: subject.note },
          anthropicApiKey: deps.anthropicApiKey ?? '',
          jevEnabled,
          onSpend: (r) => spent.push(r),
        });
        const run = await runProvider(provider, ports);
        await ledger('propose-structure-sources', spent);
        return run;
      },
      async describe(itemIds) {
        const rows = await sql()<
          { item_id: string; title: string; canonical_url: string; provider: string; licence_mode: string; units: number }[]
        >`
          select c.item_id, i.title, i.canonical_url, p.name as provider, c.licence_mode,
                 (select count(*)::int from learn.catalogue_segments s where s.item_id = c.item_id) as units
            from learn.catalogue_structures c
            join learn.catalogue_items i on i.id = c.item_id
            join learn.catalogue_providers p on p.id = i.provider_id
           where c.item_id = any(${itemIds}::uuid[])`;
        const byId = new Map(rows.map((r) => [r.item_id, r]));
        return itemIds.flatMap((id): PulledDocument[] => {
          const r = byId.get(id);
          return r ? [{ itemId: id, title: r.title, provider: r.provider, url: r.canonical_url, licence: r.licence_mode, units: r.units }] : [];
        });
      },
    },
    async (subjectId) => (await readKind(subjectId)).kind,
  );

  const match = matchStep({
    async embed(deadline) {
      for (let pass = 0; pass < EMBED_PASSES; pass++) {
        const swept = await embedCatalogueSegments(sql(), { userId, limit: EMBED_PER_PASS, deadline });
        if (swept.stopped?.reason === 'time') return { finished: false };
        if (swept.stopped) throw new Error(`Embedding the new weeks stopped: ${swept.stopped.reason}: ${swept.stopped.detail}`);
        if (swept.embedded === 0) return { finished: true };
      }
      return { finished: false };
    },
    async find(subject) {
      const spent: SpendReport[] = [];
      const found = await findStoredUnits(liveStoredUnitPorts(sql()), subject, [], (r) => spent.push(r));
      await ledger('match-structure-units', spent);
      if (!found.ok) return found;
      return {
        ok: true,
        weeks: found.matches.map((m) => ({
          segmentId: m.segmentId,
          itemId: m.itemId,
          ordinal: m.ordinal,
          label: m.label,
          heading: m.heading,
          similarity: m.similarity,
        })),
      };
    },
  });

  return {
    classify,
    pull_documents: pull,
    match_weeks: match,
    finish: finishStep,
  };
}
