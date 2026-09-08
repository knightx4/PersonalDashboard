'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { isModuleId } from '@/lib/modules';
import { PLAN_STATUSES } from '@/lib/plan/load';
import { seedStepsMissingFrom } from '@/lib/plan/seed';

export type PlanActionState = {
  error?: string;
  message?: string;
};

function revalidatePlan(): void {
  revalidatePath('/dev/plan');
}

/** Empty string means "the app as a whole", the same as the ideas list. */
const moduleField = z
  .string()
  .max(40)
  .transform((value) => (value && isModuleId(value) ? value : null));

const statusField = z.enum(PLAN_STATUSES);

const addSchema = z.object({
  module: moduleField,
  title: z.string().trim().min(1, 'A step needs a name.').max(200),
  detail: z.string().trim().max(4000).optional(),
  status: statusField,
});

/**
 * A step of your own.
 *
 * Added at the end of its module rather than in the middle: the plan is read
 * top to bottom, a new step is almost always the next thing rather than a
 * forgotten early one, and anything else can be dragged into place by editing
 * the number in its title — which is where the numbering actually lives.
 *
 * Positions are spaced by ten so that one can later be slotted between two
 * others without renumbering the rest.
 */
export async function addPlanItem(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = addSchema.safeParse({
    module: String(formData.get('module') ?? ''),
    title: String(formData.get('title') ?? ''),
    detail: String(formData.get('detail') ?? ''),
    status: String(formData.get('status') ?? 'not_started'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // `.is(null)` rather than `.eq('')`: an app-wide step has a null module, and
  // matching it against the empty string would find nothing and restart the
  // numbering at 10 on every add.
  const withinModule = supabase
    .from('plan_items')
    .select('position')
    .eq('user_id', user.id);

  const { data: siblings } = await (
    parsed.data.module
      ? withinModule.eq('module', parsed.data.module)
      : withinModule.is('module', null)
  )
    .order('position', { ascending: false })
    .limit(1);

  const last = (siblings ?? [])[0]?.position as number | undefined;

  const { error } = await supabase.from('plan_items').insert({
    user_id: user.id,
    module: parsed.data.module,
    title: parsed.data.title,
    detail: parsed.data.detail || null,
    status: parsed.data.status,
    position: (last ?? 0) + 10,
  });
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: 'Added.' };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1, 'A step needs a name.').max(200),
  detail: z.string().trim().max(4000).optional(),
  comment: z.string().trim().max(4000).optional(),
  status: statusField,
});

/** The whole step at once: what it is, where it stands, and your note on it. */
export async function updatePlanItem(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    title: String(formData.get('title') ?? ''),
    detail: String(formData.get('detail') ?? ''),
    comment: String(formData.get('comment') ?? ''),
    status: String(formData.get('status') ?? 'not_started'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await supabase
    .from('plan_items')
    .update({
      title: parsed.data.title,
      detail: parsed.data.detail || null,
      comment: parsed.data.comment || null,
      status: parsed.data.status,
    })
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: 'Saved.' };
}

/**
 * Move a step between states without opening it.
 *
 * The one thing this page is for is answering "where is this", so changing the
 * answer is one click from the list rather than a form you have to open, fill
 * and submit.
 */
export async function setPlanItemStatus(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = statusField.safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'Missing step or status.' };

  const { error } = await supabase
    .from('plan_items')
    .update({ status: status.data })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: 'Updated.' };
}

export async function deletePlanItem(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing step.' };

  const { error } = await supabase
    .from('plan_items')
    .delete()
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: 'Deleted.' };
}

/**
 * Write the build order in, and later bring in what has been added to it.
 *
 * Deliberately a button rather than something that happens on first render.
 * Seeding is a write, and a write that happens because you looked at a page is
 * one nobody can decline — this way the empty plan explains what it is about to
 * do and you say when.
 *
 * Pressing it again is safe and useful rather than merely harmless. It adds
 * only the steps the plan does not already have, matched on module and title,
 * and touches nothing that is there: a step you marked done stays done, a
 * comment you wrote stays written, a title you rewrote is left alone. That is
 * what makes it possible to plan a new slice where the specs live — in a file,
 * next to the reasoning — and then work it here, rather than retyping six long
 * steps into a form.
 */
export async function seedPlan(
  // Signature is fixed by useActionState; the button sends nothing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: PlanActionState, _formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error: readError } = await supabase
    .from('plan_items')
    .select('module, title, position')
    .eq('user_id', user.id);
  if (readError) return { error: readError.message };

  const existing = (data ?? []) as { module: string | null; title: string; position: number }[];
  const missing = seedStepsMissingFrom(existing);

  if (missing.length === 0) {
    return { message: 'Nothing new — the plan already holds every step in the build order.' };
  }

  // New steps go after whatever that module already has, spaced by ten so one
  // can later be slotted between two others without renumbering the rest. On an
  // empty plan this is 10, 20, 30 within each module, which is where the
  // numbering came from in the first place.
  const lastByModule = new Map<string, number>();
  for (const row of existing) {
    const key = row.module ?? 'app';
    lastByModule.set(key, Math.max(lastByModule.get(key) ?? 0, row.position ?? 0));
  }

  const rows = missing.map((step) => {
    const key = step.module ?? 'app';
    const next = (lastByModule.get(key) ?? 0) + 10;
    lastByModule.set(key, next);
    return {
      user_id: user.id,
      module: step.module,
      title: step.title,
      detail: step.detail,
      status: step.status,
      position: next,
    };
  });

  const { error } = await supabase.from('plan_items').insert(rows);
  if (error) return { error: error.message };

  revalidatePlan();
  return {
    message:
      existing.length === 0
        ? `Imported ${rows.length} steps from the build order.`
        : `Added ${rows.length} ${rows.length === 1 ? 'step' : 'steps'} written since the last import.`,
  };
}
