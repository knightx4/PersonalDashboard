'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/auth/client';
import {
  PROGRESS_COLUMNS,
  heardThreadOf,
  latestSessionLine,
  mergeReports,
  mergeThreadMessages,
  progressReportOf,
  type HeardThread,
  type SessionProgressReport,
} from '@/lib/core/session-thread-live';
import { sessionMessageOf, type SessionMessage } from '@/lib/core/session-threads-model';

/** Whether the channel is open: connecting, heard, or cut off (and the page falls back to re-reading). */
export type SessionLiveConnection = 'connecting' | 'open' | 'lost';

export type SessionThreadLive = {
  /** The server's messages with every one heard since, oldest first, each once. */
  messages: SessionMessage[];
  /** The thread's row as last heard, to lay over what the server read. */
  heard: HeardThread | null;
  /** Each report the session made on its progress row, oldest first. */
  reports: SessionProgressReport[];
  /** Ids of messages and lines that came in while the page was open. */
  arrived: ReadonlySet<string>;
  connection: SessionLiveConnection;
  /** The newest thing the session said it is doing since your last message. */
  latest: string | null;
};

const MESSAGE_COLUMNS =
  'id, author, kind, body, options, artifact_url, attachment_path, answer, answered_at, created_at';

/**
 * One session thread, kept current over Realtime (plan #2789.12), the way a
 * plan step's run lines are (components/runs/live-run-lines.tsx).
 *
 * It holds one channel for the thread: inserts and updates on
 * core.session_messages for the thread (a reply, a question, a mockup, a
 * status line, an answer), updates to its core.session_threads row (its
 * state), and inserts and updates on core.session_progress for the thread
 * (each report). It subscribes before it reads, so nothing written between
 * the two is missed, and the merge drops what arrives both ways. All three
 * tables are in the supabase_realtime publication (migration 0301) and
 * Realtime reads each event through the viewer's RLS, so only the owner
 * hears anything.
 *
 * `messages` and `report` are what the server read; left empty, the hook
 * reads them itself once the channel is open, which is how the Ask Dash line
 * for a question handed to a session uses it (#2789.11). Off while `threadId`
 * is null or `enabled` is false.
 */
export function useSessionThreadLive({
  threadId,
  messages: server = [],
  report = null,
  enabled = true,
}: {
  threadId: string | null;
  messages?: readonly SessionMessage[];
  report?: SessionProgressReport | null;
  enabled?: boolean;
}): SessionThreadLive {
  const [heardMessages, setHeardMessages] = useState<SessionMessage[]>([]);
  const [heard, setHeard] = useState<HeardThread | null>(null);
  const [heardReports, setReports] = useState<SessionProgressReport[]>([]);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  const [connection, setConnection] = useState<SessionLiveConnection>('connecting');
  const on = enabled && threadId !== null;

  useEffect(() => {
    if (!on || !threadId) return;
    const supabase = createClient();
    const core = supabase.schema('core');
    let gone = false;

    const hearMessage = (row: unknown, fresh: boolean) => {
      const m = sessionMessageOf((row ?? {}) as Record<string, unknown>);
      if (!m || gone) return;
      setHeardMessages((held) => mergeThreadMessages(held, [m]));
      if (fresh) setArrived((ids) => new Set(ids).add(m.id));
    };
    const hearReport = (row: unknown, fresh: boolean) => {
      const r = progressReportOf(row as Record<string, unknown> | null);
      if (!r || gone) return;
      setReports((held) => mergeReports(held, [r]));
      if (fresh) setArrived((ids) => new Set(ids).add(`progress:${r.key}`));
    };
    const hearThread = (row: unknown) => {
      const t = heardThreadOf(row as Record<string, unknown> | null);
      if (!t || gone) return;
      setHeard((was) => (was && Date.parse(was.updatedAt) > Date.parse(t.updatedAt) ? was : t));
    };

    const read = async () => {
      const [messages, thread, progress] = await Promise.all([
        core
          .from('session_messages')
          .select(MESSAGE_COLUMNS)
          .eq('thread_id', threadId)
          .order('created_at', { ascending: true })
          .limit(1000),
        core.from('session_threads').select('state, session_id, updated_at').eq('id', threadId).maybeSingle(),
        core.from('session_progress').select(PROGRESS_COLUMNS).eq('thread_id', threadId),
      ]);
      if (gone) return;
      for (const row of messages.data ?? []) hearMessage(row, false);
      if (thread.data) hearThread(thread.data);
      for (const row of progress.data ?? []) hearReport(row, false);
    };

    const thread = `thread_id=eq.${threadId}`;
    const channel = supabase
      .channel(`session-thread:${threadId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'core', table: 'session_messages', filter: thread }, (p) =>
        hearMessage(p.new, true),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'core', table: 'session_messages', filter: thread }, (p) =>
        hearMessage(p.new, false),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'core', table: 'session_threads', filter: `id=eq.${threadId}` }, (p) =>
        hearThread(p.new),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'core', table: 'session_progress', filter: thread }, (p) =>
        hearReport(p.new, true),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'core', table: 'session_progress', filter: thread }, (p) =>
        hearReport(p.new, true),
      )
      .subscribe((status) => {
        if (gone) return;
        if (status === 'SUBSCRIBED') {
          setConnection('open');
          // Read after subscribing, so nothing falls between the two.
          void read();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('lost');
        }
      });

    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [on, threadId]);

  // The report the server read joins the ones heard.
  const reports = useMemo(() => mergeReports(heardReports, report ? [report] : []), [heardReports, report]);
  const messages = useMemo(() => mergeThreadMessages(server, heardMessages), [server, heardMessages]);
  const latest = useMemo(() => latestSessionLine(messages, reports), [messages, reports]);
  return { messages, heard, reports, arrived, connection: on ? connection : 'open', latest };
}
