import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { loadPlan } from '@/lib/plan/load';
import { outlineIndex, refFor } from '@/lib/plan/ref';
import { buildPlanTree } from '@/lib/plan/tree';
import {
  decideFirstText,
  enabledKinds,
  FIRST_TEXT_RULES,
  isTextKind,
  ruleFor,
  STALE_MS,
  type FirstTextRule,
  type TextEvent,
  type TextKind,
} from '@/lib/you/first-texts';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * People text first (plan #2854.1): one pass of the sweep, run by the
 * five-minute council-texts job before it announces texts.
 *
 * For every person on People whose key has a rule in lib/you/first-texts.ts,
 * the pass reads their account's open events (you.first_text_events), names
 * the steps they are about by outline, and lets the rule decide. A send
 * writes the batch into that person's thread as text_first bubbles carrying
 * the rule's key, and closes the events it covers. The first bubble of a
 * batch worth a notification is left unannounced (pushed_at null), so the
 * council-texts sweep that runs next sends it the way it sends every text
 * (inngest/you/council-texts.ts); every other bubble is saved as announced.
 *
 * Events nobody will text are closed once STALE_MS old, whichever account
 * they are in, so the table does not fill for an account with no such
 * person. The service clients bypass RLS, so every other read and write
 * names the person.
 */

export type RulePerson = { id: string; userId: string; key: string; name: string; textWhen: string[] | null };

export type StoredEvent = {
  id: string;
  kind: TextKind;
  createdAt: string;
  planItemId: string | null;
  detail: 'failed' | 'stalled' | null;
};

export type FirstTextPorts = {
  /** Everyone on People with a rule, every account's. */
  people(keys: readonly string[]): Promise<RulePerson[]>;
  open(userId: string): Promise<StoredEvent[]>;
  /** Each step's outline and title, by id. */
  steps(userId: string, ids: readonly string[]): Promise<Map<string, { ref: string; title: string }>>;
  timezone(userId: string): Promise<string>;
  /** Texts this rule has sent the person since `since`. */
  sentSince(userId: string, rule: string, since: Date): Promise<number>;
  /** Writes the bubbles into the person's thread; returns the first one's id. */
  send(input: { person: RulePerson; bubbles: readonly string[]; push: boolean; now: Date }): Promise<string>;
  close(userId: string, ids: readonly string[], messageId: string | null, at: Date): Promise<void>;
  /** Closes every account's events older than `before`. */
  closeStale(before: Date): Promise<number>;
};

export type FirstTextsSummary = {
  sent: { userId: string; rule: string; events: number; push: boolean }[];
  waiting: { userId: string; rule: string; reason: string }[];
  closed: number;
  failed: string[];
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function firstTextPorts(you: YouSupabaseClient, core: CoreSupabaseClient, plan: SupabaseClient): FirstTextPorts {
  return {
    async people(keys) {
      const { data, error } = await you
        .from('board_advisors')
        .select('id, user_id, key, name, text_when')
        .in('key', [...keys])
        .eq('active', true);
      if (error) throw new Error(`Reading who texts first failed: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: str(r.id),
        userId: str(r.user_id),
        key: str(r.key),
        name: str(r.name),
        textWhen: Array.isArray(r.text_when) ? r.text_when.filter((k): k is string => typeof k === 'string') : null,
      }));
    },
    async open(userId) {
      const { data, error } = await you
        .from('first_text_events')
        .select('id, kind, created_at, plan_item_id, detail')
        .eq('user_id', userId)
        .is('closed_at', null)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw new Error(`Reading what is worth a text failed: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).flatMap((r) =>
        isTextKind(r.kind)
          ? [
              {
                id: str(r.id),
                kind: r.kind,
                createdAt: str(r.created_at),
                planItemId: str(r.plan_item_id) || null,
                detail: r.detail === 'failed' || r.detail === 'stalled' ? r.detail : null,
              },
            ]
          : [],
      );
    },
    async steps(userId, ids) {
      const out = new Map<string, { ref: string; title: string }>();
      if (ids.length === 0) return out;
      const data = await loadPlan(plan, userId);
      const outlines = outlineIndex(buildPlanTree(data).flatMap((section) => section.nodes));
      const wanted = new Set(ids);
      for (const item of data.items) {
        if (wanted.has(item.id)) out.set(item.id, { ref: refFor(item.number, outlines), title: item.title });
      }
      return out;
    },
    async timezone(userId) {
      const { data, error } = await core.from('account_settings').select('timezone').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`Reading the time zone failed: ${error.message}`);
      return str((data as { timezone?: unknown } | null)?.timezone) || 'UTC';
    },
    async sentSince(userId, rule, since) {
      // A text is a batch of bubbles; the batch is counted by the bubble its events point at.
      const events = await you
        .from('first_text_events')
        .select('message_id')
        .eq('user_id', userId)
        .not('message_id', 'is', null)
        .gte('closed_at', since.toISOString());
      if (events.error) throw new Error(`Counting today's texts failed: ${events.error.message}`);
      const ids = [...new Set(((events.data ?? []) as Record<string, unknown>[]).map((r) => str(r.message_id)).filter(Boolean))];
      if (ids.length === 0) return 0;
      const mine = await you.from('advisor_messages').select('id').eq('user_id', userId).eq('text_rule', rule).in('id', ids);
      if (mine.error) throw new Error(`Counting today's texts failed: ${mine.error.message}`);
      return (mine.data ?? []).length;
    },
    async send({ person, bubbles, push, now }) {
      const found = await you
        .from('advisor_chats')
        .select('id')
        .eq('user_id', person.userId)
        .eq('advisor_id', person.id)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (found.error) throw new Error(`Reading ${person.name}'s thread failed: ${found.error.message}`);
      let chatId = str((found.data as { id?: unknown } | null)?.id);
      if (!chatId) {
        const made = await you
          .from('advisor_chats')
          .insert({ user_id: person.userId, advisor_id: person.id, title: `Talking with ${person.name}`.slice(0, 200) })
          .select('id')
          .single();
        if (made.error || !made.data) throw new Error(`Starting ${person.name}'s thread failed: ${made.error?.message ?? 'no row'}`);
        chatId = str((made.data as { id?: unknown }).id);
      }
      const at = now.getTime();
      const rows = bubbles.map((text, i) => ({
        user_id: person.userId,
        chat_id: chatId,
        role: 'advisor',
        kind: 'text_first',
        text_rule: person.key,
        text,
        // A millisecond apart, so the bubbles keep their order.
        created_at: new Date(at + i).toISOString(),
        // Only the first bubble of a batch worth it is announced, by the sweep that runs next.
        pushed_at: i === 0 && push ? null : new Date(at + i).toISOString(),
      }));
      const { data, error } = await you.from('advisor_messages').insert(rows).select('id, created_at');
      if (error || !data) throw new Error(`${person.name}'s text was not saved: ${error?.message ?? 'no rows'}`);
      const first = [...(data as Record<string, unknown>[])].sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))[0];
      return str(first?.id);
    },
    async close(userId, ids, messageId, at) {
      if (ids.length === 0) return;
      const { error } = await you
        .from('first_text_events')
        .update({ closed_at: at.toISOString(), message_id: messageId })
        .eq('user_id', userId)
        .in('id', [...ids]);
      if (error) throw new Error(`Closing what was texted failed: ${error.message}`);
    },
    async closeStale(before) {
      const { data, error } = await you
        .from('first_text_events')
        .update({ closed_at: new Date().toISOString() })
        .is('closed_at', null)
        .lt('created_at', before.toISOString())
        .select('id');
      if (error) throw new Error(`Closing old events failed: ${error.message}`);
      return (data ?? []).length;
    },
  };
}

/** One pass over every person with a rule. A failure for one person is recorded and the pass goes on. */
export async function runFirstTextsWith(
  ports: FirstTextPorts,
  now: Date,
  rules: readonly FirstTextRule[] = FIRST_TEXT_RULES,
): Promise<FirstTextsSummary> {
  const summary: FirstTextsSummary = { sent: [], waiting: [], closed: 0, failed: [] };
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const people = rules.length > 0 ? await ports.people(rules.map((r) => r.key)) : [];
  // One person per account and rule: the first found texts.
  const seen = new Set<string>();
  for (const person of people) {
    const rule = rules.find((r) => r.key === person.key) ?? ruleFor(person.key);
    if (!rule || !person.userId || seen.has(`${person.userId}:${rule.key}`)) continue;
    seen.add(`${person.userId}:${rule.key}`);
    try {
      const stored = (await ports.open(person.userId)).filter((e) => rule.kinds.includes(e.kind));
      if (stored.length === 0) continue;
      const fresh = stored.filter((e) => now.getTime() - Date.parse(e.createdAt) < STALE_MS);
      const named = await ports.steps(
        person.userId,
        [...new Set(fresh.map((e) => e.planItemId).filter((id): id is string => !!id))],
      );
      const events: TextEvent[] = stored.map((e) => {
        const step = e.planItemId ? named.get(e.planItemId) : undefined;
        return { id: e.id, kind: e.kind, createdAt: e.createdAt, ref: step?.ref ?? null, title: step?.title ?? null, detail: e.detail };
      });
      const decision = decideFirstText({
        rule,
        enabled: enabledKinds(rule, person.textWhen),
        events,
        now,
        timeZone: await ports.timezone(person.userId),
        sentToday: await ports.sentSince(person.userId, rule.key, dayStart),
      });
      if (decision.close.length > 0) {
        await ports.close(person.userId, decision.close, null, now);
        summary.closed += decision.close.length;
      }
      if (!decision.send) {
        if (decision.reason !== 'nothing') summary.waiting.push({ userId: person.userId, rule: rule.key, reason: decision.reason });
        continue;
      }
      const messageId = await ports.send({ person, bubbles: decision.bubbles, push: decision.push, now });
      await ports.close(person.userId, decision.texted, messageId || null, now);
      summary.sent.push({ userId: person.userId, rule: rule.key, events: decision.texted.length, push: decision.push });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  try {
    summary.closed += await ports.closeStale(new Date(now.getTime() - STALE_MS));
  } catch (err) {
    summary.failed.push(err instanceof Error ? err.message : String(err));
  }
  return summary;
}
