import 'server-only';

import type postgres from 'postgres';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpend } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { catalogueSql } from '@/lib/learn/catalogue/connection';
import { embedCatalogueSegments, vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { readStructure } from '@/lib/learn/catalogue/structure-store';
import { TOPIC_DIMENSIONS } from '@/lib/learn/areas/topic-import';
import { embedOne } from '@/lib/learn/embed/embed';
import { liveGoalPullPorts, runProvider, wiredProviders } from '@/lib/learn/catalogue/structure-pull-for-goal';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { isGoalKind } from '@/lib/learn/goal-kind';
import { GOAL_KIND_MODEL, classifyGoals } from '@/lib/learn/goal-kind-call';
import { findStoredUnits, liveStoredUnitPorts } from '@/lib/learn/levels/stored-sources-run';
import { draftTerritoryTick } from '@/lib/learn/levels/territory-run';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { CURRICULUM_MODEL, writeCurriculum } from '@/lib/learn/graph/curriculum';
import { draftTopicsStep, writeUnitsStep, type SubjectUnit } from './draft-steps';
import { compileStep, compileTerritory, FRAMES_OFFERED, type CompileDocument } from './compile-territory';
import { finishPreparationStep } from './finish-step';
import type { StepHandler } from './run';
import { loadRunTerritory, saveRunTerritory } from './store';
import type { PreparationStepKey } from './steps';
import { classifyStep, matchStep, pullStep, type PulledDocument, type SubjectKindRow } from './structure-steps';

/**
 * The steps whose code is on main, by key (plan #2276).
 *
 * A key missing here is skipped by the runner with the plan step that builds
 * it, so the run still reaches its end. classify, pull_documents and
 * match_weeks are here from #2276.3, compile_territory from #2276.4,
 * draft_topics and write_units from #2276.5, and finish from #2276.6.
 */
export type PreparationDeps = {
  learn: LearnSupabaseClient;
  userId: string;
  anthropicApiKey: string | undefined;
  /** The job search client the territory drafter reads role requirements through; a compiled territory names none. */
  jobs: AppSupabaseClient;
  /** The catalogue connection; the live one unless a test gives its own. */
  catalogue?: () => postgres.Sql;
};

/** Units embedded per pass over the bank, as the territory draft does after a pull. */
const EMBED_PER_PASS = 600;
const EMBED_PASSES = 5;

type Operation =
  | 'classify-goal-kind'
  | 'propose-structure-sources'
  | 'match-structure-units'
  | 'compile-territory'
  | 'write-curriculum';

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

  const compile = compileStep({
    stored: (runId) => loadRunTerritory(learn, userId, runId),
    async documents(items) {
      const read = await Promise.all(items.map((item) => readStructure(sql(), item.itemId)));
      return items.flatMap((item, i): CompileDocument[] => {
        const doc = read[i];
        if (!doc) return [];
        return [
          {
            itemId: doc.itemId,
            title: doc.title,
            url: doc.canonicalUrl,
            institution: doc.institution,
            courseCode: doc.courseCode,
            term: doc.term,
            units: doc.units.map((u) => ({ ordinal: u.ordinal, label: u.label, heading: u.heading, topics: u.topics })),
            matched: item.matched,
            best: item.best,
          },
        ];
      });
    },
    async frames(subject) {
      // The frame articles are embedded at 512 wide (learn 0128); the subject is searched the same way.
      const spent: SpendReport[] = [];
      const query = `${subject.name.trim()}${subject.note?.trim() ? `. ${subject.note.trim()}` : ''}`;
      const embedded = await embedOne(query, { inputType: 'query', dimensions: TOPIC_DIMENSIONS, onSpend: (r) => spent.push(r) });
      await ledger('compile-territory', spent);
      if (!embedded.ok) throw new Error(`Finding the frame topics failed: ${embedded.reason}: ${embedded.detail}`);
      const rows = await sql()<{ title: string }[]>`
        select title from learn.area_check_articles
         where level = 4 and embedding is not null
         order by embedding operator(extensions.<=>) ${vectorLiteral(embedded.vector, TOPIC_DIMENSIONS)}::extensions.vector
         limit ${FRAMES_OFFERED}`;
      return [...new Set(rows.map((r) => r.title))];
    },
    async compile(input) {
      if (!deps.anthropicApiKey) return { ok: false, detail: 'No ANTHROPIC_API_KEY is set.' };
      const spent: SpendReport[] = [];
      const result = await compileTerritory({ ...input, anthropicApiKey: deps.anthropicApiKey, onSpend: (r) => spent.push(r) });
      await ledger('compile-territory', spent);
      return result;
    },
    save: (runId, territory) => saveRunTerritory(learn, userId, runId, territory),
  });

  const draftTopics = draftTopicsStep({
    territory: (runId) => loadRunTerritory(learn, userId, runId),
    async lens(subject) {
      const { data: found, error } = await learn
        .from('lenses')
        .select('id, name')
        .eq('user_id', userId)
        .eq('subject_id', subject.id)
        .maybeSingle();
      if (error) throw new Error(`Reading the subject's lens failed: ${error.message}`);
      if (found) return found as { id: string; name: string };
      const { data: made, error: makeError } = await learn
        .from('lenses')
        .insert({ user_id: userId, name: subject.name, origin: 'subject', subject_id: subject.id })
        .select('id, name')
        .single();
      if (made) return made as { id: string; name: string };
      // Made by another call in the meantime: that one stands.
      const { data: raced } = await learn
        .from('lenses')
        .select('id, name')
        .eq('user_id', userId)
        .eq('subject_id', subject.id)
        .maybeSingle();
      if (raced) return raced as { id: string; name: string };
      throw new Error(`Making the subject's lens failed: ${makeError?.message ?? 'no row came back'}`);
    },
    async asked() {
      const { data, error } = await learn.from('topics').select('asked').eq('user_id', userId);
      if (error) throw new Error(`Reading the topics already drafted failed: ${error.message}`);
      return ((data ?? []) as { asked: string | null }[]).map((t) => t.asked);
    },
    async draft(territory, budgetMs) {
      if (!deps.anthropicApiKey) throw new Error('No ANTHROPIC_API_KEY is set.');
      // No catalogue: the compiled territory already carries its documents as its texts.
      const tick = await draftTerritoryTick({ learn, jobs: deps.jobs }, userId, territory, {
        anthropicApiKey: deps.anthropicApiKey,
        budgetMs,
      });
      return { drafted: tick.drafted, failed: tick.failed };
    },
    async targets(lensId, topics) {
      const asks = topics.map((t) => t.ask);
      const { data, error } = await learn.from('topics').select('id, asked, ceiling').eq('user_id', userId).in('asked', asks);
      if (error) throw new Error(`Reading the drafted topics failed: ${error.message}`);
      const byAsk = new Map(
        ((data ?? []) as { id: string; asked: string; ceiling: number | null }[]).map((t) => [t.asked.trim().toLowerCase(), t]),
      );
      const rows = topics.flatMap((t) => {
        const topic = byAsk.get(t.ask.trim().toLowerCase());
        return topic
          ? [{ user_id: userId, lens_id: lensId, topic_id: topic.id, target_level: Math.min(t.target, topic.ceiling ?? t.target) }]
          : [];
      });
      if (rows.length === 0) return 0;
      // A target the person or an earlier tick set stays as it is.
      const { error: upsertError } = await learn
        .from('lens_targets')
        .upsert(rows, { onConflict: 'lens_id,topic_id', ignoreDuplicates: true });
      if (upsertError) throw new Error(`Setting the lens's targets failed: ${upsertError.message}`);
      const { count } = await learn
        .from('lens_targets')
        .select('topic_id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('lens_id', lensId)
        .in('topic_id', rows.map((r) => r.topic_id));
      return count ?? rows.length;
    },
  });

  const writeUnits = writeUnitsStep({
    territory: (runId) => loadRunTerritory(learn, userId, runId),
    async names(asks) {
      const { data, error } = await learn.from('topics').select('asked, name').eq('user_id', userId).in('asked', [...asks]);
      if (error) throw new Error(`Reading the drafted topics failed: ${error.message}`);
      return new Map(((data ?? []) as { asked: string; name: string }[]).map((t) => [t.asked.trim().toLowerCase(), t.name]));
    },
    async units(subjectId) {
      const { data, error } = await learn
        .from('curriculum_units')
        .select('id, ordinal, title, placeholder')
        .eq('user_id', userId)
        .eq('subject_id', subjectId);
      if (error) throw new Error(`Reading the curriculum failed: ${error.message}`);
      const rows = (data ?? []) as { id: string; ordinal: number; title: string; placeholder: boolean }[];
      const { data: pieces, error: piecesError } = await learn
        .from('plan_pieces')
        .select('unit_id')
        .eq('user_id', userId)
        .in('unit_id', rows.map((r) => r.id))
        .not('passed_at', 'is', null);
      if (piecesError) throw new Error(`Reading the curriculum's pieces failed: ${piecesError.message}`);
      const passed = new Set(((pieces ?? []) as { unit_id: string }[]).map((p) => p.unit_id));
      return rows.map((r): SubjectUnit => ({ ...r, passed: passed.has(r.id) }));
    },
    async write(input) {
      if (!deps.anthropicApiKey) return { ok: false, detail: 'No ANTHROPIC_API_KEY is set.' };
      const spent: SpendReport[] = [];
      const result = await writeCurriculum({ ...input, anthropicApiKey: deps.anthropicApiKey, onSpend: (r) => spent.push(r) });
      await ledger('write-curriculum', spent);
      return result;
    },
    async replace(subjectId, { remove, units, kept }) {
      const scoped = () => learn.from('curriculum_units');
      if (remove.length > 0) {
        // Their unpassed pieces go with them; a goal filed under one is filed under none.
        const { error } = await scoped().delete().eq('user_id', userId).eq('subject_id', subjectId).in('id', remove);
        if (error) throw new Error(`Clearing the placeholder units failed: ${error.message}`);
      }
      // The kept units move past every place first, so no row lands on one still taken.
      const park = async (offset: number) => {
        for (const [i, id] of kept.entries()) {
          const { error } = await scoped().update({ ordinal: offset + i }).eq('user_id', userId).eq('id', id);
          if (error) throw new Error(`Renumbering the kept units failed: ${error.message}`);
        }
      };
      await park(10_000);
      const { error: insertError } = await scoped().insert(
        units.map((unit, i) => ({
          user_id: userId,
          subject_id: subjectId,
          ordinal: i + 1,
          title: unit.title,
          covers: unit.covers,
          outcome: unit.outcome,
          write_model: CURRICULUM_MODEL,
        })),
      );
      if (insertError) throw new Error(`Saving the opening units failed: ${insertError.message}`);
      await park(units.length + 1);
    },
  });

  const finish = finishPreparationStep({
    territory: (runId) => loadRunTerritory(learn, userId, runId),
    async firstUnit(subjectId) {
      const { data, error } = await learn
        .from('curriculum_units')
        .select('title')
        .eq('user_id', userId)
        .eq('subject_id', subjectId)
        .order('ordinal', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Reading the first unit failed: ${error.message}`);
      return (data as { title: string } | null)?.title ?? null;
    },
    async drafted(asks) {
      const { data, error } = await learn.from('topics').select('id, asked, name').eq('user_id', userId).in('asked', [...asks]);
      if (error) throw new Error(`Reading the drafted topics failed: ${error.message}`);
      return new Map(
        ((data ?? []) as { id: string; asked: string; name: string }[]).map((t) => [t.asked.trim().toLowerCase(), { id: t.id, name: t.name }]),
      );
    },
    async catalogue(itemIds) {
      const rows = await sql()<
        { item_id: string; provider: string; licence_mode: string | null; rights: string | null; units: number }[]
      >`
        select i.id as item_id, p.name as provider, c.licence_mode, coalesce(i.licence, p.licence) as rights,
               (select count(*)::int from learn.catalogue_segments s where s.item_id = i.id) as units
          from learn.catalogue_items i
          join learn.catalogue_providers p on p.id = i.provider_id
          left join learn.catalogue_structures c on c.item_id = i.id
         where i.id = any(${[...itemIds]}::uuid[])`;
      return new Map(
        rows.map((r) => [r.item_id, { provider: r.provider, licence: r.licence_mode, rights: r.rights, units: r.units }]),
      );
    },
  });

  return {
    classify,
    pull_documents: pull,
    match_weeks: match,
    compile_territory: compile,
    draft_topics: draftTopics,
    write_units: writeUnits,
    finish,
  };
}
