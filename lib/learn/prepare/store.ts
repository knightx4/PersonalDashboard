import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { readTerritory, type Territory } from '@/lib/learn/levels/territory';
import type {
  ClaimedPreparation,
  PreparationPorts,
  PreparationRow,
  PreparationStepRow,
  RunPatch,
  StepPatch,
} from './run';
import { isPreparationStepKey, PREPARATION_STEPS, type PreparationStepKey } from './steps';
import { readBranch, readDirection, type DirectionChoice } from './branch';

/**
 * Where a subject's preparation run is kept (plan #2276.1):
 * learn.subject_preparations and learn.subject_preparation_steps.
 *
 * Written with the service role, so every query names the account. The
 * person's own session may only read the rows (0167); the page reads them
 * with loadPreparation.
 */

type RunDb = {
  id: string;
  user_id: string;
  subject_id: string;
  status: PreparationRow['status'];
  current_step: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  failures: number;
  branch: unknown;
};

type StepDb = {
  key: string;
  ordinal: number;
  status: PreparationStepRow['status'];
  started_at: string | null;
  finished_at: string | null;
  summary: string | null;
  counts: Record<string, number> | null;
  detail: Record<string, unknown> | null;
  calls: number;
  error: string | null;
};

const RUN_COLUMNS = 'id, user_id, subject_id, status, current_step, started_at, finished_at, error, failures, branch';
const STEP_COLUMNS = 'key, ordinal, status, started_at, finished_at, summary, counts, detail, calls, error';

/** A run left this many failures behind is left for the person's Continue. */
export const CRON_RETRIES = 3;

function toRun(row: RunDb): PreparationRow {
  return {
    id: row.id,
    userId: row.user_id,
    subjectId: row.subject_id,
    status: row.status,
    currentStep: isPreparationStepKey(row.current_step) ? row.current_step : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    failures: row.failures,
    branch: readBranch(row.branch),
  };
}

function toSteps(rows: StepDb[]): PreparationStepRow[] {
  return rows
    .filter((r): r is StepDb & { key: PreparationStepKey } => isPreparationStepKey(r.key))
    .map((r) => ({
      key: r.key,
      ordinal: r.ordinal,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      summary: r.summary,
      counts: r.counts ?? {},
      detail: r.detail ?? {},
      calls: r.calls,
      error: r.error,
    }))
    .sort((a, b) => a.ordinal - b.ordinal);
}

function runColumns(patch: RunPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.currentStep !== undefined) out.current_step = patch.currentStep;
  if (patch.startedAt !== undefined) out.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) out.finished_at = patch.finishedAt;
  if (patch.error !== undefined) out.error = patch.error;
  if (patch.failures !== undefined) out.failures = patch.failures;
  if (patch.leaseUntil !== undefined) out.lease_until = patch.leaseUntil;
  return out;
}

function stepColumns(patch: StepPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.startedAt !== undefined) out.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) out.finished_at = patch.finishedAt;
  if (patch.summary !== undefined) out.summary = patch.summary;
  if (patch.counts !== undefined) out.counts = patch.counts;
  if (patch.detail !== undefined) out.detail = patch.detail;
  if (patch.calls !== undefined) out.calls = patch.calls;
  if (patch.error !== undefined) out.error = patch.error;
  return out;
}

/**
 * Open the run for a subject that has none: one made before the trigger in
 * 0167, which only the Prepare press and the script in #2276.8 reach. A
 * subject with a run keeps it as it is. Returns the run's id.
 */
export async function ensurePreparation(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<string> {
  const readOwn = () =>
    learn.from('subject_preparations').select('id').eq('user_id', userId).eq('subject_id', subjectId).is('branch_key', null).maybeSingle();
  const { data: existing, error: readError } = await readOwn();
  if (readError) throw new Error(`Reading the preparation failed: ${readError.message}`);
  let id = (existing as { id: string } | null)?.id ?? null;
  if (!id) {
    // The subject's own run is unique by a partial key (learn 0171), which an
    // upsert cannot name, so a run opened in the meantime shows as a clash.
    const { data: made, error } = await learn
      .from('subject_preparations')
      .insert({ user_id: userId, subject_id: subjectId })
      .select('id')
      .maybeSingle();
    if (error && error.code !== '23505') throw new Error(`Opening the preparation failed: ${error.message}`);
    id = (made as { id: string } | null)?.id ?? null;
    if (!id) {
      const { data: raced } = await readOwn();
      id = (raced as { id: string } | null)?.id ?? null;
      if (!id) throw new Error('Opening the preparation failed: no run came back.');
    }
  }
  const { error: stepsError } = await learn.from('subject_preparation_steps').upsert(
    PREPARATION_STEPS.map((key, i) => ({ preparation_id: id, user_id: userId, key, ordinal: i + 1 })),
    { onConflict: 'preparation_id,key', ignoreDuplicates: true },
  );
  if (stepsError) throw new Error(`Opening the preparation's steps failed: ${stepsError.message}`);
  return id;
}

/** A subject's run and its steps as they stand, or null when it has none. */
export async function loadPreparation(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<{ run: PreparationRow; steps: PreparationStepRow[] } | null> {
  const { data, error } = await learn
    .from('subject_preparations')
    .select(RUN_COLUMNS)
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .is('branch_key', null)
    .maybeSingle();
  if (error) throw new Error(`Reading the preparation failed: ${error.message}`);
  if (!data) return null;
  const run = toRun(data as RunDb);
  const { data: steps, error: stepsError } = await learn
    .from('subject_preparation_steps')
    .select(STEP_COLUMNS)
    .eq('user_id', userId)
    .eq('preparation_id', run.id);
  if (stepsError) throw new Error(`Reading the preparation's steps failed: ${stepsError.message}`);
  return { run, steps: toSteps((steps ?? []) as StepDb[]) };
}

/**
 * Subjects whose run is unfinished and free to work, oldest first: pending,
 * running with an expired lease, or failed fewer than CRON_RETRIES times.
 * What the daily cron resumes.
 */
export async function unfinishedPreparations(
  learn: LearnSupabaseClient,
  userId: string,
  now: Date,
  limit: number,
): Promise<{ subjectId: string; branch: string | null }[]> {
  const { data, error } = await learn
    .from('subject_preparations')
    .select('subject_id, branch_key, status, failures')
    .eq('user_id', userId)
    .neq('status', 'done')
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(limit * 4);
  if (error) throw new Error(`Reading unfinished preparations failed: ${error.message}`);
  return ((data ?? []) as { subject_id: string; branch_key: string | null; status: string; failures: number }[])
    .filter((r) => r.status !== 'failed' || r.failures < CRON_RETRIES)
    .slice(0, limit)
    .map((r) => ({ subjectId: r.subject_id, branch: r.branch_key }));
}

/**
 * The subjects whose preparation has finished (plan #2297.4): the main run
 * (no branch) is done. The feed top-up writes no cards or concept lessons for
 * these, since the preparation covers them.
 */
export async function preparedSubjectIds(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await learn
    .from('subject_preparations')
    .select('subject_id')
    .eq('user_id', userId)
    .eq('status', 'done')
    .is('branch_key', null);
  if (error) throw new Error(`Reading prepared subjects failed: ${error.message}`);
  return new Set(((data ?? []) as { subject_id: string }[]).map((row) => row.subject_id));
}

/** The territory a run compiled (plan #2276.4), by the run's id; null before compile_territory has kept one. */
export async function loadRunTerritory(learn: LearnSupabaseClient, userId: string, runId: string): Promise<Territory | null> {
  const { data, error } = await learn
    .from('subject_preparations')
    .select('territory')
    .eq('user_id', userId)
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(`Reading the territory failed: ${error.message}`);
  return readTerritory((data as { territory: unknown } | null)?.territory);
}

/** The territory a subject's preparation compiled, for the drafter and the territory-draft route. */
export async function loadSubjectTerritory(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<Territory | null> {
  const { data, error } = await learn
    .from('subject_preparations')
    .select('territory')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .is('branch_key', null)
    .maybeSingle();
  if (error) throw new Error(`Reading the subject's territory failed: ${error.message}`);
  return readTerritory((data as { territory: unknown } | null)?.territory);
}

export async function saveRunTerritory(learn: LearnSupabaseClient, userId: string, runId: string, territory: Territory): Promise<void> {
  const { error } = await learn
    .from('subject_preparations')
    .update({ territory, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('id', runId);
  if (error) throw new Error(`Saving the territory failed: ${error.message}`);
}

export type BranchPreparation = { run: PreparationRow; steps: PreparationStepRow[] };

/**
 * What the direction offer reads (plan #2276.7): the last answer to it, the
 * graded answers on the subject's lens, and the subject's branch runs with
 * their steps, oldest first. Null when the subject has no run of its own.
 */
export async function loadDirection(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<{ direction: DirectionChoice | null; prepared: boolean; answers: number; branches: BranchPreparation[] } | null> {
  const [own, lens, runs] = await Promise.all([
    learn
      .from('subject_preparations')
      .select('direction, status')
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .is('branch_key', null)
      .maybeSingle(),
    learn.from('lenses').select('id').eq('user_id', userId).eq('subject_id', subjectId).limit(1).maybeSingle(),
    learn
      .from('subject_preparations')
      .select(RUN_COLUMNS)
      .eq('user_id', userId)
      .eq('subject_id', subjectId)
      .not('branch_key', 'is', null)
      .order('created_at', { ascending: true }),
  ]);
  if (own.error) throw new Error(`Reading the direction failed: ${own.error.message}`);
  if (runs.error) throw new Error(`Reading the branch runs failed: ${runs.error.message}`);
  if (!own.data) return null;

  const lensId = (lens.data as { id: string } | null)?.id ?? null;
  let answers = 0;
  if (lensId) {
    const counted = await learn.rpc('lens_graded_answers', { p_user: userId, p_lens: lensId });
    if (counted.error) throw new Error(`Counting the answers on the lens failed: ${counted.error.message}`);
    answers = typeof counted.data === 'number' ? counted.data : 0;
  }

  const branchRuns = ((runs.data ?? []) as RunDb[]).map(toRun);
  let branches: BranchPreparation[] = [];
  if (branchRuns.length > 0) {
    const { data: steps, error: stepsError } = await learn
      .from('subject_preparation_steps')
      .select(`preparation_id, ${STEP_COLUMNS}`)
      .eq('user_id', userId)
      .in('preparation_id', branchRuns.map((r) => r.id));
    if (stepsError) throw new Error(`Reading the branch runs' steps failed: ${stepsError.message}`);
    const rows = (steps ?? []) as (StepDb & { preparation_id: string })[];
    branches = branchRuns.map((run) => ({ run, steps: toSteps(rows.filter((r) => r.preparation_id === run.id)) }));
  }
  const ownRow = own.data as { direction: unknown; status: string };
  return { direction: readDirection(ownRow.direction), prepared: ownRow.status === 'done', answers, branches };
}

/** The ports of runPreparation over the database, for one account. */
export function preparationStore(
  learn: LearnSupabaseClient,
  userId: string,
): Pick<PreparationPorts, 'claim' | 'saveRun' | 'saveStep'> {
  return {
    async claim(subjectId, leaseUntil, branch): Promise<ClaimedPreparation | null> {
      const now = new Date().toISOString();
      // One statement, so two calls cannot both take a free run. A branch run
      // is named by its key (plan #2276.7); no key is the subject's own run.
      const update = learn
        .from('subject_preparations')
        .update({ lease_until: leaseUntil, updated_at: now })
        .eq('user_id', userId)
        .eq('subject_id', subjectId);
      const { data, error } = await (branch ? update.eq('branch_key', branch) : update.is('branch_key', null))
        .or(`lease_until.is.null,lease_until.lt.${now}`)
        .select(RUN_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`Taking the preparation failed: ${error.message}`);
      if (!data) return null;
      const run = toRun(data as RunDb);

      const [stepsRead, subjectRead] = await Promise.all([
        learn.from('subject_preparation_steps').select(STEP_COLUMNS).eq('user_id', userId).eq('preparation_id', run.id),
        learn.from('subjects').select('id, user_id, name, note, kind').eq('user_id', userId).eq('id', subjectId).maybeSingle(),
      ]);
      if (stepsRead.error) throw new Error(`Reading the preparation's steps failed: ${stepsRead.error.message}`);
      if (subjectRead.error) throw new Error(`Reading the subject failed: ${subjectRead.error.message}`);
      const subject = subjectRead.data as { id: string; user_id: string; name: string; note: string | null; kind: string | null } | null;
      if (!subject) return null;
      return {
        run,
        steps: toSteps((stepsRead.data ?? []) as StepDb[]),
        subject: {
          id: subject.id,
          userId: subject.user_id,
          name: subject.name,
          note: subject.note,
          kind: subject.kind,
          branch: run.branch ?? null,
        },
      };
    },

    async saveRun(runId, patch) {
      const { error } = await learn.from('subject_preparations').update(runColumns(patch)).eq('user_id', userId).eq('id', runId);
      if (error) throw new Error(`Saving the preparation failed: ${error.message}`);
    },

    async saveStep(runId, key, patch) {
      const { error } = await learn
        .from('subject_preparation_steps')
        .update(stepColumns(patch))
        .eq('user_id', userId)
        .eq('preparation_id', runId)
        .eq('key', key);
      if (error) throw new Error(`Saving the step ${key} failed: ${error.message}`);
    },
  };
}
