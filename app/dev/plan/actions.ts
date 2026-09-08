'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, requireUser } from '@/lib/auth/server';
import { isModuleId, type ModuleId } from '@/lib/modules';
import { fireFeatureRoutine, planRoutineId } from '@/lib/feedback/routine';
import { planBrief } from '@/lib/plan/brief';
import {
  PLAN_ASSIGNEES,
  PLAN_PRIORITIES,
  PLAN_SIZES,
  PLAN_STATUSES,
  loadPlan,
} from '@/lib/plan/load';
import { PLAN_SEED } from '@/lib/plan/seed';
import { buildPlanTree, findNode, flatten } from '@/lib/plan/tree';

export type PlanActionState = {
  error?: string;
  message?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

function revalidatePlan(): void {
  revalidatePath('/dev/plan');
}

/** Empty string means "the app as a whole", the same as the ideas list. */
const moduleField = z
  .string()
  .max(40)
  .transform((value) => (value && isModuleId(value) ? value : null));

const statusField = z.enum(PLAN_STATUSES);

const priorityField = z.coerce
  .number()
  .refine((value): value is (typeof PLAN_PRIORITIES)[number] =>
    (PLAN_PRIORITIES as readonly number[]).includes(value),
  );

/** Empty means "not said", which is a real answer for a size and for who holds it. */
const sizeField = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === '' || (PLAN_SIZES as readonly string[]).includes(value), {
    message: 'That is not a size.',
  })
  .transform((value) => (value === '' ? null : value));

const assigneeField = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === '' || (PLAN_ASSIGNEES as readonly string[]).includes(value), {
    message: 'That is not somebody who builds this.',
  })
  .transform((value) => (value === '' ? null : value));

/** A uuid, or empty for "none" -- no parent, no dependency. */
const idOrNoneField = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value === '' || z.string().uuid().safeParse(value).success, {
    message: 'That is not a step.',
  })
  .transform((value) => (value === '' ? null : value));

const text = (max: number) => z.string().trim().max(max);

const titleField = z.string().trim().min(1, 'A step needs a name.').max(200);

function field(formData: FormData, name: string, fallback = ''): string {
  const value = formData.get(name);
  return value === null ? fallback : String(value);
}

/**
 * The end of a sibling list.
 *
 * A new step goes after its siblings rather than among them: the plan is
 * read top to bottom, a new step is almost always the next thing rather than
 * a forgotten early one, and anything else can be moved once it exists.
 * Positions are spaced by ten so that one can later be slotted between two
 * others without renumbering the rest.
 *
 * Siblings are the steps under the same parent, or -- at the top of a module
 * -- the module's other top-level steps. `.is(null)` rather than `.eq('')`
 * for the app-wide module: matching null against the empty string would find
 * nothing and restart the numbering at 10 on every add.
 */
async function nextPosition(
  supabase: Db,
  userId: string,
  module: ModuleId | null,
  parentId: string | null,
): Promise<number> {
  let query = supabase.from('plan_items').select('position').eq('user_id', userId);
  if (parentId) {
    query = query.eq('parent_id', parentId);
  } else {
    query = query.is('parent_id', null);
    query = module ? query.eq('module', module) : query.is('module', null);
  }
  const { data } = await query.order('position', { ascending: false }).limit(1);
  const last = (data ?? [])[0]?.position as number | undefined;
  return (last ?? 0) + 10;
}

/** The module a step's parent is in -- what a step under it must be in too. */
async function parentModule(
  supabase: Db,
  userId: string,
  parentId: string,
): Promise<{ ok: true; module: ModuleId | null } | { ok: false; error: string }> {
  const { data } = await supabase
    .from('plan_items')
    .select('module')
    .eq('user_id', userId)
    .eq('id', parentId)
    .maybeSingle();
  if (!data) return { ok: false, error: 'That parent step does not exist.' };
  const scope = data.module as string | null;
  return { ok: true, module: scope && isModuleId(scope) ? scope : null };
}

const addSchema = z.object({
  module: moduleField,
  parent: idOrNoneField,
  title: titleField,
  detail: text(4000).optional(),
  acceptance: text(4000).optional(),
  status: statusField,
  priority: priorityField,
  size: sizeField,
  assignee: assigneeField,
});

/**
 * A step of your own: at the top of a module, or under another step.
 *
 * A step under a parent takes the parent's module whatever the form said,
 * because a sub-step of a shopping feature that claimed to be a jobs step
 * would show up in neither place anyone looked for it.
 */
export async function addPlanItem(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = addSchema.safeParse({
    module: field(formData, 'module'),
    parent: field(formData, 'parent'),
    title: field(formData, 'title'),
    detail: field(formData, 'detail'),
    acceptance: field(formData, 'acceptance'),
    status: field(formData, 'status', 'not_started'),
    priority: field(formData, 'priority', '2'),
    size: field(formData, 'size'),
    assignee: field(formData, 'assignee'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let scope = parsed.data.module;
  if (parsed.data.parent) {
    const parent = await parentModule(supabase, user.id, parsed.data.parent);
    if (!parent.ok) return { error: parent.error };
    scope = parent.module;
  }

  const position = await nextPosition(supabase, user.id, scope, parsed.data.parent);

  const { error } = await supabase.from('plan_items').insert({
    user_id: user.id,
    module: scope,
    parent_id: parsed.data.parent,
    title: parsed.data.title,
    detail: parsed.data.detail || null,
    acceptance: parsed.data.acceptance || null,
    status: parsed.data.status,
    priority: parsed.data.priority,
    size: parsed.data.size,
    assignee: parsed.data.assignee,
    position,
  });
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: 'Added.' };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  parent: idOrNoneField,
  title: titleField,
  detail: text(4000).optional(),
  acceptance: text(4000).optional(),
  comment: text(4000).optional(),
  commit: text(64).optional(),
  status: statusField,
  priority: priorityField,
  size: sizeField,
  assignee: assigneeField,
});

/**
 * The whole step at once: what it is, where it stands, and your note on it.
 *
 * Moving it under a different parent is part of the same save. A moved step
 * goes to the end of its new siblings and takes its new parent's module; the
 * database refuses a parent that is the step's own descendant, and that
 * refusal is shown rather than swallowed.
 */
export async function updatePlanItem(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    parent: field(formData, 'parent'),
    title: field(formData, 'title'),
    detail: field(formData, 'detail'),
    acceptance: field(formData, 'acceptance'),
    comment: field(formData, 'comment'),
    commit: field(formData, 'commit'),
    status: field(formData, 'status', 'not_started'),
    priority: field(formData, 'priority', '2'),
    size: field(formData, 'size'),
    assignee: field(formData, 'assignee'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data: current } = await supabase
    .from('plan_items')
    .select('parent_id, module')
    .eq('user_id', user.id)
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!current) return { error: 'That step no longer exists.' };

  const patch: Record<string, unknown> = {
    title: parsed.data.title,
    detail: parsed.data.detail || null,
    acceptance: parsed.data.acceptance || null,
    comment: parsed.data.comment || null,
    commit_sha: parsed.data.commit || null,
    status: parsed.data.status,
    priority: parsed.data.priority,
    size: parsed.data.size,
    assignee: parsed.data.assignee,
  };

  const currentParent = (current.parent_id as string | null) ?? null;
  if (parsed.data.parent !== currentParent) {
    if (parsed.data.parent === parsed.data.id) {
      return { error: 'A step cannot be its own parent.' };
    }
    const stored = current.module as string | null;
    let scope: ModuleId | null = stored && isModuleId(stored) ? stored : null;
    if (parsed.data.parent) {
      const parent = await parentModule(supabase, user.id, parsed.data.parent);
      if (!parent.ok) return { error: parent.error };
      scope = parent.module;
    }
    patch.parent_id = parsed.data.parent;
    patch.module = scope;
    patch.position = await nextPosition(supabase, user.id, scope, parsed.data.parent);
  }

  const { error } = await supabase
    .from('plan_items')
    .update(patch)
    .eq('id', parsed.data.id)
    .eq('user_id', user.id);
  if (error) return { error: friendly(error.message) };

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

/**
 * Say yes to a proposal.
 *
 * The step and every proposed step beneath it become not started, in one
 * click, because a feature is approved as a whole: the person who wants two
 * of its five steps drops the other three first, and the page is where that
 * happens. Steps beneath it that are already decided on are left alone.
 * This is the one move a session never makes.
 */
export async function approvePlanItem(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing step.' };

  const sections = buildPlanTree(await loadPlan(supabase, user.id));
  const node = findNode(sections, id.data);
  if (!node) return { error: 'That step no longer exists.' };

  const ids = flatten([node])
    .filter((step) => step.status === 'proposed')
    .map((step) => step.id);
  if (ids.length === 0) return { message: 'Nothing left to approve there.' };

  const { error } = await supabase
    .from('plan_items')
    .update({ status: 'not_started' })
    .in('id', ids)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: ids.length === 1 ? 'Approved.' : `Approved ${ids.length} steps.` };
}

/** Hand a step to Claude, or take it back, in one click. */
export async function setPlanItemAssignee(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const assignee = assigneeField.safeParse(field(formData, 'assignee'));
  if (!id.success || !assignee.success) return { error: 'Missing step or assignee.' };

  const { error } = await supabase
    .from('plan_items')
    .update({ assignee: assignee.data })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: assignee.data === 'claude' ? 'Handed to Claude.' : 'Updated.' };
}

/**
 * One place up or down among its siblings.
 *
 * Positions are re-dealt in tens across the whole sibling list after the
 * swap rather than only the two rows exchanged, because the seed and the
 * migration both left rows that share a position, and swapping two equal
 * numbers moves nothing. Re-dealing costs a handful of writes on a list that
 * is a handful long.
 */
export async function movePlanItem(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const direction = z.enum(['up', 'down']).safeParse(formData.get('direction'));
  if (!id.success || !direction.success) return { error: 'Missing step or direction.' };

  const { data: row } = await supabase
    .from('plan_items')
    .select('parent_id, module')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .maybeSingle();
  if (!row) return { error: 'That step no longer exists.' };

  let query = supabase
    .from('plan_items')
    .select('id, position')
    .eq('user_id', user.id);
  if (row.parent_id) {
    query = query.eq('parent_id', row.parent_id as string);
  } else {
    query = query.is('parent_id', null);
    query = row.module ? query.eq('module', row.module as string) : query.is('module', null);
  }
  const { data: siblings } = await query
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  const order = (siblings ?? []).map((s) => s.id as string);
  const index = order.indexOf(id.data);
  const target = direction.data === 'up' ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= order.length) {
    return { message: 'Already there.' };
  }
  [order[index], order[target]] = [order[target], order[index]];

  const writes = order.map((itemId, i) =>
    supabase
      .from('plan_items')
      .update({ position: (i + 1) * 10 })
      .eq('id', itemId)
      .eq('user_id', user.id),
  );
  const failed = (await Promise.all(writes)).find((result) => result.error);
  if (failed?.error) return { error: failed.error.message };

  revalidatePlan();
  return { message: 'Moved.' };
}

/** Deleting a step takes its sub-steps with it; the confirm says how many. */
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

/** "Cannot start until that one is done." */
export async function addPlanDependency(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const item = z.string().uuid().safeParse(formData.get('item'));
  const dependsOn = z.string().uuid().safeParse(formData.get('depends_on'));
  if (!item.success || !dependsOn.success) return { error: 'Pick a step to wait on.' };
  if (item.data === dependsOn.data) return { error: 'A step cannot wait on itself.' };

  const { error } = await supabase.from('plan_dependencies').insert({
    user_id: user.id,
    item_id: item.data,
    depends_on_id: dependsOn.data,
  });
  if (error) return { error: friendly(error.message) };

  revalidatePlan();
  return { message: 'Added.' };
}

export async function removePlanDependency(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing dependency.' };

  const { error } = await supabase
    .from('plan_dependencies')
    .delete()
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: 'Removed.' };
}

/**
 * Hand a step to Claude and start the routine on it now.
 *
 * The same rope the notes queue pulls -- `fireFeatureRoutine` -- with the
 * step's brief as the extra turn, so the session that wakes up knows which
 * step it is for and everything the plan says about it. The step is marked
 * as Claude's first, whatever happens to the request after: a routine that
 * fails to start is a thing to retry, and the plan should already say who it
 * was meant for.
 */
export async function sendPlanItemToClaude(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing step.' };

  const data = await loadPlan(supabase, user.id);
  const sections = buildPlanTree(data);
  const node = findNode(sections, id.data);
  if (!node) return { error: 'That step no longer exists.' };

  if (node.assignee !== 'claude') {
    const { error } = await supabase
      .from('plan_items')
      .update({ assignee: 'claude' })
      .eq('id', node.id)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
    revalidatePlan();
  }

  const text =
    `Build plan step #${node.number}, "${node.title}", following .claude/skills/plan/SKILL.md. ` +
    'The brief is below; it is the plan as the app holds it right now, and the plan is the ' +
    'source of truth -- claim the step, build it, verify, commit with the step number in the ' +
    'subject, and close it with a note.\n\n' +
    planBrief(sections, node);

  const result = await fireFeatureRoutine({
    apiKey: process.env.CLAUDE_API_KEY ?? null,
    routineId: planRoutineId(),
    text,
  });
  if (!result.ok) return { error: result.error };
  return { message: `Sent. ${result.detail}` };
}

/**
 * Write the build order in, once.
 *
 * Deliberately a button rather than something that happens on first render.
 * Seeding is a write, and a write that happens because you looked at a page is
 * one nobody can decline -- this way the empty plan explains what it is about
 * to do and you say when.
 *
 * It refuses when the plan already holds anything, which is what makes it safe
 * to press twice: the alternative, adding forty rows beside forty identical
 * ones, is exactly the mess that would make somebody abandon the page.
 *
 * Every seeded step lands at the top of its module. The build order was
 * written flat, and nesting it is a judgement the page exists to let you make
 * afterwards, one move at a time.
 */
export async function seedPlan(
  // Signature is fixed by useActionState; the button sends nothing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: PlanActionState, _formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const { count } = await supabase
    .from('plan_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  if (count) {
    return { error: 'There is already a plan here. Delete it first if you want to start over.' };
  }

  // Spaced by ten, and numbered within the module rather than across the whole
  // seed, so each module's list starts at the top. The step numbers themselves
  // come from the trigger, in the order the rows are given.
  const byModule = new Map<string, number>();
  const rows = PLAN_SEED.map((step) => {
    const key = step.module ?? '';
    const next = (byModule.get(key) ?? 0) + 10;
    byModule.set(key, next);
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
  return { message: `Imported ${rows.length} steps from the build order.` };
}

/**
 * The database's refusals, in the page's words.
 *
 * The triggers raise with a sentence already, but PostgREST wraps a unique
 * violation in its own phrasing, and "duplicate key value violates unique
 * constraint" is not something a person should have to read.
 */
function friendly(message: string): string {
  if (/plan_dependencies_pair_key/.test(message)) return 'It already waits on that step.';
  return message;
}
