import 'server-only';

import type postgres from 'postgres';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { recordSpend } from '@/lib/core/spend/record';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fireDraftRoutine, runTopicDraft } from '@/lib/learn/levels/draft-run';
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
 * Drafts a territory (plan #2172.6). Each call queues every topic not yet
 * drafted for the routine (learn 0193), from the territory's sources, and
 * starts the routine once. Each request carries what is done with its draft
 * once kept: pointed at the Level 4 frame topic it refines, given its target
 * on the subject's lens, and approved there and then (plan #2356.2), any row
 * that cites no source marked personal first (plan #2356.6).
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

export type TerritoryTick = {
  /** Always empty since learn 0193: topics are queued for the routine, which drafts and approves them. */
  drafted: { ask: string; id: string; name: string; approved: boolean }[];
  failed: { ask: string; detail: string }[];
  /** Topics queued for the routine this tick. */
  queued: number;
  /** Whether the routine was started on them; null when nothing was queued. */
  fired: { ok: boolean; detail: string } | null;
  remaining: number;
  /** What the structure store gave; null when no catalogue connection was given. */
  store: TerritoryStore | null;
};

export async function draftTerritoryTick(
  clients: { learn: LearnSupabaseClient; jobs: AppSupabaseClient },
  owner: string,
  territory: Territory,
  input: {
    /** For the structure pull on the first tick; drafting itself spends nothing. */
    anthropicApiKey: string;
    catalogue?: postgres.Sql;
    /** Draft only this area's remaining topics (plan #2483.1); the first area with topics left when absent. */
    area?: string;
    /** The preparation run queuing them, so its step finds its own requests. */
    preparationId?: string;
  },
): Promise<TerritoryTick> {
  const { learn, jobs } = clients;

  const { data: had, error } = await learn.from('topics').select('asked').eq('user_id', owner);
  if (error) throw new Error(`Reading the topics already drafted failed: ${error.message}`);
  const askedBefore = ((had ?? []) as { asked: string | null }[]).map((t) => t.asked);
  // A territory with areas drafts one area a tick, from that area's texts
  // (plan #2483.2): the one asked for, or else the first with topics left.
  const area = input.area ?? (territory.areas?.length ? topicsLeft(territory, askedBefore)[0]?.area : undefined);
  const left = topicsLeft(territory, askedBefore, area);

  const roleSources = await Promise.all(territory.roles.map((phrase) => roleRequirementSourceFrom(jobs, phrase, owner)));
  const given = territorySources(territory, roleSources, area);
  // The first tick of the territory, whichever area it is drafted for: nothing of it is drafted yet.
  const firstTick = topicsLeft(territory, askedBefore).length === territory.topics.length;

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
    ? await withTerritoryStore(territory, given, firstTick, {
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
          const jevEnabled = await jevEnabledFor(core, owner);
          const pulled = await pullStructureForGoal(
            territory.kind ?? null,
            liveGoalPullPorts({ sql: catalogue, goal, anthropicApiKey: input.anthropicApiKey, jevEnabled, onSpend: (r) => spent.push(r) }),
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

  // Queued for the routine (learn 0193), each with what was done here once it
  // was drafted: the frame it refines, its target on the lens, approval.
  const out: TerritoryTick = { drafted: [], failed: [], queued: 0, fired: null, remaining: left.length, store: read?.store ?? null };
  for (const topic of left) {
    const frame = frameId.get(topic.frame);
    const result = await runTopicDraft(
      learn,
      owner,
      {
        goal: topic.ask,
        scope: topic.scope,
        sources,
        documents: read?.refs,
        canon: read?.canon,
        after: {
          approve: true,
          ...(frame ? { refinesArticleId: frame } : {}),
          ...(lens.data ? { lensTarget: { lensId: lens.data.id as string, target: topic.target } } : {}),
        },
      },
      { owner, hold: true, preparationId: input.preparationId },
    );
    if (!result.ok) {
      out.failed.push({ ask: topic.ask, detail: result.detail });
      continue;
    }
    out.queued += 1;
  }
  if (out.queued > 0) out.fired = await fireDraftRoutine(learn, owner);
  return out;
}
