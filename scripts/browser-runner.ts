/**
 * The browser runner: does the person's browser tasks in their own Chrome,
 * on the computer it is started on (plan #3040.6; the loop is in
 * lib/talk/browser-runner.ts).
 *
 *   npm run browser-runner -- pc
 *   npm run browser-runner -- mac
 *
 * Start it from a checkout of this repository on the PC or the Mac, with
 * Chrome open and Claude in Chrome connected, and Claude Code (`claude`)
 * signed in on that computer. It sends a heartbeat every 30 seconds, claims
 * the oldest browser task (the PC first: the Mac takes one only when the
 * PC's runner has been quiet for 2 minutes), checks that Claude in Chrome
 * answers, and runs `claude -p --chrome` against the hand-off's brief. Stop
 * it with Ctrl-C.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and the project (NEXT_PUBLIC_SUPABASE_URL
 * or SUPABASE_PROJECT_REF), as scripts/session-broker.ts does, and holds no
 * other credential. CLAUDE_BIN names another `claude` to run. Every read and
 * write is for the app's owner.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { supabaseProjectRef } from '../lib/db/project';
import {
  CHECK_TOOLS,
  CHROME_CHECK_PROMPT,
  chromeAnswer,
  machineName,
  parseMachine,
  RUN_TOOLS,
  startRunner,
  type RunnerDeps,
  type RunnerMachine,
} from '../lib/talk/browser-runner';
import type { SessionBriefHandoff } from '../lib/talk/handoff-session';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const ref = supabaseProjectRef();
  if (ref) process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused-by-the-service-role';

/** A run longer than this is stopped; the watch fails a hand-off quiet for 90 minutes anyway. */
const RUN_TIMEOUT_MS = 2 * 60 * 60_000;
const CHECK_TIMEOUT_MS = 3 * 60_000;

const windows = process.platform === 'win32';

/** Runs a command with the prompt on stdin, and returns what it printed. */
function run(
  command: string,
  args: readonly string[],
  input: string,
  env: NodeJS.ProcessEnv,
  timeout: number,
  echo: boolean,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // On Windows `claude` is a .cmd, which needs a shell, and the shell needs each argument quoted.
    const child = windows
      ? spawn([command, ...args].map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(' '), {
          shell: true,
          env,
          timeout,
        })
      : spawn(command, [...args], { env, timeout });
    let output = '';
    const take = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (echo) process.stdout.write(text);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => resolve({ ok: false, output: `${output}\n${error.message}` }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
    child.stdin.end(input);
  });
}

async function main() {
  const machine = parseMachine(process.argv[2]);
  if (!machine) {
    console.error('Name this computer: npm run browser-runner -- pc, or npm run browser-runner -- mac');
    process.exit(1);
  }

  const { createServiceSchemaSupabase, createServiceSupabase } = await import('@/inngest/supabase-admin');
  const pub = createServiceSupabase();
  const core = createServiceSchemaSupabase('core');
  const { data: owner } = await pub.rpc('app_owner');
  const userId = (owner as { userId?: string } | null)?.userId;
  if (!userId) throw new Error('No owner account.');

  const claude = process.env.CLAUDE_BIN?.trim() || 'claude';
  const log = (line: string) => console.log(`${new Date().toLocaleTimeString()} ${line}`);

  const deps: RunnerDeps = {
    machine,
    userId,
    heartbeat: async () => {
      const { error } = await core.rpc('browser_runner_heartbeat', { p_machine: machine });
      if (error) throw new Error(error.message);
    },
    claim: async () => {
      const { data, error } = await core.rpc('claim_browser_task', { p_machine: machine });
      if (error) throw new Error(`The claim failed: ${error.message}`);
      return typeof data === 'string' ? data : null;
    },
    load: async (id) => {
      const { data, error } = await core
        .from('dash_handoffs')
        .select('id, advisor_id, conversation_id, advisor_chat_id, request, asked, summary, refs')
        .eq('id', id)
        .eq('user_id', userId)
        .eq('kind', 'session')
        .eq('status', 'pending')
        .eq('claimed_by', machine)
        .maybeSingle();
      if (error) throw new Error(`Reading the hand-off failed: ${error.message}`);
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        id: String(row.id),
        advisorId: (row.advisor_id as string | null) ?? null,
        conversationId: (row.conversation_id as string | null) ?? null,
        advisorChatId: (row.advisor_chat_id as string | null) ?? null,
        request: String(row.request ?? ''),
        asked: String(row.asked ?? ''),
        summary: (row.summary as string | null) ?? null,
        refs: Array.isArray(row.refs) ? (row.refs as SessionBriefHandoff['refs']) : [],
        browserTask: true,
      };
    },
    chromeConnected: async () => {
      const check = await run(
        claude,
        ['-p', '--chrome', '--model', 'haiku', '--max-turns', '8', '--allowedTools', CHECK_TOOLS.join(',')],
        CHROME_CHECK_PROMPT,
        process.env,
        CHECK_TIMEOUT_MS,
        false,
      );
      return check.ok && chromeAnswer(check.output);
    },
    release: async (id) => {
      const { data, error } = await core
        .from('dash_handoffs')
        .update({ claimed_by: null, claimed_at: null })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('claimed_by', machine)
        .eq('status', 'pending')
        .select('id');
      if (error) throw new Error(`Letting the hand-off go failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    begin: async (id) => {
      const now = new Date().toISOString();
      const { data, error } = await core
        .from('dash_handoffs')
        .update({ status: 'fired', fired_at: now, last_seen_at: now })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('kind', 'session')
        .eq('claimed_by', machine)
        .eq('status', 'pending')
        .select('id');
      if (error) throw new Error(`Starting the hand-off failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    runClaude: (prompt, sessionId) =>
      run(
        claude,
        ['-p', '--chrome', '--session-id', sessionId, '--allowedTools', RUN_TOOLS.join(',')],
        prompt,
        // handoff-session.ts close reads the session's transcript by this id to count its cost.
        { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId },
        RUN_TIMEOUT_MS,
        true,
      ),
    status: async (id) => {
      const { data, error } = await core
        .from('dash_handoffs')
        .select('status')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(`Reading the hand-off failed: ${error.message}`);
      return (data as { status?: string } | null)?.status ?? null;
    },
    closeFailed: async (id, reason, sessionId) => {
      const closed = await run(
        'npx',
        ['tsx', 'scripts/handoff-session.ts', 'close', id, '--failed', reason],
        '',
        { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId },
        CHECK_TIMEOUT_MS,
        true,
      );
      if (!closed.ok) log(`Closing hand-off ${id} failed: ${closed.output.slice(-500)}`);
    },
    newSessionId: () => randomUUID(),
    now: () => Date.now(),
    log,
  };

  const stop = new AbortController();
  process.on('SIGINT', () => {
    if (stop.signal.aborted) process.exit(130);
    log('Stopping after this pass. Press Ctrl-C again to stop now.');
    stop.abort();
  });
  log(`Browser runner on your ${machineName(machine as RunnerMachine)}: a heartbeat and a look for tasks every 30 seconds.`);
  await startRunner(deps, { signal: stop.signal });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
