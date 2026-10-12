/**
 * A feature whose last two runs closed nothing, raised to the person with the
 * cause (plan #1803).
 *
 * The overnight runner already held a feature whose two sessions in one night
 * closed nothing and raised it with "send it again?" (`heldRaise` in
 * inngest/dev/overnight.ts). That raise could not say why, and it only saw the
 * runner's own fires. This reads every build run on the feature, whoever sent
 * it, and quotes the line each session wrote when it stopped (#1802).
 *
 * The rules, all pure so the tick and the tests agree:
 *
 * - The runs on a feature are the build runs (`step` and `feature` jobs) fired
 *   at the feature or at any row beneath it. A re-shape or a comment reply
 *   closes no step by design, and counting them would raise features that
 *   are fine.
 * - A stall is the two newest of those both ending `failed`. A run ends
 *   `finished` when a step under it closed or blocked (`runEnd`), so a block
 *   counts as closing here too.
 * - One open raise per feature, the old held raise included. Nor is a second
 *   raised for the stall the person has already answered: a raise filed after
 *   the newest run is about this stall.
 * - A raise holds its feature from the overnight runner until a run is fired
 *   at it after the raise was filed or answered. A Yes sends one, which
 *   releases it; a No sends nothing, so the feature stays held until it is
 *   sent by hand. A dismissed raise holds nothing.
 * - A feature with no steps whose session left the pieces it would split into
 *   is asked "Split it into N steps?" instead (#1804). Its Yes is
 *   `split_feature`: lib/comments/act.ts reads the pieces back off the runs the
 *   raise's source names, writes them as ready steps and sends the first, and
 *   that run releases the hold the same way.
 */
import { checkDay } from './check-backs';
import { isClosed, isDismissed } from './load';
import type { RunJob } from './run-end';
import { flatten, isWaiting, isWaitingOnThePerson, type PlanNode } from './tree';

/** The jobs whose runs build steps, and so can close one. */
export const STALL_JOBS: readonly RunJob[] = ['step', 'feature'];

/** How many runs in a row closing nothing make a stall. */
export const STALL_RUNS = 2;

/** One run on a feature, as the stall check reads it. */
export type StallRun = {
  id: string;
  planItemId: string;
  status: string;
  createdAt: string;
  /** The session's own line on why it stopped (#1802), or null. */
  stopReason: string | null;
  /** The steps a session that found the work too big would split it into. */
  stopPieces: string[] | null;
  /** The app's note on a run it ended, such as the silence cutoff. */
  error: string | null;
};

/** A raise already filed about a feature, as the stall check reads it. */
export type FeatureRaise = {
  status: string;
  createdAt: string;
  answeredAt: string | null;
};

/** The feature a raise is about. */
export type StallFeature = {
  id: string;
  number: number;
  title: string;
  module: string | null;
};

/** A step a raise names as the one its feature is stuck on. */
export type StuckStep = { number: number; title: string };

/**
 * The step a feature's sessions were stuck on: its first build row that is
 * neither done nor dropped, or null. Naming it lets the person see at a glance
 * whether the step waits on something no session can supply, such as two
 * weeks of data still to collect.
 */
export function stuckStep(feature: {
  children: readonly { kind: string; status: string; number: number; title: string }[];
}): StuckStep | null {
  const row = feature.children.find(
    (child) => child.kind === 'build' && child.status !== 'done' && child.status !== 'dropped',
  );
  return row ? { number: row.number, title: row.title } : null;
}

/**
 * Whether a raise's `source` is one of the runner's own (a held or stalled
 * feature), whose ids mean nothing to read. The raise page names the runner
 * instead of printing them.
 */
export function isRunnerSource(source: string | null | undefined): boolean {
  return raiseFeatureId(source) !== null;
}

/** The title every raise about a stuck feature carries. */
export function stuckTitle(named: string): string {
  return cut(`${named}: two sessions in a row finished nothing`, 200);
}

/** The one question a raise about a stuck feature asks when there is no split. */
export function stuckAsk(named: string): string {
  return cut(`Try ${named} again?`, 500);
}

/**
 * The paragraph naming the step a feature is stuck on, with the reason the
 * person most often needs: that a step waiting on time or on them will stop
 * the same way if it is sent again. Empty with no step to name.
 */
export function stuckLine(step: StuckStep | null | undefined): string {
  if (!step) return '';
  return (
    `The step it is stuck on is #${step.number} ${step.title}. If that step waits on something ` +
    'that has not happened yet, such as data still to collect or a setup only you can do, ' +
    'trying again will stop the same way. Close with a reason in that case.'
  );
}

/** The two prefixes a raise about a held feature is filed under. */
const HELD_PREFIX = 'overnight held ';
const STALL_PREFIX = 'stalled ';

/**
 * The feature a raise's `source` names, for either kind of held raise, or
 * null for any other source.
 */
export function raiseFeatureId(source: string | null | undefined): string | null {
  if (!source) return null;
  const rest = source.startsWith(HELD_PREFIX)
    ? source.slice(HELD_PREFIX.length)
    : source.startsWith(STALL_PREFIX)
      ? source.slice(STALL_PREFIX.length)
      : null;
  const id = rest?.split(' ')[0];
  return id ? id : null;
}

/**
 * The newest runs on each feature, newest first, at most `STALL_RUNS` each.
 * `featureOf` maps the row a run was fired at to the feature above it, or
 * null for a row under no feature being checked.
 */
export function runsByFeature(
  runs: readonly StallRun[],
  featureOf: (planItemId: string) => string | null,
): Map<string, StallRun[]> {
  const sorted = [...runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const out = new Map<string, StallRun[]>();
  for (const run of sorted) {
    const feature = featureOf(run.planItemId);
    if (!feature) continue;
    const list = out.get(feature) ?? [];
    if (list.length < STALL_RUNS) list.push(run);
    out.set(feature, list);
  }
  return out;
}

/** Whether a feature's newest runs, newest first, both closed nothing. */
export function isStalled(runs: readonly StallRun[]): boolean {
  return runs.length >= STALL_RUNS && runs.slice(0, STALL_RUNS).every((run) => run.status === 'failed');
}

/**
 * Whether to file a raise for a stalled feature, given the raises already
 * filed about it. None while one is open, and none for a stall a raise has
 * already been filed about since its newest run.
 */
export function shouldRaiseStall(
  runs: readonly StallRun[],
  raises: readonly FeatureRaise[],
): boolean {
  if (!isStalled(runs)) return false;
  if (raises.some((raise) => raise.status === 'open')) return false;
  const newest = new Date(runs[0].createdAt).getTime();
  return !raises.some((raise) => new Date(raise.createdAt).getTime() >= newest);
}

/**
 * Whether the raises about a feature hold it from the overnight runner.
 *
 * The newest raise decides. Dismissed, it holds nothing. Otherwise it holds
 * until a run is fired at the feature after the raise was answered, or after
 * it was filed while it is still open. `newestRunAt` is the newest build run
 * on the feature, or null when there is none.
 */
export function raiseHolds(
  raises: readonly FeatureRaise[],
  newestRunAt: string | null,
): boolean {
  const newest = [...raises].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  if (!newest || newest.status === 'dismissed') return false;
  const since = new Date(newest.answeredAt ?? newest.createdAt).getTime();
  return !newestRunAt || new Date(newestRunAt).getTime() <= since;
}

/**
 * Why nothing under a feature can be worked now, when every open step beneath
 * it waits on another step or on a check-back, or null when one can be. A
 * feature with no steps is its own work and is never refused here.
 */
export function waitingSteps(node: PlanNode): string | null {
  const beneath = flatten(node.children).filter(
    (step) =>
      !isClosed(step.status) &&
      step.status !== 'proposed' &&
      !isDismissed(step) &&
      step.children.every((child) => isClosed(child.status) || isDismissed(child)),
  );
  if (beneath.length === 0) return null;
  if (beneath.some((step) => !isWaiting(step) && !isWaitingOnThePerson(step))) return null;
  const said = beneath.slice(0, 3).map((step) => {
    const check = step.waitsUntil[step.waitsUntil.length - 1];
    if (check) return `#${step.number} waits until ${checkDay(check.dueAt)} (${check.title.replace(/[.]+$/, '')})`;
    if (step.waitingOn.length > 0) return `#${step.number} waits on #${step.waitingOn[0].number}`;
    return `#${step.number} waits on you`;
  });
  return `Nothing under #${node.number} can be worked now: ${said.join('; ')}.`;
}

/** The action a Yes takes on a raise that splits a feature (#1804). */
export const SPLIT_ACTION = 'split_feature';

/**
 * How many steps a feature has: its build rows that were not dropped. A
 * question or a setup job beneath it is not a piece of its work.
 */
export function featureSteps(feature: {
  children: readonly { kind: string; status: string }[];
}): number {
  return feature.children.filter((row) => row.kind === 'build' && row.status !== 'dropped').length;
}

/** The runs a stall raise's `source` names, newest first, or none. */
export function stallRunIds(source: string | null | undefined): string[] {
  if (!source?.startsWith(STALL_PREFIX)) return [];
  const words = source.slice(STALL_PREFIX.length).split(' ').filter(Boolean);
  return words[1] === 'runs' ? words.slice(2) : [];
}

/** One run as the split reads it back: its pieces and the session it was. */
export type SplitRun = {
  id: string;
  stopPieces: string[] | null;
  /** The session's id (`plan_runs.external_id`), for the stamp on each step. */
  session: string | null;
};

/**
 * The pieces to split a feature into: those of the first run, in the order
 * the raise names them (newest first), that left two or more. The same choice
 * `stallRaise` makes, so a Yes writes the list the raise showed.
 */
export function splitPieces(
  runIds: readonly string[],
  runs: readonly SplitRun[],
): { pieces: string[]; session: string | null } | null {
  for (const id of runIds) {
    const found = runs.find((one) => one.id === id);
    const pieces = (found?.stopPieces ?? []).map((piece) => piece.trim()).filter(Boolean);
    if (found && pieces.length >= 2) return { pieces, session: found.session };
  }
  return null;
}

/** What the tick inserts into `raised_items` for a stall. */
export type StallRaise = {
  module: string | null;
  title: string;
  ask: string;
  detail: string;
  consequence: {
    name: 'send_step' | typeof SPLIT_ACTION;
    text: string;
    module: null;
    field: null;
    detail: null;
    kind: null;
  };
  source: string;
};

/** One line, cut to `limit` characters with an ellipsis when it runs over. */
function cut(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

/** The day a run was fired, as the raise names it. */
function day(at: string): string {
  return at.slice(0, 10);
}

/** One run's line in the raise: its own reason, or what the app noted. */
function runLine(run: StallRun): string {
  if (run.stopReason) return `- ${day(run.createdAt)}: "${run.stopReason}"`;
  if (run.error) return `- ${day(run.createdAt)}: the session left no note. ${cut(run.error, 300)}`;
  return `- ${day(run.createdAt)}: the session left no note.`;
}

/**
 * The raise for a stalled feature. `runs` are its newest runs, newest first.
 *
 * With no reason on either run it is the held raise's question, "send it
 * again?". With one it quotes each session's line and asks whether to send it
 * again as it stands, which is what a Yes does. A session that found the work
 * too big leaves the pieces it would split it into; the raise lists them, and
 * `source` names both runs so the split can read the pieces back off them.
 *
 * `steps` is how many steps the feature has (`featureSteps`). With pieces and
 * none, the question is the split itself, "Split #N … into N steps?", and a
 * Yes writes them and sends the first (#1804). A feature that already has
 * steps keeps "send it again as it stands", since splitting it would write a
 * second set beside the first.
 */
export function stallRaise(
  feature: StallFeature,
  runs: readonly StallRun[],
  steps: number,
  stuck: StuckStep | null = null,
): StallRaise {
  const named = `#${feature.number} ${feature.title}`;
  const two = runs.slice(0, STALL_RUNS);
  const reason = two.find((run) => run.stopReason)?.stopReason ?? null;
  const pieces = two.find((run) => run.stopPieces && run.stopPieces.length > 0)?.stopPieces ?? null;
  const split = Boolean(pieces && pieces.length >= 2 && steps === 0);
  const consequence: StallRaise['consequence'] = {
    name: split ? SPLIT_ACTION : 'send_step',
    text: `#${feature.number}`,
    module: null,
    field: null,
    detail: null,
    kind: null,
  };
  const source = `${STALL_PREFIX}${feature.id} runs ${two.map((run) => run.id).join(' ')}`;
  const after =
    'Yes tries it again now. Close with a reason keeps it paused until you send it from its ' +
    'row on /dev/plan. Dismiss lets the overnight runner pick it up again on its own.';
  const stuckText = stuckLine(stuck);

  const lines = [
    `Dash sent two sessions at ${named} and neither finished a step, so the overnight runner ` +
      'has paused it rather than keep spending sessions on it. What each session ended with, newest first:',
    '',
    ...two.map(runLine),
  ];
  if (stuckText) lines.push('', stuckText);

  if (!reason) {
    lines.push('', after);
    return {
      module: feature.module,
      title: stuckTitle(named),
      ask: stuckAsk(named),
      detail: cut(lines.join('\n'), 4000),
      consequence,
      source,
    };
  }

  if (pieces && split) {
    lines[0] = `This covers ${pieces.length} pieces of work. ${lines[0]}`;
    lines.push(
      '',
      `The last session found it too big for one sitting and would split it into these ${pieces.length} steps:`,
      ...pieces.map((piece, index) => `${index + 1}. ${piece}`),
      '',
      'Yes writes them as steps under it, ready to build, and sends the first. Close with a ' +
        'reason keeps it paused until you send it from its row on /dev/plan. To change ' +
        'something first, say what in your answer.',
    );
    return {
      module: feature.module,
      title: stuckTitle(named),
      ask: cut(`Split ${named} into ${pieces.length} steps?`, 500),
      detail: cut(lines.join('\n'), 4000),
      consequence,
      source,
    };
  }
  if (pieces) {
    lines.push(
      '',
      `The last session found it too big for one sitting and would split it into ${pieces.length} steps:`,
      ...pieces.map((piece, index) => `${index + 1}. ${piece}`),
    );
  }
  lines.push('', `${after} To change something first, say what in your answer.`);

  const ask = pieces
    ? `The sessions found ${named} too big for one sitting and would split it into ${pieces.length} steps. Send it again as it stands?`
    : `A session on it stopped because "${cut(reason.replace(/[.!]+$/, ''), 200)}". Send ${named} again as it stands?`;

  return {
    module: feature.module,
    title: stuckTitle(named),
    ask: cut(ask, 500),
    detail: cut(lines.join('\n'), 4000),
    consequence,
    source,
  };
}
