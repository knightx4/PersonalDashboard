import type { SpendSink } from '@/lib/core/spend/pricing';
import { vectorLiteral } from '@/lib/learn/catalogue/embed-sweep';
import { embedTexts, type EmbedOutcome } from '@/lib/learn/embed/embed';
import type { EmbeddingInputType } from '@/lib/learn/embed/voyage';
import type { VaultSupabaseClient } from '@/lib/vault/db/schema-name';

/** Existing theme names sent with each chunk, so the model reuses them. */
export const MAX_EXISTING_THEMES = 200;

/**
 * How many of those are the themes nearest the note (plan #818). The rest are
 * the strongest themes, so a note is still shown the names the map is built
 * around.
 */
export const NEAREST_THEMES_OFFERED = 150;

/**
 * How much of a note is embedded to find its nearest themes. The opening of
 * a long note says what it is about; the whole of it would cost more tokens
 * and move the vector very little.
 */
export const NOTE_EMBED_CHARS = 6000;

/**
 * The person's theme names, strongest first, for `proposeNoteMap` to reuse
 * rather than coin a near-duplicate.
 *
 * A failed read returns no names. The proposal still works without them; it
 * only loses the nudge towards names already in use.
 *
 * `userId` is required with a service-role client, which RLS does not narrow:
 * the sweep passes it so one person's theme names are never sent with
 * another's notes.
 */
export async function loadThemeNames(
  supabase: VaultSupabaseClient,
  limit = MAX_EXISTING_THEMES,
  userId?: string,
): Promise<string[]> {
  let query = supabase.from('themes').select('name');
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query
    .order('strength', { ascending: false })
    .order('name')
    .limit(limit);
  if (error || !data) return [];
  return (data as { name: string }[]).map((row) => row.name);
}

/** What is embedded to stand for a note: its title and the opening of its body. */
export function noteEmbeddingText(note: { title: string; body: string }): string {
  return `${note.title}\n\n${note.body}`.trim().slice(0, NOTE_EMBED_CHARS);
}

export type NearestThemesOptions = {
  userId?: string;
  limit?: number;
  apiKey?: string | null;
  onSpend?: SpendSink;
  /** Injected by the tests. Defaults to Voyage through `embedTexts`. */
  embed?: (input: {
    texts: string[];
    inputType: EmbeddingInputType;
    apiKey?: string | null;
    onSpend?: SpendSink;
  }) => Promise<EmbedOutcome>;
};

/**
 * The names of the person's themes closest to this note by embedding, closest
 * first (plan #818).
 *
 * The strongest 200 are the same for every note, so a note on a subject
 * outside them used to see nothing close and coin a new theme. The note is
 * embedded as a query and compared with every theme that has a vector
 * (obsidian.nearest_themes, supabase/migrations-vault/0010).
 *
 * Never throws and never fails the reading. No key, a failed embedding call or
 * a failed lookup returns no names, and the note is offered the strongest
 * themes as before. A theme with no vector yet, such as one just renamed or
 * merged, is left out here and can still arrive through the strongest list.
 */
export async function loadNearestThemeNames(
  supabase: VaultSupabaseClient,
  note: { title: string; body: string },
  options: NearestThemesOptions = {},
): Promise<string[]> {
  const text = noteEmbeddingText(note);
  if (text === '') return [];

  try {
    const embed = options.embed ?? embedTexts;
    const outcome = await embed({
      texts: [text],
      inputType: 'query',
      apiKey: options.apiKey,
      onSpend: options.onSpend,
    });
    if (!outcome.ok) {
      if (outcome.reason !== 'no-key') {
        console.error('[vault map nearest themes]', outcome.reason, outcome.detail);
      }
      return [];
    }
    const vector = outcome.vectors[0];
    if (!vector) return [];

    const { data, error } = await supabase.rpc('nearest_themes', {
      query_embedding: vectorLiteral(vector),
      p_user_id: options.userId ?? null,
      match_limit: options.limit ?? NEAREST_THEMES_OFFERED,
      embedding_model_filter: outcome.model,
    });
    if (error) {
      console.error('[vault map nearest themes]', error.message);
      return [];
    }
    return ((data ?? []) as { name: string }[]).map((row) => row.name);
  } catch (error) {
    console.error('[vault map nearest themes]', error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * The names offered with a note: the nearest first, then the strongest until
 * the cap. With no nearest names this is the strongest list as it always was.
 */
export function offerThemes(
  nearest: string[],
  strongest: string[],
  cap = MAX_EXISTING_THEMES,
): string[] {
  const seen = new Set<string>();
  const offered: string[] = [];
  for (const name of [...nearest.slice(0, NEAREST_THEMES_OFFERED), ...strongest]) {
    if (offered.length >= cap) break;
    if (seen.has(name)) continue;
    seen.add(name);
    offered.push(name);
  }
  return offered;
}
