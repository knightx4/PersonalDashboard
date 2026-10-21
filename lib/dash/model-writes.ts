import { sameAs } from './runs';
import type Anthropic from '@anthropic-ai/sdk';
import { DASH_CHOICES, type DashChoiceId } from '@/lib/core/models';
import { toRef } from '@/lib/core/refs';
import type { ModelChangeInput, ModelChangeKind } from '@/lib/ask/model-changes';
import { DASH_MODEL_HREF, dashModelLabel } from './model-lookup';
import { saveDashModel } from './model-choice';
import type { DashWriteContext, DashWriteResult, DashWriteTool } from './registry';

/**
 * The model change Dash makes when asked (plan #2458.4, feature #2458):
 *
 *   set_dash_model  the model Dash answers with switched to Haiku, Sonnet or
 *                   Opus, or back to the default.
 *
 * It saves through saveDashModel (lib/dash/model-choice.ts), the function the
 * picker's own action calls, so the button and Dash refuse the same things in
 * the same words and write the same column. What it reports is the account's
 * choice before and after; the row is the settings row, which has no id of
 * its own (the person's id is its key), so the record keeps no Undo and says
 * how to take it back instead: ask Dash again or use the picker.
 *
 * The switch applies from the next question: the answer being written is
 * already running on the model that was chosen when it started.
 */

/** The names the tool takes, which are the picker's labels in lower case. */
const NAMES = DASH_CHOICES.map((c) => c.label.toLowerCase());
const DEFAULT = 'default';

const DONE_NOTE =
  'It is done: it shows under your answer. Say which model they are on now and that it applies from their next question, and cite the row this returned.';

const UNDO = 'Ask Dash to switch the model back, or pick it again on the Dash page.';

class Refused extends Error {}

function chosen(args: Record<string, unknown>): DashChoiceId | null {
  const name = typeof args.model === 'string' ? args.model.trim().toLowerCase() : '';
  if (name === DEFAULT) return null;
  const found = DASH_CHOICES.find((c) => c.label.toLowerCase() === name);
  if (!found) throw new Refused(`model must be one of ${NAMES.join(', ')} or ${DEFAULT}.`);
  return found.id;
}

async function setDashModel(ctx: DashWriteContext, args: Record<string, unknown>): Promise<DashWriteResult> {
  const model = chosen(args);
  const core = await ctx.db('core');
  const saved = await saveDashModel(core, ctx.userId, model);
  if (!saved.ok) throw new Refused(saved.error);

  const label = model ? dashModelLabel(model) : 'the default (Sonnet)';
  const was = saved.before ? dashModelLabel(saved.before) : 'the default';
  const input: ModelChangeInput = {
    verb: 'Switched the model Dash answers with',
    what: model ? dashModelLabel(model) : 'the default',
    rest: ` from ${was}`,
    href: DASH_MODEL_HREF,
    where: 'Open the Dash page',
    paths: [DASH_MODEL_HREF],
  };
  return {
    ok: true,
    kind: 'set_dash_model' satisfies ModelChangeKind,
    input: input as unknown as Record<string, unknown>,
    subjectRef: toRef('core.account_settings', ctx.userId),
    op: 'update',
    before: { dash_model: saved.before },
    after: { dash_model: saved.after },
    summary: `Dash switched the model it answers with to ${label}, from ${was}.`,
    undo: { none: UNDO },
    row: {
      table: 'core.account_settings',
      ref: ctx.userId,
      title: `Dash answers with ${label}`,
      href: DASH_MODEL_HREF,
      detail: { model: label, was },
    },
  };
}

function guarded(run: (ctx: DashWriteContext, args: Record<string, unknown>) => Promise<DashWriteResult>) {
  return async (ctx: DashWriteContext, input: unknown): Promise<DashWriteResult> => {
    const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    try {
      return await run(ctx, args);
    } catch (error) {
      if (error instanceof Refused) return { ok: false, error: error.message };
      console.error('dash write set_dash_model failed', error);
      return { ok: false, error: 'That change could not be made. Tell them nothing was changed.' };
    }
  };
}

const definition: Anthropic.Tool = {
  name: 'set_dash_model',
  description: `Switch the model Dash answers with, when they ask ("use Opus", "switch to Haiku", "go back to the default"). Haiku is the quickest and cheapest, Sonnet the default, Opus the most careful. It is the same save as the picker on the Dash page, and applies from their next question, not the one being answered. To tell them which model they are on, call dash_model instead; do not change it to find out. ${DONE_NOTE}`,
  input_schema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        enum: [...NAMES, DEFAULT],
        description: 'haiku, sonnet or opus; default clears their choice, which reads as Sonnet.',
      },
    },
    required: ['model'],
    additionalProperties: false,
  },
};

/** The model write tools, in the order the model is sent them. */
export const MODEL_WRITE_TOOLS: readonly DashWriteTool<DashWriteResult>[] = [
  { name: 'set_dash_model', runs: sameAs(['lib/dash/model-choice-actions.ts#setDashModel', 'lib/dash/model-choice.ts#saveDashModel']), kind: 'write', definition, apply: guarded(setDashModel) },
];
