'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { LATER_REFUSED, laterUntil } from '@/lib/core/snooze-days';
import { agendaRefusal, completeAgendaItem, deferAgendaItem, dismissAgendaItem } from '@/lib/todo/agenda/act';
import { loadAgendaSettings } from '@/lib/todo/agenda/settings';
import { sourceById } from '@/lib/todo/agenda/registry';
import { addDays, todayIn } from '@/lib/todo/tasks/model';
import { isSourceId, type SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Acting on something the agenda found somewhere else.
 *
 * Every one of these goes back through the source, which decides what the verb
 * means for its own workspace. Finishing, putting off and dismissing go
 * through lib/todo/agenda/act.ts, which Dash's change_agenda_row calls too.
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

// latency: optimistic -- the agenda row ticks and strikes through at once
export async function completeItem(
  sourceId: string,
  key: string,
): Promise<{ error: string | null }> {
  const { error } = await completeAgendaItem(await context(), sourceId, key);
  if (error) return { error };
  done();
  return { error: null };
}

/**
 * Later, to one of the Later menu's days or a day picked (`choice`, as
 * lib/core/snooze-days.ts reads it), in the account's zone.
 */
// latency: optimistic -- the agenda row fades at once
export async function deferItem(
  sourceId: string,
  key: string,
  choice: string,
): Promise<{ error: string | null }> {
  const ctx = await context();
  const later = laterUntil(choice, ctx.timezone, ctx.now);
  if (!later) return { error: LATER_REFUSED };
  const { error } = await deferAgendaItem(ctx, sourceId, key, later.until);
  if (error) return { error };
  done();
  return { error: null };
}

// latency: optimistic -- the agenda row fades at once
export async function dismissItem(sourceId: string, key: string): Promise<{ error: string | null }> {
  const { error } = await dismissAgendaItem(await context(), sourceId, key);
  if (error) return { error };
  done();
  return { error: null };
}

/** The toast's Undo on Later or Drop (plan #1957.3): the item is back on the list. */
// latency: pending
export async function restoreItem(sourceId: string, key: string): Promise<{ error: string | null }> {
  const source = isSourceId(sourceId) ? sourceById(sourceId) : undefined;
  if (!source?.restore) return agendaRefusal(sourceId, 'bring back');

  await source.restore(await context(), key);
  done();
  return { error: null };
}

/**
 * Answer a question on the agenda with one of its options (plan #1267). The
 * source records it where the question lives; the row marks itself answered
 * at once and the rebuilt page leaves the question out.
 */
// latency: optimistic -- the agenda row marks itself answered at once
export async function answerItem(
  sourceId: string,
  key: string,
  answer: string,
): Promise<{ error: string | null }> {
  const source = isSourceId(sourceId) ? sourceById(sourceId) : undefined;
  if (!source?.answer) return agendaRefusal(sourceId, 'answer');

  const result = await source.answer(await context(), key, answer);
  if (result.error) return result;
  done();
  return { error: null };
}
