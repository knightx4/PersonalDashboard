'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { sourceById } from '@/lib/todo/agenda/registry';
import { addDays, todayIn } from '@/lib/todo/tasks/model';
import { isSourceId, type SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Acting on something the agenda found somewhere else.
 *
 * Every one of these goes back through the source, which decides what the verb
 * means for its own workspace -- deferring a job reminder moves its due date,
 * deferring a return deadline writes a dismissal. The agenda does not know the
 * difference and must not learn it.
 */

async function context(): Promise<SourceContext> {
  const user = await requireUser();
  const [account, agenda] = await Promise.all([
    loadAccountSettings(user.id),
    loadAgendaSettings(user.id),
  ]);

  const today = todayIn(account.timezone);

  return {
    userId: user.id,
    timezone: account.timezone,
    from: addDays(today, -365),
    to: addDays(today, agenda.horizonDays),
    now: new Date(),
  };
}

function done(): void {
  revalidatePath('/todo');
  revalidatePath('/home');
}

/**
 * Why a verb did not happen, in words a row can show.
 *
 * A source that has no `complete` is the honest case -- a return deadline is a
 * date and cannot be ticked off -- and an id no source answers to is a request
 * from a page that has gone stale. Both used to be a bare `return`, which a
 * caller could not tell from a write that worked.
 */
function refuse(sourceId: string, verb: string): { error: string } {
  const source = isSourceId(sourceId) ? sourceById(sourceId) : undefined;
  if (!source) return { error: 'That is not a source this list knows about.' };
  return { error: `${source.label}: nothing here can ${verb} that.` };
}

export async function completeItem(
  sourceId: string,
  key: string,
): Promise<{ error: string | null }> {
  const source = isSourceId(sourceId) ? sourceById(sourceId) : undefined;
  if (!source?.complete) return refuse(sourceId, 'finish');

  await source.complete(await context(), key);
  done();
  return { error: null };
}

export async function deferItem(sourceId: string, key: string): Promise<{ error: string | null }> {
  const source = isSourceId(sourceId) ? sourceById(sourceId) : undefined;
  if (!source?.defer) return refuse(sourceId, 'put off');

  await source.defer(await context(), key);
  done();
  return { error: null };
}

export async function dismissItem(sourceId: string, key: string): Promise<{ error: string | null }> {
  const source = isSourceId(sourceId) ? sourceById(sourceId) : undefined;
  if (!source?.dismiss) return refuse(sourceId, 'dismiss');

  await source.dismiss(await context(), key);
  done();
  return { error: null };
}
