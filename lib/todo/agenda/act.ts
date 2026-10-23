import 'server-only';

import { sourceById } from '@/lib/todo/agenda/registry';
import { isSourceId, type AgendaSource, type SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Finishing, putting off and dismissing a row the agenda found somewhere
 * else: the agenda's buttons (app/todo/source-actions.ts) and Dash's
 * change_agenda_row (lib/dash/todo-writes.ts) both come through here (plan
 * #2473.3), so a verb means the same thing from either.
 *
 * Every one goes back through the source, which decides what the verb means
 * for its own workspace: deferring a job reminder moves its due date,
 * deferring a return deadline writes a dismissal. The agenda does not know
 * the difference and must not learn it.
 */

function sourceOf(sourceId: string): AgendaSource | undefined {
  return isSourceId(sourceId) ? sourceById(sourceId) : undefined;
}

/**
 * Why a verb did not happen, in words a row can show.
 *
 * A source that has no `complete` is the honest case (a return deadline is a
 * date and cannot be ticked off), and an id no source answers to is a request
 * from a page that has gone stale.
 */
export function agendaRefusal(sourceId: string, verb: string): { error: string } {
  const source = sourceOf(sourceId);
  if (!source) return { error: 'That is not a source this list knows about.' };
  return { error: `${source.label}: nothing here can ${verb} that.` };
}

export async function completeAgendaItem(
  ctx: SourceContext,
  sourceId: string,
  key: string,
): Promise<{ error: string | null }> {
  const source = sourceOf(sourceId);
  if (!source?.complete) return agendaRefusal(sourceId, 'finish');
  await source.complete(ctx, key);
  return { error: null };
}

/** Later, to the start of a day already read from the Later menu (lib/core/snooze-days.ts). */
export async function deferAgendaItem(
  ctx: SourceContext,
  sourceId: string,
  key: string,
  until: Date,
): Promise<{ error: string | null }> {
  const source = sourceOf(sourceId);
  if (!source?.defer) return agendaRefusal(sourceId, 'put off');
  await source.defer(ctx, key, until);
  return { error: null };
}

export async function dismissAgendaItem(
  ctx: SourceContext,
  sourceId: string,
  key: string,
): Promise<{ error: string | null }> {
  const source = sourceOf(sourceId);
  if (!source?.dismiss) return agendaRefusal(sourceId, 'dismiss');
  await source.dismiss(ctx, key);
  return { error: null };
}
