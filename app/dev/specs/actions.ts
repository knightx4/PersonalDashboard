'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { MODULE_IDS } from '@/lib/modules';
import { APP_VISION } from '@/lib/specs/vision';
import { planRoutine } from '@/lib/feedback/routine';
import { loadPlan } from '@/lib/plan/load';
import { startRoutineRun } from '@/lib/plan/runs';
import { buildPlanTree } from '@/lib/plan/tree';
import { openFeaturesIn, scopeLabel, visionReshapeText } from '@/lib/plan/vision-reshape';
import { decideVisionEdit, type DecidedVisionEdit } from '@/lib/specs/vision-review';
import { decideSpecChange, type SpecChange, type SpecChangeDecision } from '@/lib/specs/changes';

/**
 * Writing the vision for a workspace.
 *
 * The one thing on the specs page the app may write. Everything else there is
 * read from `docs/` and is the repository's, for the reasons migration 0087
 * gives; this is the person's own paragraph about what a workspace is for, and
 * a paragraph you have to open an editor and land a commit to change is a
 * paragraph that goes stale.
 *
 * Saving nothing is how one is taken back. The row is deleted rather than left
 * holding an empty string, so "has a vision been written" stays a question
 * about rows.
 */

export type VisionActionState = {
  error?: string;
  message?: string;
};

// A workspace, or `app` for the vision of the app as a whole.
const moduleSchema = z
  .string()
  .trim()
  .refine((value) => value === APP_VISION || (MODULE_IDS as readonly string[]).includes(value), {
    message: 'That is not a workspace.',
  });

/**
 * Longer than this is not the highest layer of abstraction over a workspace;
 * it is another spec, and the specs live in the repository. The same ceiling
 * the table's own check holds, said here so the reason arrives as a sentence
 * rather than as a constraint violation.
 */
const bodySchema = z.string().trim().max(8000, 'A vision shorter than the specs under it.');

// latency: pending
export async function saveModuleVision(
  _prev: VisionActionState,
  formData: FormData,
): Promise<VisionActionState> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const scope = moduleSchema.safeParse(String(formData.get('module') ?? ''));
  const body = bodySchema.safeParse(formData.get('body') ?? '');
  if (!scope.success) return { error: scope.error.issues[0].message };
  if (!body.success) return { error: body.error.issues[0].message };

  if (body.data === '') {
    const { error } = await supabase
      .from('module_visions')
      .delete()
      .eq('user_id', user.id)
      .eq('module', scope.data);
    if (error) return { error: error.message };

    revalidatePath('/dev/specs');
    return { message: 'Vision cleared.' };
  }

  const { error } = await supabase
    .from('module_visions')
    .upsert(
      { user_id: user.id, module: scope.data, body: body.data },
      { onConflict: 'user_id,module' },
    );
  if (error) return { error: error.message };

  revalidatePath('/dev/specs');
  return { message: 'Vision saved.' };
}

/**
 * Deciding an edit the weekly vision review proposed (plan #1106).
 *
 * Both go through `decide_vision_edit` (migration 0108), which marks the edit
 * and, on accept, writes `module_visions` in the same transaction, so the page
 * never shows a new vision beside an edit still pending. The edit keeps the
 * vision as it stood, so an accepted one can still be read back.
 *
 * Accepting is its own action rather than a flag on one shared action, because
 * it also starts a re-shape of the workspace's open features (#1137): that
 * fire goes after the decision has landed, in `acceptVisionEdit` only.
 */

export type VisionEditActionState = {
  error?: string;
  message?: string;
};

const editIdSchema = z.string().uuid('That edit is not one this page can find.');

type Decided =
  | { state: VisionEditActionState; edit?: undefined }
  | { state: VisionEditActionState; edit: DecidedVisionEdit; userId: string; supabase: Db };

type Db = Awaited<ReturnType<typeof createClient>>;

async function decide(formData: FormData, accept: boolean): Promise<Decided> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = editIdSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { state: { error: id.error.issues[0].message } };

  const { error, edit } = await decideVisionEdit(supabase, id.data, accept);
  if (error) {
    // The function raises this when the edit is not pending any more: decided
    // in another tab, or superseded by a later review.
    if (error.includes('No pending vision edit')) {
      revalidatePath('/dev/specs');
      return { state: { error: 'That edit has already been decided.' } };
    }
    return { state: { error } };
  }

  revalidatePath('/dev/specs');
  // The Dash tab counts the edits waiting.
  revalidatePath('/dev/raised');
  const state = { message: accept ? 'Vision replaced.' : 'Edit dismissed.' };
  return edit ? { state, edit, userId: user.id, supabase } : { state };
}

/**
 * Re-read the workspace's open features against the vision just accepted
 * (plan #1137, following #1109's answer).
 *
 * One run of the plan routine for the whole workspace, however many features
 * are open in it, and a run that leaves only proposals and drop questions
 * (lib/plan/vision-reshape.ts says what it is told). The vision has already
 * been replaced by the time this runs, so a run that does not start loses
 * nothing but the re-read, and the message says so.
 */
async function reshapeAfterAccept(
  supabase: Db,
  userId: string,
  edit: DecidedVisionEdit,
): Promise<string> {
  const label = scopeLabel(edit.module);
  if (!edit.proposedBody) return 'Vision replaced.';

  const features = openFeaturesIn(buildPlanTree(await loadPlan(supabase, userId)), edit.module);
  if (features.length === 0) {
    return `Vision replaced. Nothing is open on the plan for ${label}, so there is nothing to re-shape.`;
  }

  const result = await startRoutineRun({
    supabase,
    userId,
    job: 'vision_reshape',
    routine: planRoutine(),
    text: visionReshapeText({
      scope: edit.module,
      before: edit.visionBody,
      after: edit.proposedBody,
      features,
    }),
  });
  if (!result.ok) {
    return `Vision replaced. The re-shape of the open features in ${label} did not start: ${result.error}`;
  }
  revalidatePath('/dev/plan');
  const count = `${features.length} open ${features.length === 1 ? 'feature' : 'features'}`;
  return `Vision replaced. Dash is re-reading the ${count} in ${label} against it; any changes come back as proposals on the plan.`;
}

// latency: pending
export async function acceptVisionEdit(
  _prev: VisionEditActionState,
  formData: FormData,
): Promise<VisionEditActionState> {
  const decided = await decide(formData, true);
  if (!decided.edit) return decided.state;
  return { message: await reshapeAfterAccept(decided.supabase, decided.userId, decided.edit) };
}

// latency: pending
export async function dismissVisionEdit(
  _prev: VisionEditActionState,
  formData: FormData,
): Promise<VisionEditActionState> {
  return (await decide(formData, false)).state;
}

/**
 * Deciding a change Dash proposed to a spec (plan #1506, docs/SPEC-LAYER-SPEC.md
 * Part 3).
 *
 * Both presses only record the answer here. Approving is its own action rather
 * than a flag on a shared one for the same reason accepting a vision edit is:
 * plan #1509 starts the run that commits the diff to docs/ and shapes the
 * change into work, and that start belongs after the decision has landed, in
 * `approveSpecChange` only.
 */

export type SpecChangeActionState = {
  error?: string;
  message?: string;
};

const changeIdSchema = z.string().uuid('That change is not one this page can find.');

async function decideChange(
  formData: FormData,
  decision: SpecChangeDecision,
): Promise<{ state: SpecChangeActionState; change?: SpecChange }> {
  const supabase = await createClient();
  const user = await requireOwner({ supabase });

  const id = changeIdSchema.safeParse(String(formData.get('id') ?? ''));
  if (!id.success) return { state: { error: id.error.issues[0].message } };

  const result = await decideSpecChange(supabase, user.id, id.data, decision);
  // Whether it failed or was decided elsewhere, the page should show the
  // change as it now stands.
  revalidatePath('/dev/specs');
  // Home lists the changes waiting on you and its tab counts them.
  revalidatePath('/dev/raised');
  if ('error' in result) return { state: { error: result.error } };

  return {
    state: {
      message:
        decision === 'approved'
          ? 'Approved. It stays on Specs until it is written into the spec.'
          : 'Declined.',
    },
    change: result.change,
  };
}

// latency: pending
export async function approveSpecChange(
  _prev: SpecChangeActionState,
  formData: FormData,
): Promise<SpecChangeActionState> {
  const decided = await decideChange(formData, 'approved');
  if (!decided.change) return decided.state;
  // Plan #1509 hooks in here: with the change approved, start the run that
  // commits `decided.change.diff` to docs/, marks it applied, and shapes it
  // into approved features (or an overhaul, per #1508's answer), then return
  // what that start says in place of the message below.
  return decided.state;
}

// latency: pending
export async function declineSpecChange(
  _prev: SpecChangeActionState,
  formData: FormData,
): Promise<SpecChangeActionState> {
  return (await decideChange(formData, 'declined')).state;
}
