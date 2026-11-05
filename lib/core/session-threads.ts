import 'server-only';

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { SchemaClient } from '@/lib/ask/db';
import { editPlanItem } from '@/lib/plan/edit-item';
import { listAttachments, recordAttachments } from '@/lib/attachments/store';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import { toRef } from '@/lib/core/refs';
import type { DevProject } from '@/lib/plan/projects';
import {
  SESSION_ANSWER_MAX,
  MOCKUP_COMMENT_MAX,
  SESSION_MESSAGE_MAX,
  PICK_OPENING,
  THIS_APP_LABEL,
  commentBody,
  detailWithReference,
  pickBody,
  sessionMessageOf,
  stateOf,
  threadTitleFrom,
  type SessionMessage,
  type SessionThread,
} from './session-threads-model';
import { PROGRESS_COLUMNS, progressReportOf, type SessionProgressReport } from './session-thread-live';

/**
 * The reads and writes behind the session thread screen in Chat (plan
 * #2789.7). Every call takes the core client on the person's own session, so
 * RLS keeps each account to its own threads, and each query names the person
 * as well. Sending writes the message only; the action then wakes the
 * broker (lib/threads/broker-wake.ts), which reads the undelivered rows
 * itself and hands them to the thread's session (#2789.6).
 */

type ThreadRow = {
  id: string;
  title: string;
  project_id: string | null;
  session_id: string | null;
  state: string;
  created_at: string;
  updated_at: string;
};

const THREAD_COLUMNS = 'id, title, project_id, session_id, state, created_at, updated_at';
const MESSAGE_COLUMNS =
  'id, author, kind, body, options, artifact_url, attachment_path, answer, answered_at, created_at';

/** The ref a message's file is recorded against in core.attachments. */
export function messageRef(messageId: string): string {
  return toRef('core.session_messages', messageId);
}

function labelFor(projectId: string | null, projects: readonly DevProject[]): string {
  if (!projectId) return THIS_APP_LABEL;
  return projects.find((p) => p.id === projectId)?.label ?? projectId;
}

function threadOf(row: ThreadRow, projects: readonly DevProject[], lastAt?: string): SessionThread {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    projectLabel: labelFor(row.project_id, projects),
    sessionId: row.session_id,
    state: stateOf(row.state),
    updatedAt: row.updated_at,
    lastAt: lastAt && lastAt > row.updated_at ? lastAt : row.updated_at,
  };
}

/** Every thread of the person's, the one where something happened last first. */
export async function listSessionThreads(
  core: CoreSupabaseClient,
  userId: string,
  projects: readonly DevProject[],
): Promise<SessionThread[]> {
  const { data, error } = await core
    .from('session_threads')
    .select(THREAD_COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Reading the session threads failed: ${error.message}`);
  const rows = (data ?? []) as ThreadRow[];
  if (rows.length === 0) return [];

  // The newest message in each, since a reply does not touch the thread row.
  const { data: recent } = await core
    .from('session_messages')
    .select('thread_id, created_at')
    .eq('user_id', userId)
    .in('thread_id', rows.map((r) => r.id))
    .order('created_at', { ascending: false })
    .limit(500);
  const last = new Map<string, string>();
  for (const m of (recent ?? []) as { thread_id: string; created_at: string }[]) {
    if (!last.has(m.thread_id)) last.set(m.thread_id, m.created_at);
  }
  return rows
    .map((row) => threadOf(row, projects, last.get(row.id)))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export type SessionThreadPage = {
  thread: SessionThread;
  messages: SessionMessage[];
  /** What the session last reported on its progress row while working, if anything. */
  reported: string | null;
  /** The newest report on its progress row, the first of the run lines under the working line (plan #2789.12). */
  report: SessionProgressReport | null;
};

/** One thread with its messages, oldest first; null when it is not the person's or not there. */
export async function loadSessionThread(
  core: CoreSupabaseClient,
  userId: string,
  threadId: string,
  projects: readonly DevProject[],
): Promise<SessionThreadPage | null> {
  const { data, error } = await core
    .from('session_threads')
    .select(THREAD_COLUMNS)
    .eq('user_id', userId)
    .eq('id', threadId)
    .maybeSingle();
  if (error) throw new Error(`Reading the thread failed: ${error.message}`);
  const row = data as ThreadRow | null;
  if (!row) return null;

  const [{ data: rows, error: messagesError }, { data: progress }] = await Promise.all([
    core
      .from('session_messages')
      .select(MESSAGE_COLUMNS)
      .eq('user_id', userId)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(1000),
    core
      .from('session_progress')
      .select(PROGRESS_COLUMNS)
      .eq('user_id', userId)
      .eq('thread_id', threadId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (messagesError) throw new Error(`Reading the thread's messages failed: ${messagesError.message}`);
  const raw = (rows ?? []) as Record<string, unknown>[];

  const withFiles = raw.filter((r) => typeof r.attachment_path === 'string').map((r) => messageRef(String(r.id)));
  const files = await listAttachments(core, withFiles).catch(() => new Map());
  const messages = raw.flatMap((r) => {
    const file = files.get(messageRef(String(r.id)))?.[0];
    const message = sessionMessageOf(r, file ? { name: file.name, href: file.href } : null);
    return message ? [message] : [];
  });
  const latest = messages.at(-1)?.createdAt;
  const report = progressReportOf(progress as Record<string, unknown> | null);
  return {
    thread: threadOf(row, projects, latest),
    messages,
    reported: report?.state === 'working' ? report.action : null,
    report,
  };
}

export class SessionThreadError extends Error {}

function checkText(text: string, file: UploadedAttachment | null): string {
  const body = text.trim();
  if (!body && !file) throw new SessionThreadError('Write a message or attach a file.');
  if (body.length > SESSION_MESSAGE_MAX) throw new SessionThreadError('That message is too long to send.');
  return body;
}

async function insertMessage(
  core: CoreSupabaseClient,
  userId: string,
  threadId: string,
  body: string,
  file: UploadedAttachment | null,
): Promise<SessionMessage> {
  const { data, error } = await core
    .from('session_messages')
    .insert({
      user_id: userId,
      thread_id: threadId,
      author: 'person',
      kind: 'text',
      body,
      attachment_path: file?.path ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Saving the message failed: ${error?.message ?? 'no row'}`);
  const row = data as Record<string, unknown>;
  let recorded: { name: string; href: string } | null = null;
  if (file) {
    const [kept] = await recordAttachments(core, userId, messageRef(String(row.id)), [file]);
    if (kept) recorded = { name: kept.name, href: kept.href };
  }
  const message = sessionMessageOf(row, recorded);
  if (!message) throw new Error('The saved message could not be read back.');
  return message;
}

/**
 * Start a thread on a project (or this app, with null) with its first
 * message. The thread waits as queued until the broker starts a session on it.
 */
export async function startSessionThread(
  core: CoreSupabaseClient,
  userId: string,
  input: { projectId: string | null; text: string; file: UploadedAttachment | null },
  projects: readonly DevProject[],
): Promise<{ id: string }> {
  const body = checkText(input.text, input.file);
  if (input.projectId && !projects.some((p) => p.id === input.projectId && !p.archivedAt)) {
    throw new SessionThreadError('That project is not one of yours.');
  }
  const title = body ? threadTitleFrom(body) : `About ${input.file?.name ?? 'a file'}`.slice(0, 200);
  const { data, error } = await core
    .from('session_threads')
    .insert({ user_id: userId, title, project_id: input.projectId, state: 'queued' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Starting the thread failed: ${error?.message ?? 'no row'}`);
  const id = (data as { id: string }).id;
  await insertMessage(core, userId, id, body, input.file);
  return { id };
}

/** Your message in a thread of yours. A thread that has ended takes no more. */
export async function sendSessionMessage(
  core: CoreSupabaseClient,
  userId: string,
  input: { threadId: string; text: string; file: UploadedAttachment | null },
): Promise<SessionMessage> {
  const body = checkText(input.text, input.file);
  const { data } = await core
    .from('session_threads')
    .select('id, state')
    .eq('user_id', userId)
    .eq('id', input.threadId)
    .maybeSingle();
  const thread = data as { id: string; state: string } | null;
  if (!thread) throw new SessionThreadError('That thread could not be found.');
  if (thread.state === 'ended') throw new SessionThreadError('This thread has ended. Start a new one to carry on.');
  return insertMessage(core, userId, thread.id, body, input.file);
}

/**
 * Your answer to a question in a thread: one of its options, kept on the
 * question. A second press does not overwrite the first. A thread that was
 * waiting on you goes back to working, as the Inbox's answer does
 * (lib/core/session-questions-store.ts).
 */
export async function answerThreadQuestion(
  core: CoreSupabaseClient,
  userId: string,
  input: { messageId: string; answer: string },
): Promise<{ threadId: string }> {
  const answer = input.answer.trim();
  if (!answer || answer.length > SESSION_ANSWER_MAX) throw new SessionThreadError('Pick one of the options.');
  const { data } = await core
    .from('session_messages')
    .select('id, thread_id, kind, options, answer')
    .eq('user_id', userId)
    .eq('id', input.messageId)
    .maybeSingle();
  const question = data as { id: string; thread_id: string; kind: string; options: unknown; answer: string | null } | null;
  if (!question || question.kind !== 'question') throw new SessionThreadError('That question could not be found.');
  if (question.answer !== null) throw new SessionThreadError('This question already has your answer.');
  const options = Array.isArray(question.options) ? question.options.filter((o): o is string => typeof o === 'string') : [];
  if (options.length > 0 && !options.some((o) => o.trim() === answer)) {
    throw new SessionThreadError('Pick one of the options.');
  }
  const { data: updated, error } = await core
    .from('session_messages')
    .update({ answer, answered_at: new Date().toISOString() })
    .eq('id', question.id)
    .eq('user_id', userId)
    .is('answer', null)
    .select('id');
  if (error) throw new Error(`Saving the answer failed: ${error.message}`);
  if (!updated || updated.length === 0) throw new SessionThreadError('This question already has your answer.');
  await core
    .from('session_threads')
    .update({ state: 'working' })
    .eq('id', question.thread_id)
    .eq('user_id', userId)
    .eq('state', 'waiting');
  return { threadId: question.thread_id };
}

type MockupContext = { id: string; threadId: string; title: string; url: string };

/** A mockup of the session's in a thread of yours that has not ended. */
async function mockupOf(core: CoreSupabaseClient, userId: string, messageId: string): Promise<MockupContext> {
  const { data } = await core
    .from('session_messages')
    .select('id, thread_id, kind, author, body, artifact_url')
    .eq('user_id', userId)
    .eq('id', messageId)
    .maybeSingle();
  const row = data as {
    id: string;
    thread_id: string;
    kind: string;
    author: string;
    body: string;
    artifact_url: string | null;
  } | null;
  if (!row || row.kind !== 'mockup' || row.author !== 'session' || !row.artifact_url) {
    throw new SessionThreadError('That mockup could not be found.');
  }
  const { data: thread } = await core
    .from('session_threads')
    .select('state')
    .eq('user_id', userId)
    .eq('id', row.thread_id)
    .maybeSingle();
  const state = (thread as { state: string } | null)?.state;
  if (!state) throw new SessionThreadError('That thread could not be found.');
  if (state === 'ended') throw new SessionThreadError('This thread has ended. Start a new one to carry on.');
  return { id: row.id, threadId: row.thread_id, title: row.body, url: row.artifact_url };
}

async function insertAbout(
  core: CoreSupabaseClient,
  userId: string,
  mockup: MockupContext,
  body: string,
): Promise<SessionMessage> {
  const { data, error } = await core
    .from('session_messages')
    .insert({
      user_id: userId,
      thread_id: mockup.threadId,
      author: 'person',
      kind: 'text',
      body,
      artifact_url: mockup.url,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Saving the message failed: ${error?.message ?? 'no row'}`);
  const message = sessionMessageOf(data as Record<string, unknown>);
  if (!message) throw new Error('The saved message could not be read back.');
  return message;
}

/** Your note on one of the session's mockups, sent to the session as a reply that names it. */
export async function commentOnMockup(
  core: CoreSupabaseClient,
  userId: string,
  input: { messageId: string; text: string },
): Promise<{ message: SessionMessage; threadId: string }> {
  const note = input.text.trim();
  if (!note) throw new SessionThreadError('Write a note on the mockup.');
  if (note.length > MOCKUP_COMMENT_MAX) throw new SessionThreadError('That note is too long to send.');
  const mockup = await mockupOf(core, userId, input.messageId);
  const message = await insertAbout(core, userId, mockup, commentBody(mockup.title, note));
  return { message, threadId: mockup.threadId };
}

/**
 * Pick one of the session's mockups: "picked" goes to the session, and when
 * the thread is about a plan step (its session reports progress on one) the
 * link goes on that step's detail as a Reference line, which the step's brief
 * carries and its builder registers as the design to match (lib/plan/brief.ts,
 * lib/preview/references.ts). Picking again swaps the earlier pick off the
 * step. `step` is the outline of the step it was saved on, or null.
 */
export async function pickMockup(
  core: CoreSupabaseClient,
  pub: SchemaClient,
  userId: string,
  input: { messageId: string },
): Promise<{ message: SessionMessage; step: string | null; threadId: string }> {
  const mockup = await mockupOf(core, userId, input.messageId);
  const { data: already } = await core
    .from('session_messages')
    .select('artifact_url')
    .eq('user_id', userId)
    .eq('thread_id', mockup.threadId)
    .eq('author', 'person')
    .eq('kind', 'text')
    .not('artifact_url', 'is', null)
    .like('body', `${PICK_OPENING}%`);
  const earlier = ((already ?? []) as { artifact_url: string }[]).map((p) => p.artifact_url);
  if (earlier.includes(mockup.url)) throw new SessionThreadError('You already picked this mockup.');

  const { data: progress } = await core
    .from('session_progress')
    .select('plan_item_id')
    .eq('user_id', userId)
    .eq('thread_id', mockup.threadId)
    .not('plan_item_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const itemId = (progress as { plan_item_id: string } | null)?.plan_item_id ?? null;

  let step: string | null = null;
  if (itemId) {
    const { data: item } = await pub
      .from('plan_items')
      .select('id, detail')
      .eq('user_id', userId)
      .eq('id', itemId)
      .maybeSingle();
    if (item) {
      const detail = detailWithReference((item as { detail: string | null }).detail, mockup.url, earlier);
      const saved = await editPlanItem(pub, { userId, id: itemId, fields: { detail } });
      if ('error' in saved) throw new SessionThreadError(`The step could not take the link: ${saved.error}`);
      const { data: outline } = await pub
        .from('plan_item_outlines')
        .select('outline')
        .eq('user_id', userId)
        .eq('id', itemId)
        .maybeSingle();
      step = (outline as { outline: string } | null)?.outline ?? null;
    }
  }
  const message = await insertAbout(core, userId, mockup, pickBody(mockup.title));
  return { message, step, threadId: mockup.threadId };
}
