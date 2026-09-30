import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedOne } from '@/lib/learn/embed/embed';
import type { ModuleId } from '@/lib/modules';
import type { Author } from '@/lib/memory/passages';

/**
 * Finding the person's passages by meaning (plan #1248).
 *
 * The question is embedded as a query (Voyage's `query` input type, the side
 * of retrieval the passages were not embedded on) and compared with every
 * passage in core.memory_chunks by core.search_memory, as the signed-in
 * person. Ask Dash's recall tool calls this; so can anything else that holds a
 * question and the person's core client.
 *
 * Which workspaces a passage may come from is passed to the database rather
 * than filtered here, so a switched-off workspace's passages never use up the
 * limit.
 */

/**
 * The cosine similarity a passage must reach against the question.
 *
 * Read off the live passages on 30 September 2026 (6,797 passages from 1,733
 * rows). No query could be embedded where this was set, so it was read from
 * passages compared with each other. Eleven short passages, each a goal or
 * step title such as "Pay off student debt" or "Walk into interviews ready",
 * were compared with every other passage: the median similarity to an
 * unrelated passage was 0.22 to 0.31, the 95th percentile 0.36 to 0.48.
 * Compared with whole passages, the Land Value Tax note's nearest fifty
 * were all about land, tax or property down to 0.54, and the YC jobs profile's
 * nearest fifty were all job applications and interview answers from 0.74.
 *
 * So a topic the person has written about fills the limit well above any
 * floor, and the floor only decides what comes back for a topic they have
 * not written about. A question is embedded on the query side, which these
 * readings could not measure and which may sit lower on the scale, so the
 * floor is at the unrelated median rather than above it. That errs towards
 * returning something: Dash reads each passage and says when none answers,
 * which costs less than returning nothing for a question the notes do
 * answer. The recall lookup logs the similarities it saw
 * (`[ask recall]` in the runtime logs), so the floor can be read again from
 * real questions.
 */
export const RECALL_MIN_SIMILARITY = 0.3;

/** Passages asked for per question: the most core.search_memory returns. */
export const RECALL_PASSAGE_LIMIT = 50;

/** What spend from embedding a question is recorded as. */
export const RECALL_OPERATION = 'recall-question';

/**
 * Every source_table core.memory_sources emits, with the workspace that has
 * to be on for its passages to be searched. Null: always searched (files
 * belong to no workspace that can be switched off). A table missing here is
 * never searched, which lib/memory/search.test.ts checks against the SQL.
 */
export const MEMORY_SOURCE_MODULES: Readonly<Record<string, ModuleId | null>> = {
  'obsidian.notes': 'vault',
  'job_search.thoughts': 'jobs',
  'job_search.notes': 'jobs',
  'job_search.profiles': 'jobs',
  'goals.items': 'goals',
  'goals.captures': 'goals',
  'core.files': null,
  'learn.aims': 'learn',
  'learn.card_notes': 'learn',
  'learn.feed_cards': 'learn',
  'public.order_items': 'shopping',
};

/** The source tables whose workspace is on. */
export function memorySourcesFor(enabled: readonly ModuleId[]): string[] {
  return Object.entries(MEMORY_SOURCE_MODULES)
    .filter(([, module]) => module === null || enabled.includes(module))
    .map(([table]) => table);
}

export type MemoryPassage = {
  sourceTable: string;
  sourceRef: string;
  chunkIndex: number;
  author: Author;
  body: string;
  similarity: number;
};

/** One row's passages that came back, closest first. */
export type MemoryRowHit = {
  sourceTable: string;
  sourceRef: string;
  /** The closest of its passages. */
  similarity: number;
  passages: MemoryPassage[];
};

/** Turns the question into a vector. The tests hand in their own. */
export type QuestionEmbedder = (
  question: string,
  onSpend: SpendSink,
) => Promise<{ ok: true; vector: number[]; model: string } | { ok: false; reason: string; detail: string }>;

export const voyageQuestionEmbedder: QuestionEmbedder = async (question, onSpend) => {
  const outcome = await embedOne(question, { inputType: 'query', onSpend });
  if (!outcome.ok) return { ok: false, reason: outcome.reason, detail: outcome.detail };
  return { ok: true, vector: outcome.vector, model: outcome.model };
};

/** The part of a core-schema client this needs. */
export type MemoryRpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type MemorySearch = {
  userId: string;
  question: string;
  /** Source tables to search; memorySourcesFor(enabled workspaces). */
  sources: readonly string[];
  /** Only these authors; both when absent. */
  authors?: readonly Author[];
  limit?: number;
  minSimilarity?: number;
  embed?: QuestionEmbedder;
  onSpend?: SpendSink;
};

export type MemorySearchResult =
  | { ok: true; passages: MemoryPassage[] }
  | { ok: false; reason: string; detail: string };

type PassageRow = {
  source_table: string;
  source_ref: string;
  chunk_index: number;
  author: string;
  body: string;
  similarity: number;
};

/**
 * The person's passages nearest a question, closest first. Throws only when
 * the database read fails; an embedding that could not be made is a result.
 */
export async function searchMemory(
  client: MemoryRpcClient,
  search: MemorySearch,
): Promise<MemorySearchResult> {
  const question = search.question.trim();
  if (!question) return { ok: false, reason: 'empty-text', detail: 'the question is empty' };
  if (search.sources.length === 0) return { ok: true, passages: [] };

  const embed = search.embed ?? voyageQuestionEmbedder;
  const embedded = await embed(question, search.onSpend ?? (() => {}));
  if (!embedded.ok) return embedded;

  const { data, error } = await client.rpc('search_memory', {
    query_embedding: vectorLiteral(embedded.vector),
    p_user_id: search.userId,
    p_sources: [...search.sources],
    match_limit: search.limit ?? RECALL_PASSAGE_LIMIT,
    min_similarity: search.minSimilarity ?? RECALL_MIN_SIMILARITY,
    // The Voyage 4 models share one space, so passages from any of them compare.
    embedding_model_filter: null,
    p_authors: search.authors && search.authors.length > 0 ? [...search.authors] : null,
  });
  if (error) throw new Error(`core.search_memory: ${error.message}`);

  return {
    ok: true,
    passages: ((data ?? []) as PassageRow[]).map((row) => ({
      sourceTable: row.source_table,
      sourceRef: row.source_ref,
      chunkIndex: row.chunk_index,
      author: row.author === 'dash' ? 'dash' : 'me',
      body: row.body,
      similarity: row.similarity,
    })),
  };
}

/** Passages grouped by the row they belong to, rows in order of their closest passage. */
export function groupByRow(passages: readonly MemoryPassage[]): MemoryRowHit[] {
  const rows = new Map<string, MemoryRowHit>();
  for (const passage of [...passages].sort((a, b) => b.similarity - a.similarity)) {
    const key = `${passage.sourceTable}\u0000${passage.sourceRef}`;
    const row = rows.get(key);
    if (row) row.passages.push(passage);
    else
      rows.set(key, {
        sourceTable: passage.sourceTable,
        sourceRef: passage.sourceRef,
        similarity: passage.similarity,
        passages: [passage],
      });
  }
  return [...rows.values()];
}

/**
 * A passage split into the row title it starts with and its text
 * (lib/memory/passages.ts puts the title first, then a blank line). A
 * passage that is only a title has no text.
 */
export function splitPassage(body: string): { title: string | null; text: string } {
  const at = body.indexOf('\n\n');
  if (at < 0) return body.length <= 200 ? { title: body.trim(), text: '' } : { title: null, text: body };
  const head = body.slice(0, at).trim();
  if (!head || head.length > 200 || head.includes('\n')) return { title: null, text: body };
  return { title: head, text: body.slice(at + 2).trim() };
}
