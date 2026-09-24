/**
 * Whether the checks passed on the commit a step shipped in.
 *
 * A step closes against the commit that was at HEAD when it closed, which is
 * almost always a commit on a branch. CI runs on main and on pull requests, so
 * the commit a step records is usually one nothing ever checked. #555 settled
 * what to ask instead: the merge that carried the step onto main, which is
 * where the checks actually ran and which can answer for work already shipped.
 *
 * So this file does two things, both pure. It works out which commit on main's
 * own line carried each commit there, from the graph alone -- no request per
 * commit, one listing of main and arithmetic. And it turns a commit's check
 * runs into the single word the plan page draws.
 *
 * Pure and separate from `ci.ts` for the same reason `run-end.ts` is separate
 * from `runs.ts`: the fetching is server-only and the page draws the answer in
 * the browser.
 */

/**
 * What came back about a commit.
 *
 * `none` and `unmerged` are both "no result", and they are different results:
 * one says the merge ran no checks, the other says nothing on main carries
 * this commit at all, which is what a step closed at a branch commit that was
 * never merged looks like.
 */
export type CheckConclusion = 'passed' | 'failed' | 'running' | 'none' | 'unmerged';

/** What is known about one recorded commit, as the plan page reads it. */
export type CommitCheck = {
  /** The commit on main the checks were read from. Null on `unmerged`. */
  mergeSha: string | null;
  conclusion: CheckConclusion;
  /** When GitHub was asked. */
  checkedAt: string;
};

/** A commit as the listing gives it: its own sha and its parents', in order. */
export type CommitNode = { sha: string; parents: readonly string[] };

/** One workflow run on a commit, as the API reports it. */
export type CheckRun = { status: string; conclusion: string | null };

/**
 * How long an answer that is not final may stand before it is asked again.
 *
 * `passed` and `failed` never change, so they are never re-asked. The other
 * three do: a run finishes, a branch gets merged, a workflow that had not
 * registered yet registers. Ten minutes is shorter than the gap between two
 * visits to the page and long enough that opening it twice does not ask twice.
 */
export const RECHECK_AFTER_MINUTES = 10;

/** The conclusions that will not change, so nothing asks about them again. */
const FINAL: ReadonlySet<CheckConclusion> = new Set<CheckConclusion>(['passed', 'failed']);

/**
 * How long after a step closes a `none` stops being worth asking about.
 *
 * `none` means the merge that carried the step ran no workflows. A workflow
 * that had not registered yet shows up within minutes, so a `none` read a day
 * after the close will not change. Before this, the thirty-five such commits
 * on the plan were asked about every ten minutes for weeks, and because the
 * oldest were further back than the listing reaches, each open of /dev/plan
 * paged through all of main and asked a comparison for each of them before
 * anything was drawn.
 */
export const NONE_SETTLES_AFTER_HOURS = 24;

/** Conclusions on a completed run that mean the commit did not pass. */
const FAILING = new Set(['failure', 'timed_out', 'action_required', 'cancelled', 'startup_failure']);

/**
 * Which commit on main carried each commit there, for every commit in the
 * listing.
 *
 * Main's own line is its first parents, walked from the head. Everything else
 * came in behind one of those merges, and which one is found by walking each
 * merge's other parents back until the walk reaches the line again. Read
 * oldest merge first, so a branch merged twice is credited to the merge that
 * first put it on main.
 *
 * A commit on the line is its own carrier: work committed straight onto main
 * was checked as itself.
 */
export function carriedBy(commits: readonly CommitNode[]): Map<string, string> {
  const parents = new Map<string, readonly string[]>();
  for (const commit of commits) parents.set(commit.sha, commit.parents);

  const line: string[] = [];
  const seen = new Set<string>();
  let sha: string | undefined = commits[0]?.sha;
  while (sha && parents.has(sha) && !seen.has(sha)) {
    line.push(sha);
    seen.add(sha);
    sha = parents.get(sha)?.[0];
  }

  // Seeded with the line itself, which is both the answer for those commits
  // and the wall each walk below stops at.
  const carrier = new Map<string, string>();
  for (const commitSha of line) carrier.set(commitSha, commitSha);

  for (let i = line.length - 1; i >= 0; i -= 1) {
    const merge = line[i];
    const queue = [...(parents.get(merge) ?? []).slice(1)];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (carrier.has(next)) continue;
      carrier.set(next, merge);
      for (const parent of parents.get(next) ?? []) queue.push(parent);
    }
  }

  return carrier;
}

/**
 * The carrier for a recorded commit, which is usually seven characters rather
 * than forty.
 *
 * A prefix that matches more than one commit is treated as matching none: a
 * wrong answer about which merge shipped a step is worse than no answer, and
 * seven characters over a few hundred commits collides about never.
 */
export function carrierFor(carrier: ReadonlyMap<string, string>, sha: string): string | null {
  const exact = carrier.get(sha);
  if (exact) return exact;

  let found: string | null = null;
  for (const [full, merge] of carrier) {
    if (!full.startsWith(sha)) continue;
    if (found && found !== merge) return null;
    found = merge;
  }
  return found;
}

/**
 * What a commit's check runs add up to.
 *
 * A failure outranks a run still going: once one check has failed the commit
 * is red whatever the rest do. Neutral and skipped runs are neither, so they
 * fall through to passed, which is what GitHub's own summary does with them.
 */
export function conclusionFrom(runs: readonly CheckRun[]): CheckConclusion {
  if (runs.length === 0) return 'none';
  if (runs.some((run) => run.conclusion && FAILING.has(run.conclusion))) return 'failed';
  if (runs.some((run) => run.status !== 'completed')) return 'running';
  return 'passed';
}

/**
 * Whether GitHub should be asked about this commit again.
 *
 * `closedAt` is when the step that records the commit was closed. Without it a
 * `none` is asked about again every ten minutes, as it always was.
 */
export function shouldRecheck(
  check: CommitCheck | undefined,
  now: number,
  closedAt?: string | null,
): boolean {
  if (!check) return true;
  if (FINAL.has(check.conclusion)) return false;
  if (check.conclusion === 'none' && closedAt) {
    const settled = Date.parse(closedAt) + NONE_SETTLES_AFTER_HOURS * 3_600_000;
    if (Date.parse(check.checkedAt) >= settled) return false;
  }
  return (now - new Date(check.checkedAt).getTime()) / 60_000 >= RECHECK_AFTER_MINUTES;
}

/** The word the row carries. Null when there is nothing worth marking. */
export function checkWord(check: CommitCheck | undefined): string | null {
  if (!check) return 'Not checked';
  switch (check.conclusion) {
    case 'passed':
      return null;
    case 'failed':
      return 'CI failed';
    case 'running':
      return 'CI running';
    case 'none':
      return 'No checks';
    case 'unmerged':
      return 'Not on main';
  }
}

/** The sentence the step's own panel carries, beside the commit. */
export function checkLine(check: CommitCheck | undefined): string {
  if (!check) return 'Checks not read yet';
  switch (check.conclusion) {
    case 'passed':
      return 'Checks passed';
    case 'failed':
      return 'Checks failed';
    case 'running':
      return 'Checks still running';
    case 'none':
      return 'No checks ran';
    case 'unmerged':
      return 'Never reached main';
  }
}
