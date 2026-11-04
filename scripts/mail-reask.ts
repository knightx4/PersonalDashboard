/**
 * Ask Jev again about one account's sorted mail, with the pile wording in
 * lib/core/mailroom/question.ts as it stands (plan #2520.1).
 *
 *   npm run mail:reask -- --user <account id>                 # prints what would change
 *   npm run mail:reask -- --user <account id> --write         # stores it
 *   npm run mail:reask -- --user <account id> --piles bill,order,appointment
 *
 * Asks about the mail a linker's rules or Jev put in any of --piles (bill and
 * order unless it says otherwise), prints each email whose pile changes, and
 * with --write updates those rows of core.mail_piles and records what the
 * calls cost under core/sort-email. Identical sender and subject are asked
 * once. Then `npm run mail:piles` counts the new answers.
 *
 * Run it only once the wording it asks with is on main and deployed: the
 * recurring linker routes by the stored piles as soon as the gate opens
 * (lib/core/mailroom/reask.ts says why).
 *
 * Needs TYPESAFE_API_KEY, and SUPABASE_SERVICE_ROLE_KEY (cloud) or
 * DATABASE_URL, from the environment or from .env.local and .env. Every
 * statement names the account, and the write is refused for any account but
 * the owner's (lib/db/sql-guard.ts).
 */
import { existsSync } from 'node:fs';
import { config as loadEnvFile } from 'dotenv';
import postgres from 'postgres';
import { sortEnvelopes } from '../lib/core/mailroom/linker';
import { MAIL_PILES, type MailPile } from '../lib/core/mailroom/question';
import { storedPilesStatement, updatePilesStatement, type StoredPile } from '../lib/core/mailroom/reask';
import { costMicrosFor, type TokenUsage } from '../lib/core/spend/pricing';
import { httpsSql, literal, restTransport } from '../lib/db/https-sql';
import { OWNER_QUERY, sqlRefusal } from '../lib/db/sql-guard';
import { jevApiKey } from '../lib/jev/wire';
import { requireSupabaseProjectUrl } from '../lib/db/project';

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

/** One statement, the way scripts/sql.ts connects. */
async function run(statement: string): Promise<Record<string, unknown>[]> {
  const url = process.env.DATABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && (process.env.CLAUDE_CODE_REMOTE === 'true' || !url)) {
    const rest = requireSupabaseProjectUrl();
    return httpsSql(restTransport(rest, key)).unsafe(statement);
  }
  if (!url) throw new Error('Neither DATABASE_URL nor SUPABASE_SERVICE_ROLE_KEY is set.');
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return (await sql.unsafe(statement)) as unknown as Record<string, unknown>[];
  } finally {
    await sql.end();
  }
}

let owner: Promise<string | null> | null = null;

async function guarded(statement: string): Promise<Record<string, unknown>[]> {
  owner ??= run(OWNER_QUERY).then(([row]) => (typeof row?.id === 'string' ? row.id : null));
  const refused = sqlRefusal(statement, await owner);
  if (refused) throw new Error(refused);
  return run(statement);
}

function spendStatement(userId: string, model: string, usage: TokenUsage): string {
  const cost = costMicrosFor(model, usage);
  return `insert into core.model_spend
  (user_id, module, operation, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, cost_micros)
values (${literal(userId)}, 'core', 'sort-email', ${literal(model)}, ${usage.inputTokens}, ${usage.cachedInputTokens},
  ${usage.cacheWriteTokens}, ${usage.outputTokens}, ${cost ?? 'null'})
returning id`;
}

async function main(): Promise<void> {
  loadEnvironment();
  const args = process.argv.slice(2);
  const userId = readFlag(args, '--user');
  if (!userId) throw new Error('--user <account id> is required');
  const write = args.includes('--write');
  const piles = (readFlag(args, '--piles') ?? 'bill,order').split(',').map((p) => p.trim()) as MailPile[];
  for (const pile of piles) {
    if (!MAIL_PILES.includes(pile)) throw new Error(`--piles takes ${MAIL_PILES.join(', ')}; not ${pile}`);
  }
  if (!jevApiKey()) throw new Error('TYPESAFE_API_KEY is not set.');

  const stored = (await guarded(storedPilesStatement(userId, piles))) as unknown as StoredPile[];
  // Ask once per sender and subject; the answer is copied to every email that shares them.
  const groups = new Map<string, StoredPile[]>();
  for (const row of stored) {
    const key = JSON.stringify([row.from_address, row.reply_to_address, row.subject]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const asked = [...groups.values()].map((rows) => rows[0]);
  const sorted = await sortEnvelopes({
    userId,
    envelopes: asked.map((row) => ({
      id: row.id,
      fromAddress: row.from_address,
      replyToAddress: row.reply_to_address,
      subject: row.subject,
    })),
  });

  const answers = new Map(sorted.rows.map((row) => [row.id, row]));
  const changed = [];
  for (const rows of groups.values()) {
    const answer = answers.get(rows[0].id);
    if (!answer) continue;
    const moved = rows.filter((row) => row.pile !== answer.pile || Math.abs(row.confidence - answer.confidence) > 0.005);
    if (moved.some((row) => row.pile !== answer.pile)) {
      const r = rows[0];
      console.log(
        `x${rows.length} ${r.pile} ${r.confidence.toFixed(2)} -> ${answer.pile} ${answer.confidence.toFixed(2)}` +
          ` (rules: ${r.rule_piles.join(', ') || 'none'}): ${r.from_address ?? 'unknown'} | ${r.subject ?? '(no subject)'}`,
      );
    }
    changed.push(...moved.map((row) => ({ ...answer, id: row.id })));
  }

  const failed = Object.entries(sorted.failed).map(([reason, n]) => `${reason} ${n}`);
  console.log(
    `\n${stored.length} emails, ${asked.length} asked, ${sorted.rows.length} answered` +
      `${sorted.skipped ? `, ${sorted.skipped} with nothing to read` : ''}${failed.length ? `, failed: ${failed.join(', ')}` : ''};` +
      ` ${changed.length} rows to update.`,
  );

  if (!write) {
    console.log('Nothing written. Pass --write to store the new answers.');
    return;
  }
  const update = updatePilesStatement(userId, changed);
  if (update) console.log(`Updated ${(await guarded(update)).length} rows of core.mail_piles.`);

  const byModel = new Map<string, TokenUsage>();
  for (const report of sorted.spend) {
    const sum = byModel.get(report.model) ?? { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
    sum.inputTokens += report.usage.inputTokens;
    sum.cachedInputTokens += report.usage.cachedInputTokens;
    sum.cacheWriteTokens += report.usage.cacheWriteTokens;
    sum.outputTokens += report.usage.outputTokens;
    byModel.set(report.model, sum);
  }
  for (const [model, usage] of byModel) await guarded(spendStatement(userId, model, usage));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
