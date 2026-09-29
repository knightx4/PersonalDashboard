/**
 * How often Jev's pile agrees with the linkers' rules (plan #1173).
 *
 *   npm run mail:piles -- --user <account id>
 *   npm run mail:piles -- --user <account id> --disagreements 40
 *
 * Prints one line per linker, for the pile its rules own, and one per pile no
 * linker owns: how many emails the rules put there, how many Jev did, how
 * many both did, and the share that agree. Then the disagreements, newest
 * first (20 unless --disagreements says otherwise), so the rule or the Jev
 * option behind each can be read.
 *
 * The same numbers without this script:
 * `select * from core.mail_pile_agreement('<account id>');`
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, from the
 * environment or from .env.local and .env. Reads only.
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import { createCoreServiceSupabase } from '../inngest/core/supabase-admin';
import {
  formatAgreement,
  formatDisagreements,
  type AgreementRow,
  type ComparisonRow,
} from '../lib/core/mailroom/report';

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
  const userId = readFlag(args, '--user');
  if (!userId) throw new Error('--user <account id> is required');
  const limit = Number(readFlag(args, '--disagreements') ?? '20');
  if (!Number.isInteger(limit) || limit < 0) throw new Error('--disagreements takes a whole number');

  const core = createCoreServiceSupabase();
  const [agreement, comparison] = await Promise.all([
    core.rpc('mail_pile_agreement', { p_user_id: userId }),
    core.rpc('mail_pile_comparison', { p_user_id: userId }),
  ]);
  if (agreement.error) throw new Error(`reading the agreement failed (${agreement.error.message})`);
  if (comparison.error) throw new Error(`reading the comparison failed (${comparison.error.message})`);

  const rows = ((comparison.data ?? []) as ComparisonRow[]).sort((a, b) =>
    (b.received_at ?? '').localeCompare(a.received_at ?? ''),
  );
  console.log(formatAgreement((agreement.data ?? []) as AgreementRow[], rows.length));
  if (rows.length > 0 && limit > 0) {
    console.log('\nDisagreements, newest first:\n');
    console.log(formatDisagreements(rows, limit));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
