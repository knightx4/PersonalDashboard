/**
 * Measure how often a week of newsletters tells the same story (plan #872).
 *
 *   npm run news:repeats -- --user <account id>
 *   npm run news:repeats -- --user <account id> --days 7
 *
 * Reads the account's news.issues that arrived in the last seven days, embeds
 * each story's headline and summary with the Voyage helper the vault map uses,
 * and compares every pair of stories from different newsletters that arrived
 * within two days of each other. It prints how many pairs clear each cut-off
 * from 0.70 to 0.90, then the two headlines of every pair in each band, so the
 * band where different events start being joined can be read off by eye.
 *
 * Nothing is stored except the spend: the embedding call is recorded in
 * core.model_spend under module 'news', operation 'measure-repeats', against
 * the account whose stories were embedded.
 *
 * `--user` can be left off when only one account received newsletters in the
 * window. Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * EMBEDDING_API_KEY, from the environment or from .env.local and .env.
 * `--conditions=react-server`, which the npm script adds, lets it import the
 * `server-only` modules; see scripts/learn-catalogue.ts for why.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { createCoreServiceSupabase } from '../inngest/core/supabase-admin';
import type { SpendReport } from '../lib/core/spend/pricing';
import { recordSpend } from '../lib/core/spend/record';
import { createNewsServiceClient } from '../lib/news/auth/service';
import { embedTexts } from '../lib/learn/embed/embed';
import {
  bandPairs,
  countsAtCutoffs,
  repeatText,
  REPEAT_CUTOFFS,
  similarPairs,
  type PlacedStory,
} from '../lib/news/issues/repeats';
import { readStories } from '../lib/news/issues/stories';

const OPERATION = 'measure-repeats';
const DAY_MS = 24 * 60 * 60 * 1000;

function loadEnvironment(): void {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
  }
}

function readFlag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} takes a value`);
  return value;
}

async function main(): Promise<void> {
  loadEnvironment();
  const args = process.argv.slice(2);
  const days = Number(readFlag(args, '--days') ?? '7');
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days takes a number above 0');

  const news = createNewsServiceClient();
  const since = new Date(Date.now() - days * DAY_MS).toISOString();

  let userId = readFlag(args, '--user');
  if (!userId) {
    const { data, error } = await news.from('issues').select('user_id').gte('received_at', since);
    if (error) throw new Error(`news: reading issues failed (${error.message})`);
    const owners = [...new Set((data ?? []).map((row) => row.user_id as string))];
    if (owners.length !== 1) {
      throw new Error(
        `${owners.length} accounts received newsletters in the window; name one with --user`,
      );
    }
    userId = owners[0];
  }

  const [issues, senders] = await Promise.all([
    news
      .from('issues')
      .select('id, sender_id, received_at, stories')
      .eq('user_id', userId)
      .gte('received_at', since)
      .order('received_at', { ascending: true }),
    news.from('senders').select('id, name, email').eq('user_id', userId),
  ]);
  if (issues.error) throw new Error(`news: reading issues failed (${issues.error.message})`);
  if (senders.error) throw new Error(`news: reading senders failed (${senders.error.message})`);

  const senderName = new Map<string, string>();
  for (const row of senders.data ?? []) {
    senderName.set(
      row.id as string,
      ((row.name as string | null) ?? '').trim() || (row.email as string),
    );
  }

  const stories: PlacedStory[] = [];
  for (const issue of issues.data ?? []) {
    // An issue with no sender row still gets a sender of its own, so its
    // stories are compared with everything else rather than with nothing.
    const senderId = (issue.sender_id as string | null) ?? `issue:${issue.id as string}`;
    readStories(issue.stories).forEach((story, index) => {
      stories.push({
        issueId: issue.id as string,
        index,
        senderId,
        senderName: senderName.get(senderId) ?? 'unknown sender',
        receivedAt: Date.parse(issue.received_at as string),
        story,
      });
    });
  }

  const issueCount = issues.data?.length ?? 0;
  const newsletters = new Set(stories.map((story) => story.senderId)).size;
  console.log(
    `${issueCount} issues from ${newsletters} newsletters in the last ${days} days, ${stories.length} stories.`,
  );
  if (stories.length < 2) return;

  const core = createCoreServiceSupabase();
  const reports: SpendReport[] = [];
  const outcome = await embedTexts({
    texts: stories.map((placed) => repeatText(placed.story)),
    inputType: 'document',
    onSpend: (report) => reports.push(report),
  });
  for (const report of reports) {
    await recordSpend(core, userId, {
      module: 'news',
      operation: OPERATION,
      model: report.model,
      usage: report.usage,
    });
  }
  if (!outcome.ok) throw new Error(`embedding failed (${outcome.reason}): ${outcome.detail}`);
  console.log(`Embedded with ${outcome.model}, ${outcome.tokens} tokens.\n`);

  const floor = Math.min(...REPEAT_CUTOFFS);
  const pairs = similarPairs(stories, outcome.vectors, floor);

  console.log('Pairs at or above each cut-off:');
  for (const row of countsAtCutoffs(pairs)) {
    console.log(`  ${row.cutoff.toFixed(2)}  ${row.pairs}`);
  }

  for (const band of bandPairs(pairs)) {
    const label =
      band.to === null
        ? `${band.from.toFixed(2)} and above`
        : `${band.from.toFixed(2)} to ${band.to.toFixed(2)}`;
    console.log(`\n${label}: ${band.pairs.length} pairs`);
    for (const pair of band.pairs) {
      console.log(
        `  ${pair.similarity.toFixed(3)}  [${pair.a.senderName}] ${pair.a.story.headline}`,
      );
      console.log(`         [${pair.b.senderName}] ${pair.b.story.headline}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
