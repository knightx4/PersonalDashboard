import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loggableContent } from './evidence';
import type { Stage } from './plan';

/**
 * Writes on `learn.essay_log` (migration learn 0133): the stages opened, for
 * drop-off, and each model call with its response, for replaying real
 * responses in the tests. Logging never fails the work it records: an error
 * is reported to the server log and dropped.
 */

export async function logEssayStageVisit(
  supabase: LearnSupabaseClient,
  userId: string,
  essayId: string,
  stage: Stage,
): Promise<void> {
  const { error } = await supabase
    .from('essay_log')
    .insert({ user_id: userId, essay_id: essayId, kind: 'stage', stage });
  if (error) console.error('[essay log] stage', error.message);
}

export async function logEssayCall(
  supabase: LearnSupabaseClient,
  userId: string,
  essayId: string,
  call: {
    stage: Stage;
    action: string;
    model: string;
    prompt: string;
    content: unknown;
    kind?: string;
  },
): Promise<void> {
  const { error } = await supabase.from('essay_log').insert({
    user_id: userId,
    essay_id: essayId,
    kind: 'call',
    stage: call.stage,
    action: call.action,
    payload: {
      action: call.action,
      ...(call.kind ? { kind: call.kind } : {}),
      model: call.model,
      prompt: call.prompt,
      content: loggableContent(call.content),
    },
  });
  if (error) console.error('[essay log] call', error.message);
}
