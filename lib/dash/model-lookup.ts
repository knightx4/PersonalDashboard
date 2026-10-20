import { DASH_CHOICES } from '@/lib/core/models';
import type { AskContext, AskToolResult } from '@/lib/ask/db';
import { DASH_MODELS } from './models';
import { dashModelFor } from './model-choice';

/** The page the picker is on. */
export const DASH_MODEL_HREF = '/ask';

/** The Dash page's name for a model id: "Haiku", "Sonnet" or "Opus". */
export function dashModelLabel(id: string): string {
  return DASH_CHOICES.find((c) => c.id === id)?.label ?? id;
}

/**
 * The `dash_model` lookup (plan #2458.4): which model Dash answers this
 * person with, read by the same loader the answer itself uses
 * (dashModelFor), so what Dash says is what it runs on. A person who never
 * picked one is on the default, and the row says so.
 */
export async function dashModelLookup(ctx: AskContext): Promise<AskToolResult> {
  const id = await dashModelFor(await ctx.db('core'), ctx.userId);
  const label = dashModelLabel(id);
  const isDefault = id === DASH_MODELS.ask;
  return {
    ok: true,
    rows: [
      {
        table: 'core.account_settings',
        ref: ctx.userId,
        title: `Dash answers with ${label}`,
        href: DASH_MODEL_HREF,
        detail: { model: label, default: isDefault ? 'yes' : 'no' },
      },
    ],
    note: `Dash is answering with ${label}${isDefault ? ', the default, because nothing else was picked' : ''}. They change it with the picker on the Dash page, or by asking you to (set_dash_model).`,
  };
}
