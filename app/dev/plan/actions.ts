'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, requireUser } from '@/lib/auth/server';
import { isModuleId, type ModuleId } from '@/lib/modules';
import { planRoutine, type FireRoutineResult } from '@/lib/feedback/routine';
import {
  DISMISSAL_RULE,
  FOG_RULE,
  PLAIN_ENGLISH_RULE,
  dismissedUnder,
  planBrief,
  planQueueBrief,
} from '@/lib/plan/brief';
import { loadDismissedSuggestions } from '@/lib/ideas/load';
import {
  PLAN_ASSIGNEES,
  PLAN_KINDS,
  PLAN_PRIORITIES,
  PLAN_SIZES,
  PLAN_STATUSES,
  isClosed,
  isDismissed,
  loadPlan,
  type PlanStatus,
} from '@/lib/plan/load';
import { hasLiveClaim } from '@/lib/plan/elapsed';
import { handStepToClaude } from '@/lib/plan/handover';
import { nextPlanPosition } from '@/lib/plan/position';
import { startRoutineRun } from '@/lib/plan/runs';
import { PLAN_SEED } from '@/lib/plan/seed';
import {
  buildPlanTree,
  findNode,
  flatten,
  handedToClaude,
  isWaitingOnThePerson,
  topFeatureOf,
  type PlanNode,
  type PlanSection,
} from '@/lib/plan/tree';

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

/**
 * What closing it will mean. Only the add form sends this, and only to raise a
 * question: everything else on the page adds work, and a step that changed
 * kind under an edit would be a done step whose commit had stopped counting.
 */
const kindField = z.enum(PLAN_KINDS);

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
  kind: kindField,
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
// latency: pending
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
    kind: field(formData, 'kind', 'build'),
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

  const position = await nextPlanPosition(supabase, user.id, scope, parsed.data.parent);

  const { error } = await supabase.from('plan_items').insert({
    user_id: user.id,
    module: scope,
    parent_id: parsed.data.parent,
    title: parsed.data.title,
    detail: parsed.data.detail || null,
    acceptance: parsed.data.acceptance || null,
    status: parsed.data.status,
    kind: parsed.data.kind,
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
  fog: text(4000).optional(),
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
// latency: pending
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
    fog: field(formData, 'fog'),
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
    .select('parent_id, module, fog')
    .eq('user_id', user.id)
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!current) return { error: 'That step no longer exists.' };

  const patch: Record<string, unknown> = {
    title: parsed.data.title,
    detail: parsed.data.detail || null,
    acceptance: parsed.data.acceptance || null,
    // Emptied is cleared, not blanked: fog is meant to disappear the moment
    // the steps that dispel it exist, and null is what "there is none" reads
    // as everywhere else it is asked about.
    fog: parsed.data.fog || null,
    comment: parsed.data.comment || null,
    commit_sha: parsed.data.commit || null,
    status: parsed.data.status,
    priority: parsed.data.priority,
    size: parsed.data.size,
    assignee: parsed.data.assignee,
  };

  // A rewritten patch of fog is a new admission, and nobody has put that one
  // aside. Leaving the dismissal on it would hide the new text the moment it
  // was written.
  if ((parsed.data.fog || null) !== ((current.fog as string | null) ?? null)) {
    patch.fog_dismissed_at = null;
  }

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
    patch.position = await nextPlanPosition(supabase, user.id, scope, parsed.data.parent);
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
// latency: pending
export async function setPlanItemStatus(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const status = statusField.safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'Missing step or status.' };

  // Two of the statuses need the row as it stands: done reads its fog, and
  // in progress reads who has it. The rest are one write and no read.
  const needsCurrent = status.data === 'done' || status.data === 'in_progress';
  const { data: current } = needsCurrent
    ? await supabase
        .from('plan_items')
        .select('number, fog, fog_dismissed_at, assignee')
        .eq('user_id', user.id)
        .eq('id', id.data)
        .maybeSingle()
    : { data: null };

  // Fog says part of this step was never specified. Closing it as done
  // leaves that admission sitting on finished work, where nothing looks at
  // it again -- which is how three features shipped still carrying theirs.
  // Graduate it into steps, or clear it, then close.
  // Unless you have put that patch aside, which is the other way out: "not
  // right now" said about the gap itself, recorded and findable.
  if (status.data === 'done' && current?.fog && !current.fog_dismissed_at) {
    return {
      error: `#${current.number} still says part of it is not specified. Write the steps that patch covers, or clear it, then close this.`,
    };
  }

  // Blocking a step takes it back off Claude in the same write.
  //
  // A block says the step needs something outside the repo, so nothing a
  // session does will move it -- and a row left assigned sits in the Claude's
  // view carrying the reason it cannot be worked. Whoever blocks it should not
  // have to remember to unhand it as a second step.
  const patch: Record<string, string | null> = { status: status.data };
  if (status.data === 'blocked') patch.assignee = null;

  // Marking a step underway yourself puts it in your queue, if it was in
  // nobody's.
  //
  // `in_progress` means somebody has this step in hand right now, and the
  // daily cron puts back a claim with no assignee on exactly that reading --
  // nothing is working it. Moving the row here is you working it, so the row
  // says so and the sweep leaves it alone. A step already handed to Claude
  // keeps its assignee: pressing the status control is not taking it back.
  if (status.data === 'in_progress' && !current?.assignee) patch.assignee = 'me';

  const { error } = await supabase
    .from('plan_items')
    .update(patch)
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return { message: status.data === 'blocked' ? 'Blocked, and taken back off Dash.' : 'Updated.' };
}

/** "1" puts something aside; anything else brings it back. */
function dismissing(formData: FormData): boolean {
  return String(formData.get('dismissed') ?? '') === '1';
}

/**
 * Not right now, said about a question.
 *
 * The third way out of a decision, and the one that was missing. Answering it
 * writes something every session beneath the feature builds against, so an
 * answer you do not mean is the most expensive thing on this page. Withdrawing
 * it says the question stopped mattering, which is a claim about the question
 * rather than about your afternoon. This says neither: the question is still
 * open and still unanswered, and it is out of the plan until you go and get
 * it. #340 settled that it is hidden rather than closed, and the Dismissed
 * view is where it is found.
 *
 * Only an open question. A settled one has an answer and a withdrawn one has
 * a reason, and hiding either would be hiding the record rather than the ask.
 */
// latency: pending
export async function dismissPlanDecision(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing step.' };
  const aside = dismissing(formData);

  const { data: current } = await supabase
    .from('plan_items')
    .select('number, kind, status')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .maybeSingle();
  if (!current) return { error: 'That step no longer exists.' };

  if (aside && current.kind !== 'decision') {
    return {
      error:
        `#${current.number} is a step, not a question. ` +
        'A step you are not doing is dropped, with the reason.',
    };
  }
  if (aside && isClosed(current.status as PlanStatus)) {
    return { error: `#${current.number} is already settled.` };
  }

  const { error } = await supabase
    .from('plan_items')
    .update({ dismissed_at: aside ? new Date().toISOString() : null })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return {
    message: aside
      ? `#${current.number} put aside. It is under Dismissed when you want it.`
      : `#${current.number} is back.`,
  };
}

/**
 * The same, said about a patch of fog.
 *
 * Its own column rather than the row's, because a feature whose fog you have
 * put aside is otherwise a live feature with live steps: dismissing the row
 * would take the work with it. What it stops is the asking -- the patch leaves
 * the page, leaves the Not specified view, is not written into any turn, and
 * no longer holds the step open when you close it.
 *
 * Rewriting the patch brings it back, in `updatePlanItem` and in the CLI. A
 * new admission is not one anybody has put aside yet.
 */
// latency: pending
export async function dismissPlanFog(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing step.' };
  const aside = dismissing(formData);

  const { data: current } = await supabase
    .from('plan_items')
    .select('number, fog')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .maybeSingle();
  if (!current) return { error: 'That step no longer exists.' };
  if (!current.fog) return { error: `#${current.number} says nothing is unspecified.` };

  const { error } = await supabase
    .from('plan_items')
    .update({ fog_dismissed_at: aside ? new Date().toISOString() : null })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  return {
    message: aside
      ? `#${current.number}'s fog put aside. It is under Dismissed when you want it.`
      : `#${current.number}'s fog is back.`,
  };
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
// latency: pending
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

/**
 * Hand a step to Claude, or take it back, in one click.
 *
 * The step and every open step beneath it, for the same reason approving works
 * that way: work is handed over as a whole, and marking five sub-steps one at
 * a time is how four of them get missed. Closed steps are left alone -- who
 * was going to do a finished thing is history, not an instruction.
 *
 * A proposed step can be handed over. This column says who a step is for, not
 * that it has been agreed to, and nothing picks up a proposal: `next --claude`
 * lists approved steps only.
 */
// latency: pending
export async function setPlanItemAssignee(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  const assignee = assigneeField.safeParse(field(formData, 'assignee'));
  if (!id.success || !assignee.success) return { error: 'Missing step or assignee.' };

  const sections = buildPlanTree(await loadPlan(supabase, user.id));
  const node = findNode(sections, id.data);
  if (!node) return { error: 'That step no longer exists.' };

  // The step itself whatever state it is in -- you asked for this one -- and
  // the open ones beneath it.
  const candidates = [
    node,
    ...flatten([node]).filter((step) => step.id !== node.id && !isClosed(step.status)),
  ];

  // Nothing waiting on you goes to Claude. An unanswered question is yours to
  // settle and a blocked step needs something outside the repo, so handing
  // either over puts a session in front of the same wall -- and fills the
  // Claude's view with rows nobody can work.
  //
  // Only when handing over. Taking work back is always allowed, whatever state
  // it is in, because that is how a row that should never have been handed
  // over gets unhanded.
  const skipped =
    assignee.data === 'claude' ? candidates.filter((step) => isWaitingOnThePerson(step)) : [];
  const ids = candidates
    .filter((step) => !skipped.some((other) => other.id === step.id))
    .map((step) => step.id);

  if (ids.length === 0) {
    return {
      error: `#${node.number} is ${node.status === 'blocked' ? 'blocked' : 'a question nobody has answered'}, so it is waiting on you rather than on Dash.`,
    };
  }

  const { error } = await supabase
    .from('plan_items')
    .update({ assignee: assignee.data })
    .in('id', ids)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();
  if (assignee.data !== 'claude') {
    return { message: ids.length === 1 ? 'Taken back.' : `Took back ${ids.length} steps.` };
  }

  const left = skipped.length === 0 ? '' : ` ${skipped.length} left with you: ${skipped.map((step) => `#${step.number}`).join(', ')}.`;
  return {
    message:
      (ids.length === 1 ? 'Handed to Dash.' : `Handed ${ids.length} steps to Dash.`) + left,
  };
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
// latency: pending
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

/**
 * Settle a decision.
 *
 * The other way a step closes. A build step closes on a commit; a decision
 * closes on an answer, in the person's words, recorded in `resolution` where
 * every brief beneath the feature will carry it from then on. `commit_sha`
 * stays null, because nothing was built.
 *
 * Two refusals, and both are the point. A step that is not a decision cannot
 * be answered -- the form is only rendered on a decision, so reaching here
 * with a build step means the id was forged, and answering it would leave a
 * step that reads done with no commit and no work behind it. And an empty
 * answer is refused: a question closed on nothing is exactly what this
 * feature exists to stop, and it would be worse than the question staying
 * open, because it would stop looking like a question.
 *
 * The dated line on the comment is the same one the CLI writes, so a decision
 * answered on the page and one answered from a terminal read the same.
 */
// latency: pending
export async function answerPlanDecision(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing step.' };

  const answer = text(4000).safeParse(field(formData, 'answer'));
  if (!answer.success) return { error: 'That answer is too long.' };
  if (!answer.data) return { error: 'An answer is what closes a decision. Say what you decided.' };

  const { data: current } = await supabase
    .from('plan_items')
    .select('kind, comment')
    .eq('user_id', user.id)
    .eq('id', id.data)
    .maybeSingle();
  if (!current) return { error: 'That step no longer exists.' };
  if (current.kind !== 'decision') {
    return { error: 'That step is work, not a question. It closes on a commit.' };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const line = `Answered ${stamp}: ${answer.data}`;
  const comment = current.comment ? `${current.comment}\n\n${line}` : line;

  const { error } = await supabase
    .from('plan_items')
    .update({ status: 'done', resolution: answer.data, comment, commit_sha: null })
    .eq('id', id.data)
    .eq('user_id', user.id);
  if (error) return { error: error.message };

  revalidatePlan();

  // The last answer under a feature starts the re-shape.
  //
  // #96 chose a button over firing on every answer, to stop three answers in
  // one sitting starting three runs that raced each other. Ten days of that
  // button never being pressed says the cost was the wrong way round: the
  // races were hypothetical and the forgetting was not.
  //
  // Firing on the *last* open question fixes both. You settle three questions
  // and one run starts, when the feature has every answer it was waiting for.
  // Answer a fourth later and it starts again, which is correct: there is new
  // information and the feature has not been read against it.
  const after = buildPlanTree(await loadPlan(supabase, user.id));
  const answered = findNode(after, id.data);
  if (!answered) return { message: 'Answered.' };

  const feature = topFeatureOf(after, answered);
  // A question put aside is not one the feature is still waiting on, so it
  // does not hold the re-shape back for ever.
  const stillOpen = flatten([feature]).filter(
    (step) => step.kind === 'decision' && !isClosed(step.status) && !isDismissed(step),
  ).length;

  if (stillOpen > 0) {
    return {
      message: `Answered. ${stillOpen} more ${stillOpen === 1 ? 'question' : 'questions'} under #${feature.number}; the re-shape starts when the last one is answered.`,
    };
  }
  if (feature.status === 'proposed' || feature.children.length === 0) {
    return { message: 'Answered.' };
  }

  // A re-shape that will not start loses nothing: the answer is already
  // recorded, and the button is still there.
  const started = await startReshape(
    supabase,
    user.id,
    after,
    feature,
    dismissedUnder(feature, await loadDismissedSuggestions(supabase, user.id, feature.id)),
  );
  return {
    message: started.ok
      ? `Answered, and re-shaping #${feature.number} against everything settled under it. What comes back is proposed.`
      : `Answered. The re-shape did not start: ${started.error}`,
  };
}

/** Deleting a step takes its sub-steps with it; the confirm says how many. */
// latency: pending
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
// latency: pending
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

// latency: pending
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
 * The same rope the notes queue pulls -- `startRoutineRun` -- with the
 * step's brief as the extra turn, so the session that wakes up knows which
 * step it is for and everything the plan says about it. The step is marked
 * as Claude's first, whatever happens to the request after: a routine that
 * fails to start is a thing to retry, and the plan should already say who it
 * was meant for.
 */
// latency: pending
export async function sendPlanItemToClaude(
  _prev: PlanActionState,
  formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing step.' };

  // Every rule about what may be sent is in lib/plan/handover.ts, because a
  // comment can now ask for the same thing and the two ways in have to refuse
  // the same steps.
  const sent = await handStepToClaude({ supabase, userId: user.id, id: id.data });
  if (!sent.ok) return { error: sent.error };
  if (sent.changed) revalidatePlan();

  // What went with it, when something did. "Sent." on its own said nothing
  // about the subtree that travelled in the brief.
  return {
    message:
      sent.beneath === 0
        ? `Sent #${sent.number}. ${sent.detail}`
        : `Sent #${sent.number}, with ${sent.beneath} ${sent.beneath === 1 ? 'step' : 'steps'} beneath it. ${sent.detail}`,
  };
}

/**
 * Hand a whole feature over and start the routine on it now.
 *
 * The step-at-a-time button is right when you are watching; a feature of seven
 * steps pressed seven times is not. So this one cascades -- every open step
 * beneath becomes Claude's, the way approving cascades -- and fires once with
 * the feature's brief, which already carries its steps and what each waits on.
 * The session works them in order and stops at the first thing it should not
 * decide alone.
 *
 * It refuses a proposal, because a proposal is not work yet, and it refuses a
 * feature with nothing open beneath it, because there would be nothing to do.
 * Proposed steps beneath an approved feature are left alone rather than swept
 * in: a step nobody has said yes to is not part of the batch.
 */
// latency: pending
export async function sendPlanFeatureToClaude(
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

  if (node.status === 'proposed') {
    return { error: `#${node.number} is only a proposal. Approve it first.` };
  }

  // The same one-at-a-time rule as the single send. A batch started on top of
  // a running session is the worse version of the same collision, since it
  // hands the whole feature to a second run.
  const running = flatten([node]).find((step) => hasLiveClaim(step, Date.now()));
  if (running) {
    return {
      error: `#${running.number} ${running.title} is already underway. Wait for it, or put it back to not started if its session is gone.`,
    };
  }

  // Itself included: a feature is closed when its steps are, and the session
  // needs it to be its own to close.
  //
  // Minus whatever is waiting on the person. A batch that swept up the
  // feature's unanswered questions and its blocked steps handed a session rows
  // it could do nothing with, and left them sitting in the Claude's view saying
  // why they could not be worked.
  const open = flatten([node]).filter(
    (step) =>
      !isClosed(step.status) && step.status !== 'proposed' && !isWaitingOnThePerson(step),
  );
  if (open.length === 0) return { error: 'Nothing open under that step that is not waiting on you.' };

  const toHandOver = open.filter((step) => step.assignee !== 'claude').map((step) => step.id);
  if (toHandOver.length > 0) {
    const { error } = await supabase
      .from('plan_items')
      .update({ assignee: 'claude' })
      .in('id', toHandOver)
      .eq('user_id', user.id);
    if (error) return { error: error.message };
    revalidatePlan();
  }

  // Handed over, and that is all. Nothing here is marked underway.
  //
  // This used to set every open step in the feature to `in_progress` on the
  // press, so that the plan showed the batch as work in hand. What it actually
  // showed was six lies and one truth: the session works the steps one at a
  // time, and everything it had not reached yet -- everything it never reached,
  // when a batch ran short or the run died -- sat there reading "in progress"
  // with nothing on it. That is the bug behind note 60a0ad01, and there is no
  // clock that fixes it, because the rows were never true in the first place.
  //
  // `in_progress` now means one thing: a session has claimed this step and is
  // on it. The session sets it when it claims, one at a time, and clears it
  // when it closes the step -- which is what the plan skill already tells it to
  // do. "Handed to Claude" is a separate fact and has its own state:
  // `assignee`, set above, which is exactly what this press changes and what
  // the queue is built from.
  const steps = open.length - 1;
  const text =
    `Work plan feature #${node.number}, "${node.title}", to completion, following ` +
    '.claude/skills/plan/SKILL.md. Build its steps ONE AT A TIME in the order the plan ' +
    'gives, each verified, committed and closed before the next is claimed, and keep ' +
    'going until every step beneath it is closed, something blocks, or the session is ' +
    'running short. Stop at the first step that needs a decision from me: block it with ' +
    'the exact question rather than guessing, and do not skip past it to a later step. ' +
    'Push once at the end of the batch and report every step you closed, by number and ' +
    'title.\n\nThe brief is below; it is the plan as the app holds it right now, and ' +
    'the plan is the source of truth.\n\n' +
    planBrief(sections, node, { thread: true });

  const result = await startRoutineRun({
    supabase,
    userId: user.id,
    job: 'feature',
    routine: planRoutine(),
    planItemId: node.id,
    text,
  });
  if (!result.ok) return { error: result.error };
  return {
    message: `Sent #${node.number} and its ${steps === 1 ? 'step' : `${steps} steps`}. ${result.detail}`,
  };
}

/**
 * Re-shape a feature against what has been decided since it was written.
 *
 * The return trip. Shaping runs once, before anything is built, and from then
 * on the feature is a fixed drawing of a thing that is still moving: fog is
 * written and never read again, and an answer that makes half the plan wrong
 * changes nothing but its own row. This is the press that re-reads the feature
 * against everything settled beneath it.
 *
 * On request rather than on every answer, which is #96: you settle three
 * questions in one sitting and then press this once, so one session reads all
 * three together instead of three racing each other over the same feature. It
 * is also why answering is untouched -- the answer is recorded by its own
 * action, and a re-shape that cannot be started loses nothing, because there
 * was never anything riding on the same request.
 *
 * Nothing is assigned and nothing is started, unlike the two hand-over buttons
 * above. A re-shape does not build; it proposes, and what it proposes waits
 * for the same approve as anything else.
 *
 * It refuses a proposal -- there is nothing agreed there to adapt -- and a leaf
 * step, which has nothing beneath it to re-read.
 */
/**
 * Start a re-shape of one feature.
 *
 * Shared by the button and by the last answer, so both send the same
 * instruction and a change to it cannot apply to only one of them.
 */
async function startReshape(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  sections: readonly PlanSection[],
  node: PlanNode,
  /** What has been put aside under this feature, written out. Empty for none. */
  dismissed: string,
): Promise<FireRoutineResult> {
  // A feature that has already shipped does not take new rows. Re-shaping one
  // is legitimate -- an answer can land under it long after it closed -- but
  // everything the re-shape finds is new work, not an amendment to a closed
  // feature, so it goes at the top level with a line back to where it came
  // from. Nesting it was the bug: a feature reading "Done" quietly grew a
  // proposal inside it, which reads as the feature having re-opened itself.
  const closed = isClosed(node.status);
  const where = closed
    ? 'as a NEW top-level feature (no --parent), because ' +
      `#${node.number} has already shipped and a closed feature takes no new rows`
    : 'beneath the feature';

  const text =
    `Re-shape plan feature #${node.number}, "${node.title}", following ` +
    '.claude/skills/plan/SKILL.md. This is the re-shape job, not the build job: read the ' +
    'feature against every answer settled beneath it and against what the code now says, ' +
    'and write what has changed.\n\n' +
    (closed
      ? `#${node.number} is ${node.status}. It is finished, and nothing new may be added ` +
        'inside it -- not a step, not a decision, not a graduated fog step. Anything this ' +
        're-shape turns up is new work: raise it as its own top-level feature whose detail ' +
        `opens by saying it came out of #${node.number}, and put the steps and questions ` +
        'under that. The only write this re-shape makes to the closed feature itself is ' +
        `clearing its fog patch (plan.ts fog ${node.number} --clear), and only once the new ` +
        'feature that dispels it exists. If nothing has changed, say so and write nothing.\n\n'
      : '') +
    'Three moves, and nothing else:\n' +
    `- Fog the answers have made specifiable becomes proposed steps ${where}, ` +
    'each with a done-when and a size, and the fog patch is cleared in the same breath ' +
    '(plan.ts fog <n> --clear).\n' +
    '- A step an answer has made pointless is dropped with the reason, naming the answer ' +
    'that did it. A re-shape may drop, and must say why.\n' +
    `- A question an answer surfaced is written as a fresh decision ${where}, ` +
    'with its real options, what each costs, and your recommendation.\n\n' +
    'Everything you add is proposed and stays proposed. Do not approve anything, do not ' +
    'answer a decision, do not start or build a step, and do not re-propose something the ' +
    'feature already holds. Report what you proposed, what you dropped and why, and what ' +
    `fog you cleared.\n\n${PLAIN_ENGLISH_RULE}\n\n${FOG_RULE}\n\n${DISMISSAL_RULE}\n\nThe brief is below; it is the plan as the app holds it right ` +
    'now, and the plan is the source of truth. "Decided so far" is every answer settled ' +
    'beneath this feature.\n\n' +
    planBrief(sections, node, { thread: true }) +
    (dismissed ? `\n${dismissed}` : '');

  return startRoutineRun({
    supabase,
    userId,
    job: 'reshape',
    routine: planRoutine(),
    planItemId: node.id,
    text,
  });
}

// latency: pending
export async function reshapePlanFeature(
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

  if (node.status === 'proposed') {
    return {
      error: `#${node.number} is only a proposal. There is nothing agreed here to re-shape yet.`,
    };
  }
  if (node.children.length === 0) {
    return {
      error: `#${node.number} is a step, not a feature. A re-shape re-reads a feature against what has been settled beneath it, and nothing is beneath this one.`,
    };
  }

  const answered = flatten([node]).filter(
    (step) => step.kind === 'decision' && step.status === 'done' && step.resolution,
  ).length;

  const result = await startReshape(
    supabase,
    user.id,
    sections,
    node,
    dismissedUnder(node, await loadDismissedSuggestions(supabase, user.id, node.id)),
  );
  if (!result.ok) return { error: result.error };
  return {
    message:
      `Re-shaping #${node.number} against ` +
      `${answered === 0 ? 'no answers yet' : `${answered} ${answered === 1 ? 'answer' : 'answers'}`}` +
      `${node.fog ? ' and its fog' : ''}. What comes back is proposed. ${result.detail}`,
  };
}

/**
 * Send everything handed to Claude, in one press.
 *
 * The step button is right when you are watching one step; the feature button
 * is right when you are looking at one feature. Neither is what you want after
 * an afternoon spent going down the plan marking things as Claude's, which is
 * the state this button is for: a queue built up over a session and sent when
 * you get up from the desk.
 *
 * Nothing is assigned here. Being handed over is exactly what these steps
 * already are -- that is how they got into the queue -- so nothing is dragged
 * into the queue by pressing this, and pressing it twice sends the same queue
 * again.
 *
 * Nothing is marked in progress either. That is the session's to set, one step
 * at a time as it claims them, and a press that marked the whole queue underway
 * described eleven steps nothing was on. `handedToClaude` has already left out
 * the decisions and the proposals, so what is left is exactly what a session
 * will build.
 *
 * `handedToClaude` decides what is in it: open, approved, not a decision, most
 * urgent first. One routine works the lot in that order, because two sessions
 * on one plan would take the same step twice.
 */
// latency: pending
export async function sendPlanQueueToClaude(
  // Signature is fixed by useActionState; the button sends nothing.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: PlanActionState, _formData: FormData,
): Promise<PlanActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const sections = buildPlanTree(await loadPlan(supabase, user.id));
  const queue = handedToClaude(sections);
  if (queue.length === 0) {
    return { error: 'Nothing is handed to Dash right now. Hand a step over and it lands here.' };
  }

  // Nothing is marked underway here either, for the reason the feature send
  // gives: one session works the queue one step at a time, so marking all
  // twelve on the press describes eleven steps nothing is on. The queue is
  // built from `assignee`, which these steps already carry -- that is how they
  // got into it -- so the press changes no state at all. It sends.
  const text =
    `Work the ${queue.length} plan ${queue.length === 1 ? 'step' : 'steps'} handed to Claude, ` +
    'following .claude/skills/plan/SKILL.md. Work them ONE AT A TIME in the order below, each ' +
    'claimed, built, verified, committed with the step number in the subject and closed with a ' +
    'note before the next is claimed. A step whose brief says it waits on another is worked ' +
    'after that one, not skipped. Stop at the first step that needs a decision from me: block ' +
    'it with the exact question rather than guessing, and carry on with the rest. Keep going ' +
    'until every step is closed, something blocks the batch as a whole, or the session is ' +
    'running short. Push once at the end and report every step you closed, by number and ' +
    'title.\n\nThe briefs are below; they are the plan as the app holds it right now, and the ' +
    'plan is the source of truth.\n\n' +
    planQueueBrief(sections, queue, { thread: true });

  const result = await startRoutineRun({
    supabase,
    userId: user.id,
    job: 'queue',
    routine: planRoutine(),
    // No step: the queue is the whole of what was handed over, and naming the
    // first of twelve would say the run was about that one.
    text,
  });
  if (!result.ok) return { error: result.error };
  return {
    message: `Sent ${queue.length === 1 ? '1 step' : `all ${queue.length} steps`}. ${result.detail}`,
  };
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
// latency: pending
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
