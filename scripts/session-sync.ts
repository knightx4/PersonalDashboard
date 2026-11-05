/**
 * Copies each open session's own summary into its progress row (plan #2800.2;
 * .claude/skills/session-broker/SKILL.md and plan/reference/project-dispatch.md).
 *
 *   npm run session-sync -- open
 *       # every open session the broker or dispatcher started, with its ids
 *   npm run session-sync -- copy <session id> --status running|idle|ended|archived
 *       [--summary "<what get_session says it is doing>"] [--activity <ISO time of its last activity>]
 *       # write that into the session's progress row, unless the session
 *       # reported something newer itself (then only the row's time moves)
 *
 * Every read and write is for the app's owner. Needs SUPABASE_SERVICE_ROLE_KEY
 * and the project (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_REF).
 */
import './app-repository';
import { supabaseProjectRef } from '../lib/db/project';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = supabaseProjectRef();
  if (ref) process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused-by-the-service-role';

function flag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

async function main() {
  const { createServiceSchemaSupabase, createServiceSupabase } = await import('@/inngest/supabase-admin');
  const { copySummary, openSessions } = await import('@/lib/plan/session-copy-store');
  const { SESSION_STATUSES } = await import('@/lib/plan/session-copy');

  const [command, ...rest] = process.argv.slice(2);
  const pub = createServiceSupabase();
  const { data: owner } = await pub.rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');
  const clients = { core: createServiceSchemaSupabase('core'), pub, userId };
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

  if (command === 'open') {
    print({ sessions: await openSessions(clients) });
    return;
  }

  if (command === 'copy') {
    const sessionId = rest[0] ?? '';
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) throw new Error('Name the session: npm run session-sync -- copy <session id> --status …');
    const status = flag(rest, '--status') ?? '';
    if (!(SESSION_STATUSES as readonly string[]).includes(status)) {
      throw new Error(`--status is one of ${SESSION_STATUSES.join(', ')}.`);
    }
    const activity = flag(rest, '--activity');
    if (activity && Number.isNaN(Date.parse(activity))) throw new Error('--activity takes a time, such as 2026-11-05T10:00:00Z.');
    const result = await copySummary(clients, {
      sessionId,
      status: status as (typeof SESSION_STATUSES)[number],
      summary: flag(rest, '--summary'),
      activityAt: activity,
    });
    print({ session_id: sessionId, ...result });
    return;
  }

  console.error('Commands: open, copy <session id> --status … [--summary …] [--activity …]');
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
