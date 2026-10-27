import { fireFeatureRoutine, type RoutineTarget } from '@/lib/feedback/routine';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { sortAdvisors } from '@/lib/you/board-questions';

/**
 * The advisor roster the Advisors view keeps (plan #2561.7): the five seats
 * and every guest with the question each owns, the state of a guest's brain,
 * and the switch for whether the chair may bring a guest in. Adding an advisor
 * writes the row and fires the board routine with "Build advisor <id>"
 * (.claude/skills/board/advisor-brain.md), as callBoardMeeting fires a meeting.
 *
 * A build that cannot finish leaves brain_status `failed` and the reason in
 * `brain.error`, the only place a row without a brain can hold text. The skill
 * writes it the same way (advisor-brain.md, step 7).
 */

export const NAME_MAX = 120;
export const FOCUS_MAX = 300;
export const ADVISOR_SKILL_PATH = '.claude/skills/board/advisor-brain.md';
/** A build still `building` after this long was lost with its session. */
export const BUILD_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type BrainStatus = 'none' | 'building' | 'ready' | 'failed';

export type RosterAdvisor = {
  id: string;
  key: string;
  name: string;
  kind: 'seat' | 'guest';
  question: string;
  focus: string | null;
  brainStatus: BrainStatus;
  /** Why the last build failed, for a failed guest. */
  failure: string | null;
  /** How many public sources the brain was built from, for a ready guest. */
  sources: number;
  active: boolean;
  addedBy: 'person' | 'dash';
  updatedAt: string;
};

/** What a guest's row says about its brain right now. */
export type BrainState =
  | { kind: 'seat' }
  | { kind: 'ready'; sources: number }
  | { kind: 'building' }
  | { kind: 'failed'; why: string };

export const STALE_BUILD_MESSAGE = 'The build stopped before it finished.';

export function brainState(advisor: RosterAdvisor, now: number): BrainState {
  if (advisor.kind === 'seat') return { kind: 'seat' };
  if (advisor.brainStatus === 'ready') return { kind: 'ready', sources: advisor.sources };
  if (advisor.brainStatus === 'building') {
    const since = Date.parse(advisor.updatedAt);
    return Number.isFinite(since) && now - since > BUILD_STALE_AFTER_MS
      ? { kind: 'failed', why: STALE_BUILD_MESSAGE }
      : { kind: 'building' };
  }
  return { kind: 'failed', why: advisor.failure ?? 'Dash has not built this brain yet.' };
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function rosterOf(row: Record<string, unknown>): RosterAdvisor | null {
  const key = str(row.key);
  const name = str(row.name);
  if (!key || !name || typeof row.id !== 'string') return null;
  const brain =
    row.brain && typeof row.brain === 'object' && !Array.isArray(row.brain)
      ? (row.brain as Record<string, unknown>)
      : null;
  const status = row.brain_status;
  return {
    id: row.id,
    key,
    name,
    kind: row.kind === 'seat' ? 'seat' : 'guest',
    question: str(row.question),
    focus: str(row.focus) || null,
    brainStatus: status === 'building' || status === 'ready' || status === 'failed' ? status : 'none',
    failure: str(brain?.error) || null,
    sources: Array.isArray(brain?.sources) ? brain.sources.length : 0,
    active: row.active !== false,
    addedBy: row.added_by === 'dash' ? 'dash' : 'person',
    updatedAt: str(row.updated_at),
  };
}

const COLUMNS = 'id, key, name, kind, question, focus, brain_status, active, added_by, updated_at, brain';

/** Every advisor on or off the board, the seats first. The brain is read for its source count and failure only. */
export async function listRoster(client: YouSupabaseClient, userId: string): Promise<RosterAdvisor[]> {
  const { data, error } = await client.from('board_advisors').select(COLUMNS).eq('user_id', userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).flatMap((row) => {
    const r = rosterOf(row as Record<string, unknown>);
    return r ? [r] : [];
  });
  return sortAdvisors(rows);
}

/** "Warren Buffett" as `warren_buffett`; a key already taken gets a number after. */
export function advisorKey(name: string, taken: readonly string[]): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || 'advisor';
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
  }
  return `${base}_${taken.length}`;
}

export type CleanAdvisor = { name: string; focus: string | null };

export function cleanAdvisor(input: {
  name: string;
  focus?: string | null;
}): { ok: true; value: CleanAdvisor } | { ok: false; error: string } {
  const name = input.name.replace(/\s+/g, ' ').trim();
  const focus = (input.focus ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'Say who to add first.' };
  if (name.length > NAME_MAX) return { ok: false, error: `Keep the name to at most ${NAME_MAX} characters.` };
  if (focus.length > FOCUS_MAX) return { ok: false, error: `Keep the focus to at most ${FOCUS_MAX} characters.` };
  return { ok: true, value: { name, focus: focus || null } };
}

/** The question a new guest owns until the brain is built and Dash writes theirs. */
export function placeholderQuestion(name: string): string {
  return `What would ${name} make of this?`;
}

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
    .select(COLUMNS)
    .eq('user_id', userId)
    .eq('id', advisorId)
    .maybeSingle();
  if (error) return { started: false, error: error.message };
  const advisor = data ? rosterOf(data as Record<string, unknown>) : null;
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
