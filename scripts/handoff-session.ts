/**
 * What a Claude Code session working a session hand-off says about itself
 * (plan #3005.3): that it is still at work, and how it ended, with what it
 * cost.
 *
 *   npx tsx scripts/handoff-session.ts seen <hand-off id>
 *   npx tsx scripts/handoff-session.ts close <hand-off id> --done --reply-turn <id>          # Ask Dash
 *   npx tsx scripts/handoff-session.ts close <hand-off id> --done --reply "<text>" \
 *       [--link "<label>=<path>"]… [--undo]                                                 # People
 *   npx tsx scripts/handoff-session.ts close <hand-off id> --failed "<the reason, in a sentence>"
 *   npx tsx scripts/handoff-session.ts cost              # what this session has cost so far
 *
 * `seen` keeps last_seen_at, so a session gone quiet can be flagged, and
 * moves a hand-off still queued to running. `close` sets it done or failed
 * and counts the session's cost toward spend: one core.model_spend row per
 * model (core / hand-off-session), read from this session's transcripts
 * (lib/talk/handoff-session.ts), and the total on the hand-off's
 * cost_micros. A hand-off already closed is left as it is, and the cost is
 * written only by the call that closed it, so it is never counted twice.
 *
 * Closing also tells the thread (plan #3005.4). Done in an Ask Dash
 * conversation needs the reply turn the session wrote; done in a People chat
 * needs --reply, which the bot posts with each --link as a receipt and, with
 * --undo, a link to Home where the recorded changes have their Undo. Failed
 * tells the thread the reason, unless an Ask reply turn already did. A close
 * that would leave the thread without its result is refused before anything
 * is written.
 *
 * Only the owner's hand-offs (CLAUDE.md, "Only the owner's account is
 * touched"). Connects as scripts/sql.ts does.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { httpsSql, restTransport } from '../lib/db/https-sql';
import { requireSupabaseProjectUrl } from '../lib/db/project';
import {
  CLOSE_SQL,
  closeParameters,
  closeRefusal,
  SEEN_SQL,
  sessionReceipts,
  SPEND_SQL,
  spendParameter,
  TELL_DONE_SQL,
  TELL_FAILED_SQL,
  THREAD_SQL,
  totalSessionMicros,
  transcriptSpend,
  type SessionClose,
} from '../lib/talk/handoff-session';

type Sql = { unsafe: (query: string, parameters?: readonly unknown[]) => Promise<Record<string, unknown>[]> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function connect(): { sql: Sql; end: () => Promise<void> } {
  const url = process.env.DATABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && (process.env.CLAUDE_CODE_REMOTE === 'true' || !url)) {
    const sql = httpsSql(restTransport(requireSupabaseProjectUrl(), key)) as unknown as Sql;
    return { sql, end: async () => {} };
  }
  if (!url) fail('Needs DATABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in a cloud session.');
  const pg = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  return { sql: pg as unknown as Sql, end: () => pg.end({ timeout: 5 }) };
}

async function ownerId(sql: Sql): Promise<string> {
  const [row] = await sql.unsafe('select core.dev_owner_id() as id');
  const id = row?.id as string | null;
  if (!id) fail('No owner is set (core.app_settings.owner_user_id).');
  return id;
}

/** This session's transcript and its subagents', wherever Claude Code keeps them. */
function sessionTranscripts(): string[] {
  const session = process.env.CLAUDE_CODE_SESSION_ID?.trim();
  if (!session) return [];
  const root = join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'), 'projects');
  if (!existsSync(root)) return [];
  const texts: string[] = [];
  for (const project of readdirSync(root)) {
    const main = join(root, project, `${session}.jsonl`);
    if (existsSync(main)) texts.push(readFileSync(main, 'utf8'));
    const subagents = join(root, project, session, 'subagents');
    if (!existsSync(subagents)) continue;
    for (const file of readdirSync(subagents)) {
      if (file.endsWith('.jsonl')) texts.push(readFileSync(join(subagents, file), 'utf8'));
    }
  }
  return texts;
}

function flag(args: string[], name: string): string | null {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) fail(`${name} needs a value.`);
  return value;
}

/** Every value given for a flag that may repeat. */
function flags(args: string[], name: string): string[] {
  const values: string[] = [];
  args.forEach((arg, at) => {
    if (arg !== name) return;
    const value = args[at + 1];
    if (!value || value.startsWith('--')) fail(`${name} needs a value.`);
    values.push(value);
  });
  return values;
}

async function seen(sql: Sql, owner: string, id: string) {
  const rows = await sql.unsafe(SEEN_SQL, [id, owner]);
  if (rows.length === 0) fail(`No open session hand-off ${id} in the owner's account. It may be closed already.`);
  console.log(JSON.stringify(rows[0], null, 2));
}

async function close(sql: Sql, owner: string, id: string, args: string[]) {
  const done = args.includes('--done');
  const reason = flag(args, '--failed');
  if (done === Boolean(reason)) fail('close takes one of --done or --failed "<reason>".');
  const replyTurnId = flag(args, '--reply-turn');
  const noteId = flag(args, '--note');
  for (const value of [replyTurnId, noteId]) if (value && !UUID.test(value)) fail(`${value} is not a uuid.`);
  const reply = flag(args, '--reply');
  const receipts = sessionReceipts(flags(args, '--link'), args.includes('--undo'));
  if (!receipts.ok) fail(receipts.error);

  const [row] = await sql.unsafe(THREAD_SQL, [id, owner]);
  if (!row) fail(`No session hand-off ${id} in the owner's account.`);
  const thread = {
    conversationId: (row.conversation_id as string | null) ?? null,
    advisorChatId: (row.advisor_chat_id as string | null) ?? null,
  };

  const spend = transcriptSpend(sessionTranscripts());
  if (spend.length === 0) console.error('No transcript was found for this session, so no cost is counted.');
  const ending: SessionClose = reason
    ? { outcome: 'failed', reason, replyTurnId, noteId }
    : { outcome: 'done', replyTurnId, noteId };
  const refused = closeRefusal(thread, ending, reply);
  if (refused) fail(refused);
  const [handoff] = await sql.unsafe(CLOSE_SQL, closeParameters(id, owner, ending, spend));
  if (!handoff) fail(`No open session hand-off ${id} in the owner's account. It may be closed already.`);
  // Only the call that closed it gets here, so the cost is counted once.
  const spent = spend.length > 0 ? await sql.unsafe(SPEND_SQL, [owner, spendParameter(spend)]) : [];
  // The thread hears it now; the watch says it for any telling that fails here.
  const [told] =
    ending.outcome === 'failed'
      ? await sql.unsafe(TELL_FAILED_SQL, [id])
      : thread.advisorChatId
        ? await sql.unsafe(TELL_DONE_SQL, [id, owner, reply, JSON.stringify(receipts.receipts)])
        : [];
  console.log(
    JSON.stringify({ handoff, spend_rows: spent.length, told_message: told?.message_id ?? null }, null, 2),
  );
}

async function main() {
  const [command, id, ...rest] = process.argv.slice(2);
  if (command === 'cost') {
    const spend = transcriptSpend(sessionTranscripts());
    console.log(JSON.stringify({ spend, total_micros: totalSessionMicros(spend) }, null, 2));
    return;
  }
  if ((command !== 'seen' && command !== 'close') || !id || !UUID.test(id)) {
    fail(
      'Usage: handoff-session.ts seen <id> | close <id> --done --reply-turn <id> | close <id> --done --reply "<text>" [--link "<label>=<path>"]… [--undo] | close <id> --failed "<reason>" | cost',
    );
  }
  const { sql, end } = connect();
  try {
    const owner = await ownerId(sql);
    if (command === 'seen') await seen(sql, owner, id);
    else await close(sql, owner, id, rest);
  } finally {
    await end();
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
