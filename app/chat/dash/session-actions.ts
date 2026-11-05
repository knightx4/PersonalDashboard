'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { parseUploadedAttachments, type UploadedAttachment } from '@/lib/attachments/rules';
import { activeProjects } from '@/lib/plan/projects';
import { loadProjectsForRequest } from '@/lib/plan/request-plan';
import {
  SessionThreadError,
  answerThreadQuestion,
  commentOnMockup,
  pickMockup,
  sendSessionMessage,
  startSessionThread,
} from '@/lib/core/session-threads';
import { isThreadId, type SessionMessage } from '@/lib/core/session-threads-model';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { brokerRoutine } from '@/lib/feedback/routine';
import { wakeBroker } from '@/lib/threads/broker-wake';

/**
 * The presses on a session thread in Chat (plan #2789.7): start one, send a
 * message with or without a file, and answer a question with one of its
 * options. Each writes its rows, then wakes the session broker once the
 * answer has gone (#2789.6), which hands what you wrote to the thread's
 * session. The work and its rules are lib/core/session-threads.ts.
 */

export type SessionOutcome<T> = ({ ok: true } & T) | { ok: false; error: string };

const PROJECT = /^[a-z][a-z0-9-]{0,39}$/;

function oneFile(input: unknown, userId: string): UploadedAttachment | null {
  return parseUploadedAttachments(input === undefined || input === null ? [] : [input], userId)[0] ?? null;
}

/** Wake the broker for a thread after the response, so the press does not wait on the fire. */
function wake(userId: string, threadId: string): void {
  after(async () => {
    await wakeBroker({ core: createCoreServiceSupabase(), userId, threadId, routine: brokerRoutine() });
  });
}

function failed(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof SessionThreadError) return { ok: false, error: error.message };
  console.error(fallback, error);
  return { ok: false, error: fallback };
}

/** A new thread on a project, or on this app with no project, with its first message. */
// latency: pending
export async function startSessionThreadAction(input: {
  projectId: string | null;
  text: string;
  file?: UploadedAttachment | null;
}): Promise<SessionOutcome<{ id: string }>> {
  const user = await requireUser();
  const projectId = input.projectId && PROJECT.test(input.projectId) ? input.projectId : null;
  if (input.projectId && !projectId) return { ok: false, error: 'That project is not one of yours.' };
  try {
    const projects = activeProjects(await loadProjectsForRequest(user.id));
    const { id } = await startSessionThread(
      await createCoreClient(),
      user.id,
      { projectId, text: String(input.text ?? ''), file: oneFile(input.file, user.id) },
      projects,
    );
    wake(user.id, id);
    revalidatePath('/chat/dash', 'layout');
    return { ok: true, id };
  } catch (error) {
    return failed(error, 'The thread could not be started. Try again.');
  }
}

/** Your message in a thread of yours. */
// latency: optimistic
export async function sendSessionMessageAction(input: {
  threadId: string;
  text: string;
  file?: UploadedAttachment | null;
}): Promise<SessionOutcome<{ message: SessionMessage }>> {
  const user = await requireUser();
  if (!isThreadId(String(input.threadId))) return { ok: false, error: 'That thread could not be found.' };
  try {
    const message = await sendSessionMessage(await createCoreClient(), user.id, {
      threadId: input.threadId,
      text: String(input.text ?? ''),
      file: oneFile(input.file, user.id),
    });
    wake(user.id, input.threadId);
    revalidatePath('/chat/dash', 'layout');
    return { ok: true, message };
  } catch (error) {
    return failed(error, 'Not sent. Try again.');
  }
}

/** One of a question's options, as your answer. */
// latency: optimistic
export async function answerSessionMessageAction(input: {
  messageId: string;
  answer: string;
}): Promise<SessionOutcome<object>> {
  const user = await requireUser();
  if (!isThreadId(String(input.messageId))) return { ok: false, error: 'That question could not be found.' };
  try {
    const { threadId } = await answerThreadQuestion(await createCoreClient(), user.id, {
      messageId: input.messageId,
      answer: String(input.answer ?? ''),
    });
    wake(user.id, threadId);
    revalidatePath('/chat/dash', 'layout');
    return { ok: true };
  } catch (error) {
    return failed(error, 'Your answer could not be saved. Try again.');
  }
}

/** Pick one of the session's mockups; the step the thread is about keeps its link. */
// latency: optimistic
export async function pickSessionMockupAction(input: {
  messageId: string;
}): Promise<SessionOutcome<{ step: string | null }>> {
  const user = await requireUser();
  if (!isThreadId(String(input.messageId))) return { ok: false, error: 'That mockup could not be found.' };
  try {
    const { step, threadId } = await pickMockup(await createCoreClient(), await createClient(), user.id, {
      messageId: input.messageId,
    });
    wake(user.id, threadId);
    revalidatePath('/chat/dash', 'layout');
    return { ok: true, step };
  } catch (error) {
    return failed(error, 'Your pick could not be saved. Try again.');
  }
}

/** A note on one of the session's mockups, sent to the session. */
// latency: optimistic
export async function commentOnSessionMockupAction(input: {
  messageId: string;
  text: string;
}): Promise<SessionOutcome<object>> {
  const user = await requireUser();
  if (!isThreadId(String(input.messageId))) return { ok: false, error: 'That mockup could not be found.' };
  try {
    const { threadId } = await commentOnMockup(await createCoreClient(), user.id, {
      messageId: input.messageId,
      text: String(input.text ?? ''),
    });
    wake(user.id, threadId);
    revalidatePath('/chat/dash', 'layout');
    return { ok: true };
  } catch (error) {
    return failed(error, 'Your note could not be sent. Try again.');
  }
}
