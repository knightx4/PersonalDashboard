import 'server-only';

import { createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import { sendToPerson, type PushPayload, type PushPorts, type PushResult } from '@/lib/push/send';
import { dueNotices, duePayload, type DueNotice } from '@/lib/you/board-due';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The daily board notification (plan #2581.10), called once a day by pg_cron
 * through /api/cron/board-due (supabase/migrations-you/0030). For each person
 * with a check-back or a tripwire whose day has come and that has not been
 * announced, it sends one notification opening the Board tab, then records
 * each announced key in you.board_questions.notified so tomorrow does not
 * send it again. No model is called. The service client bypasses RLS, so
 * every write names the person.
 */

export type BoardDuePorts = {
  /** Decided questions and questions with a watching tripwire, every person's. */
  rows(): Promise<Record<string, unknown>[]>;
  push(userId: string): PushPorts | null;
  /** Record the keys announced on one question. */
  notified(userId: string, questionId: string, keys: Record<string, string>): Promise<void>;
  send(ports: PushPorts, userId: string, payload: PushPayload, now: Date): Promise<PushResult>;
};

export type BoardDueSummary = {
  people: number;
  notified: { userId: string; notices: number; sent: number }[];
  failed: string[];
};

/** Enough rows for every person's open decisions; the job runs once a day. */
const ROWS = 5000;

export function boardDuePorts(you: YouSupabaseClient): BoardDuePorts {
  return {
    async rows() {
      const { data, error } = await you
        .from('board_questions')
        .select('id, user_id, question, status, decided_at, reviews, tripwire, notified')
        .or('status.eq.decided,tripwire->>status.eq.watching')
        .limit(ROWS);
      if (error) throw new Error(`Reading the board's decisions failed: ${error.message}`);
      return (data ?? []) as Record<string, unknown>[];
    },
    push(userId) {
      return pushPorts(createCoreServiceSupabase(), userId);
    },
    async notified(userId, questionId, keys) {
      const { data, error } = await you
        .from('board_questions')
        .select('notified')
        .eq('user_id', userId)
        .eq('id', questionId)
        .maybeSingle();
      if (error) throw new Error(`Reading what was announced failed: ${error.message}`);
      const before = (data as { notified?: Record<string, unknown> } | null)?.notified ?? {};
      const { error: writeError } = await you
        .from('board_questions')
        .update({ notified: { ...before, ...keys } })
        .eq('user_id', userId)
        .eq('id', questionId);
      if (writeError) throw new Error(`Recording what was announced failed: ${writeError.message}`);
    },
    send: sendToPerson,
  };
}

/** One pass: group what is due by person, send, record. */
export async function runBoardDueWith(ports: BoardDuePorts, now: Date): Promise<BoardDueSummary> {
  const today = now.toISOString().slice(0, 10);
  const byPerson = new Map<string, DueNotice[]>();
  for (const row of await ports.rows()) {
    if (typeof row.user_id !== 'string') continue;
    const notices = dueNotices(row, today);
    if (notices.length > 0) byPerson.set(row.user_id, [...(byPerson.get(row.user_id) ?? []), ...notices]);
  }
  const summary: BoardDueSummary = { people: byPerson.size, notified: [], failed: [] };
  for (const [userId, notices] of byPerson) {
    try {
      const push = ports.push(userId);
      // Without the signing keys nothing can be sent; leave it unannounced for a day that can.
      if (!push) continue;
      const result = await ports.send(push, userId, duePayload(notices, today), now);
      // A push service down for a day is tried again tomorrow.
      if (result.failed > 0 && result.sent === 0) continue;
      const at = now.toISOString();
      const byQuestion = new Map<string, Record<string, string>>();
      for (const n of notices) byQuestion.set(n.questionId, { ...(byQuestion.get(n.questionId) ?? {}), [n.key]: at });
      for (const [questionId, keys] of byQuestion) await ports.notified(userId, questionId, keys);
      summary.notified.push({ userId, notices: notices.length, sent: result.sent });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}

export async function runBoardDue(now: Date = new Date()): Promise<BoardDueSummary> {
  const you = createServiceSchemaSupabase('you') as unknown as YouSupabaseClient;
  return runBoardDueWith(boardDuePorts(you), now);
}
