/**
 * What the plan asks GitHub: how the commits it shipped in fared, and what has
 * been pushed since.
 *
 * The plan page drew a step's commit sha and stopped there, so a step that
 * landed on a red commit and one that landed on a green one read identically.
 * The answer is one request per merge on main plus one listing of main's
 * commits; `checks.ts` holds the rules for turning that into a word, and this
 * file is the part that goes over the wire and writes the answers down.
 *
 * Three things keep a page load from turning into a hundred requests. Nothing
 * is asked at all unless some commit needs an answer, which after a backfill
 * is a step or two a day. Answers are kept per commit in `plan_commit_checks`,
 * and `passed` and `failed` are never asked about again. And a single call
 * resolves at most `MERGE_BUDGET` merges, so the first few loads fill the
 * backlog in instead of one load carrying all of it.
 *
 * The pushes are the other question, and the same way in answers it: whether
 * the session a run started is still working is read off what has moved in
 * this repository since it was fired. One listing, one token, one set of
 * headers -- a second route to GitHub would be a second thing to get wrong
 * when the key is rotated. `liveness.ts` holds the rules for what the listing
 * means.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { ask, commitOnMain, readToken, REPO, REPO_KEY, refusalFor } from './github';
import { pushesFrom, type ActivityRow, type Push } from './liveness';
import {
  carriedBy,
  carrierFor,
  conclusionFrom,
  shouldRecheck,
  type CheckConclusion,
  type CheckRun,
  type CommitCheck,
  type CommitNode,
} from './checks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * The repository, the token, the headers and what a refusal means all moved to
 * `github.ts`, so that `scripts/plan.ts` could ask GitHub whether a commit is
 * on main without importing this `server-only` file. Re-exported here because
 * the app imports them from this module.
 */
export { REPO, REPO_KEY, refusalFor };

/** Commits per listing request, which is the most GitHub allows. */
const PAGE_SIZE = 100;

/** How far back the listing will go looking for the commits it was asked about. */
const PAGE_CAP = 8;

/** How many merges one call will read checks for. */
const MERGE_BUDGET = 25;

/**
 * How many commits one call will ask about by comparison.
 *
 * The listing above answers most of them, so this is only ever the commits it
 * did not reach: something closed minutes ago that is still on its branch, or
 * something older than the page cap. Smaller than `MERGE_BUDGET` because one
 * request answers one commit here, where one request answers every commit a
 * merge carried.
 */
const LANDING_BUDGET = 10;

/** How many of those are in flight at once. */
const LANES = 5;

type CommitRow = { sha: string; parents?: Array<{ sha?: string }> };

/**
 * Main's commits, newest first, until every commit asked about has been seen.
 *
 * A commit the listing does not reach is not answered here, either way. It
 * used to be: the walk reported whether it had read the whole history, and
 * "not in here, and we read all of it" was taken for "never reached main".
 * That reading could not be had at this repository's size -- main passed the
 * cap's eight hundred commits, so the walk never reached the start of history
 * again and `unmerged` stopped being written at all. `commitOnMain` asks the
 * question exactly and at any depth instead, so the walk is left to do the one
 * thing it is good at: naming the merge, for the commits it does reach.
 */
async function listMain(
  wanted: ReadonlySet<string>,
  token: string,
  doFetch: typeof globalThis.fetch,
): Promise<CommitNode[]> {
  const commits: CommitNode[] = [];
  const outstanding = new Set(wanted);

  for (let page = 1; page <= PAGE_CAP; page += 1) {
    const rows = await ask<CommitRow[]>(
      `/repos/${REPO.owner}/${REPO.repo}/commits?sha=${REPO.branch}&per_page=${PAGE_SIZE}&page=${page}`,
      token,
      doFetch,
    );
    for (const row of rows) {
      commits.push({ sha: row.sha, parents: (row.parents ?? []).map((p) => p.sha ?? '') });
      for (const sha of outstanding) {
        if (row.sha.startsWith(sha)) outstanding.delete(sha);
      }
    }
    if (rows.length < PAGE_SIZE) break;
    if (outstanding.size === 0) break;
  }

  return commits;
}

/**
 * What CI said about one commit on main.
 *
 * The check runs attached to a commit would answer this too, but reading them
 * needs Checks: Read, and #559 settled on Actions: Read instead. The workflow
 * runs for a head sha carry the same `status` and `conclusion` fields, so the
 * reply reads the same way once `workflow_runs` is taken out of it.
 */
async function checkCommit(
  sha: string,
  token: string,
  doFetch: typeof globalThis.fetch,
): Promise<CheckConclusion> {
  const body = await ask<{ workflow_runs?: CheckRun[] }>(
    `/repos/${REPO.owner}/${REPO.repo}/actions/runs?head_sha=${sha}&per_page=${PAGE_SIZE}`,
    token,
    doFetch,
  );
  return conclusionFrom(body.workflow_runs ?? []);
}

/**
 * What CI says about main's newest commit right now, written down for the
 * shell to read.
 *
 * `refreshCommitChecks` below answers a different question and cannot answer
 * this one: it asks about the commits closed steps recorded, which are last
 * week's merges, and it only ever runs when somebody has /dev/plan open. Main
 * sat red from 19:43 to 21:40 one night with two more merges landing on top of
 * it and nothing anywhere said so, because nobody had that page open. So this
 * is asked from the overnight tick, which runs every four minutes whether or
 * not a night is running, and the answer is stored once for every page in the
 * app to read (`lib/shell/main-check.ts`).
 *
 * Two requests: one commit from the branch listing, and that commit's workflow
 * runs. The same `ask`, the same token and the same headers as everything else
 * here, deliberately -- a second route to GitHub is a second thing to get
 * wrong when the key is rotated.
 *
 * Nothing is thrown and nothing is skipped. A refusal is a row too: the
 * sentence `refusalFor` writes goes in `error` beside a null conclusion, so
 * "GitHub would not tell us" is stored as the different fact it is from "we
 * have not asked". A tick that could not reach GitHub still leaves the row
 * saying when it tried, which is what stops a green dot from yesterday
 * standing in for an answer today.
 */
export async function refreshMainCheck(input: {
  supabase: Db;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<{ sha: string | null; conclusion: CheckConclusion | null; error: string | null }> {
  const now = input.now ?? Date.now();
  const doFetch = input.fetch ?? globalThis.fetch;
  const token = readToken();

  let sha: string | null = null;
  let conclusion: CheckConclusion | null = null;
  let error: string | null = null;

  if (!token) {
    error = `No GITHUB_READ_TOKEN is set, so ${REPO.branch}'s checks cannot be read.`;
  } else {
    try {
      // One commit. The whole question is what is at the head of the branch,
      // and `listMain`'s eight pages are for finding commits somebody named.
      const rows = await ask<CommitRow[]>(
        `/repos/${REPO.owner}/${REPO.repo}/commits?sha=${REPO.branch}&per_page=1`,
        token,
        doFetch,
      );
      sha = rows[0]?.sha ?? null;
      if (!sha) {
        error = `GitHub named no commits on ${REPO.branch}.`;
      } else {
        conclusion = await checkCommit(sha, token, doFetch);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const { error: writeError } = await input.supabase.from('plan_main_checks').upsert(
    {
      repo: REPO_KEY,
      head_sha: sha,
      conclusion,
      checked_at: new Date(now).toISOString(),
      error,
    },
    { onConflict: 'repo' },
  );
  // Logged rather than carried, like every other best-effort write on this
  // path. A tick that could not store the reading still has a night to run.
  if (writeError) {
    console.error(`main's CI reading could not be stored: ${writeError.message}`);
  }

  return { sha, conclusion, error };
}

/** A few at a time, so a backlog does not become twenty-five round trips. */
async function inLanes<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LANES, items.length) }, lane));
  return out;
}

/** What this account already knows, by the commit sha a step records. */
export async function loadCommitChecks(
  supabase: Db,
  userId: string,
): Promise<Record<string, CommitCheck>> {
  const { data, error } = await supabase
    .from('plan_commit_checks')
    .select('commit_sha, merge_sha, conclusion, checked_at')
    .eq('user_id', userId);
  if (error) {
    console.error(`plan_commit_checks could not be read for the plan page: ${error.message}`);
    return {};
  }

  const checks: Record<string, CommitCheck> = {};
  for (const row of (data ?? []) as Array<{
    commit_sha: string;
    merge_sha: string | null;
    conclusion: string;
    checked_at: string;
  }>) {
    checks[row.commit_sha] = {
      mergeSha: row.merge_sha,
      conclusion: row.conclusion as CheckConclusion,
      checkedAt: row.checked_at,
    };
  }
  return checks;
}

/**
 * Ask about the commits that have no answer yet, and write down what comes
 * back.
 *
 * Carried back rather than thrown, the same as the seed sync and the run
 * sweep above it: a plan page that could not reach GitHub is still a plan page
 * worth reading, and the steps it could not answer for say "not checked",
 * which is true.
 */
export async function refreshCommitChecks(input: {
  supabase: Db;
  userId: string;
  now?: number;
  fetch?: typeof globalThis.fetch;
}): Promise<{ checked: number; error: string | null }> {
  const now = input.now ?? Date.now();
  const doFetch = input.fetch ?? globalThis.fetch;
  const token = readToken();
  if (!token) {
    return { checked: 0, error: 'No GITHUB_READ_TOKEN is set, so CI results cannot be read.' };
  }

  const { data: steps, error: stepsError } = await input.supabase
    .from('plan_items')
    .select('commit_sha')
    .eq('user_id', input.userId)
    .eq('status', 'done')
    .not('commit_sha', 'is', null);
  if (stepsError) return { checked: 0, error: stepsError.message };

  const known = await loadCommitChecks(input.supabase, input.userId);
  const wanted = new Set(
    ((steps ?? []) as Array<{ commit_sha: string }>)
      .map((step) => step.commit_sha)
      .filter((sha) => /^[0-9a-f]{7,40}$/.test(sha) && shouldRecheck(known[sha], now)),
  );
  if (wanted.size === 0) return { checked: 0, error: null };

  try {
    const carrier = carriedBy(await listMain(wanted, token, doFetch));

    // Which merge each commit needs an answer from, and which commits are
    // answered by each merge. A commit the listing did not reach gets no merge
    // and no answer from here; it is asked about below instead.
    const missing: string[] = [];
    const byMerge = new Map<string, string[]>();
    for (const sha of wanted) {
      const merge = carrierFor(carrier, sha);
      if (!merge) {
        missing.push(sha);
        continue;
      }
      const sharing = byMerge.get(merge);
      if (sharing) sharing.push(sha);
      else byMerge.set(merge, [sha]);
    }

    // Whether main carries each of those, asked one comparison at a time.
    // Only a definite no is written down: main carrying a commit the listing
    // never reached says nothing about which merge ran the checks, and an
    // answer GitHub would not give is not an answer. Both leave the commit
    // unwritten and asked again next time, which reads as "not checked" --
    // true, where "never reached main" would be a guess.
    const unmerged = (
      await inLanes(missing.slice(0, LANDING_BUDGET), async (sha) => ({
        sha,
        landing: await commitOnMain({ sha, fetch: doFetch }),
      }))
    )
      .filter(({ landing }) => landing.onMain === false)
      .map(({ sha }) => sha);

    const merges = [...byMerge.keys()].slice(0, MERGE_BUDGET);
    const conclusions = await inLanes(merges, (sha) => checkCommit(sha, token, doFetch));

    const stamp = new Date(now).toISOString();
    const rows = [
      ...unmerged.map((sha) => ({
        user_id: input.userId,
        commit_sha: sha,
        merge_sha: null,
        conclusion: 'unmerged' as CheckConclusion,
        checked_at: stamp,
      })),
      ...merges.flatMap((merge, i) =>
        (byMerge.get(merge) ?? []).map((sha) => ({
          user_id: input.userId,
          commit_sha: sha,
          merge_sha: merge,
          conclusion: conclusions[i],
          checked_at: stamp,
        })),
      ),
    ];
    if (rows.length === 0) return { checked: 0, error: null };

    const { error } = await input.supabase
      .from('plan_commit_checks')
      .upsert(rows, { onConflict: 'user_id,commit_sha' });
    if (error) return { checked: 0, error: error.message };

    return { checked: rows.length, error: null };
  } catch (error) {
    return { checked: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * How many commit messages one refresh will look up.
 *
 * One request each, and the shas asked about are the last push of every step
 * being worked -- a handful at most, since only one step under a feature may
 * be underway. The cap is there so that a table full of claims cannot turn one
 * refresh into a hundred requests.
 */
const SUBJECT_BUDGET = 10;

/**
 * The first line of each commit's message, by sha.
 *
 * The activity listing says which branch moved and to what sha, and nothing
 * about what the commit said, so saying what a push *was* costs one request
 * per commit. That is why the subject is a separate lookup rather than part of
 * `listPushes`, and why it is allowed to come back missing: a push with no
 * subject stored is legal, and the page falls back to the short sha and then
 * to the time alone.
 *
 * A refusal on one commit is dropped rather than carried, because it must not
 * turn a reading GitHub answered into a reading GitHub refused. The refusal
 * that matters is the one on the listing, and `listPushes` carries that.
 */
export async function commitSubjects(input: {
  shas: readonly string[];
  fetch?: typeof globalThis.fetch;
}): Promise<Record<string, string>> {
  const token = readToken();
  const wanted = [...new Set(input.shas.filter((sha) => /^[0-9a-f]{7,40}$/.test(sha)))].slice(
    0,
    SUBJECT_BUDGET,
  );
  if (!token || wanted.length === 0) return {};

  const doFetch = input.fetch ?? globalThis.fetch;
  const subjects: Record<string, string> = {};
  await inLanes(wanted, async (sha) => {
    try {
      const body = await ask<{ commit?: { message?: string } }>(
        `/repos/${REPO.owner}/${REPO.repo}/commits/${sha}`,
        token,
        doFetch,
      );
      const subject = (body.commit?.message ?? '').split('\n')[0].trim();
      if (subject) subjects[sha] = subject;
    } catch {
      // Left out. The reading is worth storing without it.
    }
  });
  return subjects;
}

/**
 * What has been pushed to any branch since an instant, newest first.
 *
 * One request. The activity listing is the only endpoint that answers "which
 * branches moved and when" without a request per branch, and this repository
 * has over a hundred branches, so the per-branch reading #522 describes is
 * asked for this way. It is newest first and one page of a hundred covers most
 * of a day here, which is well past the mark at which a run counts as over --
 * so nothing pages, and a run older than that is already ended whatever the
 * listing says about it.
 *
 * Carried back rather than thrown, the same as the check refresh above: a
 * reading nobody could take is `unknown`, which is a different answer from
 * silence, and `liveness.ts` keeps the two apart.
 */
export async function listPushes(input: {
  since: number;
  fetch?: typeof globalThis.fetch;
}): Promise<{ pushes: Push[]; error: string | null }> {
  const token = readToken();
  if (!token) {
    return { pushes: [], error: 'No GITHUB_READ_TOKEN is set, so pushes cannot be read.' };
  }

  try {
    const rows = await ask<ActivityRow[]>(
      `/repos/${REPO.owner}/${REPO.repo}/activity?per_page=${PAGE_SIZE}`,
      token,
      input.fetch ?? globalThis.fetch,
    );
    return { pushes: pushesFrom(rows, input.since), error: null };
  } catch (error) {
    return { pushes: [], error: error instanceof Error ? error.message : String(error) };
  }
}
