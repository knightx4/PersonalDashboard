/**
 * Tag the clips already cut with every subject they serve, in one go (plan #1696).
 *
 *   npm run clips:tag
 *   npm run clips:tag -- --batches 2
 *
 * The library run tags three batches of fifty a run. This runs the same pass
 * (lib/learn/youtube/clip-tag-run.ts) with no cap and no time limit, so every
 * clip not yet checked is read in one sitting, by caption and idea, with no
 * transcript fetched. Each Haiku call is recorded in core.model_spend under
 * learn / tag-clips, against the person the clips are for. Running it again
 * reads nothing: every clip it read is marked checked, whether it fit a
 * subject or not, and no tag is ever removed.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * ANTHROPIC_API_KEY, from the environment or from .env.local and .env.
 * `--conditions=react-server`, which the npm script adds, lets it import the
 * `server-only` modules.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { createCoreServiceSupabase } from '../inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '../inngest/learn/supabase-admin';
import { recordSpend } from '../lib/core/spend/record';
import { tagUntaggedClips } from '../lib/learn/youtube/clip-tag-run';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const at = args.indexOf('--batches');
  const maxBatches = at === -1 ? Infinity : Number(args[at + 1]);
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();
  const rows: Promise<unknown>[] = [];
  const result = await tagUntaggedClips(learn, {
    anthropicApiKey,
    deadline: Infinity,
    maxBatches,
    onSpend: (userId, report) =>
      void rows.push(recordSpend(core, userId, { module: 'learn', operation: 'tag-clips', model: report.model, usage: report.usage })),
  });
  await Promise.all(rows);
  console.log(
    `Read ${result.checked} clips: ${result.tagged} tagged with ${result.tags} new subject tags, ${result.fitNothing} fit nothing. ` +
      `${result.failed} batches failed and will be tried again, ${result.waiting} clips still to read.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
