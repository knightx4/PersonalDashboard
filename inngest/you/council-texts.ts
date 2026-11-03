import 'server-only';

import { createServiceSchemaSupabase } from '@/inngest/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import { runCouncilTick } from '@/inngest/you/council-tick';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { sendToPerson, type PushPayload, type PushPorts, type PushResult } from '@/lib/push/send';
import { isQuietHours, textPayload } from '@/lib/you/council-texts';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The mentors' texts on the phone (plan #2748.7), called every five minutes
 * by pg_cron through /api/cron/council-texts (supabase/migrations-you/0039).
 *
 * A pass finds every text_first message from the last day whose notification
 * has not gone out (pushed_at null), and, for each person outside quiet
 * hours, sends one notification per text naming the mentor and its first
 * line, then records pushed_at. A person in quiet hours keeps theirs until
 * 08:00. A text with no phone to go to is recorded as pushed; one the push
 * service failed on is tried on the next pass. No model is called. The
 * service clients bypass RLS, so every read and write names the person.
 *
 * The same call then runs the council tick, so the daily round starts at the
 * first pass after the person's morning begins rather than only at the daily
 * cron's 12:00 UTC, which is inside quiet hours in New York in winter.
 */

export type PendingText = { id: string; userId: string; mentorName: string; text: string };

export type CouncilTextPorts = {
  /** Texts from `since` on with no notification yet, every person's. */
  pending(since: Date): Promise<PendingText[]>;
  timezone(userId: string): Promise<string>;
  push(userId: string): PushPorts | null;
  pushed(userId: string, ids: string[], at: Date): Promise<void>;
  send(ports: PushPorts, userId: string, payload: PushPayload, now: Date): Promise<PushResult>;
};

export type CouncilTextsSummary = {
  texts: number;
  sent: { userId: string; texts: number }[];
  held: string[];
  failed: string[];
};

/** A text unannounced for longer than this is left alone: a day-old ping is noise. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const ROWS = 500;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function councilTextPorts(you: YouSupabaseClient, core: CoreSupabaseClient): CouncilTextPorts {
  return {
    async pending(since) {
      const { data, error } = await you
        .from('advisor_messages')
        .select('id, user_id, chat_id, text')
        .eq('kind', 'text_first')
        .is('pushed_at', null)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: true })
        .limit(ROWS);
      if (error) throw new Error(`Reading the mentors' new texts failed: ${error.message}`);
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) return [];
      const chatIds = [...new Set(rows.map((r) => str(r.chat_id)))];
      const chats = await you.from('advisor_chats').select('id, advisor_id').in('id', chatIds);
      if (chats.error) throw new Error(`Reading the mentors' threads failed: ${chats.error.message}`);
      const advisorByChat = new Map(
        ((chats.data ?? []) as Record<string, unknown>[]).map((c) => [str(c.id), str(c.advisor_id)]),
      );
      const advisorIds = [...new Set(advisorByChat.values())];
      const advisors = await you.from('board_advisors').select('id, name').in('id', advisorIds);
      if (advisors.error) throw new Error(`Reading the mentors failed: ${advisors.error.message}`);
      const nameById = new Map(
        ((advisors.data ?? []) as Record<string, unknown>[]).map((a) => [str(a.id), str(a.name)]),
      );
      return rows.map((r) => ({
        id: str(r.id),
        userId: str(r.user_id),
        mentorName: nameById.get(advisorByChat.get(str(r.chat_id)) ?? '') ?? '',
        text: str(r.text),
      }));
    },
    async timezone(userId) {
      const { data, error } = await core.from('account_settings').select('timezone').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`Reading the time zone failed: ${error.message}`);
      return str((data as { timezone?: unknown } | null)?.timezone) || 'UTC';
    },
    push(userId) {
      return pushPorts(core, userId);
    },
    async pushed(userId, ids, at) {
      const { error } = await you
        .from('advisor_messages')
        .update({ pushed_at: at.toISOString() })
        .eq('user_id', userId)
        .in('id', ids);
      if (error) throw new Error(`Recording the announced texts failed: ${error.message}`);
    },
    send: sendToPerson,
  };
}

/** One pass: group the new texts by person, hold them in quiet hours, send one notification each, record. */
export async function runCouncilTextsWith(ports: CouncilTextPorts, now: Date): Promise<CouncilTextsSummary> {
  const texts = await ports.pending(new Date(now.getTime() - LOOKBACK_MS));
  const byPerson = new Map<string, PendingText[]>();
  for (const t of texts) {
    if (!t.userId || !t.id) continue;
    byPerson.set(t.userId, [...(byPerson.get(t.userId) ?? []), t]);
  }
  const summary: CouncilTextsSummary = { texts: texts.length, sent: [], held: [], failed: [] };
  for (const [userId, theirs] of byPerson) {
    try {
      if (isQuietHours(now, await ports.timezone(userId))) {
        summary.held.push(userId);
        continue;
      }
      const push = ports.push(userId);
      // Without the signing keys nothing can be sent; keep them for a pass that can.
      if (!push) continue;
      const done: string[] = [];
      for (const t of theirs) {
        const result = await ports.send(push, userId, textPayload({ messageId: t.id, mentorName: t.mentorName, text: t.text }), now);
        // A push service that failed every phone is tried again next pass.
        if (result.failed > 0 && result.sent === 0) continue;
        done.push(t.id);
      }
      if (done.length > 0) await ports.pushed(userId, done, now);
      summary.sent.push({ userId, texts: done.length });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}

export async function runCouncilTexts(now: Date = new Date()): Promise<
  CouncilTextsSummary & { round: { skipped: string } | { started: true; runId: string } | { error: string } }
> {
  const you = createServiceSchemaSupabase('you') as unknown as YouSupabaseClient;
  const summary = await runCouncilTextsWith(councilTextPorts(you, createCoreServiceSupabase()), now);
  let round: { skipped: string } | { started: true; runId: string } | { error: string };
  try {
    round = await runCouncilTick({ now: now.getTime() });
  } catch (err) {
    round = { error: err instanceof Error ? err.message : String(err) };
  }
  return { ...summary, round };
}
