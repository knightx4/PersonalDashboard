import type { TalkToolCall } from '@/lib/talk/talk';
import { LOOKUP_NOT_RUN } from '@/lib/talk/talk';
import { LIMIT_MARKS, UNFINISHED_OPENING } from './grade';

/**
 * How the person's real Ask Dash answers went over a window, usually the last
 * day, worked out from what is already kept: the turns with their lookups and
 * thumbs, and the spend rows of ask-dash. Nothing here reads a database.
 *
 * The alerts are what the nightly run writes a Dev note about and the daily
 * Dash quality session works first. Each threshold is set so that one real
 * failure raises it: an answer that gave up, a lookup that broke, a thumbs
 * down or a reply that says the answer was wrong is always worth a look.
 * This is the check that runs every day, so nothing here calls a model.
 */

export type HealthTurn = {
  id: string;
  body: string;
  toolCalls: readonly TalkToolCall[] | null;
  rating: 'up' | 'down' | null;
  ratingNote: string | null;
  /** What the person wrote next in the same chat, if anything. */
  followUp?: string | null;
};

export type HealthSpend = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costMicros: number | null;
};

/** One call a connected app (claude.ai, Claude Desktop) made through the connector. */
export type HealthConnectorCall = {
  id: string;
  tool: string;
  outcome: 'ok' | 'partial' | 'error' | 'limited';
  error: string | null;
};

export type ToolFailure = { tool: string; count: number; sample: string; turns: string[] };

export type DashHealth = {
  answers: number;
  unfinished: { count: number; turns: string[] };
  limited: { count: number; turns: string[] };
  failedLookups: ToolFailure[];
  skippedLookups: number;
  thumbsDown: { turn: string; note: string | null }[];
  /** Answers the person pushed back on in their next message. */
  pushback: { turn: string; said: string }[];
  /** Calls from connected apps, and the ones that failed or answered in part, by tool. */
  connector: { calls: number; failed: ToolFailure[] };
  calls: number;
  avgPromptTokens: number;
  maxPromptTokens: number;
  costUsd: number;
  alerts: string[];
};

/** A call's whole prompt above this many tokens is flagged: Dash's rules and tools have grown again. */
export const PROMPT_TOKENS_ALERT = 85_000;

/** A tool that fails this many times in the window is flagged, whatever the error. */
export const TOOL_FAILURES_ALERT = 2;

/**
 * The start of a reply that says the answer was wrong or missed something:
 * "no", "that's wrong", "you didn't", "not what I asked". Read without a model,
 * so it costs nothing; the weekly reply check reads the subtler ones.
 */
const PUSHBACK =
  /^\s*(no\b|nope\b|wrong\b|incorrect\b|that'?s (not|wrong|incorrect)|this is (not|wrong)|you (didn'?t|did not|missed|forgot|got)|not what i|i (said|asked|meant)|why (did|didn'?t|did not|can'?t)|that isn'?t|it'?s not|still (not|wrong|didn'?t))/i;

/** Whether a reply to an answer pushes back on it. */
export function pushesBack(reply: string): boolean {
  return PUSHBACK.test(reply);
}

/**
 * An error this way is the app's fault rather than a bad argument, and is
 * flagged the first time. "Could not read" is a lookup that answered with
 * only part of what it was asked: search over the connector read none of the
 * person's workspaces for weeks that way, logged as a clean answer.
 */
const BROKEN = /failed to read the database|timeout|timed out|could not be reached|internal|could not read/i;

/** What a lookup that answered says it could not read, or null. */
function unreadOf(note: unknown): string | null {
  const match = typeof note === 'string' ? note.match(/Could not read: [^.]*\./) : null;
  return match ? match[0] : null;
}

/** Counts one failed call under its tool. */
function countFailure(failures: Map<string, ToolFailure & { broken: boolean }>, tool: string, error: string, at: string) {
  const seen = failures.get(tool) ?? { tool, count: 0, sample: error, turns: [], broken: false };
  seen.count++;
  if (!seen.turns.includes(at)) seen.turns.push(at);
  if (BROKEN.test(error)) {
    seen.broken = true;
    seen.sample = error;
  }
  failures.set(tool, seen);
}

/** The alert lines for a set of failing tools: any that broke, and any that failed again and again. */
function failureAlerts(failures: readonly (ToolFailure & { broken: boolean })[], where: string): string[] {
  return failures
    .filter((f) => f.broken || f.count >= TOOL_FAILURES_ALERT)
    .map((f) => `${where}${f.tool} failed ${f.count} time${f.count === 1 ? '' : 's'}: ${f.sample}`);
}

/** 85000 as "85,000". */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function dashHealth(
  turns: readonly HealthTurn[],
  spend: readonly HealthSpend[],
  connectorCalls: readonly HealthConnectorCall[] = [],
): DashHealth {
  const unfinished: string[] = [];
  const limited: string[] = [];
  const failures = new Map<string, ToolFailure & { broken: boolean }>();
  let skipped = 0;
  const thumbsDown: DashHealth['thumbsDown'] = [];
  const pushback: DashHealth['pushback'] = [];

  for (const turn of turns) {
    if (turn.body.startsWith(UNFINISHED_OPENING)) unfinished.push(turn.id);
    if (LIMIT_MARKS.some((mark) => turn.body.includes(mark))) limited.push(turn.id);
    if (turn.rating === 'down') thumbsDown.push({ turn: turn.id, note: turn.ratingNote });
    if (turn.followUp && pushesBack(turn.followUp)) {
      pushback.push({ turn: turn.id, said: turn.followUp.replace(/\s+/g, ' ').trim().slice(0, 200) });
    }
    for (const call of turn.toolCalls ?? []) {
      const result = call.result as { ok?: unknown; error?: unknown; note?: unknown } | undefined;
      if (!result) continue;
      if (result.ok !== false) {
        const unread = unreadOf(result.note);
        if (unread) countFailure(failures, call.name, unread, turn.id);
        continue;
      }
      const error = typeof result.error === 'string' ? result.error.replace(/\s+/g, ' ').slice(0, 200) : 'no reason given';
      if (error === LOOKUP_NOT_RUN) {
        skipped++;
        continue;
      }
      countFailure(failures, call.name, error, turn.id);
    }
  }

  const prompts = spend.map((s) => s.inputTokens + s.cachedInputTokens + s.cacheWriteTokens);
  const avgPromptTokens = prompts.length ? Math.round(prompts.reduce((a, b) => a + b, 0) / prompts.length) : 0;
  const maxPromptTokens = prompts.length ? Math.max(...prompts) : 0;
  const costUsd = Math.round(spend.reduce((sum, s) => sum + (s.costMicros ?? 0), 0) / 10_000) / 100;

  const failedLookups = [...failures.values()].sort((a, b) => b.count - a.count);
  const fromApps = new Map<string, ToolFailure & { broken: boolean }>();
  for (const call of connectorCalls) {
    if (call.outcome === 'error' || call.outcome === 'partial') {
      countFailure(fromApps, call.tool, (call.error ?? 'no reason given').replace(/\s+/g, ' ').slice(0, 200), call.id);
    }
  }
  const connectorFailed = [...fromApps.values()].sort((a, b) => b.count - a.count);
  const alerts: string[] = [];
  if (unfinished.length > 0) {
    alerts.push(`${unfinished.length} answer${unfinished.length === 1 ? '' : 's'} fell back to "I could not finish".`);
  }
  if (limited.length > 0) {
    alerts.push(`${limited.length} answer${limited.length === 1 ? ' was' : 's were'} cut short by a limit.`);
  }
  if (skipped > 0) alerts.push(`${skipped} lookup${skipped === 1 ? ' was' : 's were'} refused at a limit.`);
  alerts.push(...failureAlerts(failedLookups, 'Lookup '));
  alerts.push(...failureAlerts(connectorFailed, 'Connected apps: '));
  if (thumbsDown.length > 0) {
    alerts.push(`${thumbsDown.length} answer${thumbsDown.length === 1 ? ' was' : 's were'} marked down.`);
  }
  if (pushback.length > 0) {
    alerts.push(`${pushback.length} answer${pushback.length === 1 ? ' was' : 's were'} pushed back on: ${pushback.map((p) => `"${p.said.slice(0, 80)}"`).join('; ')}`);
  }
  if (avgPromptTokens > PROMPT_TOKENS_ALERT) {
    alerts.push(`Calls averaged ${grouped(avgPromptTokens)} prompt tokens, above ${grouped(PROMPT_TOKENS_ALERT)}.`);
  }

  return {
    answers: turns.length,
    unfinished: { count: unfinished.length, turns: unfinished },
    limited: { count: limited.length, turns: limited },
    failedLookups: failedLookups.map(({ broken: _broken, ...f }) => f),
    connector: { calls: connectorCalls.length, failed: connectorFailed.map(({ broken: _broken, ...f }) => f) },
    skippedLookups: skipped,
    thumbsDown,
    pushback,
    calls: spend.length,
    avgPromptTokens,
    maxPromptTokens,
    costUsd,
    alerts,
  };
}
