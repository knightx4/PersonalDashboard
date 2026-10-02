/**
 * Read the Dash inspiration playlist and fetch its transcripts once, by hand
 * (plan #1408).
 *
 *   npm run inspiration:sync
 *
 * Runs lib/dev/inspiration/sync.ts for every person with a playlist set, with
 * no time limit and the month's remaining TranscriptAPI credits as the cap.
 * Running it again spends nothing on a video already fetched.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YOUTUBE_API_KEY
 * and TRANSCRIPTAPI_KEY, from the environment or from .env.local and .env.
 * `--conditions=react-server`, which the npm script adds, lets it import the
 * `server-only` modules.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { createLearnServiceSupabase } from '../inngest/learn/supabase-admin';
import { syncInspirationPlaylists } from '../lib/dev/inspiration/sync';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) loadEnvFile({ path: file, quiet: true });
}

async function main(): Promise<void> {
  const results = await syncInspirationPlaylists(createLearnServiceSupabase(), {
    trigger: 'press',
    maxCredits: Infinity,
  });
  if (results.length === 0) console.log('Nobody has an inspiration playlist set.');
  for (const result of results) {
    const t = result.transcripts;
    console.log(
      `${result.playlistId ?? '(none)'}: ${result.onPlaylist} on the playlist, ${result.added} added, ` +
        `${result.left} gone, ${result.back} back, ${result.unavailable} unavailable; ` +
        `${result.withTranscript} with a transcript` +
        (t ? `; spent ${t.credits} credits (${t.fetched} fetched, ${t.none} no captions, ${t.failed} failed)` : '; spent nothing') +
        (t?.stopped ? `; stopped: ${t.stopped.detail}` : '') +
        (result.error ? `. Error: ${result.error}` : '.'),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
