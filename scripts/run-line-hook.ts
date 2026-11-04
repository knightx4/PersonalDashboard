/**
 * Write a run line for what the session just did (lib/plan/auto-line.ts).
 *
 * Started by scripts/run-line-hook.sh after each tool call and when the
 * session stops, in the background so the session never waits on it. Handed
 * the path of a file holding the hook's JSON, which the wrapper wrote from
 * stdin before detaching.
 *
 * The session's run is the one named in its brief: `startRoutineRun` writes
 * "Dash run id: <uuid>" into every brief it fires. A session with no run, one
 * started by hand, writes nothing, and says so to no one: the hook is a
 * by-product of working, and a failure in it must never surface as one in the
 * session.
 *
 *   npx tsx scripts/run-line-hook.ts <hook-json-file>
 *
 * Writes through the REST API when SUPABASE_SERVICE_ROLE_KEY is set, calling
 * public.write_run_lines (migration 0240). A cloud session has to: its proxy
 * carries HTTPS and nothing else, so DATABASE_URL cannot reach Postgres from
 * there. Without the key it connects with DATABASE_URL, which works locally.
 */
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  briefRunId,
  EMPTY_STATE,
  lineForThought,
  lineForTool,
  newestThought,
  worthWriting,
  type AutoLine,
  type AutoLineState,
} from '../lib/plan/auto-line';
import { requireSupabaseProjectUrl } from '../lib/db/project';

type HookInput = {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
};

/** How much of the transcript is read from each end. */
const WINDOW = 256 * 1024;

function slice(path: string, fromEnd: boolean): string[] {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    const length = Math.min(size, WINDOW);
    const start = fromEnd ? size - length : 0;
    const buffer = Buffer.alloc(length);
    fd = openSync(path, 'r');
    readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString('utf8').split('\n');
    // A window cut mid-line leaves a partial entry at the cut; drop it.
    if (fromEnd && start > 0) lines.shift();
    if (!fromEnd && length < size) lines.pop();
    return lines.filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function outputText(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const { stdout, stderr } = response as { stdout?: unknown; stderr?: unknown };
    if (typeof stdout === 'string' || typeof stderr === 'string') {
      return [stdout, stderr].filter((part) => typeof part === 'string').join('\n');
    }
    try {
      return JSON.stringify(response).slice(0, 20_000);
    } catch {
      return '';
    }
  }
  return '';
}

function statePath(session: string): string {
  return join(tmpdir(), `dash-run-line-${session.replace(/[^\w-]/g, '')}.json`);
}

function loadState(path: string): AutoLineState {
  try {
    return {
      ...EMPTY_STATE,
      ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<AutoLineState>),
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** What writing a run's lines came to: written, or the run takes no more. */
type Written = 'written' | 'over' | 'missing';

async function writeOverHttps(key: string, runId: string, lines: AutoLine[]): Promise<Written> {
  const base = requireSupabaseProjectUrl();
  const response = await fetch(`${base}/rest/v1/rpc/write_run_lines`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_run_id: runId,
      p_lines: lines.map(({ kind, body }) => ({ kind, body })),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`write_run_lines answered ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as Written;
}

async function writeOverPostgres(url: string, runId: string, lines: AutoLine[]): Promise<Written> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const [run] = await sql<{ id: string; user_id: string; status: string }[]>`
      select id, user_id, status from plan_runs where id = ${runId}`;
    if (!run) return 'missing';
    if (run.status === 'finished' || run.status === 'failed') return 'over';
    for (const line of lines) {
      await sql`
        insert into core.run_activities (user_id, run_table, run_id, kind, body)
        values (${run.user_id}, 'plan_runs', ${run.id}, ${line.kind}, ${line.body})`;
    }
    // A line means the run is alive again, so a stale mark comes off. A wait
    // on the person's answer stays: a session keeps working while it waits,
    // and an automatic line is not the answer.
    if (run.status === 'stale') {
      await sql`update plan_runs set status = 'started' where id = ${run.id} and status = 'stale'`;
    }
    return 'written';
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.DATABASE_URL;
  if (!file || (!key && !url)) return;
  let input: HookInput;
  try {
    input = JSON.parse(readFileSync(file, 'utf8')) as HookInput;
  } finally {
    rmSync(file, { force: true });
  }
  if (!input.session_id || !input.transcript_path) return;

  const where = statePath(input.session_id);
  const state = loadState(where);
  if (!state.resolved) {
    state.runId = briefRunId(slice(input.transcript_path, false));
    state.resolved = true;
  }
  if (!state.runId) {
    writeFileSync(where, JSON.stringify(state));
    return;
  }

  const now = Date.now();
  const lines: AutoLine[] = [];
  // Dash's words come before the call they led to. They count as sent only
  // once a write succeeds, so a failed one tries them again next call.
  const thought = newestThought(slice(input.transcript_path, true));
  let thoughtId: string | null = null;
  if (thought && thought.id !== state.lastThoughtId) {
    thoughtId = thought.id;
    const line = lineForThought(thought.words);
    if (line) lines.push(line);
  }
  if (input.hook_event_name === 'PostToolUse' && input.tool_name) {
    const line = lineForTool({
      tool: input.tool_name,
      input: input.tool_input ?? {},
      output: outputText(input.tool_response),
      cwd: input.cwd ?? null,
    });
    if (line) lines.push(line);
  }
  const keep = lines.filter((line) => worthWriting(line, state, now));
  if (keep.length === 0) {
    if (thoughtId) state.lastThoughtId = thoughtId;
    writeFileSync(where, JSON.stringify(state));
    return;
  }

  try {
    const written = key
      ? await writeOverHttps(key, state.runId, keep)
      : await writeOverPostgres(url!, state.runId, keep);
    if (thoughtId) state.lastThoughtId = thoughtId;
    if (written === 'written') {
      state.lastBody = keep[keep.length - 1].body;
      state.lastAt = now;
    } else {
      // A run already written back as over, or gone, takes no more lines.
      state.runId = null;
    }
  } finally {
    writeFileSync(where, JSON.stringify(state));
  }
}

main().catch((err: unknown) => {
  // Nobody reads this: the wrapper sends it to /dev/null. It is here for a
  // person running the script by hand.
  console.error(`run-line hook: ${err instanceof Error ? err.message : String(err)}`);
});
