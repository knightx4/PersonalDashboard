import 'server-only';

import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedOne } from '@/lib/learn/embed/embed';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AskContext, AskDb } from './db';

/**
 * Notes nearest a question by meaning, for vault_notes (lib/ask/lookups.ts).
 *
 * The question is embedded as a query and compared with the vectors the notes
 * already have (obsidian.nearest_notes), so a question that shares no words
 * with a note can still reach it. One embedding call per lookup, a few hundred
 * tokens, reported to `onSpend` so it lands in the same ledger row as the
 * answer. No key, or a failed call, returns nothing and the lookup goes on by
 * words.
 */

/** Lower than the floor for notes beside notes (RELATED_NOTE_MIN_SIMILARITY): a question is shorter than a note and scores lower against it. */
export const ASK_NOTE_MIN_SIMILARITY = 0.3;

/** Notes a question may match by meaning. */
export const ASK_NOTE_MATCHES = 6;

export function semanticNotesFor(db: AskDb, userId: string, onSpend: SpendSink): NonNullable<AskContext['semanticNotes']> {
  return async (query) => {
    const embedded = await embedOne(query.slice(0, 2_000), { inputType: 'query', onSpend });
    if (!embedded.ok) {
      if (embedded.reason !== 'no-key') console.error('ask: embedding the question failed', embedded.reason, embedded.detail);
      return [];
    }
    const vault = await db('obsidian');
    const { data, error } = await vault.rpc('nearest_notes', {
      query_embedding: vectorLiteral(embedded.vector),
      p_user_id: userId,
      match_limit: ASK_NOTE_MATCHES,
      min_similarity: ASK_NOTE_MIN_SIMILARITY,
      embedding_model_filter: embedded.model,
      p_exclude: null,
    });
    if (error) throw new Error(`nearest notes: ${error.message}`);
    return ((data ?? []) as { note_id: string; similarity: number }[])
      .filter((row) => Number.isFinite(row.similarity))
      .map((row) => ({ id: row.note_id, similarity: row.similarity }));
  };
}
