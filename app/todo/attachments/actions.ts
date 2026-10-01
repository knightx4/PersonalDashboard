'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { searchMail, type MailSearchHit } from '@/lib/inbox/search-mail';
import { createTodoClient } from '@/lib/todo/auth/server';
import { connectedAccountIds } from '@/lib/core/inbox/accounts';
import { attachEmail } from '@/lib/todo/attachments/email';
import {
  searchWordsFor,
  type AttachmentTarget,
  type AttachmentView,
} from '@/lib/todo/attachments/model';
import {
  createUploadSlot,
  loadAttachments,
  registerUpload,
  removeFromTarget,
  setRole,
  type UploadSlot,
} from '@/lib/todo/attachments/store';
import { addDays } from '@/lib/todo/tasks/model';

/**
 * Attaching files and emails to a task or an event.
 *
 * A target comes from the page as plain data, so it is checked for being a
 * kind and an id before anything is read with it; the database then checks it
 * is the signed-in person's (RLS and the ownership trigger in 0016).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validTarget(target: AttachmentTarget): boolean {
  return (target.kind === 'task' || target.kind === 'event') && UUID.test(target.id);
}

function refresh() {
  revalidatePath('/todo');
  revalidatePath('/todo/all');
  revalidatePath('/todo/calendar');
}

// latency: pending
export async function startAttachmentUpload(
  target: AttachmentTarget,
  file: { name: string; type: string; size: number },
): Promise<UploadSlot> {
  const user = await requireUser();
  if (!validTarget(target)) return { ok: false, error: 'Which one is this for?' };
  return createUploadSlot(user.id, target, file);
}

// latency: pending
export async function finishAttachmentUpload(
  target: AttachmentTarget,
  upload: { id: string; name: string; type: string; size: number },
): Promise<{ error: string | null }> {
  const user = await requireUser();
  if (!validTarget(target) || !UUID.test(upload.id)) return { error: 'Which one is this for?' };
  const result = await registerUpload(user.id, target, upload);
  if (!result.error) refresh();
  return result;
}

// latency: pending
export async function removeAttachment(
  target: AttachmentTarget,
  attachmentId: string,
): Promise<{ error: string | null }> {
  await requireUser();
  if (!validTarget(target) || !UUID.test(attachmentId)) return { error: 'Which one is this?' };
  const result = await removeFromTarget(attachmentId, target);
  if (!result.error) refresh();
  return result;
}

// latency: pending
export async function changeAttachmentRole(
  attachmentId: string,
  role: string,
): Promise<{ error: string | null }> {
  await requireUser();
  if (!UUID.test(attachmentId)) return { error: 'Which one is this?' };
  const result = await setRole(attachmentId, role);
  if (!result.error) refresh();
  return result;
}

/** What the picker shows for each candidate message. */
export type EmailCandidate = Pick<
  MailSearchHit,
  'accountId' | 'messageId' | 'from' | 'subject' | 'date' | 'snippet'
>;

export type FindEmailsResult =
  | { ok: true; messages: EmailCandidate[]; searched: string }
  | { ok: false; error: string };

/**
 * Looks in the person's mailboxes for the mail about this task or event: the
 * ticket, the booking. It searches for the title's words in the half year
 * before the day, newest first, and returns candidates for the person to pick
 * from. Nothing is stored here.
 */
// latency: pending
export async function findEmailsFor(
  target: AttachmentTarget,
  words?: string,
): Promise<FindEmailsResult> {
  const user = await requireUser();
  if (!validTarget(target)) return { ok: false, error: 'Which one is this for?' };

  const supabase = await createTodoClient();
  let title = '';
  let day: string | null = null;
  if (target.kind === 'event') {
    const { data } = await supabase
      .from('events')
      .select('title, starts_on, starts_at')
      .eq('id', target.id)
      .maybeSingle();
    const row = data as {
      title: string;
      starts_on: string | null;
      starts_at: string | null;
    } | null;
    title = row?.title ?? '';
    day = row?.starts_on ?? row?.starts_at?.slice(0, 10) ?? null;
  } else {
    const { data } = await supabase
      .from('tasks')
      .select('title, due_on')
      .eq('id', target.id)
      .maybeSingle();
    const row = data as { title: string; due_on: string | null } | null;
    title = row?.title ?? '';
    day = row?.due_on ?? null;
  }

  const query = (words ?? '').trim() || searchWordsFor(title);
  if (!query) return { ok: false, error: 'Type a few words to search your email for.' };

  const result = await searchMail(await createCoreClient(), user.id, {
    words: query,
    // Tickets are bought before the day, often months before; an event already
    // past is searched from half a year before it, one ahead from half a year ago.
    after: addDays(day ?? new Date().toISOString().slice(0, 10), -183),
  });
  if (!result.ok) return { ok: false, error: result.reason };
  return {
    ok: true,
    searched: query,
    messages: result.messages.map((m) => ({
      accountId: m.accountId,
      messageId: m.messageId,
      from: m.from,
      subject: m.subject,
      date: m.date,
      snippet: m.snippet,
    })),
  };
}

export type AttachEmailOutcome = { ok: true; message: string } | { ok: false; error: string };

// latency: pending
export async function attachEmailAction(
  target: AttachmentTarget,
  accountId: string,
  messageId: string,
): Promise<AttachEmailOutcome> {
  const user = await requireUser();
  if (!validTarget(target) || !UUID.test(accountId) || !messageId)
    return { ok: false, error: 'Which email is this?' };
  const result = await attachEmail(await createCoreClient(), user.id, {
    accountId,
    messageId,
    target,
  });
  if (!result.ok) return { ok: false, error: result.reason };
  refresh();
  const files =
    result.files === 0 ? '' : ` with ${result.files} file${result.files === 1 ? '' : 's'}`;
  return { ok: true, message: `Attached “${result.subject}”${files}.` };
}

/** What is on one task or event, for a form that opens on demand rather than with the page. */
// latency: pending
export async function loadAttachmentsFor(
  target: AttachmentTarget,
): Promise<{ items: AttachmentView[]; canSearchMail: boolean }> {
  const user = await requireUser();
  if (!validTarget(target)) return { items: [], canSearchMail: false };
  const [items, accounts] = await Promise.all([
    loadAttachments(target),
    connectedAccountIds(await createCoreClient(), user.id),
  ]);
  return { items, canSearchMail: accounts.length > 0 };
}
