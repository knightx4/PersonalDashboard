import type { SupabaseClient } from '@supabase/supabase-js';
import { ATTACHMENTS_BUCKET } from '@/lib/attachments/rules';
import { PROJECT_COLUMNS, projectFromRow } from '@/lib/plan/projects';
import {
  FILE_LINK_SECONDS,
  jobFor,
  type BrokerJob,
  type BrokerMessage,
  type BrokerRepo,
  type BrokerThread,
} from './broker-model';

/**
 * The broker's reads and writes (plan #2789.6), behind `npm run broker`.
 * Every query names the owner, since the service-role clients pass no RLS.
 * Not server-only: the broker's script runs it under tsx.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, string, any>;

export type BrokerClients = {
  /** The core schema. */
  core: Client;
  /** The public schema, for dev_projects and storage. */
  pub: Client;
  userId: string;
};

const MESSAGE_COLUMNS =
  'id, thread_id, author, kind, body, options, artifact_url, attachment_path, delivered_at, answer, answered_at, created_at';

type MessageRow = {
  id: string;
  thread_id: string;
  author: 'person' | 'session';
  kind: string;
  body: string;
  options: unknown;
  artifact_url: string | null;
  attachment_path: string | null;
  delivered_at: string | null;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

type ThreadRow = { id: string; title: string; project_id: string | null; session_id: string | null; state: string };

function messageOf(row: MessageRow): BrokerMessage {
  return {
    id: row.id,
    author: row.author,
    kind: row.kind,
    body: row.body ?? '',
    options: Array.isArray(row.options) ? row.options.filter((o): o is string => typeof o === 'string') : null,
    artifactUrl: row.artifact_url,
    attachmentPath: row.attachment_path,
    deliveredAt: row.delivered_at,
    answer: row.answer,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
  };
}

function threadOf(row: ThreadRow): BrokerThread {
  return { id: row.id, title: row.title, projectId: row.project_id, sessionId: row.session_id, state: row.state };
}

async function fileLinks(pub: Client, paths: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (paths.length === 0) return links;
  const { data, error } = await pub.storage.from(ATTACHMENTS_BUCKET).createSignedUrls(paths, FILE_LINK_SECONDS);
  if (error) return links;
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) links.set(entry.path, entry.signedUrl);
  }
  return links;
}

/**
 * Every thread with something waiting for its session, as the broker's jobs,
 * oldest waiting first. `appRepo` is this app's repository, for a thread with
 * no project.
 */
export async function brokerJobs(
  clients: BrokerClients,
  input: { appRepo: Omit<BrokerRepo, 'label'>; brokerSessionId: string | null },
): Promise<BrokerJob[]> {
  const { core, pub, userId } = clients;
  const { data: waiting, error } = await core
    .from('session_messages')
    .select('thread_id, created_at')
    .eq('user_id', userId)
    .is('delivered_at', null)
    .or('author.eq.person,and(kind.eq.question,answer.not.is.null)')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(`Reading the waiting messages failed: ${error.message}`);
  const threadIds = [...new Set(((waiting ?? []) as { thread_id: string }[]).map((m) => m.thread_id))];
  if (threadIds.length === 0) return [];

  const { data: threadRows, error: threadError } = await core
    .from('session_threads')
    .select('id, title, project_id, session_id, state')
    .eq('user_id', userId)
    .in('id', threadIds)
    .neq('state', 'ended');
  if (threadError) throw new Error(`Reading the threads failed: ${threadError.message}`);
  const threads = ((threadRows ?? []) as ThreadRow[]).map(threadOf);
  if (threads.length === 0) return [];

  const { data: messageRows, error: messageError } = await core
    .from('session_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', userId)
    .in('thread_id', threads.map((t) => t.id))
    .order('created_at', { ascending: true })
    .limit(5000);
  if (messageError) throw new Error(`Reading the threads' messages failed: ${messageError.message}`);
  const rows = (messageRows ?? []) as MessageRow[];
  const links = await fileLinks(
    pub,
    rows.flatMap((r) => (r.attachment_path ? [r.attachment_path] : [])),
  );

  const projectIds = [...new Set(threads.flatMap((t) => (t.projectId ? [t.projectId] : [])))];
  const repos = new Map<string, BrokerRepo>();
  if (projectIds.length > 0) {
    const { data: projectRows, error: projectError } = await pub
      .from('dev_projects')
      .select(PROJECT_COLUMNS)
      .eq('user_id', userId)
      .in('id', projectIds);
    if (projectError) throw new Error(`Reading the projects failed: ${projectError.message}`);
    for (const row of (projectRows ?? []) as Record<string, unknown>[]) {
      const project = projectFromRow(row);
      if (project) repos.set(project.id, { ...project.repo, label: project.label });
    }
  }
  const app: BrokerRepo = { ...input.appRepo, label: 'This app' };

  const order = new Map(threadIds.map((id, index) => [id, index]));
  return threads
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .flatMap((thread) => {
      const repo = thread.projectId ? repos.get(thread.projectId) : app;
      if (!repo || !repo.owner || !repo.repo) return [];
      const job = jobFor({
        thread,
        messages: rows.filter((r) => r.thread_id === thread.id).map(messageOf),
        repo,
        links,
        brokerSessionId: input.brokerSessionId,
      });
      return job ? [job] : [];
    });
}

/**
 * The broker passed `ids` to the thread's session: mark them delivered, keep
 * the session's id on the thread when it is new, and put the thread to
 * working. Returns how many rows it marked.
 */
export async function markDelivered(
  clients: BrokerClients,
  input: { threadId: string; ids: string[]; sessionId: string | null },
): Promise<number> {
  const { core, userId } = clients;
  const { data: thread, error: threadError } = await core
    .from('session_threads')
    .select('id, state')
    .eq('user_id', userId)
    .eq('id', input.threadId)
    .maybeSingle();
  if (threadError) throw new Error(`Reading the thread failed: ${threadError.message}`);
  if (!thread) throw new Error(`No thread ${input.threadId}.`);

  let marked = 0;
  if (input.ids.length > 0) {
    const { data, error } = await core
      .from('session_messages')
      .update({ delivered_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('thread_id', input.threadId)
      .in('id', input.ids)
      .is('delivered_at', null)
      .select('id');
    if (error) throw new Error(`Marking the messages delivered failed: ${error.message}`);
    marked = (data ?? []).length;
  }

  if ((thread as { state: string }).state !== 'ended') {
    const fields: Record<string, string> = { state: 'working' };
    if (input.sessionId) fields.session_id = input.sessionId;
    const { error } = await core
      .from('session_threads')
      .update(fields)
      .eq('user_id', userId)
      .eq('id', input.threadId);
    if (error) throw new Error(`Updating the thread failed: ${error.message}`);
  }
  return marked;
}

/** Threads whose session is working or waiting, for the broker to check on. */
export async function watchedThreads(clients: BrokerClients): Promise<{ thread_id: string; session_id: string; state: string }[]> {
  const { core, userId } = clients;
  const { data, error } = await core
    .from('session_threads')
    .select('id, session_id, state')
    .eq('user_id', userId)
    .in('state', ['working', 'waiting'])
    .not('session_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Reading the working threads failed: ${error.message}`);
  return ((data ?? []) as { id: string; session_id: string; state: string }[]).map((t) => ({
    thread_id: t.id,
    session_id: t.session_id,
    state: t.state,
  }));
}

/** A thread's session has stopped: idle, so the next message wakes it. Never reopens an ended thread. */
export async function markIdle(clients: BrokerClients, threadId: string): Promise<boolean> {
  const { core, userId } = clients;
  const { data, error } = await core
    .from('session_threads')
    .update({ state: 'idle' })
    .eq('user_id', userId)
    .eq('id', threadId)
    .eq('state', 'working')
    .select('id');
  if (error) throw new Error(`Updating the thread failed: ${error.message}`);
  return (data ?? []).length > 0;
}
