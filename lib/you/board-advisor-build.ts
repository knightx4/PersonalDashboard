import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  ADVISOR_SKILL_PATH,
  advisorKey,
  brainState,
  cleanAdvisor,
  listRoster,
  placeholderQuestion,
  ROSTER_COLUMNS,
  rosterOf,
} from '@/lib/you/board-advisors';

/**
 * The server half of the Advisors view (plan #2561.7): adding a guest, firing
 * the build and retrying it, and the chair's switch. Kept apart from
 * board-advisors.ts, which the client view imports, because firing a routine
 * is server-only.
 */

export function advisorBrief(input: { advisorId: string; userId: string }): string {
  return [`Follow ${ADVISOR_SKILL_PATH}`, `Build advisor ${input.advisorId}`, `user_id ${input.userId}`].join('\n');
}

export type BuildResult = { started: true } | { started: false; error: string };

const NO_ROUTINE =
  'Brains are built on the board routine, which is not set up on this deployment: it needs CLAUDE_BOARD_ROUTINE_ID and CLAUDE_BOARD_ROUTINE_TOKEN.';

/** Fire the build for a row already marked building; a fire that fails marks it failed with the answer. */
async function fireBuild(input: {
  client: YouSupabaseClient;
  userId: string;
  advisorId: string;
  routine: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<BuildResult> {
  const { client, userId, advisorId, routine } = input;
  const fired =
    routine.id && routine.token
      ? await fireFeatureRoutine({
          apiKey: routine.token,
          routineId: routine.id,
          text: advisorBrief({ advisorId, userId }),
          fetch: input.fetch,
        })
      : null;
  if (fired?.ok) return { started: true };
  const error = fired ? `Dash could not start the build. ${fired.error}` : NO_ROUTINE;
  await client
    .from('board_advisors')
    .update({ brain_status: 'failed', brain: { error: error.slice(0, 1000) } })
    .eq('id', advisorId)
    .eq('user_id', userId);
  return { started: false, error };
}

/**
 * Add a guest: the row, building, then the build fired. The name and focus
 * are the person's; the skill writes the question from the brain when it is
 * still the placeholder (advisor-brain.md, step 3).
 */
export async function addAdvisor(input: {
  client: YouSupabaseClient;
  userId: string;
  name: string;
  focus?: string | null;
  routine: RoutineTarget;
  fetch?: typeof globalThis.fetch;
}): Promise<{ error: string | null; advisorId?: string }> {
  const clean = cleanAdvisor(input);
  if (!clean.ok) return { error: clean.error };
  const { client, userId } = input;
  const roster = await listRoster(client, userId);
  if (roster.some((a) => a.name.toLowerCase() === clean.value.name.toLowerCase())) {
    return { error: `${clean.value.name} is already on your board.` };
  }
  const { data, error } = await client
    .from('board_advisors')
    .insert({
      user_id: userId,
      key: advisorKey(
        clean.value.name,
        roster.map((a) => a.key),
      ),
      name: clean.value.name,
      kind: 'guest',
      question: placeholderQuestion(clean.value.name),
      focus: clean.value.focus,
      brain_status: 'building',
      added_by: 'person',
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'Could not add the advisor.' };
  const advisorId = data.id as string;
  const built = await fireBuild({ client, userId, advisorId, routine: input.routine, fetch: input.fetch });
  // The row is saved either way; a build that could not start shows why on it, with a retry.
  return { error: built.started ? null : built.error, advisorId };
}

/** Build a failed (or lost) brain again. A ready guest is not rebuilt from here. */
export async function retryBuild(input: {
  client: YouSupabaseClient;
  userId: string;
  advisorId: string;
  routine: RoutineTarget;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<BuildResult> {
  const { client, userId, advisorId } = input;
  const { data, error } = await client
    .from('board_advisors')
    .select(ROSTER_COLUMNS)
    .eq('user_id', userId)
    .eq('id', advisorId)
    .maybeSingle();
  if (error) return { started: false, error: error.message };
  const advisor = data ? rosterOf(data as unknown as Record<string, unknown>) : null;
  if (!advisor || advisor.kind !== 'guest') return { started: false, error: 'That is not one of your guests.' };
  const state = brainState(advisor, input.now ?? Date.now());
  if (state.kind !== 'failed') {
    return {
      started: false,
      error: state.kind === 'ready' ? 'This brain is already built.' : 'This brain is being built.',
    };
  }
  const { error: moveError } = await client
    .from('board_advisors')
    .update({ brain_status: 'building', brain: null })
    .eq('id', advisorId)
    .eq('user_id', userId);
  if (moveError) return { started: false, error: moveError.message };
  return fireBuild({ client, userId, advisorId, routine: input.routine, fetch: input.fetch });
}

/** Let the chair bring a guest in, or not. A seat always sits. */
export async function setActive(input: {
  client: YouSupabaseClient;
  userId: string;
  advisorId: string;
  active: boolean;
}): Promise<{ error: string | null }> {
  const { data, error } = await input.client
    .from('board_advisors')
    .update({ active: input.active })
    .eq('user_id', input.userId)
    .eq('id', input.advisorId)
    .eq('kind', 'guest')
    .select('id');
  if (error) return { error: error.message };
  return data && data.length > 0 ? { error: null } : { error: 'That is not one of your guests.' };
}
