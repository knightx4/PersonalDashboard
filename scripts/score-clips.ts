/**
 * Score every clip waiting for one in one go (plan #1401).
 *
 *   npm run clips:score
 *   npm run clips:score -- --limit 50
 *
 * The library run scores up to 160 clips a person a run, after cutting. This
 * runs the same pass (lib/learn/clips/score-run.ts) with no cap or time limit: every
 * clip with no score, and every unseen clip scored against tracks and goals
 * that have since changed. Jev scores each clip where the account has opted
 * in; Haiku scores the rest. Spend is recorded in core.model_spend under
 * learn / score-clips, against the person the clips are for. Run it after
 * `npm run clips:cut` to score a backlog just cut.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and
 * TYPESAFE_API_KEY, ANTHROPIC_API_KEY or both, from the environment or from
 * .env.local and .env. `--conditions=react-server`, which the npm script
 * adds, lets it import the `server-only` modules.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { createCoreServiceSupabase } from '../inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '../inngest/learn/supabase-admin';
import { recordSpend } from '../lib/core/spend/record';
import { jevEnabledFor } from '../lib/jev/enabled';
import { haikuClient } from '../lib/learn/clips/score-jev';
import { scoreClips } from '../lib/learn/clips/score-run';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const at = args.indexOf('--limit');
  const limit = at === -1 ? Infinity : Number(args[at + 1]);
  const client = haikuClient(process.env.ANTHROPIC_API_KEY);
  if (!client && !process.env.TYPESAFE_API_KEY?.trim()) {
    throw new Error('Neither TYPESAFE_API_KEY nor ANTHROPIC_API_KEY is set.');
  }

  const learn = createLearnServiceSupabase();
  const core = createCoreServiceSupabase();
  const rows: Promise<unknown>[] = [];
  const total = { scored: 0, byJev: 0, byHaiku: 0, rescored: 0, unscored: 0, failed: 0 };
  // A pass reads at most a thousand clips a person, so passes repeat until
  // one scores nothing.
  for (let left = limit; left > 0; ) {
    const result = await scoreClips(learn, {
      client,
      jevEnabled: (userId) => jevEnabledFor(core, userId),
      deadline: Infinity,
      limit: Math.min(left, 1000),
      onSpend: (userId, report) =>
        void rows.push(recordSpend(core, userId, { module: 'learn', operation: 'score-clips', model: report.model, usage: report.usage })),
    });
    total.scored += result.scored;
    total.byJev += result.byJev;
    total.byHaiku += result.byHaiku;
    total.rescored += result.rescored;
    total.unscored = result.unscored;
    total.failed += result.failed;
    left -= result.scored;
    if (result.scored === 0 || result.unscored > 0) break;
  }
  await Promise.all(rows);
  console.log(
    `Scored ${total.scored} clips (${total.byJev} by Jev, ${total.byHaiku} by Haiku; ${total.rescored} scored again). ` +
      `${total.unscored} left unscored, ${total.failed} calls failed.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
