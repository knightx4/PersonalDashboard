import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { NOT_RECORDING, type Recording } from './recording';

/** The person's recording-mode choice (plan #1997.9), kept in their Learn settings row. */
export async function loadRecording(
  learn: LearnSupabaseClient,
  userId: string,
): Promise<Recording> {
  const { data, error } = await learn
    .from('settings')
    .select('idea_space_recording, idea_space_hidden_places')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading your Idea Space settings failed: ${error.message}`);
  const row = data as {
    idea_space_recording: boolean;
    idea_space_hidden_places: string[] | null;
  } | null;
  return row
    ? { on: row.idea_space_recording, hidden: row.idea_space_hidden_places ?? [] }
    : NOT_RECORDING;
}

export async function saveRecording(
  learn: LearnSupabaseClient,
  userId: string,
  recording: Recording,
): Promise<void> {
  const { error } = await learn.from('settings').upsert(
    {
      user_id: userId,
      idea_space_recording: recording.on,
      idea_space_hidden_places: recording.hidden,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(`Saving that failed: ${error.message}`);
}
