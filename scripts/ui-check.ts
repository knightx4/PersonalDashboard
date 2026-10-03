/**
 * Record one design critic round (plan #1533).
 *
 *   npm run ui-check -- <step or note id> <surface> <round> [--commit <sha>]
 *
 * Reads the critic's verdict, saved unchanged at
 * `.preview-shots/checks/<step or note id>--<surface>--r<round>.json`, keeps a
 * copy of the round's four shots beside it (the next shoot overwrites the
 * originals), uploads them to the private `ui-shots` bucket and writes the
 * round to `public.ui_checks`. Run it after every round, pass or fix, before
 * making the fixes and shooting again. Recording a round twice replaces it.
 *
 * What it can do depends on what the session has:
 *
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: uploads the
 *     shots and writes the row.
 *   - DATABASE_URL only: writes the row, with no shots uploaded.
 *   - neither, as in Claude Code on the web: prints the statement to run
 *     through the Supabase connector, with no shots uploaded. The shots stay
 *     in `.preview-shots/checks/`, and running this again from a session
 *     with the keys uploads them and fills the row in.
 *
 * Exits non-zero when the verdict file is missing or is not the critic's
 * shape, so a round cannot be recorded from a summary.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import {
  bucketPath,
  checkLine,
  checkRow,
  connectorSql,
  keptShotFile,
  parseOwner,
  parseRound,
  parseSurface,
  parseVerdict,
  shotFile,
  SHOT_NAMES,
  UI_SHOTS_BUCKET,
  verdictFile,
  type CheckOwner,
  type ShotName,
} from '../lib/preview/ui-checks';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** Keep this round's shots where the next shoot cannot reach them. */
function keepShots(owner: CheckOwner, surface: string, round: number): ShotName[] {
  const kept: ShotName[] = [];
  for (const shot of SHOT_NAMES) {
    const from = shotFile(surface, shot);
    const to = keptShotFile(owner, surface, round, shot);
    // A copy already kept wins: by the second run of a round, the shots in
    // .preview-shots/ may be the next round's.
    if (!existsSync(to) && existsSync(from)) copyFileSync(from, to);
    if (existsSync(to)) kept.push(shot);
  }
  return kept;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.includes('placeholder')) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  const [ownerArg, surfaceArg, roundArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!ownerArg || !surfaceArg || !roundArg) {
    fail('Usage: npm run ui-check -- <step or note id> <surface> <round> [--commit <sha>]');
  }
  let owner: CheckOwner, surface: string, round: number;
  try {
    owner = parseOwner(ownerArg);
    surface = parseSurface(surfaceArg);
    round = parseRound(roundArg);
  } catch (error) {
    fail((error as Error).message);
  }

  const file = verdictFile(owner, surface, round);
  if (!existsSync(file)) fail(`No verdict at ${file}. Save the critic's json block there first.`);
  let verdict;
  try {
    verdict = parseVerdict(readFileSync(file, 'utf8'), surface, round);
  } catch (error) {
    fail(`${file}: ${(error as Error).message}`);
  }

  const kept = keepShots(owner, surface, round);
  if (kept.length < SHOT_NAMES.length) {
    console.warn(`Only ${kept.length} of the ${SHOT_NAMES.length} shots were found for ${surface}.`);
  }
  const commitArg = arg('--commit');
  const commitSha = commitArg && /^[0-9a-f]{7,40}$/i.test(commitArg) ? commitArg : null;

  const service = serviceClient();
  if (service) {
    const lookup =
      owner.step !== null
        ? service.from('plan_items').select('user_id').eq('number', owner.step).limit(1)
        : service.from('feedback_items').select('user_id').eq('id', owner.noteId).limit(1);
    const { data, error } = await lookup;
    if (error) fail(`Could not find who owns ${ownerArg}: ${error.message}`);
    const userId = (data?.[0] as { user_id?: string } | undefined)?.user_id;
    if (!userId) fail(`No plan step or note matches ${ownerArg}.`);

    const uploaded: string[] = [];
    for (const shot of kept) {
      const path = bucketPath(userId, owner, surface, round, shot);
      const body = readFileSync(keptShotFile(owner, surface, round, shot));
      const { error: upload } = await service.storage
        .from(UI_SHOTS_BUCKET)
        .upload(path, body, { contentType: 'image/png', upsert: true });
      if (upload) fail(`Uploading ${shot} failed: ${upload.message}`);
      uploaded.push(path);
    }

    const row = { user_id: userId, ...checkRow(owner, verdict, uploaded, commitSha) };
    const { error: write } = await service.from('ui_checks').upsert(row, {
      onConflict: owner.step !== null ? 'user_id,step,surface,round' : 'user_id,note_id,surface,round',
    });
    if (write) fail(`Writing the round failed: ${write.message}`);
    console.log(`${checkLine(verdict)}. Recorded, with ${uploaded.length} shots in ${UI_SHOTS_BUCKET}.`);
    return;
  }

  const statement = connectorSql(checkRow(owner, verdict, [], commitSha));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await sql.unsafe(statement);
    } finally {
      await sql.end();
    }
    console.log(`${checkLine(verdict)}. Recorded; the shots are kept in .preview-shots/checks/ but not uploaded.`);
    return;
  }

  console.log(`${checkLine(verdict)}. Nothing here can reach the database.`);
  console.log('Run this through the Supabase connector (execute_sql). The critic text is base64 so no quote reaches it:\n');
  console.log(statement);
  console.log(
    '\nThe shots are kept in .preview-shots/checks/ but not uploaded. ' +
      'Running this again where SUPABASE_SERVICE_ROLE_KEY is set uploads them and fills in the row.',
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
