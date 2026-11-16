import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { fireFeatureRoutine, goalsRoutine } from '@/lib/feedback/routine';
import { PREPARE_STALE_MS, queueSource, type NewSource } from '@/lib/learn/reader/store';

/**
 * Asking the reader for something: a topic, a link, a pasted text, more on a
 * section, or more to read. Nothing here calls a model. The press writes a
 * row and fires the goals routine with the learn-reader skill, whose session
 * prepares it on the person's Claude subscription (learn 0195). When nobody
 * asks, nothing runs.
 */

export function readerRoutineBrief(waiting: number): string {
  return [
    'Follow .claude/skills/learn-reader/SKILL.md.',
    `Reader sources: ${waiting} waiting in learn.reader_sources for the owner.`,
    'Prepare each one in the order `npm run learn:reader -- next` gives them, and stop when it returns null.',
  ].join('\n');
}

/** Queue a source and start the routine on it. A routine that will not start leaves the source waiting. */
export async function requestSource(
  client: LearnSupabaseClient,
  userId: string,
  source: NewSource,
): Promise<{ id: string; created: boolean; fired: boolean; detail: string }> {
  const queued = await queueSource(client, userId, source);
  if (!queued.created) return { ...queued, fired: false, detail: 'That is already here.' };
  const fired = await fireReaderRoutine(client, userId);
  return { ...queued, fired: fired.ok, detail: fired.detail };
}

/** Start the routine on what is waiting, unless a session is already preparing. */
export async function fireReaderRoutine(
  client: LearnSupabaseClient,
  userId: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const since = new Date(Date.now() - PREPARE_STALE_MS).toISOString();
    const [{ count: waiting }, { count: working }] = await Promise.all([
      client
        .from('reader_sources')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'queued'),
      client
        .from('reader_sources')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'preparing')
        .gte('updated_at', since),
    ]);
    if (!waiting) return { ok: true, detail: 'Nothing is waiting to be prepared.' };
    if (working) return { ok: true, detail: 'Dash is already preparing something; this is next.' };
    const routine = goalsRoutine();
    if (!routine.id)
      return {
        ok: false,
        detail:
          'Queued, but no routine is set to prepare it (CLAUDE_GOALS_ROUTINE_ID), so it waits.',
      };
    const fired = await fireFeatureRoutine({
      apiKey: routine.token,
      routineId: routine.id,
      text: readerRoutineBrief(waiting),
    });
    if (!fired.ok)
      return { ok: false, detail: `Queued, but the run did not start: ${fired.error}` };
    return { ok: true, detail: 'Dash is preparing it. It lands here in a few minutes.' };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The run did not start.' };
  }
}
