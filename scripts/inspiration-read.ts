/**
 * Read the inspiration videos for takeaways once, by hand (plan #1409).
 *
 *   npm run inspiration:read
 *
 * Runs lib/dev/inspiration/read.ts for every person with a playlist set, with
 * no time limit: each video whose transcript is in and that has not been read
 * gets one model call, and its takeaways are stored and then merged with the
 * ones already found (plan #1410). Run `npm run
 * inspiration:sync` first to fetch the transcripts. Running it again reads
 * nothing already read.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * ANTHROPIC_API_KEY, from the environment or from .env.local and .env, and
 * EMBEDDING_API_KEY for the merge (without it the takeaways are stored
 * unmerged and the next run with the key merges them). Each call is recorded
 * in core.model_spend under its own operation.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { createCoreServiceSupabase } from '../inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '../inngest/learn/supabase-admin';
import { recordSpend } from '../lib/core/spend/record';
import { readInspirationForEveryone } from '../lib/dev/inspiration/read';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

async function main(): Promise<void> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  const core = createCoreServiceSupabase();
  const spend: Promise<unknown>[] = [];
  const results = await readInspirationForEveryone(createLearnServiceSupabase(), {
    anthropicApiKey,
    onSpend: (userId, report, operation) =>
      void spend.push(
        recordSpend(core, userId, {
          module: 'core',
          operation,
          model: report.model,
          usage: report.usage,
        }),
      ),
  });
  await Promise.all(spend);
  if (results.length === 0) console.log('Nobody has an inspiration playlist set.');
  for (const result of results) {
    console.log(
      `${result.userId}: ${result.read} read, ${result.takeaways} takeaways, ` +
        `${result.merged} merged, ${result.covered} already covered, ${result.failed} failed` +
        (result.stopped ? `; stopped: ${result.stopped}` : '.'),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
