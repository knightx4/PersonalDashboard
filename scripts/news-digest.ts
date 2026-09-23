/**
 * Summarise every stored newsletter that has not been summarised yet.
 *
 *   npm run news:digest
 *   npm run news:digest -- --limit 5
 *
 * New issues are summarised as they arrive (plan #787). This is the catch-up
 * for the rest: the issues stored before that existed, and any arrival whose
 * summary never finished. It takes every issue with no `digested_at`, oldest
 * first, and makes one Haiku call for each, recorded in core.model_spend
 * against the account that owns the issue. An issue the model could not read
 * is saved with its error and not tried again; clear its `digested_at` to
 * queue it for the next run.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * ANTHROPIC_API_KEY, read from the environment or from .env.local and .env.
 *
 * `--conditions=react-server`, which the npm script adds, lets it import the
 * `server-only` modules it shares with the inbound route; see
 * scripts/learn-catalogue.ts for why.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { createCoreServiceSupabase } from '../inngest/core/supabase-admin';
import { createNewsServiceClient } from '../lib/news/auth/service';
import { digestPending } from '../lib/news/issues/summarise';

function loadEnvironment(): void {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
  }
}

function readLimit(args: string[]): number | undefined {
  const at = args.indexOf('--limit');
  if (at === -1) return undefined;
  const limit = Number(args[at + 1]);
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('--limit takes a whole number above 0');
  return limit;
}

async function main(): Promise<void> {
  loadEnvironment();
  const limit = readLimit(process.argv.slice(2));
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const tally = await digestPending({
    news: createNewsServiceClient(),
    spend: createCoreServiceSupabase(),
    anthropicApiKey,
    limit,
    onIssue: (issueId, outcome) => {
      const detail =
        outcome.status === 'digested'
          ? `${outcome.stories.length} stories`
          : outcome.status === 'failed'
            ? outcome.error
            : 'no longer there';
      console.log(`${outcome.status.padEnd(8)} ${issueId}  ${detail}`);
    },
  });

  console.log(`\n${tally.digested} summarised, ${tally.failed} failed, ${tally.missing} missing.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
