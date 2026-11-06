/**
 * The session broker's side of Chat's session threads (plan #2789.6;
 * .claude/skills/session-broker/SKILL.md).
 *
 *   npm run broker -- pending                        # each thread with something waiting: start or send, with the text
 *   npm run broker -- delivered <thread> --ids a,b [--session <id>]
 *                                                    # those rows reached the session; keep its id on the thread
 *   npm run broker -- watching                       # threads whose session is working or waiting
 *   npm run broker -- idle <thread>                  # its session has stopped; the next message wakes it
 *
 * Every read and write is for the app's owner. Needs SUPABASE_SERVICE_ROLE_KEY
 * and the project (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF).
 * CLAUDE_CODE_REMOTE_SESSION_ID, when set, is written into each prompt as the
 * broker's id.
 */
import './app-repository';
import { supabaseProjectRef } from '../lib/db/project';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = supabaseProjectRef();
  if (ref) process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused-by-the-service-role';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function flag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

async function main() {
  const { createServiceSchemaSupabase, createServiceSupabase } = await import('@/inngest/supabase-admin');
  const { appRepo } = await import('@/lib/plan/github');
  const { brokerJobs, markDelivered, markIdle, watchedThreads } = await import('@/lib/threads/broker-store');

  const [command, ...rest] = process.argv.slice(2);
  const pub = createServiceSupabase();
  const { data: owner } = await pub.rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const clients = { core: createServiceSchemaSupabase('core'), pub, userId };
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

  if (command === 'pending') {
    const repo = appRepo();
    if (!repo.owner || !repo.repo) throw new Error("This app's repository is unknown: set APP_REPOSITORY or run from a checkout.");
    const jobs = await brokerJobs(clients, {
      appRepo: repo,
      brokerSessionId: process.env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim() || null,
    });
    print({ jobs });
    return;
  }

  if (command === 'delivered') {
    const threadId = rest[0] ?? '';
    if (!UUID.test(threadId)) throw new Error('Name the thread: npm run broker -- delivered <thread id> --ids a,b');
    const ids = (flag(rest, '--ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    if (ids.some((id) => !UUID.test(id))) throw new Error('--ids takes message ids, comma-separated.');
    const sessionId = flag(rest, '--session')?.trim() || null;
    const marked = await markDelivered(clients, { threadId, ids, sessionId });
    print({ thread_id: threadId, marked, session_id: sessionId });
    return;
  }

  if (command === 'watching') {
    print({ threads: await watchedThreads(clients) });
    return;
  }

  if (command === 'idle') {
    const threadId = rest[0] ?? '';
    if (!UUID.test(threadId)) throw new Error('Name the thread: npm run broker -- idle <thread id>');
    print({ thread_id: threadId, idle: await markIdle(clients, threadId) });
    return;
  }

  console.error('Commands: pending, delivered <thread> --ids a,b [--session <id>], watching, idle <thread>');
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
