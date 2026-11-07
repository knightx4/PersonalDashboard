import type { SessionBriefHandoff } from './handoff-session';
import { sessionHandoffBrief } from './handoff-session';

/**
 * The browser runner (plan #3040.6, under #3040): a script the person starts
 * on their PC or Mac (scripts/browser-runner.ts) that does browser tasks in
 * their own Chrome. A cloud session cannot reach that Chrome
 * (docs/HANDOFF-BROWSER.md), so a runner on the computer it is on starts
 * Claude Code there instead.
 *
 * Every 30 seconds the runner sends its heartbeat
 * (core.browser_runner_heartbeat) and asks for a task
 * (core.claim_browser_task, migration 0312). The claim function puts the PC
 * first: the Mac gets one only when the PC has been quiet for 2 minutes.
 * With a task claimed, the runner checks that Claude in Chrome answers on
 * this computer, with a short Claude Code run that lists the tabs. If it
 * does not, the runner clears the claim and writes nothing else, then stops
 * sending heartbeats for STAND_DOWN_MS, so its claim and heartbeat no longer
 * hold the task: the other computer, or the cloud session, takes it. If it
 * does, the runner marks the hand-off running, as `handoff-session.ts seen`
 * would, so the cloud does not start a second session on it, and runs
 * Claude Code against the hand-off's brief with the Chrome lines below. That
 * session follows dash-backup's "A browser task": it records the route
 * (chrome, with a reason naming this computer), replies in the thread and
 * closes the hand-off itself. One the session left open when it exited is
 * closed failed by the runner, so the thread is told.
 *
 * This file is the loop, with every call to the database and to Claude Code
 * passed in, so the tests stub them.
 */

export type RunnerMachine = 'pc' | 'mac';

export const RUNNER_MACHINES: readonly RunnerMachine[] = ['pc', 'mac'];

/** How often the heartbeat and the claim run. */
export const RUNNER_INTERVAL_MS = 30_000;

/**
 * How long a runner whose Chrome did not answer stays quiet: no heartbeat,
 * no claim. Longer than the claim function's 2 minutes, so the Mac may take
 * the task the PC let go.
 */
export const STAND_DOWN_MS = 5 * 60_000;

/** What the Chrome check is told to answer with. */
export const CHROME_CONNECTED = 'CHROME_CONNECTED';
export const CHROME_NOT_CONNECTED = 'CHROME_NOT_CONNECTED';

/** The computer, as the reply and the route's reason name it. */
export function machineName(machine: RunnerMachine): string {
  return machine === 'pc' ? 'PC' : 'Mac';
}

/** The machine named on the command line, or null. */
export function parseMachine(value: string | undefined): RunnerMachine | null {
  const word = value?.trim().toLowerCase();
  return RUNNER_MACHINES.find((each) => each === word) ?? null;
}

/** The reason the session records with route chrome. */
export function chromeReason(machine: RunnerMachine): string {
  return `Ran on your ${machineName(machine)} in Chrome.`;
}

/**
 * The prompt of the Chrome check: load the Claude in Chrome tools, list the
 * tabs, and answer with one word. It opens nothing and writes nothing.
 */
export const CHROME_CHECK_PROMPT = [
  'Check whether Claude in Chrome is connected on this computer. Do nothing else: open no page, run no command, write nothing.',
  'Load the mcp__claude-in-chrome__* tools with ToolSearch (or call enable__mcp__claude-in-chrome if that is offered instead), then call the tool that lists the open tabs.',
  `If the tabs are listed, answer with exactly ${CHROME_CONNECTED}. If the tools are missing or the call fails, answer with exactly ${CHROME_NOT_CONNECTED}.`,
].join('\n');

/** Whether the Chrome check's answer says Chrome is connected. Anything unclear is no. */
export function chromeAnswer(output: string): boolean {
  const text = output.trim();
  return text.includes(CHROME_CONNECTED) && !text.includes(CHROME_NOT_CONNECTED);
}

/** The lines added under the hand-off's brief for a run in Chrome. */
export function chromeLines(handoffId: string, machine: RunnerMachine): string[] {
  const where = machineName(machine);
  return [
    '',
    `Where this runs: the browser runner on the person's ${where} (scripts/browser-runner.ts, plan #3040.6), in their own Chrome, which answered a moment ago.`,
    'Read "A browser task" in .claude/skills/dash-backup/SKILL.md and take its first route: load the mcp__claude-in-chrome__* tools with ToolSearch, read the chrome-browser skill if it is listed, list the tabs and work in a new tab, leaving the person\'s own tabs alone.',
    `When the work ran in Chrome, record it before you close: npx tsx scripts/handoff-session.ts browser ${handoffId} --route chrome --reason "${chromeReason(machine)}"`,
    'If Chrome stops answering partway, follow the same section for what to do without it.',
    'Make no purchase, send no message and submit no form unless the person asked for that one in the thread. Never ask for, type or store a password.',
    'Reply in the thread and close the hand-off through scripts/handoff-session.ts as the skill says, whatever happened.',
  ];
}

/** The whole prompt of the run on a browser task: the hand-off's brief, then the Chrome lines. */
export function runnerPrompt(handoff: SessionBriefHandoff, userId: string, machine: RunnerMachine): string {
  return [sessionHandoffBrief({ ...handoff, browserTask: true }, userId), ...chromeLines(handoff.id, machine)].join('\n');
}

/**
 * The tools the run may use without asking, since nobody is there to
 * answer: the repository's scripts (scripts/sql.ts, handoff-session.ts and
 * the rest), reading, the skills and Claude in Chrome. No edits to files and
 * no other commands.
 */
export const RUN_TOOLS: readonly string[] = [
  'Bash(npx tsx scripts/*)',
  'Bash(npm run *)',
  'Read',
  'Grep',
  'Glob',
  'ToolSearch',
  'Skill',
  'mcp__claude-in-chrome',
];

/** The Chrome check's tools: finding and calling Claude in Chrome's, nothing else. */
export const CHECK_TOOLS: readonly string[] = ['ToolSearch', 'mcp__claude-in-chrome'];

/** The reason a hand-off left open by the run is closed with. */
export function stoppedReason(machine: RunnerMachine): string {
  return `The session on your ${machineName(machine)} stopped before it finished.`;
}

/** What the runner needs from the database and from Claude Code. */
export type RunnerDeps = {
  machine: RunnerMachine;
  userId: string;
  heartbeat: () => Promise<void>;
  /** core.claim_browser_task: the claimed hand-off's id, or null. */
  claim: () => Promise<string | null>;
  /** The claimed hand-off, or null when it is gone or no longer open. */
  load: (id: string) => Promise<SessionBriefHandoff | null>;
  /** Runs the Chrome check; true when the tabs were listed. */
  chromeConnected: () => Promise<boolean>;
  /** Clears this computer's claim on a hand-off still pending. True when one was cleared. */
  release: (id: string) => Promise<boolean>;
  /** Moves a pending hand-off this computer claimed to running. False when it was not pending. */
  begin: (id: string) => Promise<boolean>;
  /** Runs Claude Code on the prompt with this session id, and waits for it to exit. */
  runClaude: (prompt: string, sessionId: string) => Promise<{ ok: boolean; output: string }>;
  /** The hand-off's stored status after the run. */
  status: (id: string) => Promise<string | null>;
  /** Closes a hand-off the run left open, failed, with the reason, counting that session's cost. */
  closeFailed: (id: string, reason: string, sessionId: string) => Promise<void>;
  newSessionId: () => string;
  now: () => number;
  log: (line: string) => void;
};

/** What the runner holds between ticks. */
export type RunnerState = {
  /** Until when it sends no heartbeat and claims nothing, after Chrome did not answer. */
  quietUntil: number;
};

export type TickResult =
  | { kind: 'quiet' }
  | { kind: 'idle' }
  | { kind: 'gone'; id: string }
  | { kind: 'released'; id: string }
  | { kind: 'taken'; id: string }
  | { kind: 'ran'; id: string; status: string | null; closedByRunner: boolean };

/** Whether the heartbeat should be sent now. */
export function heartbeatDue(state: RunnerState, now: number): boolean {
  return now >= state.quietUntil;
}

/**
 * One pass: claim a task and work it. The heartbeat runs on its own timer
 * (startRunner), so a long run still says the computer is there.
 */
export async function runnerTick(deps: RunnerDeps, state: RunnerState): Promise<TickResult> {
  if (deps.now() < state.quietUntil) return { kind: 'quiet' };

  const id = await deps.claim();
  if (!id) return { kind: 'idle' };
  deps.log(`Claimed hand-off ${id}.`);

  const handoff = await deps.load(id);
  if (!handoff) {
    await deps.release(id);
    deps.log(`Hand-off ${id} is no longer open; let it go.`);
    return { kind: 'gone', id };
  }

  let connected = false;
  try {
    connected = await deps.chromeConnected();
  } catch (error) {
    deps.log(`The Chrome check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!connected) {
    await deps.release(id);
    state.quietUntil = deps.now() + STAND_DOWN_MS;
    deps.log(
      `Claude in Chrome is not connected on this ${machineName(deps.machine)}: let hand-off ${id} go and stay quiet for ${STAND_DOWN_MS / 60_000} minutes.`,
    );
    return { kind: 'released', id };
  }

  if (!(await deps.begin(id))) {
    deps.log(`Hand-off ${id} was started elsewhere.`);
    return { kind: 'taken', id };
  }

  const sessionId = deps.newSessionId();
  deps.log(`Running Claude Code on hand-off ${id} (session ${sessionId}).`);
  const run = await deps.runClaude(runnerPrompt(handoff, deps.userId, deps.machine), sessionId);
  if (!run.ok) deps.log(`Claude Code exited with an error: ${run.output.slice(-500)}`);

  const status = await deps.status(id);
  const open = status === 'pending' || status === 'fired';
  if (open) {
    await deps.closeFailed(id, stoppedReason(deps.machine), sessionId);
    deps.log(`Hand-off ${id} was left open; closed it failed.`);
  } else {
    deps.log(`Hand-off ${id} closed ${status}.`);
  }
  return { kind: 'ran', id, status, closedByRunner: open };
}

/**
 * Runs the loop until the signal aborts: the heartbeat every interval while
 * not quiet, and a tick every interval with one tick at a time.
 */
export async function startRunner(
  deps: RunnerDeps,
  options: {
    intervalMs?: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    setInterval?: (run: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
  } = {},
): Promise<void> {
  const interval = options.intervalMs ?? RUNNER_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const every = options.setInterval ?? ((run: () => void, ms: number) => setInterval(run, ms));
  const stop = options.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  const state: RunnerState = { quietUntil: 0 };

  const beat = async () => {
    if (!heartbeatDue(state, deps.now())) return;
    try {
      await deps.heartbeat();
    } catch (error) {
      deps.log(`The heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await beat();
  const timer = every(() => void beat(), interval);
  try {
    while (!options.signal?.aborted) {
      try {
        const result = await runnerTick(deps, state);
        // Straight on to the next task after one ran; otherwise wait.
        if (result.kind === 'ran' || result.kind === 'taken') continue;
      } catch (error) {
        deps.log(`The pass failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (options.signal?.aborted) break;
      await sleep(interval);
    }
  } finally {
    stop(timer);
  }
}
