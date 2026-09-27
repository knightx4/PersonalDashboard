import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createServiceSupabase as createJobsServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createTodoServiceSupabase } from '@/inngest/todo/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import { createNewsServiceClient } from '@/lib/news/auth/service';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { recordSpend } from '@/lib/core/spend/record';
import type { CoreOperation } from '@/lib/core/spend/operations';
import { normalizeTimeZone } from '@/lib/core/timezone';
import { agendaFacts, briefDay, goalFact, learnFact, newsFact, type BriefFact } from '@/lib/day-brief/facts';
import { runDraftsFor, type DraftsResult } from '@/lib/drafts/run';
import { draftPorts } from '@/inngest/core/drafts';
import { BRIEF_MODEL, writeBrief } from '@/lib/day-brief/model';
import { runDayBriefFor, type DayBriefPorts, type DayBriefResult } from '@/lib/day-brief/run';
import { dailyView } from '@/lib/goals/daily';
import { briefPayload, sendToPerson, type PushPorts, type PushSubscriptionRow } from '@/lib/push/send';
import { sendWebPush, vapidKeys } from '@/lib/push/web-push';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { readStories } from '@/lib/news/issues/stories';
import type { AgendaClients } from '@/lib/todo/agenda/clients';
import { loadAgenda } from '@/lib/todo/agenda/load';

/**
 * The morning brief run (plan #1123), called every hour by pg_cron through
 * /api/cron/day-brief (supabase/migrations/0113_day_briefs.sql).
 *
 * Works every account whose own clock is in the morning window
 * (lib/day-brief/facts.ts, briefDay) and whose brief for the day is not yet
 * stored. The service clients bypass RLS, so every read names the person:
 * the agenda's loaders and sources all filter by user id or by ids taken
 * from the person's own rows (lib/todo/agenda/clients.ts).
 *
 * `written` in the ports is where the brief leaves the database: it is sent
 * as a phone notification (plan #1124) to every browser the person switched
 * it on for on the account page (core.push_subscriptions).
 *
 * Before the brief, in the same morning window, the run writes the day's
 * follow-ups and return requests (plan #1129, lib/drafts/run.ts), so they
 * are on the agenda the brief is gathered from.
 */

const OPERATION: CoreOperation = 'write-day-brief';

/** How far back a newsletter still counts as this morning's news. */
const NEWS_HOURS = 36;

/** Service-role clients for the agenda, made once per run and shared. */
function serviceClients(): AgendaClients {
  const shopping = createServiceSupabase();
  const jobs = createJobsServiceSupabase();
  const todo = createTodoServiceSupabase();
  const goals = createGoalsServiceSupabase();
  const core = createCoreServiceSupabase();
  const learn = createLearnServiceSupabase();
  const vault = createVaultServiceSupabase();
  return {
    shopping: async () => shopping,
    jobs: async () => jobs,
    todo: async () => todo,
    goals: async () => goals,
    core: async () => core,
    learn: async () => learn,
    vault: async () => vault,
  };
}

type IssueRow = {
  stories: unknown;
  senders: { name: string | null; muted: boolean } | { name: string | null; muted: boolean }[] | null;
};

/** The most important story in the unread newsletters of the last day and a half. */
async function newsStory(userId: string, now: Date): Promise<{ headline: string; sender: string | null } | null> {
  const news = createNewsServiceClient();
  const since = new Date(now.getTime() - NEWS_HOURS * 3_600_000).toISOString();
  const { data, error } = await news
    .from('issues')
    .select('stories, senders!inner ( name, muted )')
    .eq('user_id', userId)
    .is('read_at', null)
    .not('digested_at', 'is', null)
    .eq('senders.muted', false)
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`Reading the newsletters failed: ${error.message}`);

  let best: { headline: string; sender: string | null; importance: number } | null = null;
  for (const row of (data ?? []) as unknown as IssueRow[]) {
    const sender = Array.isArray(row.senders) ? row.senders[0] : row.senders;
    for (const story of readStories(row.stories)) {
      const importance = story.importance ?? 0;
      if (!best || importance > best.importance) {
        best = { headline: story.headline, sender: sender?.name ?? null, importance };
      }
    }
  }
  return best ? { headline: best.headline, sender: best.sender } : null;
}

/** The check question on the next Learn card waiting to be read. */
async function learnQuestion(clients: AgendaClients, userId: string): Promise<string | null> {
  const learn = await clients.learn();
  const { data, error } = await learn
    .from('feed_cards')
    .select('check_question')
    .eq('user_id', userId)
    .eq('status', 'ready')
    .not('context', 'is', null)
    .not('check_question', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Reading the Learn cards failed: ${error.message}`);
  return (data?.check_question as string | undefined) ?? null;
}

/** A part that fails costs its lines, not the brief. */
async function part<T>(work: Promise<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

async function gatherFacts(
  clients: AgendaClients,
  userId: string,
  day: string,
  now: Date,
): Promise<BriefFact[]> {
  const account = await loadAccountSettings(userId, await clients.core());
  const on = (module: Parameters<typeof moduleEnabled>[1]) => moduleEnabled(account, module);

  const [agenda, goal, story, question] = await Promise.all([
    part(
      loadAgenda(userId, now, clients).then((loaded) => agendaFacts(loaded.piles, day, loaded.timezone)),
      [] as BriefFact[],
    ),
    on('goals')
      ? part(
          (async () => {
            const { goals, byGoal } = await loadLiveTree(await clients.goals(), { userId, today: day });
            return goalFact(dailyView(goals, byGoal, day));
          })(),
          null,
        )
      : null,
    on('news') ? part(newsStory(userId, now), null) : null,
    on('learn') ? part(learnQuestion(clients, userId), null) : null,
  ]);

  return [...agenda, goal, newsFact(story), learnFact(question)].filter(
    (fact): fact is BriefFact => fact !== null,
  );
}

/**
 * Where a person's notifications go: their rows in core.push_subscriptions,
 * read and pruned with the service role, so every query names the person or
 * the rows already read for them.
 */
export function pushPorts(core: CoreSupabaseClient, userId: string): PushPorts | null {
  const keys = vapidKeys();
  // Without the keys nothing can be signed; the brief is still on the home page.
  if (!keys) return null;
  return {
    async subscriptions(user) {
      const { data, error } = await core
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', user);
      if (error) throw new Error(`Reading the notification subscriptions failed: ${error.message}`);
      return (data ?? []) as PushSubscriptionRow[];
    },
    send(subscription, payload) {
      return sendWebPush(keys, subscription, payload);
    },
    async forget(ids) {
      const { error } = await core.from('push_subscriptions').delete().eq('user_id', userId).in('id', ids);
      if (error) throw new Error(`Removing a dropped subscription failed: ${error.message}`);
    },
    async sent(ids, at) {
      await core
        .from('push_subscriptions')
        .update({ last_sent_at: at.toISOString() })
        .eq('user_id', userId)
        .in('id', ids);
    },
  };
}

export function dayBriefPorts(core: CoreSupabaseClient, clients: AgendaClients, now: Date): DayBriefPorts {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  return {
    async hasBrief(userId, day) {
      const { data, error } = await core
        .from('day_briefs')
        .select('id')
        .eq('user_id', userId)
        .eq('day', day)
        .limit(1);
      if (error) throw new Error(`Reading today's brief failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    facts(userId, day) {
      return gatherFacts(clients, userId, day, now);
    },

    async write(day, facts, onSpend) {
      // Without a key the plain brief is stored instead.
      if (!apiKey) return null;
      return { model: BRIEF_MODEL, text: await writeBrief(day, facts, { apiKey, onSpend }) };
    },

    async ledger(userId, report) {
      await recordSpend(core, userId, {
        module: 'core',
        operation: OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },

    async save(row) {
      const { data, error } = await core
        .from('day_briefs')
        .upsert(row, { onConflict: 'user_id,day', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`Saving today's brief failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async written(row) {
      const push = pushPorts(core, row.user_id);
      if (!push) return;
      // The brief is saved; a notification that fails costs the buzz, not the day.
      try {
        await sendToPerson(push, row.user_id, briefPayload(row.body, row.day), now);
      } catch {
        // Tried again tomorrow; the home page already shows today's.
      }
    },
  };
}

export type DayBriefsSummary = {
  people: number;
  results: { userId: string; result: DayBriefResult; drafts?: DraftsResult }[];
  failed: string[];
};

export async function runDayBriefs(now: Date = new Date()): Promise<DayBriefsSummary> {
  const core = createCoreServiceSupabase();
  const { data, error } = await core.from('account_settings').select('user_id, timezone');
  if (error) throw new Error(`Reading the accounts failed: ${error.message}`);
  const people = ((data ?? []) as { user_id: string; timezone: string | null }[]).map((row) => ({
    userId: row.user_id,
    timezone: normalizeTimeZone(row.timezone) ?? 'UTC',
  }));

  const clients = serviceClients();
  const ports = dayBriefPorts(core, clients, now);
  const drafting = draftPorts(clients);
  const summary: DayBriefsSummary = { people: people.length, results: [], failed: [] };
  for (const person of people) {
    try {
      const day = briefDay(person.timezone, now);
      let drafts: DraftsResult | undefined;
      if (day) {
        try {
          drafts = await runDraftsFor(drafting, { userId: person.userId, today: day }, now);
        } catch (err) {
          // A failed draft run costs the drafts, not the brief.
          summary.failed.push(`drafts: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      summary.results.push({ userId: person.userId, result: await runDayBriefFor(ports, person, now), drafts });
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
