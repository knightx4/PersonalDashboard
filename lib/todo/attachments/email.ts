import 'server-only';

import { randomUUID } from 'node:crypto';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { ensureAccessToken, loadAccount, type AccountRow } from '@/lib/core/inbox/access-token';
import { gmailOAuthEnv, isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import type { MessageFileRef } from '@/lib/email/mime';
import {
  decodeBase64UrlBytes,
  getGmailAttachmentBytes,
  getGmailMessageForAttach,
} from '@/lib/email/providers/gmail';
import { boundMailText } from '@/lib/inbox/read-mail';
import { createTodoClient } from '@/lib/todo/auth/server';
import { linkAttachment } from '@/lib/todo/attachments/store';
import {
  ATTACHMENT_BUCKET,
  cleanFileName,
  guessRole,
  isImage,
  MAX_ATTACHMENT_BYTES,
  MIN_EMAIL_IMAGE_BYTES,
  resolveMimeType,
  storagePathFor,
  type AttachmentRole,
  type AttachmentTarget,
} from '@/lib/todo/attachments/model';

/**
 * Attaching a message from the person's Gmail to a task or event.
 *
 * Reading mail elsewhere in the app stores nothing (lib/inbox/read-mail.ts).
 * This is the one place a message is kept, and it is kept because the person
 * attached it, by pressing the button or by asking Dash. What is kept: who it
 * is from, when, the subject, its text cut to EMAIL_TEXT_LIMIT characters, and
 * the link that opens it in Gmail. Its PDFs and photos are copied into the
 * bucket as attachments of their own, so a ticket opens from the event
 * without a trip to Gmail.
 */

export const EMAIL_TEXT_LIMIT = 20_000;

/** The most files copied out of one message. */
export const MAX_FILES_PER_EMAIL = 10;

const TICKETISH =
  /\b(?:e-?tickets?|tickets?|admission|boarding pass|your order|booking|reservation|seats?)\b/i;

export type AttachEmailInput = {
  accountId: string;
  messageId: string;
  target: AttachmentTarget;
  role?: AttachmentRole | null;
};

export type AttachEmailResult =
  | {
      ok: true;
      subject: string;
      files: number;
      skipped: number;
      alreadyThere: boolean;
      emailAttachmentId: string;
      attachmentIds: string[];
    }
  | { ok: false; kind: 'not_found' | 'needs_reauth' | 'failed' | 'not_configured'; reason: string };

/** Which of a message's files are worth keeping, and what each is called. Pure so it is tested. */
export function chooseFiles(files: readonly MessageFileRef[]): {
  keep: Array<MessageFileRef & { name: string; mimeType: string }>;
  skipped: number;
} {
  const keep: Array<MessageFileRef & { name: string; mimeType: string }> = [];
  let skipped = 0;
  for (const file of files) {
    const name = cleanFileName(file.filename);
    const mimeType = resolveMimeType(name, file.mimeType);
    const tooBig = file.sizeBytes != null && file.sizeBytes > MAX_ATTACHMENT_BYTES;
    // A logo or a tracking pixel is an image with a name; a photo of a ticket is not that small.
    const speck =
      isImage(mimeType) && file.sizeBytes != null && file.sizeBytes < MIN_EMAIL_IMAGE_BYTES;
    if (
      !name ||
      !mimeType ||
      tooBig ||
      speck ||
      file.sizeBytes === 0 ||
      keep.length >= MAX_FILES_PER_EMAIL
    ) {
      skipped += 1;
      continue;
    }
    keep.push({ ...file, name, mimeType });
  }
  return { keep, skipped };
}

export async function attachEmail(
  core: CoreSupabaseClient,
  userId: string,
  input: AttachEmailInput,
): Promise<AttachEmailResult> {
  if (!isGmailOAuthConfigured()) {
    return {
      ok: false,
      kind: 'not_configured',
      reason: 'Gmail is not configured on this deployment.',
    };
  }

  let account: AccountRow;
  try {
    account = await loadAccount(core, userId, input.accountId);
  } catch {
    return { ok: false, kind: 'not_found', reason: 'That mailbox is not connected.' };
  }

  let accessToken: string;
  try {
    accessToken = await ensureAccessToken(core, account, gmailOAuthEnv().TOKEN_ENCRYPTION_KEY);
  } catch {
    return {
      ok: false,
      kind: 'needs_reauth',
      reason: `Gmail access for ${account.email_address} has been revoked or has expired; reconnect it in Settings.`,
    };
  }

  let message: Awaited<ReturnType<typeof getGmailMessageForAttach>>;
  try {
    message = await getGmailMessageForAttach(accessToken, input.messageId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/\((400|404)\)/.test(detail)) {
      return {
        ok: false,
        kind: 'not_found',
        reason: `No message with that id is in ${account.email_address}.`,
      };
    }
    return { ok: false, kind: 'failed', reason: `Reading the message failed: ${detail}` };
  }

  const supabase = await createTodoClient();
  const subject = message.subject?.trim() || '(no subject)';
  const ticketish = TICKETISH.test(subject);

  // One row per message: a second place to put it is a second link.
  const { data: existing } = await supabase
    .from('attachments')
    .select('id')
    .eq('kind', 'email')
    .eq('email_account_id', account.id)
    .eq('email_message_id', message.id)
    .maybeSingle();
  let emailId = (existing as { id: string } | null)?.id ?? null;
  const alreadyThere = emailId !== null;

  if (!emailId) {
    emailId = randomUUID();
    const { text } = boundMailText(message.text, EMAIL_TEXT_LIMIT);
    const { error } = await supabase.from('attachments').insert({
      id: emailId,
      user_id: userId,
      kind: 'email',
      role: input.role ?? (ticketish ? 'ticket' : 'confirmation'),
      name: subject.slice(0, 500),
      email_account_id: account.id,
      email_message_id: message.id,
      email_from: message.from,
      email_sent_at: message.internalDate?.toISOString() ?? null,
      email_text: text,
      email_gmail_url: gmailOpenUrl({ emailAddress: account.email_address, messageId: message.id }),
    });
    if (error) return { ok: false, kind: 'failed', reason: 'The email could not be saved.' };
  }

  const linked = await linkAttachment(emailId, input.target, supabase);
  if (linked.error) return { ok: false, kind: 'failed', reason: linked.error };

  // Its files: link the ones copied before, otherwise copy them now.
  const { data: children } = await supabase
    .from('attachments')
    .select('id')
    .eq('from_email_id', emailId);
  if (children && children.length > 0) {
    const ids = (children as Array<{ id: string }>).map((child) => child.id);
    for (const id of ids) await linkAttachment(id, input.target, supabase);
    return {
      ok: true,
      subject,
      files: ids.length,
      skipped: 0,
      alreadyThere,
      emailAttachmentId: emailId,
      attachmentIds: [emailId, ...ids],
    };
  }

  const { keep, skipped } = chooseFiles(message.files);
  const savedIds: string[] = [];
  let failed = 0;
  for (const file of keep) {
    try {
      const bytes = file.attachmentId
        ? await getGmailAttachmentBytes(accessToken, message.id, file.attachmentId)
        : decodeBase64UrlBytes(file.inlineData ?? '');
      if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) {
        failed += 1;
        continue;
      }
      const id = randomUUID();
      const path = storagePathFor(userId, id);
      const up = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, bytes, { contentType: file.mimeType });
      if (up.error) {
        failed += 1;
        continue;
      }
      const role: AttachmentRole =
        ticketish && file.mimeType === 'application/pdf'
          ? 'ticket'
          : guessRole(file.name, file.mimeType);
      const { error } = await supabase.from('attachments').insert({
        id,
        user_id: userId,
        kind: 'file',
        role,
        name: file.name,
        mime_type: file.mimeType,
        size_bytes: bytes.length,
        storage_path: path,
        from_email_id: emailId,
      });
      if (error) {
        await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
        failed += 1;
        continue;
      }
      await linkAttachment(id, input.target, supabase);
      savedIds.push(id);
    } catch {
      failed += 1;
    }
  }
  return {
    ok: true,
    subject,
    files: savedIds.length,
    skipped: skipped + failed,
    alreadyThere,
    emailAttachmentId: emailId,
    attachmentIds: [emailId, ...savedIds],
  };
}
