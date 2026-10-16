import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import {
  readWanted,
  sameChecks,
  type FieldOption,
  type MapTopic,
  type TopicDraft,
  type WantedTopic,
} from '@/lib/learn/levels/draft-payload';
import {
  NO_SOURCES,
  readDrafting,
  sourceText,
  type Canonicality,
  type DraftSources,
  type DraftingRecord,
} from '@/lib/learn/levels/draft-sources';
import type { CellEvidence, TopicMap, Verdict } from '@/lib/learn/levels/model';

/**
 * Reading and writing topics (learn 0133 and 0135).
 *
 * Every read goes through the person's own client, so RLS keeps it to their
 * rows; the writes carry `user_id` because the composite keys need it.
 * Nothing here computes a status or a level: lib/learn/levels/model.ts does
 * that from `loadTopicMap`, on read (rule R4).
 */

type Client = LearnSupabaseClient;

/** One row of the topics list. */
export type TopicRow = {
  id: string;
  name: string;
  scope: string;
  status: 'draft' | 'approved';
  ceiling: number;
  asked: string | null;
  createdAt: string;
  approvedAt: string | null;
};

const TOPIC_COLUMNS = 'id, name, scope, status, ceiling, asked, created_at, approved_at';

type RawTopic = {
  id: string;
  name: string;
  scope: string;
  status: string;
  ceiling: number;
  asked: string | null;
  created_at: string;
  approved_at: string | null;
};

function toRow(raw: RawTopic): TopicRow {
  return {
    id: raw.id,
    name: raw.name,
    scope: raw.scope,
    status: raw.status === 'approved' ? 'approved' : 'draft',
    ceiling: raw.ceiling,
    asked: raw.asked,
    createdAt: raw.created_at,
    approvedAt: raw.approved_at,
  };
}

/** Every topic, drafts first and then by name. */
export async function listTopics(client: Client): Promise<TopicRow[]> {
  const { data, error } = await client.from('topics').select(TOPIC_COLUMNS).order('name');
  if (error) throw new Error(`Reading your topics failed: ${error.message}`);
  const rows = ((data ?? []) as RawTopic[]).map(toRow);
  return [...rows.filter((r) => r.status === 'draft'), ...rows.filter((r) => r.status === 'approved')];
}

/**
 * The whole map as lib/learn/levels/model.ts reads it: topics, cells, links
 * and evidence, reduced to the columns its rules use. Drafts are included and
 * marked, since the model itself leaves them out of what it asks.
 */
export async function loadTopicMap(client: Client, options: { userId?: string } = {}): Promise<TopicMap> {
  // Under the service role, which RLS does not narrow, `userId` keeps the
  // map to the shared territory and that account's rows (plan #2172.2).
  const { userId } = options;
  const sharedOrOwn = `user_id.is.null,user_id.eq.${userId}`;
  const topicRead = client.from('topics').select('id, name, ceiling, status');
  const cellRead = client.from('topic_cells').select('id, topic_id, level');
  const linkRead = client.from('cell_links').select('requiring_cell_id, required_cell_id');
  const evidenceRead = client.from('cell_evidence').select('cell_id, verdict, observed_at');
  const [topics, cells, links, evidence] = await Promise.all(
    userId
      ? [
          topicRead.or(sharedOrOwn),
          cellRead.or(sharedOrOwn),
          linkRead.or(sharedOrOwn),
          evidenceRead.eq('user_id', userId),
        ]
      : [topicRead, cellRead, linkRead, evidenceRead],
  );
  for (const read of [topics, cells, links, evidence]) {
    if (read.error) throw new Error(`Reading your topic map failed: ${read.error.message}`);
  }
  return {
    topics: (topics.data ?? []).map((t: { id: string; name: string; ceiling: number; status: string }) => ({
      id: t.id,
      name: t.name,
      ceiling: t.ceiling,
      approved: t.status === 'approved',
    })),
    cells: (cells.data ?? []).map((c: { id: string; topic_id: string; level: number }) => ({
      id: c.id,
      topicId: c.topic_id,
      level: c.level,
    })),
    links: (links.data ?? []).map((l: { requiring_cell_id: string; required_cell_id: string }) => ({
      requiringCellId: l.requiring_cell_id,
      requiredCellId: l.required_cell_id,
    })),
    evidence: (evidence.data ?? []).map(
      (e: { cell_id: string; verdict: Verdict; observed_at: string }): CellEvidence => ({
        cellId: e.cell_id,
        verdict: e.verdict,
        observedAt: e.observed_at,
      }),
    ),
  };
}

/** The map as the drafting call is told about it. */
export async function loadMapTopics(client: Client): Promise<MapTopic[]> {
  const { data, error } = await client.from('topics').select('id, name, scope, ceiling, status').order('name');
  if (error) throw new Error(`Reading your topics failed: ${error.message}`);
  return (data ?? []).map((t: { id: string; name: string; scope: string; ceiling: number; status: string }) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    ceiling: t.ceiling,
    approved: t.status === 'approved',
  }));
}

/** The fields from LEARN-AREAS-SPEC a topic can be tagged with. */
export async function loadFieldOptions(client: Client): Promise<FieldOption[]> {
  const { data, error } = await client.from('area_fields').select('id, slug, name').order('position');
  if (error) throw new Error(`Reading the fields failed: ${error.message}`);
  return (data ?? []) as FieldOption[];
}

/** Where a row came from: null source with no personal mark is uncited (learn 0145). */
export type RowCitation = { source: string | null; canonicality: Canonicality | null };

const CANON = new Set<string>(['canonical', 'practitioner', 'emerging', 'personal']);
function citationOf(row: { source?: string | null; canonicality?: string | null }): RowCitation {
  return {
    source: row.source ?? null,
    canonicality: row.canonicality && CANON.has(row.canonicality) ? (row.canonicality as Canonicality) : null,
  };
}

/** A row that cannot be approved as it is: no source, and not marked personal. */
export function isUncited(row: Partial<RowCitation>): boolean {
  return (row.source ?? null) === null && row.canonicality !== 'personal';
}

/** One level of a topic as its page shows it. */
export type TopicCellView = Partial<RowCitation> & {
  id: string;
  level: number;
  checks: string[];
  /** The drafted checks, when the person has rewritten them. */
  original: string[] | null;
  rewrittenAt: string | null;
};

/** A level of this topic needing a level of another. */
export type TopicLinkView = Partial<RowCitation> & {
  /** The link row's id; absent on a link read from the other side. */
  id?: string;
  fromLevel: number;
  topicId: string;
  topicName: string;
  level: number;
  why: string | null;
};

/** A topic close to this one, shown beside a draft. */
export type TopicMatch = {
  id: string;
  name: string;
  scope: string;
  status: 'draft' | 'approved';
  ceiling: number;
  similarity: number;
};

export type TopicDetail = TopicRow & {
  citation: RowCitation;
  /** The sources it was drafted from and the checks they gave; null for a topic drafted before sources. */
  drafting: DraftingRecord | null;
  fieldNames: string[];
  cells: TopicCellView[];
  links: TopicLinkView[];
  wanted: WantedTopic[];
};

/** One topic with its levels and links; null when it is not one of theirs. */
export async function loadTopicDetail(client: Client, id: string): Promise<TopicDetail | null> {
  const { data: topic, error } = await client
    .from('topics')
    .select(`${TOPIC_COLUMNS}, field_ids, wanted, source, canonicality, drafting`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Reading the topic failed: ${error.message}`);
  if (!topic) return null;

  const { data: cells, error: cellsError } = await client
    .from('topic_cells')
    .select('id, level, descriptor, descriptor_original, rewritten_at, source, canonicality')
    .eq('topic_id', id)
    .order('level');
  if (cellsError) throw new Error(`Reading the topic's levels failed: ${cellsError.message}`);

  const cellRows = (cells ?? []) as {
    id: string;
    level: number;
    descriptor: string[];
    descriptor_original: string[] | null;
    rewritten_at: string | null;
    source: string | null;
    canonicality: string | null;
  }[];
  const levelOf = new Map(cellRows.map((c) => [c.id, c.level]));

  const links: TopicLinkView[] = [];
  if (cellRows.length > 0) {
    const { data: linkRows, error: linksError } = await client
      .from('cell_links')
      .select('id, requiring_cell_id, why, source, canonicality, required:topic_cells!cell_links_required_fk(level, topic:topics!topic_cells_topic_fk(id, name))')
      .in(
        'requiring_cell_id',
        cellRows.map((c) => c.id),
      );
    if (linksError) throw new Error(`Reading the topic's links failed: ${linksError.message}`);
    for (const row of (linkRows ?? []) as unknown as {
      id: string;
      requiring_cell_id: string;
      why: string | null;
      source: string | null;
      canonicality: string | null;
      required: { level: number; topic: { id: string; name: string } | null } | null;
    }[]) {
      const fromLevel = levelOf.get(row.requiring_cell_id);
      if (fromLevel === undefined || !row.required?.topic) continue;
      links.push({
        id: row.id,
        fromLevel,
        topicId: row.required.topic.id,
        topicName: row.required.topic.name,
        level: row.required.level,
        why: row.why,
        ...citationOf(row),
      });
    }
    links.sort((a, b) => a.fromLevel - b.fromLevel || a.topicName.localeCompare(b.topicName));
  }

  const fieldIds = (topic.field_ids ?? []) as string[];
  let fieldNames: string[] = [];
  if (fieldIds.length > 0) {
    const { data: fields } = await client.from('area_fields').select('id, name').in('id', fieldIds);
    fieldNames = ((fields ?? []) as { id: string; name: string }[]).map((f) => f.name);
  }

  return {
    ...toRow(topic as RawTopic),
    citation: citationOf(topic as { source: string | null; canonicality: string | null }),
    drafting: readDrafting(topic.drafting),
    fieldNames,
    cells: cellRows
      .filter((c) => c.level <= (topic as RawTopic).ceiling)
      .map((c) => ({
        id: c.id,
        level: c.level,
        checks: c.descriptor,
        original: c.descriptor_original,
        rewrittenAt: c.rewritten_at,
        ...citationOf(c),
      })),
    links,
    wanted: readWanted(topic.wanted),
  };
}

/** Topics close to this one by scope or by name, closest first. */
export async function nearestTopics(client: Client, topicId: string): Promise<TopicMatch[]> {
  const { data, error } = await client.rpc('nearest_topics', { p_topic_id: topicId });
  if (error) throw new Error(`Looking for a topic like this one failed: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    name: string;
    scope: string;
    status: string;
    ceiling: number;
    similarity: number;
  }[]).map((m) => ({
    id: m.id,
    name: m.name,
    scope: m.scope,
    status: m.status === 'approved' ? 'approved' : 'draft',
    ceiling: m.ceiling,
    similarity: m.similarity,
  }));
}

/**
 * Keep a draft: the topic as a draft, a cell per level, and each link to a
 * topic on the map. Returns the new topic's id.
 *
 * Each row carries the source it cites, in words, and its canonicality; a row
 * the draft could not cite is written with neither, and the approval screen
 * flags it (plan #2138.11). `uncited` fills those for a caller whose rows all
 * come from one place the call was not told about, such as the move from the
 * claims graph.
 *
 * A link the cycle trigger refuses is left out rather than failing the draft:
 * the levels are what the person reviews, and a link that would close a loop
 * was wrong to propose. The count of links left out comes back so the page
 * can say so.
 */
export async function saveDraft(
  client: Client,
  userId: string,
  input: {
    draft: TopicDraft;
    asked: string | null;
    embedding: { vector: number[]; model: string } | null;
    sources?: DraftSources;
    drafting?: DraftingRecord | null;
    uncited?: { source: string; canonicality: Canonicality };
  },
): Promise<{ id: string; linksLeftOut: number }> {
  const { draft } = input;
  const given = input.sources ?? NO_SOURCES;
  const cited = (row: { cites: string[]; canonicality: Canonicality | null }): RowCitation => {
    const source = sourceText(row.cites, given);
    if (source) return { source, canonicality: row.canonicality ?? 'practitioner' };
    return input.uncited ?? { source: null, canonicality: null };
  };
  const { data: topic, error } = await client
    .from('topics')
    .insert({
      user_id: userId,
      name: draft.name,
      scope: draft.scope,
      ceiling: draft.ceiling,
      field_ids: draft.fieldIds,
      asked: input.asked,
      wanted: draft.wanted,
      drafting: input.drafting ?? null,
      ...cited({ cites: draft.topicCites, canonicality: draft.canonicality }),
      scope_embedding: input.embedding ? vectorLiteral(input.embedding.vector) : null,
      embedding_model: input.embedding?.model ?? null,
    })
    .select('id')
    .single();
  if (error || !topic) throw new Error(`Keeping the draft failed: ${error?.message ?? 'no row came back'}`);

  const { data: cells, error: cellsError } = await client
    .from('topic_cells')
    .insert(
      draft.cells.map((cell) => ({
        user_id: userId,
        topic_id: topic.id,
        level: cell.level,
        descriptor: cell.checks,
        ...cited(cell),
      })),
    )
    .select('id, level');
  if (cellsError || !cells) {
    // A topic with no levels is no draft at all; take it back out.
    await client.from('topics').delete().eq('id', topic.id);
    throw new Error(`Keeping the draft's levels failed: ${cellsError?.message ?? 'no rows came back'}`);
  }

  const linksLeftOut = await writeLinks(
    client,
    userId,
    cells as { id: string; level: number }[],
    draft.links.map((link) => ({ ...link, ...cited(link) })),
  );
  return { id: topic.id as string, linksLeftOut };
}

/** Writes each link from the draft's cells to the cell of the topic it needs. */
async function writeLinks(
  client: Client,
  userId: string,
  cells: { id: string; level: number }[],
  links: (Omit<TopicDraft['links'][number], 'canonicality'> & RowCitation)[],
): Promise<number> {
  if (links.length === 0) return 0;
  const cellAt = new Map(cells.map((c) => [c.level, c.id]));

  const { data: targets, error } = await client
    .from('topic_cells')
    .select('id, topic_id, level')
    .in('topic_id', [...new Set(links.map((l) => l.topicId))]);
  if (error) throw new Error(`Reading the topics it links to failed: ${error.message}`);
  const targetAt = new Map(
    ((targets ?? []) as { id: string; topic_id: string; level: number }[]).map((t) => [`${t.topic_id}:${t.level}`, t.id]),
  );

  let leftOut = 0;
  for (const link of links) {
    const requiring = cellAt.get(link.fromLevel);
    const required = targetAt.get(`${link.topicId}:${link.level}`);
    if (!requiring || !required) {
      leftOut += 1;
      continue;
    }
    const { error: linkError } = await client
      .from('cell_links')
      .insert({
        user_id: userId,
        requiring_cell_id: requiring,
        required_cell_id: required,
        why: link.why,
        source: link.source,
        canonicality: link.canonicality,
      });
    if (linkError) {
      console.error('[learn topics] link left out', linkError.message);
      leftOut += 1;
    }
  }
  return leftOut;
}

/**
 * Approve a draft with the checks the person settled on.
 *
 * `checks` holds every level's checks as submitted. A level whose checks
 * differ from what is stored is rewritten, keeping the drafted wording in
 * `descriptor_original` the first time, the same as a claim's rewrite. Then
 * the topic becomes approved, with `approved_at` in the same write as the
 * check constraint requires. Refuses a topic that is not a draft.
 */
export async function approveDraft(
  client: Client,
  topicId: string,
  checks: ReadonlyMap<number, string[]>,
): Promise<{ rewritten: number }> {
  const { data: topic, error } = await client.from('topics').select('id, status').eq('id', topicId).maybeSingle();
  if (error) throw new Error(`Reading the draft failed: ${error.message}`);
  if (!topic) throw new Error('That draft is not one of yours, or it is no longer there.');
  if (topic.status !== 'draft') throw new Error('That topic is already approved.');

  const uncited = await uncitedRows(client, topicId);
  if (uncited > 0) {
    throw new Error(
      `${uncited} ${uncited === 1 ? 'row names' : 'rows name'} no source. Mark ${uncited === 1 ? 'it' : 'each'} personal, or draft again with a source that covers it.`,
    );
  }

  const { data: cells, error: cellsError } = await client
    .from('topic_cells')
    .select('id, level, descriptor, descriptor_original')
    .eq('topic_id', topicId);
  if (cellsError) throw new Error(`Reading the draft's levels failed: ${cellsError.message}`);

  const now = new Date().toISOString();
  let rewritten = 0;
  for (const cell of (cells ?? []) as {
    id: string;
    level: number;
    descriptor: string[];
    descriptor_original: string[] | null;
  }[]) {
    const settled = checks.get(cell.level);
    if (!settled || sameChecks(settled, cell.descriptor)) continue;
    const { error: writeError } = await client
      .from('topic_cells')
      .update({
        descriptor: settled,
        descriptor_original: cell.descriptor_original ?? cell.descriptor,
        rewritten_at: now,
      })
      .eq('id', cell.id);
    if (writeError) throw new Error(`Keeping level ${cell.level} failed: ${writeError.message}`);
    rewritten += 1;
  }

  const { error: approveError } = await client
    .from('topics')
    .update({ status: 'approved', approved_at: now })
    .eq('id', topicId)
    .eq('status', 'draft');
  if (approveError) throw new Error(`Approving the topic failed: ${approveError.message}`);
  return { rewritten };
}

/**
 * How many of a draft's rows cite nothing and are not marked personal: the
 * topic, its levels up to the ceiling, and the links from them. Approval
 * refuses while any is left (plan #2138.11); the trigger in learn 0149 holds
 * the same rule for every writer.
 */
export async function uncitedRows(client: Client, topicId: string): Promise<number> {
  const { data: topic, error } = await client
    .from('topics')
    .select('ceiling, source, canonicality')
    .eq('id', topicId)
    .maybeSingle();
  if (error || !topic) throw new Error(`Reading the draft failed: ${error?.message ?? 'not found'}`);
  const { data: cells, error: cellsError } = await client
    .from('topic_cells')
    .select('id, level, source, canonicality')
    .eq('topic_id', topicId);
  if (cellsError) throw new Error(`Reading the draft's levels failed: ${cellsError.message}`);
  type Cited = { source: string | null; canonicality: string | null };
  const inside = ((cells ?? []) as ({ id: string; level: number } & Cited)[]).filter(
    (c) => c.level <= (topic.ceiling as number),
  );
  let links: Cited[] = [];
  if (inside.length > 0) {
    const { data, error: linksError } = await client
      .from('cell_links')
      .select('source, canonicality')
      .in(
        'requiring_cell_id',
        inside.map((c) => c.id),
      );
    if (linksError) throw new Error(`Reading the draft's links failed: ${linksError.message}`);
    links = (data ?? []) as Cited[];
  }
  return [topic as Cited, ...inside, ...links].filter((row) => isUncited(citationOf(row))).length;
}

/** Which row of a draft a personal mark is for. */
export type CitedRowKind = 'topic' | 'cell' | 'link';

const ROW_TABLE: Record<CitedRowKind, string> = { topic: 'topics', cell: 'topic_cells', link: 'cell_links' };

/**
 * Mark uncited rows of a draft personal, or take the mark off. Only a row
 * with no source takes the mark: a cited row keeps the canonicality its
 * source gave it.
 */
export async function markPersonal(client: Client, kind: CitedRowKind, ids: readonly string[], on: boolean): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await client
    .from(ROW_TABLE[kind])
    .update({ canonicality: on ? 'personal' : null })
    .in('id', ids)
    .is('source', null);
  if (error) throw new Error(`Marking it personal failed: ${error.message}`);
}

/**
 * Merge a draft into the topic it duplicates: the draft goes and the
 * existing topic stands. A draft has no evidence yet (nothing is asked about
 * one), so nothing of the person's is lost. Refuses an approved topic.
 */
export async function mergeDraftInto(client: Client, draftId: string, intoId: string): Promise<void> {
  const { data: into, error: intoError } = await client.from('topics').select('id').eq('id', intoId).maybeSingle();
  if (intoError) throw new Error(`Reading the topic to merge into failed: ${intoError.message}`);
  if (!into) throw new Error('The topic to merge into is not one of yours, or it is no longer there.');

  const { data, error } = await client
    .from('topics')
    .delete()
    .eq('id', draftId)
    .eq('status', 'draft')
    .select('id');
  if (error) throw new Error(`Merging the draft failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error('Only a draft can be merged into another topic.');
}

/**
 * Take one wanted topic off a topic's list, once it has been drafted, and
 * link the levels it was wanted for to the new draft's cell.
 */
export async function settleWanted(
  client: Client,
  userId: string,
  input: { topicId: string; name: string; draftId: string },
): Promise<void> {
  const { data: topic, error } = await client.from('topics').select('wanted').eq('id', input.topicId).maybeSingle();
  if (error || !topic) throw new Error(`Reading the topic failed: ${error?.message ?? 'not found'}`);
  const wanted = readWanted(topic.wanted);
  const entry = wanted.find((w) => w.name.toLowerCase() === input.name.toLowerCase());
  const rest = wanted.filter((w) => w !== entry);

  const { error: writeError } = await client.from('topics').update({ wanted: rest }).eq('id', input.topicId);
  if (writeError) throw new Error(`Updating the topic failed: ${writeError.message}`);
  if (!entry) return;

  const [{ data: from }, { data: to }] = await Promise.all([
    client.from('topic_cells').select('id').eq('topic_id', input.topicId).eq('level', entry.from_level).maybeSingle(),
    client.from('topic_cells').select('id').eq('topic_id', input.draftId).eq('level', entry.level).maybeSingle(),
  ]);
  if (!from || !to) return;
  const { error: linkError } = await client
    .from('cell_links')
    .insert({ user_id: userId, requiring_cell_id: from.id, required_cell_id: to.id, why: entry.why });
  if (linkError) console.error('[learn topics] wanted link left out', linkError.message);
}
