'use server';

import { revalidatePath } from 'next/cache';
import { answerItem, completeItem, deferItem, dismissItem } from '@/app/todo/source-actions';
import { completeTask, laterTask } from '@/app/todo/actions';

/**
 * The presses on a workspace Inbox's rows (plan #1937.5), each one of the
 * agenda's own verbs. The source writes it on the row where it lives, then
 * every page is rebuilt, so the row has changed in its workspace, on the
 * agenda and in each Inbox by the time the press returns.
 */

type Said = { error?: string; message?: string };

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function after(result: { error: string | null }, message: string): Said {
  if (result.error) return { error: result.error };
  revalidatePath('/', 'layout');
  return { message };
}

// latency: optimistic -- the row says Done at once
export async function doneInboxItem(form: FormData): Promise<Said> {
  return after(await completeItem(text(form, 'source'), text(form, 'key')), 'Done.');
}

// latency: optimistic -- the row says it is put off at once
export async function laterInboxItem(form: FormData): Promise<Said> {
  return after(await deferItem(text(form, 'source'), text(form, 'key'), text(form, 'choice')), 'Later.');
}

// latency: optimistic -- the row says Declined at once
export async function declineInboxItem(form: FormData): Promise<Said> {
  return after(await dismissItem(text(form, 'source'), text(form, 'key')), 'Declined.');
}

// latency: optimistic -- the row marks itself answered at once
export async function answerInboxItem(form: FormData): Promise<Said> {
  return after(
    await answerItem(text(form, 'source'), text(form, 'key'), text(form, 'answer')),
    'Answered.',
  );
}

// latency: optimistic -- the row says Done at once
export async function doneInboxTask(form: FormData): Promise<Said> {
  return after(await completeTask(text(form, 'id')), 'Done.');
}

// latency: optimistic -- the row says it is put off at once
export async function laterInboxTask(form: FormData): Promise<Said> {
  return after(await laterTask(text(form, 'id'), text(form, 'choice')), 'Later.');
}
