import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type {
  ClaimedPreparation,
  PreparationPorts,
  PreparationRow,
  PreparationStepRow,
  RunPatch,
  StepPatch,
} from './run';
import { isPreparationStepKey, PREPARATION_STEPS, type PreparationStepKey } from './steps';

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

const RUN_COLUMNS = 'id, user_id, subject_id, status, current_step, started_at, finished_at, error, failures';
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
  const { data: existing, error: readError } = await learn
    .from('subject_preparations')
    .select('id')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .maybeSingle();
  if (readError) throw new Error(`Reading the preparation failed: ${readError.message}`);
  let id = (existing as { id: string } | null)?.id ?? null;
  if (!id) {
    const { data: made, error } = await learn
      .from('subject_preparations')
      .upsert({ user_id: userId, subject_id: subjectId }, { onConflict: 'subject_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Opening the preparation failed: ${error.message}`);
    id = (made as { id: string } | null)?.id ?? null;
    if (!id) {
      const { data: raced } = await learn.from('subject_preparations').select('id').eq('user_id', userId).eq('subject_id', subjectId).single();
      id = (raced as { id: string }).id;
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
): Promise<string[]> {
  const { data, error } = await learn
    .from('subject_preparations')
    .select('subject_id, status, failures')
    .eq('user_id', userId)
    .neq('status', 'done')
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(limit * 4);
  if (error) throw new Error(`Reading unfinished preparations failed: ${error.message}`);
  return ((data ?? []) as { subject_id: string; status: string; failures: number }[])
    .filter((r) => r.status !== 'failed' || r.failures < CRON_RETRIES)
    .slice(0, limit)
    .map((r) => r.subject_id);
}

/** The ports of runPreparation over the database, for one account. */
export function preparationStore(
  learn: LearnSupabaseClient,
  userId: string,
): Pick<PreparationPorts, 'claim' | 'saveRun' | 'saveStep'> {
  return {
    async claim(subjectId, leaseUntil): Promise<ClaimedPreparation | null> {
      const now = new Date().toISOString();
      // One statement, so two calls cannot both take a free run.
      const { data, error } = await learn
        .from('subject_preparations')
        .update({ lease_until: leaseUntil, updated_at: now })
        .eq('user_id', userId)
        .eq('subject_id', subjectId)
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
        subject: { id: subject.id, userId: subject.user_id, name: subject.name, note: subject.note, kind: subject.kind },
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
