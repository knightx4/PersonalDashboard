/**
 * Cut the backlog of stored transcripts into clips in one go (plan #1398).
 *
 *   npm run clips:cut
 *   npm run clips:cut -- --limit 50
 *
 * The library run cuts twelve videos a run, four runs a day. This runs the
 * same pass (lib/learn/youtube/clip-run.ts) with no cap and no time limit, so
 * every video with a stored transcript is cut in one sitting: the playlist
 * first, then the followed channels. Each Haiku call is recorded in
 * core.model_spend under learn / cut-clips, against the person the clips are
 * for. Running it again only cuts what is still waiting.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * ANTHROPIC_API_KEY, from the environment or from .env.local and .env.
 * `--conditions=react-server`, which the npm script adds, lets it import the
 * `server-only` modules.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { z } from 'zod';
import { createCoreServiceSupabase } from '../inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '../inngest/learn/supabase-admin';
import { recordSpend } from '../lib/core/spend/record';
import { cutClips } from '../lib/learn/youtube/clip-run';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const at = args.indexOf('--limit');
  const limit = at === -1 ? Infinity : Number(args[at + 1]);
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();
  const { data } = await learn.schema('public').rpc('app_owner');
  const owner = z.object({ userId: z.string() }).safeParse(data);

  const rows: Promise<unknown>[] = [];
  const result = await cutClips(learn, {
    anthropicApiKey,
    owner: owner.success ? owner.data.userId : null,
    deadline: Infinity,
    limit,
    onSpend: (userId, report) =>
      void rows.push(recordSpend(core, userId, { module: 'learn', operation: 'cut-clips', model: report.model, usage: report.usage })),
  });
  await Promise.all(rows);
  console.log(
    `Cut ${result.cut} videos into ${result.clips} clips. ${result.failed} failed and will be tried again, ` +
      `${result.unreadable} could not be read, ${result.waiting} still waiting.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
