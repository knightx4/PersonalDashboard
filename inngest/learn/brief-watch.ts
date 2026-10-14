import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { writeCardsForBrief } from '@/inngest/learn/feed-top-up';
import { recordSpend } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { BRIEF_COLUMNS, briefFromRow, type Brief, type BriefRow } from '@/lib/learn/briefs/model';
import type { RecordSpend } from '@/lib/learn/briefs/research-run';
import { checkDue, nextCheckAt } from '@/lib/learn/briefs/watch';
import { checkBrief, type WatchOutcome } from '@/lib/learn/briefs/watch-run';

/**
 * The weekly check of research briefs for newly published sources, as a
 * stage of the daily cron (plan #2023.8). Vercel's Hobby plan allows one
 * cron, so the week is kept by each brief's own `watched_at`, as the weekly
 * goals run keeps its week (inngest/goals/weekly.ts).
 *
 * Only briefs with the watch switch on are read (off by default, decision
 * #2023.7), and of those only the ready, unarchived ones whose check is due:
 * a week since the last, or a month after four quiet checks in a row. The
 * longest overdue go first, at most three a day inside a minute and a half,
 * so the stage leaves the cron's five minutes to the others; what it does not
 * reach waits for tomorrow.
 *
 * A brief that gained sources has their Learn now cards written in what is
 * left of the stage's time; the hourly top-up writes any it does not reach.
 * Spend goes to the brief's owner under 'research-topic', through the
 * service-role client, since a cron has no session.
 */

const BUDGET_MS = 90_000;
const CARDS_BUDGET_MS = 30_000;
const MAX_PER_RUN = 3;

type WatchRow = BriefRow & { user_id: string };

export type BriefWatchResult =
  | { skipped: string }
  | {
      due: number;
      checked: { briefId: string; outcome: WatchOutcome }[];
      cards: number;
    };

function serviceRecorder(): RecordSpend {
  const core = createCoreServiceSupabase();
  return async (userId, reports) => {
    for (const report of reports) {
      await recordSpend(core, userId, {
        module: 'learn',
        operation: 'research-topic',
        model: report.model,
        usage: report.usage,
      });
    }
  };
}

async function dueBriefs(learn: LearnSupabaseClient, now: number): Promise<(Brief & { userId: string })[]> {
  const { data, error } = await learn
    .from('briefs')
    .select(`user_id, ${BRIEF_COLUMNS}`)
    .eq('watch_on', true)
    .eq('status', 'ready')
    .is('archived_at', null);
  if (error) throw new Error(`Could not read the watched briefs: ${error.message}`);
  return ((data ?? []) as unknown as WatchRow[])
    .map((row) => ({ ...briefFromRow(row), userId: row.user_id }))
    .filter((brief) => checkDue(brief, now))
    .sort((a, b) => nextCheckAt(a) - nextCheckAt(b));
}

export async function runBriefWatch(deps?: {
  learn?: LearnSupabaseClient;
  client?: Anthropic;
  recordSpend?: RecordSpend;
  writeCards?: (userId: string, briefId: string, deadline: number) => Promise<{ written: number } | null>;
  now?: number;
}): Promise<BriefWatchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!deps?.client && !apiKey) return { skipped: 'ANTHROPIC_API_KEY is not set' };
  const learn = deps?.learn ?? createLearnServiceSupabase();
  const now = deps?.now ?? Date.now();
  const deadline = Date.now() + BUDGET_MS;

  const due = await dueBriefs(learn, now);
  if (due.length === 0) return { due: 0, checked: [], cards: 0 };

  const client = deps?.client ?? new Anthropic({ apiKey });
  const record = deps?.recordSpend ?? serviceRecorder();
  const writeCards = deps?.writeCards ?? writeCardsForBrief;

  const checked: { briefId: string; outcome: WatchOutcome; userId: string }[] = [];
  for (const brief of due.slice(0, MAX_PER_RUN)) {
    if (Date.now() >= deadline) break;
    const outcome = await checkBrief(learn, brief, { client, recordSpend: record, now });
    if (!outcome.ok) console.error(`[brief watch] ${brief.id}`, outcome.error);
    checked.push({ briefId: brief.id, outcome, userId: brief.userId });
  }

  let cards = 0;
  const cardsDeadline = Date.now() + CARDS_BUDGET_MS;
  for (const { briefId, outcome, userId } of checked) {
    if (!outcome.ok || outcome.added === 0 || Date.now() >= cardsDeadline) continue;
    const written = await writeCards(userId, briefId, cardsDeadline);
    cards += written?.written ?? 0;
  }

  return { due: due.length, checked: checked.map(({ briefId, outcome }) => ({ briefId, outcome })), cards };
}
