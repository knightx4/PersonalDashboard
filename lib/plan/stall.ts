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
 */
import type { RunJob } from './run-end';

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

/** What the tick inserts into `raised_items` for a stall. */
export type StallRaise = {
  module: string | null;
  title: string;
  ask: string;
  detail: string;
  consequence: {
    name: 'send_step';
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
  if (run.error) return `- ${day(run.createdAt)}: the session said nothing; the app noted "${cut(run.error, 300)}"`;
  return `- ${day(run.createdAt)}: the session said nothing.`;
}

/**
 * The raise for a stalled feature. `runs` are its newest runs, newest first.
 *
 * With no reason on either run it is the held raise's question, "send it
 * again?". With one it quotes each session's line and asks whether to send it
 * again as it stands, which is what a Yes does. A session that found the work
 * too big leaves the pieces it would split it into; the raise lists them, and
 * `source` names both runs so #1804 can read the pieces off them when it adds
 * the split as the Yes.
 */
export function stallRaise(feature: StallFeature, runs: readonly StallRun[]): StallRaise {
  const named = `#${feature.number} ${feature.title}`;
  const two = runs.slice(0, STALL_RUNS);
  const reason = two.find((run) => run.stopReason)?.stopReason ?? null;
  const pieces = two.find((run) => run.stopPieces && run.stopPieces.length > 0)?.stopPieces ?? null;
  const consequence = {
    name: 'send_step' as const,
    text: `#${feature.number}`,
    module: null,
    field: null,
    detail: null,
    kind: null,
  };
  const source = `${STALL_PREFIX}${feature.id} runs ${two.map((run) => run.id).join(' ')}`;
  const after =
    'Yes sends it again now. No leaves it held until you send it from its row on /dev/plan.';

  if (!reason) {
    return {
      module: feature.module,
      title: cut(`${named} is held: its last two sessions closed nothing`, 200),
      ask: cut(`Send ${named} to a session again?`, 500),
      detail:
        `The last two sessions sent at ${named} closed no step and neither said why, so the ` +
        `overnight runner stopped sending it. ${after} The blocked steps and threads under it ` +
        'say where the sessions stopped.',
      consequence,
      source,
    };
  }

  const lines = [
    `The last two sessions sent at ${named} closed no step, so the overnight runner holds it. Why they stopped, newest first:`,
    '',
    ...two.map(runLine),
  ];
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
    title: cut(`${named} closed nothing in two sessions`, 200),
    ask: cut(ask, 500),
    detail: cut(lines.join('\n'), 4000),
    consequence,
    source,
  };
}
