import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { VOICE_ID, VOICE_NAME_MAX } from '@/lib/talk/speech/voices-model';

/**
 * Each bot's own Fish voice (plan #3006.5): you.board_advisors.voice_id and
 * voice_name (you 0049). A bot with none speaks in the default voice.
 */

export type BotVoice = { id: string; name: string | null };

/** The bot's voice, or null when it has none of its own or is not theirs. */
export async function readBotVoice(client: YouSupabaseClient, userId: string, advisorId: string): Promise<BotVoice | null> {
  const { data, error } = await client
    .from('board_advisors')
    .select('voice_id, voice_name')
    .eq('user_id', userId)
    .eq('id', advisorId)
    .maybeSingle();
  if (error) throw new Error(`Reading the bot's voice failed: ${error.message}`);
  const row = data as { voice_id?: unknown; voice_name?: unknown } | null;
  return voiceOfRow(row);
}

/** The voice columns of a row as a voice, or null for none. */
export function voiceOfRow(row: { voice_id?: unknown; voice_name?: unknown } | null | undefined): BotVoice | null {
  if (!row || typeof row.voice_id !== 'string' || !VOICE_ID.test(row.voice_id)) return null;
  const name = typeof row.voice_name === 'string' && row.voice_name.trim() ? row.voice_name.trim() : null;
  return { id: row.voice_id, name };
}

/**
 * Give the bot this voice, or the default with null. Returns false when the
 * id names no bot of theirs. Throws on an id that is not a Fish voice id.
 */
export async function setBotVoice(
  client: YouSupabaseClient,
  userId: string,
  advisorId: string,
  voice: BotVoice | null,
): Promise<boolean> {
  if (voice && !VOICE_ID.test(voice.id)) throw new Error('That is not a Fish voice id.');
  const name = voice?.name?.trim().slice(0, VOICE_NAME_MAX) || null;
  const { data, error } = await client
    .from('board_advisors')
    .update({ voice_id: voice?.id ?? null, voice_name: voice ? name : null })
    .eq('user_id', userId)
    .eq('id', advisorId)
    .eq('active', true)
    .select('id');
  if (error) throw new Error(`Saving the voice failed: ${error.message}`);
  return (data ?? []).length > 0;
}
