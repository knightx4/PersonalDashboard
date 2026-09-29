import type Anthropic from '@anthropic-ai/sdk';
import { parseStepFields } from '@/lib/goals/steps';
import { taskInput } from '@/lib/todo/tasks/input';
import type { ModuleId } from '@/lib/modules';
import type { DashChange, NewDashChange } from '@/lib/talk/changes';
import { isUuid, type AskContext, type AskToolResult } from './db';

/**
 * The changes Dash may propose in an answer (plan #1188, feature #1186):
 * add a todo, add a step under a goal, mark an owned item returned. A
 * proposal is checked the way the page's own action checks it and kept as a
 * proposed row in core.dash_changes; nothing else is written until the person
 * presses Confirm (#1189).
 *
 * These three and nothing else, as lib/comments/act.ts keeps to its named
 * list. A goal or an item is named by a ref a lookup returned in this
 * conversation, the same rule citations follow, so Dash can only point at a
 * row it has actually seen, and the row is read again here as the person to
 * check it is theirs and can take the change.
 */

export const PROPOSAL_TOOL_NAMES = ['propose_todo', 'propose_goal_step', 'propose_returned'] as const;
export type ProposalToolName = (typeof PROPOSAL_TOOL_NAMES)[number];

export function isProposalToolName(name: string): name is ProposalToolName {
  return (PROPOSAL_TOOL_NAMES as readonly string[]).includes(name);
}

const PROPOSE_NOTE =
  'Nothing is written yet: the person sees it as a card under your answer and confirms or declines it.';

export const PROPOSAL_TOOLS: readonly Anthropic.Tool[] = [
  {
    name: 'propose_todo',
    description: `Propose adding a todo to the person's list, when they ask you to add one. ${PROPOSE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The todo as they would write it, in a short line.' },
        due_on: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'The day it is due, YYYY-MM-DD, only when they named one ("on Friday").',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_goal_step',
    description: `Propose adding a step under one of the person's goals, when they ask you to. Name the goal by the ref goal_status or search returned for it in the goals.items table; look it up first. The step is theirs and goes last under the goal. ${PROPOSE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: {
        goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
        title: { type: 'string', description: 'The step, in a short line.' },
      },
      required: ['goal_ref', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_returned',
    description: `Propose marking an item the person owns as returned, when they say they sent it back. Name it by the ref search returned for it in the public.inventory_items table; look it up first. It records a full refund at what the item cost. ${PROPOSE_NOTE}`,
    input_schema: {
      type: 'object',
      properties: {
        item_ref: { type: 'string', description: 'The public.inventory_items ref a lookup returned for the item.' },
      },
      required: ['item_ref'],
      additionalProperties: false,
    },
  },
];

/** What a proposal needs beyond the lookups' context. */
export type ProposeContext = AskContext & {
  /** Whether a lookup returned this row in this conversation. */
  seen: (table: string, ref: string) => boolean;
  /** Keeps the proposal as a proposed row and returns it. */
  save: (change: NewDashChange) => Promise<DashChange>;
};

const MODULES: Record<ProposalToolName, ModuleId> = {
  propose_todo: 'todo',
  propose_goal_step: 'goals',
  propose_returned: 'shopping',
};

const MODULE_LABELS: Partial<Record<ModuleId, string>> = { todo: 'Todo', goals: 'Goals', shopping: 'Shopping' };

class Refused extends Error {}

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** A ref a lookup returned, in the table it has to be from. */
function seenRef(ctx: ProposeContext, args: Record<string, unknown>, key: string, table: string): string {
  const ref = text(args, key);
  if (!ref) throw new Refused(`${key} is missing.`);
  if (!ctx.seen(table, ref) || !isUuid(ref)) {
    throw new Refused(`No lookup in this conversation returned ${table} ${ref}. Look it up first and use the ref it gives.`);
  }
  return ref;
}

/** The first row a read found, or null. */
async function firstRow<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data as T[] | null) ?? [])[0] ?? null;
}

async function checkTodo(ctx: ProposeContext, args: Record<string, unknown>): Promise<NewDashChange> {
  const dueOn = text(args, 'due_on');
  const parsed = taskInput.safeParse({ title: text(args, 'title'), body: '', dueOn, dueTime: '', pinned: false });
  if (!parsed.success) throw new Refused(parsed.error.issues[0].message);
  if (parsed.data.dueOn && Number.isNaN(Date.parse(parsed.data.dueOn))) throw new Refused('due_on is not a date.');
  return {
    kind: 'add_todo',
    input: { title: parsed.data.title, body: null, dueOn: parsed.data.dueOn, dueTime: null, pinned: false },
  };
}

async function checkGoalStep(ctx: ProposeContext, args: Record<string, unknown>): Promise<NewDashChange> {
  const parentId = seenRef(ctx, args, 'goal_ref', 'goals.items');
  const parsed = parseStepFields((key) => (key === 'title' ? text(args, 'title') : undefined), { requireTitle: true });
  if (!parsed.ok) throw new Refused(parsed.error);
  const title = parsed.value.title as string;

  const client = await ctx.db('goals');
  const goal = await firstRow<{ id: string; title: string; level: string; status: string }>(
    client
      .from('items')
      .select('id, title, level, status')
      .eq('id', parentId)
      .eq('user_id', ctx.userId)
      .is('archived_at', null)
      .limit(1),
  );
  if (!goal) throw new Refused('That goal is not one of theirs, or it has been archived.');
  if (goal.level !== 'goal') throw new Refused('That row is a step, not a goal. Name the goal it sits under.');
  if (goal.status === 'done' || goal.status === 'dropped') {
    throw new Refused(`That goal is ${goal.status}, so a step cannot go under it.`);
  }
  return { kind: 'add_goal_step', input: { parentId, goalTitle: goal.title, title, kind: 'mine' } };
}

async function checkReturned(ctx: ProposeContext, args: Record<string, unknown>): Promise<NewDashChange> {
  const id = seenRef(ctx, args, 'item_ref', 'public.inventory_items');
  const client = await ctx.db('public');
  const item = await firstRow<{ id: string; name: string | null; status: string; order_item_id: string | null }>(
    client
      .from('inventory_items')
      .select('id, name, status, order_item_id')
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .limit(1),
  );
  // The same three refusals markItemReturned gives.
  if (!item) throw new Refused('That item could not be found.');
  if (item.status !== 'owned') throw new Refused('Only owned items can be marked returned.');
  if (!item.order_item_id) throw new Refused('This item is not linked to an order, so it cannot be returned.');
  return { kind: 'mark_returned', input: { id, itemTitle: item.name?.trim() || 'Item' } };
}

const CHECKS: Record<ProposalToolName, (ctx: ProposeContext, args: Record<string, unknown>) => Promise<NewDashChange>> = {
  propose_todo: checkTodo,
  propose_goal_step: checkGoalStep,
  propose_returned: checkReturned,
};

/** How a kept proposal reads back to the model. */
function described(change: NewDashChange): string {
  switch (change.kind) {
    case 'add_todo':
      return `Add the todo "${change.input.title}"${change.input.dueOn ? `, due ${change.input.dueOn}` : ''}.`;
    case 'add_goal_step':
      return `Add the step "${change.input.title}" under the goal "${change.input.goalTitle}".`;
    case 'mark_returned':
      return `Mark "${change.input.itemTitle}" returned, with a full refund at what it cost.`;
  }
}

/**
 * Check a proposal the model made and keep it. Never throws: a tool outside
 * the three, a ref no lookup returned, a row that is not theirs or cannot take
 * the change, or a failed write comes back as `{ ok: false, error }`, which
 * the loop hands the model so it can say so in words.
 */
export async function executeProposal(name: string, input: unknown, ctx: ProposeContext): Promise<AskToolResult> {
  if (!isProposalToolName(name)) {
    return { ok: false, error: `There is no tool called ${name}. You can propose only a todo, a goal step or a return.` };
  }
  const workspace = MODULES[name];
  if (!ctx.enabledModules.includes(workspace)) {
    return { ok: false, error: `The ${MODULE_LABELS[workspace]} workspace is switched off, so nothing can be proposed there.` };
  }
  const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  let change: NewDashChange;
  try {
    change = await CHECKS[name](ctx, args);
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message };
    console.error(`ask proposal ${name} failed`, error);
    return { ok: false, error: 'That proposal could not be checked against the database.' };
  }
  let kept: DashChange;
  try {
    kept = await ctx.save(change);
  } catch (error) {
    console.error(`ask proposal ${name} was not kept`, error);
    return { ok: false, error: 'That proposal could not be kept.' };
  }
  return {
    ok: true,
    rows: [],
    totals: { proposal: { id: kept.id, kind: kept.kind, input: kept.input } },
    note: `Proposed: ${described(change)} ${PROPOSE_NOTE} Say in your answer what you proposed.`,
  };
}
