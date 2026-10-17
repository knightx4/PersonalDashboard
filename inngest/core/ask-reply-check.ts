import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { checkAskReplies, REPLY_CHECK_MODEL } from '@/lib/ask/reply-check-model';
import {
  chatsToCheck,
  runReplyCheckFor,
  type CheckTurn,
  type ReplyCheckPorts,
  type ReplyCheckResult,
  type ThumbsDown,
} from '@/lib/ask/reply-check';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { CoreOperation } from '@/lib/core/spend/operations';
import { recordSpend } from '@/lib/core/spend/record';

/**
 * The weekly check of Ask Dash replies that went badly (plan #2285.3), called
 * on Mondays by pg_cron through /api/cron/ask-reply-check
 * (supabase/migrations/0255_ask_reply_check_cron.sql). The rules are
 * lib/ask/reply-check.ts; this fills in its ports.
 *
 * The check is the owner's alone: the note lands in Dev notes, which only the
 * owner reads. The service clients bypass RLS, so every read and write names
 * the owner's id.
 */

const OPERATION: CoreOperation = 'check-ask-replies';

/** The most turns one week's read takes in. */
const MAX_TURNS = 5000;

/** The most ids sent in one `in` filter. */
const IN_CHUNK = 200;

type TurnRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  body: string;
  created_at: string;
};

function chunks<T>(list: readonly T[], size: number = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Which of these chats are Ask Dash chats of this person. */
async function askChatsAmong(core: CoreSupabaseClient, userId: string, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks([...new Set(ids)])) {
    const { data, error } = await core
      .from('conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('subject_kind', 'ask')
      .in('id', part);
    if (error) throw new Error(`Reading the week's chats failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) out.add(row.id);
  }
  return out;
}

export function askReplyCheckPorts(core: CoreSupabaseClient, db: SupabaseClient): ReplyCheckPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  return {
    async hasCheck(userId, week) {
      const { data, error } = await core
        .from('ask_reply_checks')
        .select('id')
        .eq('user_id', userId)
        .eq('week', week)
        .limit(1);
      if (error) throw new Error(`Reading this week's check failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async chats(userId, window) {
      const { data, error } = await core
        .from('conversation_turns')
        .select('id, conversation_id, role, body, created_at')
        .eq('user_id', userId)
        .gte('created_at', window.from)
        .lt('created_at', window.to)
        .order('created_at', { ascending: true })
        .limit(MAX_TURNS);
      if (error) throw new Error(`Reading the week's turns failed: ${error.message}`);
      const turns: CheckTurn[] = ((data ?? []) as TurnRow[]).map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        body: row.body,
        createdAt: row.created_at,
      }));
      const ask = await askChatsAmong(
        core,
        userId,
        turns.map((turn) => turn.conversationId),
      );

      const handedOff = new Set<string>();
      for (const part of chunks([...ask])) {
        const { data: handoffs, error: handoffError } = await core
          .from('dash_handoffs')
          .select('conversation_id')
          .eq('user_id', userId)
          .in('conversation_id', part);
        if (handoffError) throw new Error(`Reading the hand-offs failed: ${handoffError.message}`);
        for (const row of (handoffs ?? []) as { conversation_id: string }[]) handedOff.add(row.conversation_id);
      }
      return chatsToCheck(turns, ask, handedOff, window);
    },

    async thumbsDown(userId, window) {
      const { data, error } = await core
        .from('conversation_turns')
        .select('id, conversation_id, created_at, rating_note')
        .eq('user_id', userId)
        .eq('rating', 'down')
        .gte('rated_at', window.from)
        .lt('rated_at', window.to)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw new Error(`Reading the week's thumbs-down failed: ${error.message}`);
      const rows = (data ?? []) as {
        id: string;
        conversation_id: string;
        created_at: string;
        rating_note: string | null;
      }[];
      const ask = await askChatsAmong(
        core,
        userId,
        rows.map((row) => row.conversation_id),
      );

      const downs: ThumbsDown[] = [];
      for (const row of rows) {
        if (!ask.has(row.conversation_id)) continue;
        const { data: before, error: beforeError } = await core
          .from('conversation_turns')
          .select('body')
          .eq('user_id', userId)
          .eq('conversation_id', row.conversation_id)
          .eq('role', 'user')
          .lt('created_at', row.created_at)
          .order('created_at', { ascending: false })
          .limit(1);
        if (beforeError) throw new Error(`Reading the question before a thumbs-down failed: ${beforeError.message}`);
        downs.push({
          turnId: row.id,
          conversationId: row.conversation_id,
          createdAt: row.created_at,
          note: row.rating_note,
          asked: ((before ?? []) as { body: string }[])[0]?.body ?? null,
        });
      }
      return downs;
    },

    async check(batch, onSpend) {
      // Without a key the week's thumbs-down are still listed.
      if (!apiKey) return null;
      return { model: REPLY_CHECK_MODEL, flags: await checkAskReplies(batch, { apiKey, onSpend }) };
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'core',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async claim(row) {
      const { data, error } = await core
        .from('ask_reply_checks')
        .upsert(row, { onConflict: 'user_id,week', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`Saving this week's check failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async writeNote(userId, body) {
      // Straight into the queue as a bug on /ask, without triage: it is
      // already sorted, and the notes run reads it as it stands.
      const { data, error } = await db
        .from('feedback_items')
        .insert({ user_id: userId, kind: 'bug', body, page_path: '/ask' })
        .select('id')
        .single();
      if (error || !data?.id) throw new Error(`Writing the Dev note failed: ${error?.message ?? 'no id'}`);
      return String(data.id);
    },

    async linkNote(userId, week, noteId) {
      const { error } = await core
        .from('ask_reply_checks')
        .update({ note_id: noteId })
        .eq('user_id', userId)
        .eq('week', week);
      if (error) throw new Error(`Linking this week's note failed: ${error.message}`);
    },

    async release(userId, week) {
      await core.from('ask_reply_checks').delete().eq('user_id', userId).eq('week', week).is('note_id', null);
    },
  };
}

const ownerSchema = z.object({ userId: z.string().uuid() });

export type AskReplyCheckSummary = { userId: string; result: ReplyCheckResult };

/** The owner's check of the week just gone. */
export async function runAskReplyCheck(now: Date = new Date()): Promise<AskReplyCheckSummary> {
  const db = createServiceSupabase();
  const owner = await db.rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to check for.');
  const userId = parsed.data.userId;

  const ports = askReplyCheckPorts(createCoreServiceSupabase(), db);
  return { userId, result: await runReplyCheckFor(ports, userId, now) };
}
