/**
 * Import a LinkedIn data export from a local zip, through the same reader and
 * engine the Jobs settings page uses (plan #2432.2).
 *
 *   npx tsx scripts/import-linkedin.ts <export.zip> --dry-run
 *   npx tsx scripts/import-linkedin.ts <export.zip> --apply [--user <uuid>]
 *
 * --dry-run prints what it would add, update, leave unchanged, keep because
 * you edited it, and skip, for each kind of record, and writes nothing.
 * --apply writes the rows and their keys and records the run in
 * core.import_runs. Without --user it imports into the owner's account.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL off the cloud
 * session). Every read and write names the one user id.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describePlan } from '../lib/imports/engine';
import { archiveDateFromName, importLinkedIn } from '../lib/imports/linkedin';
import { supabaseImportStore } from '../lib/imports/supabase-store';

const OWNER = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const zip = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--user');
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  const userAt = args.indexOf('--user');
  const userId = userAt >= 0 ? args[userAt + 1] : OWNER;
  if (!zip || dryRun === apply) {
    console.error('Usage: npx tsx scripts/import-linkedin.ts <export.zip> --dry-run | --apply [--user <uuid>]');
    process.exit(1);
  }
  if (!/^[0-9a-f-]{36}$/i.test(userId ?? '')) {
    console.error(`--user ${userId} is not a user id.`);
    process.exit(1);
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is not set. It is needed to write the import.');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://asjztutnqxbecruvyrbj.supabase.co';
  const client = createClient(url, key, { auth: { persistSession: false } });
  const store = supabaseImportStore(client, userId);

  const result = await importLinkedIn(store, new Uint8Array(readFileSync(zip)), {
    dryRun,
    archiveDate: archiveDateFromName(basename(zip)),
  });

  console.log(`${result.archive.files.length} files in the export, ${result.archive.unread.length} not read.`);
  for (const line of describePlan(result.plan)) console.log(line);
  for (const kind of result.plan.kinds) {
    for (const r of kind.records) {
      if (r.outcome === 'kept' || r.outcome === 'skipped') console.log(`  ${kind.kind} ${r.key}: ${r.outcome}. ${r.reason ?? ''}`);
    }
  }
  console.log(dryRun ? 'Dry run: nothing written.' : `Applied as import run ${result.runId}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
