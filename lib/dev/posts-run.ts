/**
 * Start the posts run (plan #1417): the Suggest posts button on the Posts tab,
 * and later "Post about this" on a changelog line (#1420).
 *
 * The same plan routine that shapes ideas and fixes red CI, with a turn that
 * says this firing is for posts. Recorded in `plan_runs` as job `posts` with
 * no step, so the tab reads it back with `loadLastPostsRun`. A press while the
 * last run is still going is refused, because two runs would draft the same
 * angles twice.
 *
 * The caller is a server action that has already passed `requireOwner`.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { planRoutine } from '@/lib/feedback/routine';
import { startRoutineRun } from '@/lib/plan/runs';
import { loadLastPostsRun, postsRunState, postsRunText, type PostsRunFocus } from './posts';

export type StartPostsRunResult = { ok: true; message: string } | { ok: false; error: string };

export async function startPostsRun(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>;
  userId: string;
  /** One step to write about instead of everything since the last post. */
  focus?: PostsRunFocus | null;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<StartPostsRunResult> {
  const last = await loadLastPostsRun(input.supabase, input.userId);
  if (postsRunState(last, input.now ?? Date.now()) === 'going') {
    return { ok: false, error: 'Dash is already drafting posts. They will appear here when it is done.' };
  }

  const result = await startRoutineRun({
    supabase: input.supabase,
    userId: input.userId,
    job: 'posts',
    routine: planRoutine(),
    text: postsRunText({ userId: input.userId, focus: input.focus ?? null }),
    fetch: input.fetch,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    message: input.focus
      ? 'Sent. The draft will appear on the Posts tab when Dash is done.'
      : 'Sent. Three to five drafts will appear here when Dash is done.',
  };
}
