/**
 * The lines a run writes without being asked to (plan #1821 follow-up).
 *
 * Run lines were the session's own job: the plan skill told it to write
 * `plan.ts activity` after claiming, after each commit and at the end, and
 * most sessions did not. Of the thirteen feature runs on 12 and 13 October,
 * four wrote any line, so the runner card had nothing to say about what a
 * session was doing.
 *
 * So a Claude Code hook in the repository (scripts/run-line-hook.sh, then
 * scripts/run-line-hook.ts) writes them: one after each tool call that
 * changes something, and Dash's own words between calls as thoughts. This
 * file is the part that decides what a line says and whether it is worth
 * writing. It is pure, so it is tested without a session, a transcript or a
 * database. Reads and searches write nothing: a line per file read would bury
 * the lines that say what changed.
 */

/** Which run a session belongs to, as `startRoutineRun` writes it into the brief. */
export const RUN_MARKER_PREFIX = 'Dash run id:';

/** The marker line appended to a routine's brief. */
export function runMarker(runId: string): string {
  return `${RUN_MARKER_PREFIX} ${runId}`;
}

const MARKER = /Dash run id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

/** The run id in a brief, or null when it carries none. */
export function runIdIn(text: string): string | null {
  return MARKER.exec(text)?.[1] ?? null;
}

export type AutoLine = {
  kind: 'thought' | 'action' | 'error';
  body: string;
  /** Written even when the last line was moments ago: a claim, a commit, a failure. */
  always?: boolean;
};

/** The longest automatic line. The column takes 4000; a card shows one line. */
export const AUTO_LINE_MAX = 600;

/** Shorter than this, Dash's words between calls are a filler ("Now the tests."). */
export const THOUGHT_MIN = 24;

/** Two ordinary action lines closer than this: the second is left out. */
export const ACTION_GAP_MS = 15_000;

function clip(text: string, max = AUTO_LINE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A path relative to the repository, when it is inside it. */
function relative(path: string, cwd: string | null): string {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

/** Commands that only look: listing, reading, searching, asking git what is there. */
const LOOKING =
  /^\s*(?:cd\s+\S+\s*(?:&&|;)\s*)?(?:cat|ls|head|tail|wc|grep|rg|find|echo|pwd|sed\s+-n|awk|jq|sort|diff|git\s+(?:status|log|show|diff|branch|fetch|rev-parse|merge-base|ls-files|blame))\b/;

/** `plan.ts` commands that write a line of their own, or only read. */
const PLAN_QUIET =
  /scripts\/plan\.ts\s+(?:activity|response|show|brief|list|next|needs|ideas|raises|check-backs)\b/;

/** `[branch abc1234] Subject` from git's commit output. */
const COMMITTED = /\[[^\]\n]*?\s([0-9a-f]{7,40})\]\s+(.+)/;

type ToolCall = {
  tool: string;
  input: Record<string, unknown>;
  /** What the tool answered, as text, when the hook has it. */
  output?: string | null;
  cwd?: string | null;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The line one tool call makes, or null when it is not worth one. */
export function lineForTool(call: ToolCall): AutoLine | null {
  const { tool, input } = call;
  const cwd = call.cwd ?? null;

  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const path = text(input.file_path) || text(input.notebook_path);
    if (!path) return null;
    return {
      kind: 'action',
      body: `${tool === 'Write' ? 'Writing' : 'Editing'} ${relative(path, cwd)}`,
    };
  }

  if (tool === 'Task' || tool === 'Agent') {
    const what = text(input.description);
    return what ? { kind: 'action', body: clip(`Sent a helper to ${lowerFirst(what)}`) } : null;
  }

  if (tool !== 'Bash') return null;
  const command = text(input.command);
  const output = call.output ?? '';
  if (!command.trim()) return null;

  const plan = /scripts\/plan\.ts\s+(start|done|block|drop|stopped|land)\s+#?([\d.]+)/.exec(
    command,
  );
  if (plan) {
    const [, verb, ref] = plan;
    const said: Record<string, string> = {
      start: 'Claimed',
      done: 'Closed',
      block: 'Blocked',
      drop: 'Dropped',
      stopped: 'Stopped on',
      land: 'Landed',
    };
    return { kind: 'action', body: `${said[verb]} #${ref}`, always: true };
  }
  if (PLAN_QUIET.test(command)) return null;

  if (/\bgit\s+commit\b/.test(command)) {
    const made = COMMITTED.exec(output);
    if (made)
      return {
        kind: 'action',
        body: clip(`Committed ${made[1].slice(0, 7)}: ${made[2]}`),
        always: true,
      };
    return null;
  }
  if (/\bgit\s+push\b/.test(command)) {
    if (/\brejected\b|\berror:/.test(output)) {
      return {
        kind: 'error',
        body: 'A push was rejected; merging main and trying again.',
        always: true,
      };
    }
    const branch =
      /\bHEAD:(\S+)/.exec(command)?.[1] ?? /\borigin\s+(\S+)\s*$/.exec(command)?.[1] ?? null;
    return { kind: 'action', body: branch ? `Pushed to ${branch}` : 'Pushed', always: true };
  }
  if (/\bnpm\s+run\s+gate\b/.test(command)) {
    const failed = /gate: FAILED at ([^\n]+)/.exec(output);
    if (failed)
      return { kind: 'error', body: clip(`The gate failed at ${failed[1]}`), always: true };
    if (/gate: all clear/.test(output))
      return { kind: 'action', body: 'The gate is all clear', always: true };
    return { kind: 'action', body: 'Running the merge gate' };
  }

  if (LOOKING.test(command)) return null;
  const description = text(input.description).trim();
  if (description) return { kind: 'action', body: clip(description) };
  return { kind: 'action', body: clip(`Ran ${command.split('\n')[0]}`, 160) };
}

function lowerFirst(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

/** Dash's words between tool calls as a thought, or null when they are filler. */
export function lineForThought(words: string): AutoLine | null {
  const body = clip(words);
  if (body.length < THOUGHT_MIN) return null;
  return { kind: 'thought', body };
}

/** What the hook remembers between calls in one session. */
export type AutoLineState = {
  runId: string | null;
  /** Whether the brief has been looked at, so a run-less session stops looking. */
  resolved: boolean;
  lastBody: string | null;
  lastAt: number;
  /** The transcript entry the newest thought came from, so it is written once. */
  lastThoughtId: string | null;
};

export const EMPTY_STATE: AutoLineState = {
  runId: null,
  resolved: false,
  lastBody: null,
  lastAt: 0,
  lastThoughtId: null,
};

/** Whether a line goes in, given what was last written. */
export function worthWriting(line: AutoLine, state: AutoLineState, now: number): boolean {
  if (line.body === state.lastBody) return false;
  if (line.always || line.kind !== 'action') return true;
  return now - state.lastAt >= ACTION_GAP_MS;
}

type TranscriptEntry = {
  type?: string;
  uuid?: string;
  message?: { content?: unknown };
};

function parse(line: string): TranscriptEntry | null {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object' ? (value as TranscriptEntry) : null;
  } catch {
    return null;
  }
}

function textBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      block && typeof block === 'object' && (block as { type?: string }).type === 'text'
        ? String((block as { text?: unknown }).text ?? '')
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * The run id in the session's first message, which is the brief the routine
 * was fired with. Only the first: a later message quoting a marker (this file's
 * own tests, a session reading `runs.ts`) is not the session's run.
 */
export function briefRunId(transcript: readonly string[]): string | null {
  for (const line of transcript) {
    const entry = parse(line);
    if (entry?.type !== 'user') continue;
    return runIdIn(textBlocks(entry.message?.content));
  }
  return null;
}

/** Dash's newest words in the transcript, with the entry they came from. */
export function newestThought(transcript: readonly string[]): { id: string; words: string } | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = parse(transcript[index]);
    if (entry?.type !== 'assistant') continue;
    const words = textBlocks(entry.message?.content).trim();
    if (words) return { id: entry.uuid ?? String(index), words };
  }
  return null;
}
