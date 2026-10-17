import type { Territory } from '@/lib/learn/levels/territory';
import type { StepHandler } from './run';
import type { PulledDocument } from './structure-steps';

/**
 * The finish step of a subject's preparation (plan #2276.6): it says where to
 * start and keeps the list of where the structure came from.
 *
 * Where to start is the subject's first unit and the first topic of the
 * territory that was drafted, at level 1. The sources are every document the
 * pull stored, and every document the territory was compiled from that the
 * pull did not store this time (one already in the bank), each with its link;
 * and the frame topics the territory refines. The page reads them from this
 * step's detail with `preparationSources` (view.ts), and reads the topic and
 * the unit again as they stand, since a topic is approved and a unit renamed
 * after the run has ended.
 *
 * Pure apart from its ports, so the tests run it with fakes.
 */

export type SourceDocument = {
  itemId: string | null;
  title: string;
  /** Null for a document the territory read from the bank and this run did not pull. */
  provider: string | null;
  url: string | null;
  /** The licence mode the bank keeps it under: show, structure_only or never_feed. */
  licence: string | null;
  /** The licence as the catalogue words it (the item's, else its provider's), such as "CC BY 4.0". */
  rights?: string | null;
  units: number | null;
  /** The territory was compiled from it. */
  used: boolean;
  /** The person added it with Add a source (plan #2307.4); its weeks are in match_weeks. */
  added?: boolean;
};

/** What the catalogue holds on a stored document, for the facts the pull did not record. */
export type CatalogueFacts = {
  provider: string;
  licence: string | null;
  rights: string | null;
  units: number;
};

export type StartTopic = { id: string; name: string; ask: string };

export type FinishDetail = {
  start: { unit: string | null; topic: StartTopic | null };
  documents: SourceDocument[];
  /** Titles of the frame topics the territory's topics refine, in territory order. */
  frames: string[];
  /** Topics the run drafted but left for the person to approve, with why (plan #2276.10). */
  drafts?: { ask: string; name: string; reason: string }[];
};

export type FinishPorts = {
  territory: (runId: string) => Promise<Territory | null>;
  /** The title of the subject's first unit, or null when it has none. */
  firstUnit: (subjectId: string) => Promise<string | null>;
  /** The drafted topics among these asks, keyed by ask lower-cased and trimmed. */
  drafted: (asks: readonly string[]) => Promise<Map<string, { id: string; name: string }>>;
  /** Provider, licence and size of stored documents, by item id; one not found is left out. */
  catalogue: (itemIds: readonly string[]) => Promise<Map<string, CatalogueFacts>>;
};

/** Each document with the catalogue's provider and licence filled in where it has them. */
export function withCatalogue(docs: readonly SourceDocument[], facts: ReadonlyMap<string, CatalogueFacts>): SourceDocument[] {
  return docs.map((d) => {
    const f = d.itemId ? facts.get(d.itemId) : undefined;
    if (!f) return d;
    return {
      ...d,
      provider: d.provider ?? f.provider,
      licence: d.licence ?? f.licence,
      rights: f.rights,
      units: d.units ?? f.units,
    };
  });
}

const key = (ask: string) => ask.trim().toLowerCase();

/** Every document the run stored, then each one the territory read that the pull did not store. */
export function sourceDocuments(pulled: readonly PulledDocument[], territory: Territory | null): SourceDocument[] {
  const texts = territory?.texts ?? [];
  const usedIds = new Set(texts.flatMap((t) => (t.itemId ? [t.itemId] : [])));
  const usedUrls = new Set(texts.flatMap((t) => (t.url ? [t.url] : [])));
  const out: SourceDocument[] = pulled.map((d) => ({
    itemId: d.itemId,
    title: d.title,
    provider: d.provider,
    url: d.url,
    licence: d.licence,
    units: d.units,
    used: usedIds.has(d.itemId) || usedUrls.has(d.url),
  }));
  const seenIds = new Set(pulled.map((d) => d.itemId));
  const seenUrls = new Set(pulled.map((d) => d.url));
  for (const t of texts) {
    if (!t.itemId && !t.url) continue;
    if ((t.itemId && seenIds.has(t.itemId)) || (t.url && seenUrls.has(t.url))) continue;
    if (t.itemId) seenIds.add(t.itemId);
    if (t.url) seenUrls.add(t.url);
    out.push({ itemId: t.itemId ?? null, title: t.label, provider: null, url: t.url ?? null, licence: null, units: null, used: true });
  }
  return out;
}

/** The frame topics, once each, in the order the territory first names them. */
export function framesOf(territory: Territory | null): string[] {
  return [...new Set((territory?.topics ?? []).map((t) => t.frame.trim()).filter((f) => f.length > 0))];
}

function readKept(detail: Record<string, unknown> | undefined): { ask: string; name: string; reason: string }[] {
  const kept = detail?.kept;
  if (!Array.isArray(kept)) return [];
  return kept.filter(
    (k): k is { ask: string; name: string; reason: string } =>
      !!k && typeof k.ask === 'string' && typeof k.name === 'string' && typeof k.reason === 'string',
  );
}

function readPulled(detail: Record<string, unknown> | undefined): PulledDocument[] {
  const docs = detail?.documents;
  return Array.isArray(docs) ? (docs as PulledDocument[]).filter((d) => d && typeof d.title === 'string') : [];
}

export function finishPreparationStep(ports: FinishPorts): StepHandler {
  return async (ctx) => {
    const started = ctx.run.startedAt ? Date.parse(ctx.run.startedAt) : ctx.now();
    const seconds = Math.max(0, Math.round((ctx.now() - started) / 1000));
    const minutes = Math.max(1, Math.round(seconds / 60));

    const territory = await ports.territory(ctx.run.id);
    const asks = (territory?.topics ?? []).map((t) => t.ask);
    // A branch run (plan #2276.7) writes no units: it starts on its first deeper topic.
    const branch = ctx.subject.branch ?? null;
    const [unit, drafted] = await Promise.all([
      branch ? Promise.resolve(null) : ports.firstUnit(ctx.subject.id),
      asks.length > 0 ? ports.drafted(asks) : Promise.resolve(new Map<string, { id: string; name: string }>()),
    ]);
    // The first topic of the territory that was drafted: one given up on is passed over.
    const first = (territory?.topics ?? []).find((t) => drafted.has(key(t.ask))) ?? null;
    const found = first ? drafted.get(key(first.ask)) : undefined;
    const topic: StartTopic | null = first && found ? { id: found.id, name: found.name, ask: first.ask } : null;

    const docs = sourceDocuments(readPulled(ctx.steps.get('pull_documents')?.detail), territory);
    const itemIds = docs.flatMap((d) => (d.itemId ? [d.itemId] : []));
    const facts = itemIds.length > 0 ? await ports.catalogue(itemIds) : new Map<string, CatalogueFacts>();
    const detail: FinishDetail = {
      start: { unit, topic },
      documents: withCatalogue(docs, facts),
      frames: framesOf(territory),
      drafts: readKept(ctx.steps.get('draft_topics')?.detail),
    };
    const where = unit ? ` Start with ${unit}.` : topic ? ` Start with ${topic.name}.` : '';
    const left = detail.drafts?.length ?? 0;
    const drafts = left > 0 ? ` ${left} ${left === 1 ? 'topic is' : 'topics are'} still a draft: ${detail.drafts?.map((d) => `${d.name} (${d.reason})`).join('; ')}.` : '';
    const took = `${minutes} minute${minutes === 1 ? '' : 's'}`;
    return {
      state: 'done',
      summary: branch ? `Went deeper on ${branch.name} in ${took}.${where}` : `Prepared in ${took}.${where}${drafts}`,
      counts: { seconds },
      detail,
    };
  };
}
