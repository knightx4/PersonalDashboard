import { z } from 'zod';
import { parseUploadedAttachments, type UploadedAttachment } from '@/lib/attachments/rules';
import { parseAskListFilter, type AskListFilter } from '@/lib/ask/list-filter';
import { HIT_KINDS, type HitKind } from '@/lib/search/sources';
import { isModuleId, type ModuleId } from '@/lib/modules';

/**
 * A question to Dash as it arrives from a browser, checked before anything is
 * read: the server action in app/ask/actions.ts and the streaming route in
 * app/api/ask/route.ts take the same things and check them the same way.
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

/** The most rows one question can carry with @ (plan #1899.5). */
export const MAX_MENTIONS = 8;

/**
 * A row the person added to a question with @ (plan #1899.5), as the top
 * bar's search found it: its kind and id say which table and row
 * (lib/ask/lookups.ts HIT_TABLES), and the title and link are what the
 * question shows.
 */
export type AskMention = { kind: HitKind; id: string; title: string; href: string };

const Mention = z.object({
  kind: z.string().refine((kind): kind is HitKind => Object.hasOwn(HIT_KINDS, kind)),
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  // A page in the app: one slash, not two, so never another site.
  href: z.string().max(500).regex(/^\/(?!\/)[^\s]*$/),
});

/** The rows sent with a question, each checked; anything malformed is left out, and repeats are kept once. */
export function parseAskMentions(rows: unknown): AskMention[] {
  if (!Array.isArray(rows)) return [];
  const kept: AskMention[] = [];
  for (const row of rows) {
    const parsed = Mention.safeParse(row);
    if (!parsed.success) continue;
    const mention = parsed.data as AskMention;
    if (kept.some((k) => k.kind === mention.kind && k.id === mention.id)) continue;
    kept.push(mention);
    if (kept.length === MAX_MENTIONS) break;
  }
  return kept;
}

/** The workspace a question is kept to, or null for every one (plan #1899.5). */
export function parseAskScope(scope: unknown): ModuleId | null {
  return typeof scope === 'string' && isModuleId(scope) ? scope : null;
}

export type AskInput = {
  question: string;
  conversationRef: string | null;
  page: string | null;
  /** Files already uploaded to the person's folder, sent with this question (plan #1715). */
  files: UploadedAttachment[];
  /** The filter a list was under when it was sent to Dash (plan #1658); null when none came or it was not one. */
  list: AskListFilter | null;
  /** Rows added with @ (plan #1899.5); empty when none came. */
  mentions: AskMention[];
  /** The workspace Dash's lookups are kept to (plan #1899.5); null for every one. */
  scope: ModuleId | null;
};

/** The question, the conversation it continues and the page, or the sentence saying why not. */
export function parseAskInput(
  question: unknown,
  conversationRef: unknown,
  page: unknown,
  files?: unknown,
  userId?: string,
  list?: unknown,
  rows?: unknown,
  scope?: unknown,
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
      list: parseAskListFilter(list),
      mentions: parseAskMentions(rows),
      scope: parseAskScope(scope),
    },
  };
}
