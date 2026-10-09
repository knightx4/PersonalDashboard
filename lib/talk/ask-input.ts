import { z } from 'zod';
import { parseUploadedAttachments, type UploadedAttachment } from '@/lib/attachments/rules';

/**
 * A question to Dash as it arrives from a browser, checked before anything is
 * read: the server action in app/ask/actions.ts and the streaming route in
 * app/api/ask/route.ts take the same three things and check them the same way.
 */

export const AskRef = z.string().uuid();

/**
 * An address in the app, as the sheet's pathname gives it: starts with one
 * slash (so not `//host`), bounded, one line. Anything else is dropped rather
 * than refused, since the question still stands without it.
 */
export const AskPagePath = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[^\s]*$/);

export type AskInput = {
  question: string;
  conversationRef: string | null;
  page: string | null;
  /** Files already uploaded to the person's folder, sent with this question (plan #1715). */
  files: UploadedAttachment[];
};

/** The question, the conversation it continues and the page, or the sentence saying why not. */
export function parseAskInput(
  question: unknown,
  conversationRef: unknown,
  page: unknown,
  files?: unknown,
  userId?: string,
): { ok: true; input: AskInput } | { ok: false; error: string } {
  if (typeof question !== 'string') return { ok: false, error: 'Write a question first.' };
  let ref: string | null = null;
  if (conversationRef != null) {
    const parsed = AskRef.safeParse(conversationRef);
    if (!parsed.success) return { ok: false, error: 'That conversation is not there any more.' };
    ref = parsed.data;
  }
  const onPage = page == null ? null : AskPagePath.safeParse(page);
  return {
    ok: true,
    input: {
      question,
      conversationRef: ref,
      page: onPage?.success ? onPage.data : null,
      files: userId ? parseUploadedAttachments(files, userId) : [],
    },
  };
}
