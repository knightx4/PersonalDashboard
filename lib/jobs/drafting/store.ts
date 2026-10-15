/**
 * Dash's working draft of a whole application, kept between visits (feature
 * #2130). One current row per application and kind in
 * job_search.application_drafts (migration 0054).
 *
 * The row holds what Dash drafted, the questions it asked back and the
 * person's replies, so a reload does not lose them and a redraft can use the
 * replies. It is a working copy: what the person keeps goes to
 * application_answers or the cover letter.
 *
 * Kept free of server-only imports so the shapes and the reading rules can be
 * tested directly. The functions that touch the database take the client.
 */
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';

export type DraftKind = 'answers' | 'cover_letter';

/** Where a cover letter's single entry sits in `drafts`. */
export const LETTER_KEY = 'letter';

/** One drafted answer, or the cover letter, with what it cites and what to check. */
export interface StoredDraft {
  answer: string;
  evidence_item_ids: string[];
  unsupported_claims: string[];
}

/**
 * Drafts by key. For kind `answers` the key is an application_answers id. For
 * kind `cover_letter` there is one entry, under LETTER_KEY.
 */
export type DraftMap = Record<string, StoredDraft>;

/** A question Dash asked back. `answer_id` is null when it concerns the application as a whole. */
export interface StoredAsk {
  id: string;
  answer_id: string | null;
  question: string;
  /** The person's reply; null until they have answered. */
  reply: string | null;
}

/** The current draft for one application and kind. */
export interface ApplicationDrafts {
  applicationId: string;
  kind: DraftKind;
  drafts: DraftMap;
  asks: StoredAsk[];
  updatedAt: string;
}

/** What a writer supplies; the row's identity and times come from the database. */
export interface DraftsInput {
  drafts: DraftMap;
  asks: StoredAsk[];
}

const TABLE = 'application_drafts';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Reads the drafts jsonb, dropping any entry that lacks an answer. */
export function parseDrafts(value: unknown): DraftMap {
  const out: DraftMap = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.answer !== 'string') continue;
    out[key] = {
      answer: entry.answer,
      evidence_item_ids: strings(entry.evidence_item_ids),
      unsupported_claims: strings(entry.unsupported_claims),
    };
  }
  return out;
}

/** Reads the asks jsonb, dropping any entry that lacks an id or a question. */
export function parseAsks(value: unknown): StoredAsk[] {
  if (!Array.isArray(value)) return [];
  const out: StoredAsk[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const ask = raw as Record<string, unknown>;
    if (typeof ask.id !== 'string' || typeof ask.question !== 'string') continue;
    out.push({
      id: ask.id,
      answer_id: typeof ask.answer_id === 'string' ? ask.answer_id : null,
      question: ask.question,
      reply: typeof ask.reply === 'string' && ask.reply.trim() !== '' ? ask.reply : null,
    });
  }
  return out;
}

/** Sets replies on the asks they name, by ask id; an empty reply clears it. Other asks are untouched. */
export function withReplies(asks: StoredAsk[], replies: Record<string, string>): StoredAsk[] {
  return asks.map((ask) => {
    if (!(ask.id in replies)) return ask;
    const reply = replies[ask.id].trim();
    return { ...ask, reply: reply === '' ? null : reply };
  });
}

/** The current draft for an application and kind, or null when none has been written. */
export async function loadDrafts(
  supabase: AppSupabaseClient,
  applicationId: string,
  kind: DraftKind,
): Promise<{ drafts: ApplicationDrafts | null; error: string | null }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('application_id, kind, drafts, asks, updated_at')
    .eq('application_id', applicationId)
    .eq('kind', kind)
    .maybeSingle();
  if (error) return { drafts: null, error: error.message };
  if (!data) return { drafts: null, error: null };
  return {
    drafts: {
      applicationId: data.application_id as string,
      kind: data.kind as DraftKind,
      drafts: parseDrafts(data.drafts),
      asks: parseAsks(data.asks),
      updatedAt: data.updated_at as string,
    },
    error: null,
  };
}

/**
 * Writes the current draft, replacing the one already there for this
 * application and kind. The caller merges first when it wants to keep earlier
 * entries; this stores exactly what it is given.
 */
export async function saveDrafts(
  supabase: AppSupabaseClient,
  userId: string,
  applicationId: string,
  kind: DraftKind,
  input: DraftsInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      application_id: applicationId,
      kind,
      drafts: input.drafts,
      asks: input.asks,
    },
    { onConflict: 'application_id,kind' },
  );
  return { error: error ? error.message : null };
}

/** Records the person's replies on the stored asks. Returns false when there is no draft to reply to. */
export async function saveReplies(
  supabase: AppSupabaseClient,
  applicationId: string,
  kind: DraftKind,
  replies: Record<string, string>,
): Promise<{ saved: boolean; error: string | null }> {
  const { drafts, error } = await loadDrafts(supabase, applicationId, kind);
  if (error) return { saved: false, error };
  if (!drafts) return { saved: false, error: null };
  const { error: updateError } = await supabase
    .from(TABLE)
    .update({ asks: withReplies(drafts.asks, replies) })
    .eq('application_id', applicationId)
    .eq('kind', kind);
  return { saved: !updateError, error: updateError ? updateError.message : null };
}

/** Removes the draft, for when the person discards it. */
export async function clearDrafts(
  supabase: AppSupabaseClient,
  applicationId: string,
  kind: DraftKind,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from(TABLE).delete().eq('application_id', applicationId).eq('kind', kind);
  return { error: error ? error.message : null };
}
