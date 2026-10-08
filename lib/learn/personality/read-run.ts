import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { MODELS } from '@/lib/core/models';
import { usageFrom } from '@/lib/core/spend/pricing';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { THINKING_ROOM, forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createVaultClient } from '@/lib/vault/auth/server';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';
import { relatedNotesStore, vectorForText } from '@/lib/vault/notes/related';
import { fromRow, RESULT_COLUMNS, type PersonalityResult, type ReadPoint, type ResultRow } from './model';
import {
  chooseNotes,
  describeResult,
  NOTES_PER_QUERY,
  PINNED_TITLES,
  pointsFrom,
  READ_MIN_SIMILARITY,
  READ_SYSTEM,
  READ_TOOL,
  READ_TOOL_SCHEMA,
  readPrompt,
  readQueries,
  type CandidateNote,
} from './read';
import { loadTraitThemes } from './trait-themes-load';

/**
 * Dash's read of one personality result against your notes (plan #1635).
 *
 * Runs once when a result is saved, after the page has answered
 * (`readPersonalityAfterResponse`), and again when the Know page's button
 * asks for a fresh read (`runPersonalityRead`, awaited). Never on a note
 * changing.
 *
 * The notes come from embedding: each trait sentence (or the typed-in type)
 * and one sentence about how you see yourself are embedded through the
 * related-notes cache and matched against your notes with
 * obsidian.nearest_notes, beside any note titled "About me". read.ts chooses
 * fifteen at most and cuts each, so a read is one Sonnet call of about six
 * thousand tokens. The cost goes on the ledger as 'read-personality'; an
 * embedding not already cached goes as 'embed-note-match'.
 *
 * The read is written on the result's own row, over any earlier one. A read
 * that fails leaves the result as it was, with read_failed_at set, so the
 * page can say the read did not run. Never throws.
 */

const MODEL = MODELS.learnPersonalityRead;

type RawNote = { id: string; path: string; title: string | null; body: string | null };

function toCandidate(note: RawNote): CandidateNote {
  return {
    id: note.id,
    path: note.path,
    title: note.title?.trim() || note.path.replace(/^.*\//, '').replace(/\.md$/i, ''),
    body: note.body ?? '',
  };
}

async function notesByIds(vault: VaultSupabaseClient, userId: string, ids: string[]): Promise<Map<string, CandidateNote>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await vault
    .from('notes')
    .select('id, path, title, body')
    .eq('user_id', userId)
    .in('id', ids)
    .is('deleted_at', null);
  if (error) throw new Error(`Reading notes failed: ${error.message}`);
  return new Map(((data ?? []) as RawNote[]).map((n) => [n.id, toCandidate(n)]));
}

async function pinnedNotes(vault: VaultSupabaseClient, userId: string): Promise<CandidateNote[]> {
  const { data, error } = await vault
    .from('notes')
    .select('id, path, title, body')
    .eq('user_id', userId)
    .in('title', [...PINNED_TITLES])
    .is('deleted_at', null);
  if (error) throw new Error(`Reading the notes about you failed: ${error.message}`);
  return ((data ?? []) as RawNote[]).map(toCandidate);
}

async function loadResults(learn: LearnSupabaseClient): Promise<PersonalityResult[]> {
  const { data, error } = await learn.from('personality_results').select(RESULT_COLUMNS);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading your results failed: ${error.message}`);
  return ((data ?? []) as unknown as ResultRow[])
    .map(fromRow)
    .filter((r): r is PersonalityResult => r !== null);
}

async function writeRead(
  learn: LearnSupabaseClient,
  id: string,
  points: ReadPoint[],
  model: string,
): Promise<void> {
  const { error } = await learn
    .from('personality_results')
    .update({ read_points: points, read_model: model, read_at: new Date().toISOString(), read_failed_at: null })
    .eq('id', id);
  if (error) throw new Error(`Keeping the read failed: ${error.message}`);
}

async function markFailed(learn: LearnSupabaseClient, id: string): Promise<void> {
  const { error } = await learn
    .from('personality_results')
    .update({ read_failed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('[learn personality read] marking the failure', error.message);
}

export type ReadOutcome = { ok: true; points: number } | { ok: false; detail: string };

async function read(
  learn: LearnSupabaseClient,
  userId: string,
  resultId: string,
  client?: Anthropic,
): Promise<ReadOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !client) return { ok: false, detail: 'ANTHROPIC_API_KEY is not set.' };

  const results = await loadResults(learn);
  const result = results.find((r) => r.id === resultId);
  if (!result) return { ok: false, detail: 'The result is not there any more.' };

  const [vault, core] = await Promise.all([createVaultClient(), createCoreClient()]);
  const ports = relatedNotesStore(vault, userId, { core });

  const nearestIds = await Promise.all(
    readQueries(result).map(async (text) => {
      const vector = await vectorForText(ports, text);
      if (!vector) throw new Error('A text to match your notes against could not be embedded.');
      const rows = await ports.nearest(vector, {
        limit: NOTES_PER_QUERY,
        minSimilarity: READ_MIN_SIMILARITY,
        exclude: [],
      });
      return rows.filter((r) => r.similarity >= READ_MIN_SIMILARITY).map((r) => r.note_id);
    }),
  );
  const [bodies, pinned, themes] = await Promise.all([
    notesByIds(vault, userId, [...new Set(nearestIds.flat())]),
    pinnedNotes(vault, userId),
    result.kind === 'big_five' ? loadTraitThemes(vault, userId, result.scores, { core }) : null,
  ]);
  const nearest = nearestIds.map((ids) =>
    ids.map((id) => bodies.get(id)).filter((n): n is CandidateNote => Boolean(n)),
  );
  const notes = chooseNotes(pinned, nearest);

  // Nothing of yours to compare with: a read with no points, and no call.
  if (notes.length === 0) {
    await writeRead(learn, result.id, [], 'none');
    return { ok: true, points: 0 };
  }

  const anthropic = client ?? new Anthropic({ apiKey });
  const spend = collectSpend();
  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096 + THINKING_ROOM,
      system: READ_SYSTEM,
      tools: [
        {
          name: READ_TOOL,
          description: 'Report where the result agrees and clashes with the notes, each point naming one note.',
          input_schema: READ_TOOL_SCHEMA,
        },
      ],
      tool_choice: forceTool(READ_TOOL, MODEL),
      messages: [
        {
          role: 'user',
          content: `${readPrompt(describeResult(result, results, themes), notes)}\n\nReport through ${READ_TOOL}.`,
        },
      ],
    });
    spend.sink({ model: MODEL, usage: usageFrom(response.usage) });
  } finally {
    await recordLearnSpend(userId, 'read-personality', spend.reports);
  }

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === READ_TOOL);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };
  const points = pointsFrom(block.input, notes);
  if (!points) return { ok: false, detail: 'The read came back in the wrong shape.' };

  await writeRead(learn, result.id, points, MODEL);
  return { ok: true, points: points.length };
}

/** Read one result now and keep the read, or mark that it failed. */
export async function runPersonalityRead(
  learn: LearnSupabaseClient,
  userId: string,
  resultId: string,
  options: { client?: Anthropic } = {},
): Promise<ReadOutcome> {
  let outcome: ReadOutcome;
  try {
    outcome = await read(learn, userId, resultId, options.client);
  } catch (error) {
    outcome = { ok: false, detail: error instanceof Error ? error.message : 'The read failed.' };
  }
  if (!outcome.ok) {
    console.error('[learn personality read]', outcome.detail);
    await markFailed(learn, resultId);
  }
  return outcome;
}

/**
 * Read a result once the response has gone, so saving it does not wait on
 * the call. Called only from server actions, where `after` may still use the
 * session's cookies for the clients and the spend record.
 */
export function readPersonalityAfterResponse(
  learn: LearnSupabaseClient,
  userId: string,
  resultId: string,
): void {
  after(() => runPersonalityRead(learn, userId, resultId).then(() => undefined));
}
