'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { createVaultClient } from '@/lib/vault/auth/server';
import { whyNotRead } from '@/lib/vault/map/rules';
import { MAYA_QUESTION_MAX } from '@/lib/vault/maya/thought-model';
import { MAYA_REPLY_MODEL, MAYA_REPLY_OPERATION, replyInThread } from '@/lib/vault/maya/reply';
import { appendReply, loadThread, renameQuestion, saveSummary, type MayaMessage } from '@/lib/vault/maya/store';
import { loadNotesByIds } from '@/lib/vault/notes/load';
import { mayaThreadHref } from '@/lib/vault/paths';
import { turnBody, type TalkTurn } from '@/lib/talk/talk';

/**
 * Talking with Maya in a thread, and renaming what the thread is about (plan
 * #1286).
 *
 * Both run on the session client, as Talk's actions do: RLS and the column
 * grants in 0028_maya.sql decide whose thread this is, so a thread id from
 * somebody else's account finds nothing.
 */

const threadId = z.string().uuid();

export type MayaReplyResult = {
  /** The turns kept, in the shape the thread draws: the person's, then Maya's. */
  turns?: TalkTurn[];
  /** Where the person has got to, rewritten after Maya's answer. */
  summary?: string;
  error?: string;
};

function asTurn(message: MayaMessage): TalkTurn {
  return {
    id: message.id,
    role: message.role === 'maya' ? 'assistant' : 'user',
    body: message.body,
    createdAt: message.createdAt,
  };
}

/**
 * Keep the person's reply, ask Maya for its answer, keep that, and rewrite
 * where they have got to.
 *
 * The person's words are kept before Maya is asked, so a failed answer loses
 * nothing: the reply stays in the thread and the error says why. A note that
 * has since become one the vault does not read (moved into Me, or now holding
 * a key) is not sent; Maya answers from its thought and the thread alone.
 */
// latency: pending
export async function replyToMaya(id: string, raw: string): Promise<MayaReplyResult> {
  const parsed = threadId.safeParse(id);
  if (!parsed.success) return { error: 'That thread could not be found.' };
  const checked = turnBody(raw);
  if ('error' in checked) return { error: checked.error };

  const user = await requireUser();
  const vault = await createVaultClient();
  const thread = await loadThread(vault, parsed.data).catch(() => null);
  if (!thread) return { error: 'That thread could not be found.' };

  const mine = await appendReply(vault, {
    threadId: thread.id,
    userId: user.id,
    role: 'person',
    body: checked.body,
  });
  if (!mine) return { error: 'That was not kept. Try again.' };
  const kept = [asTurn(mine)];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { turns: kept, error: 'This deployment has no ANTHROPIC_API_KEY, so Maya cannot reply.' };

  const [note] = await loadNotesByIds(vault, [thread.noteId]).catch(() => []);
  const readable = note && !whyNotRead(note) ? { title: note.title, body: note.body } : null;
  const thought = thread.messages.find((message) => message.kind === 'thought') ?? null;

  const spend = collectSpend();
  const reply = await replyInThread({
    note: readable,
    question: thread.question,
    thought: thought?.body ?? null,
    summary: thread.summary,
    turns: [
      ...thread.messages.filter((message) => message.kind === 'reply'),
      { role: 'person' as const, body: checked.body },
    ],
    anthropicApiKey: apiKey,
    onSpend: spend.sink,
  });
  await recordLearnSpend(user.id, MAYA_REPLY_OPERATION, spend.reports);
  if (!reply.ok) return { turns: kept, error: `Maya could not reply: ${reply.detail}` };

  const answer = await appendReply(vault, {
    threadId: thread.id,
    userId: user.id,
    role: 'maya',
    body: reply.reply,
    model: MAYA_REPLY_MODEL,
  });
  if (!answer) return { turns: kept, error: 'Maya replied, but the reply was not kept. Try again.' };

  const summary = reply.summary || thread.summary || undefined;
  if (reply.summary) await saveSummary(vault, thread.id, reply.summary);

  revalidatePath('/vault/maya');
  return { turns: [...kept, asTurn(answer)], summary };
}

const question = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'The question cannot be blank.')
      .max(MAYA_QUESTION_MAX, `The question can be at most ${MAYA_QUESTION_MAX} characters.`),
  );

/** Rewrite the line the thread is about. Returns an error to show, or nothing. */
// latency: pending
export async function renameMayaQuestion(id: string, raw: string): Promise<{ error?: string }> {
  const parsed = threadId.safeParse(id);
  if (!parsed.success) return { error: 'That thread could not be found.' };
  const next = question.safeParse(raw);
  if (!next.success) return { error: next.error.issues[0]?.message ?? 'That question cannot be saved.' };

  await requireUser();
  const vault = await createVaultClient();
  const ok = await renameQuestion(vault, parsed.data, next.data);
  if (!ok) return { error: 'The question was not saved. Try again.' };

  revalidatePath('/vault/maya');
  revalidatePath(mayaThreadHref(parsed.data));
  return {};
}
