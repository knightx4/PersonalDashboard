import 'server-only';

import type postgres from 'postgres';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { runTopicDraft } from '@/lib/learn/levels/draft-run';
import { roleRequirementSourceFrom } from '@/lib/learn/levels/role-sources';
import { territorySources, topicsLeft, type Territory } from '@/lib/learn/levels/territory';
import { embedCatalogueSegments } from '@/lib/learn/catalogue/embed-sweep';
import {
  liveGoalPullPorts,
  pullStructureForGoal,
  storedCount,
  type GoalStructurePull,
} from '@/lib/learn/catalogue/structure-pull-for-goal';
import type { DraftSources } from '@/lib/learn/levels/draft-sources';
import {
  storedSourcesFrom,
  territoryCanon,
  withStoredSources,
  type CanonText,
  type StoredSourceRef,
} from '@/lib/learn/levels/stored-sources';
import { findStoredUnits, liveStoredUnitPorts, type StoredUnitsFound } from '@/lib/learn/levels/stored-sources-run';

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
 *
 * Given the catalogue connection, the tick also reads the structure store
 * (plan #2247.10): the weeks of any stored document about the territory's
 * goal join its sources, found by what they cover. On the first tick, when
 * the store holds fewer than two documents about the goal, the providers the
 * goal's kind names are run first, their units embedded, and the store read
 * again, so a territory with nothing stored pulls what it needs once rather
 * than on every tick.
 */

/** Fewer independent documents than this about a goal, and its first tick pulls more. */
export const MIN_STORED_DOCUMENTS = 2;
/** Units embedded at most after a pull: a few courses' worth. */
const EMBED_AFTER_PULL = 600;

export type TerritoryStore = {
  /** Why the store was not read, when it was not. */
  unread: string | null;
  pulled: GoalStructurePull | null;
  documents: { sourceId: string; title: string; url: string }[];
  canon: CanonText[];
};

/** The ports the store part of a tick runs through, so a test runs it without a network or a database. */
export type TerritoryStorePorts = {
  find: () => Promise<StoredUnitsFound>;
  pull: () => Promise<GoalStructurePull>;
  embed: () => Promise<void>;
};

/**
 * The territory's sources with the stored documents added, and what the store
 * gave. Never throws: a store that cannot be read leaves the sources as they
 * were and says why.
 */
export async function withTerritoryStore(
  territory: Territory,
  sources: DraftSources,
  firstTick: boolean,
  ports: TerritoryStorePorts,
): Promise<{ sources: DraftSources; refs: StoredSourceRef[]; canon: CanonText[]; store: TerritoryStore }> {
  let found = await ports.find();
  let pulled: GoalStructurePull | null = null;
  const independent = (f: StoredUnitsFound) =>
    f.ok ? new Set(storedSourcesFrom(f.matches).refs.map((r) => r.independence)).size : 0;
  if (firstTick && territory.kind && independent(found) < MIN_STORED_DOCUMENTS) {
    try {
      pulled = await ports.pull();
      if (storedCount(pulled) > 0) {
        await ports.embed();
        found = await ports.find();
      }
    } catch (error) {
      console.error('[learn territory] pull', error instanceof Error ? error.message : error);
    }
  }
  if (!found.ok) {
    return { sources, refs: [], canon: [], store: { unread: found.detail, pulled, documents: [], canon: [] } };
  }
  const stored = storedSourcesFrom(found.matches);
  const merged = withStoredSources(sources, stored);
  const canon = territoryCanon(merged.refs, found.documents);
  return {
    sources: merged.given,
    refs: merged.refs,
    canon,
    store: {
      unread: null,
      pulled,
      documents: merged.refs.map((r) => ({ sourceId: r.sourceId, title: r.title, url: r.url })),
      canon,
    },
  };
}

/** A draft takes one to three minutes; start another only while this much of the call is left. */
const START_BEFORE_MS = 150_000;

export type TerritoryTick = {
  drafted: { ask: string; id: string; name: string }[];
  failed: { ask: string; detail: string }[];
  remaining: number;
  /** What the structure store gave; null when no catalogue connection was given. */
  store: TerritoryStore | null;
};

export async function draftTerritoryTick(
  clients: { learn: LearnSupabaseClient; jobs: AppSupabaseClient },
  owner: string,
  territory: Territory,
  input: { anthropicApiKey: string; budgetMs: number; now?: () => number; catalogue?: postgres.Sql },
): Promise<TerritoryTick> {
  const now = input.now ?? Date.now;
  const started = now();
  const { learn, jobs } = clients;

  const roleSources = await Promise.all(territory.roles.map((phrase) => roleRequirementSourceFrom(jobs, phrase, owner)));
  const given = territorySources(territory, roleSources);

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
  const ledger = async (
    operation: 'draft-topic' | 'embed-topic-scope' | 'match-structure-units' | 'propose-structure-sources',
    reports: SpendReport[],
  ) => {
    for (const report of reports) {
      await recordSpend(core, owner, { module: 'learn', operation, model: report.model, usage: report.usage }).catch(
        (e: unknown) => console.error('[learn territory] spend', e instanceof Error ? e.message : e),
      );
    }
  };

  const goal = territory.goal ?? { name: territory.name, about: null };
  const catalogue = input.catalogue;
  const read = catalogue
    ? await withTerritoryStore(territory, given, left.length === territory.topics.length, {
        find: async () => {
          const spent: SpendReport[] = [];
          const found = await findStoredUnits(liveStoredUnitPorts(catalogue), goal, territory.performances, (r) =>
            spent.push(r),
          );
          await ledger('match-structure-units', spent);
          return found;
        },
        pull: async () => {
          const spent: SpendReport[] = [];
          const pulled = await pullStructureForGoal(
            territory.kind ?? null,
            liveGoalPullPorts({ sql: catalogue, goal, anthropicApiKey: input.anthropicApiKey, onSpend: (r) => spent.push(r) }),
          );
          await ledger('propose-structure-sources', spent);
          return pulled;
        },
        embed: async () => {
          await embedCatalogueSegments(catalogue, { userId: owner, limit: EMBED_AFTER_PULL });
        },
      })
    : null;
  if (read?.store.unread) console.error('[learn territory] store', read.store.unread);
  const sources = read?.sources ?? given;

  const out: TerritoryTick = { drafted: [], failed: [], remaining: left.length, store: read?.store ?? null };
  for (const topic of left) {
    if (now() - started > Math.min(START_BEFORE_MS, input.budgetMs)) break;
    const result = await runTopicDraft(
      learn,
      owner,
      {
        goal: topic.ask,
        scope: topic.scope,
        sources,
        documents: read?.refs,
        canon: read?.canon,
        anthropicApiKey: input.anthropicApiKey,
      },
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
