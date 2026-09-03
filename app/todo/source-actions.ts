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

export async function completeItem(sourceId: string, key: string): Promise<void> {
  if (!isSourceId(sourceId)) return;
  const source = sourceById(sourceId);
  if (!source?.complete) return;

  await source.complete(await context(), key);
  done();
}

export async function deferItem(sourceId: string, key: string): Promise<void> {
  if (!isSourceId(sourceId)) return;
  const source = sourceById(sourceId);
  if (!source) return;

  await source.defer(await context(), key);
  done();
}

export async function dismissItem(sourceId: string, key: string): Promise<void> {
  if (!isSourceId(sourceId)) return;
  const source = sourceById(sourceId);
  if (!source) return;

  await source.dismiss(await context(), key);
  done();
}
