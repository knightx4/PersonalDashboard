/**
 * Asking GitHub what its checks said about the commits the plan shipped in.
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
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
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

const API = 'https://api.github.com';

/** The repository the plan is built in. The app is the thing being checked. */
export const REPO = { owner: 'knightx4', repo: 'PersonalDashboard', branch: 'main' };

/** Commits per listing request, which is the most GitHub allows. */
const PAGE_SIZE = 100;

/** How far back the listing will go looking for the commits it was asked about. */
const PAGE_CAP = 8;

/** How many merges one call will read checks for. */
const MERGE_BUDGET = 25;

/** How many of those are in flight at once. */
const LANES = 5;

type CommitRow = { sha: string; parents?: Array<{ sha?: string }> };

/** The token that may read this repository's checks. Set in Vercel. */
function readToken(): string | null {
  return process.env.GITHUB_READ_TOKEN?.trim() || null;
}

async function ask<T>(path: string, token: string, doFetch: typeof globalThis.fetch): Promise<T> {
  const res = await doFetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'personal-dashboard-plan',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`GitHub answered ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

/**
 * Main's commits, newest first, until every commit asked about has been seen.
 *
 * `exhausted` says the walk reached the start of the history rather than the
 * page cap, which is what makes "not in here" mean "never reached main" rather
 * than "older than we looked".
 */
async function listMain(
  wanted: ReadonlySet<string>,
  token: string,
  doFetch: typeof globalThis.fetch,
): Promise<{ commits: CommitNode[]; exhausted: boolean }> {
  const commits: CommitNode[] = [];
  const outstanding = new Set(wanted);
  let exhausted = false;

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
    if (rows.length < PAGE_SIZE) {
      exhausted = true;
      break;
    }
    if (outstanding.size === 0) break;
  }

  return { commits, exhausted };
}

/** What CI said about one commit on main. */
async function checkCommit(
  sha: string,
  token: string,
  doFetch: typeof globalThis.fetch,
): Promise<CheckConclusion> {
  const body = await ask<{ check_runs?: CheckRun[] }>(
    `/repos/${REPO.owner}/${REPO.repo}/commits/${sha}/check-runs?per_page=${PAGE_SIZE}`,
    token,
    doFetch,
  );
  return conclusionFrom(body.check_runs ?? []);
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
    const { commits, exhausted } = await listMain(wanted, token, doFetch);
    const carrier = carriedBy(commits);

    // Which merge each commit needs an answer from, and which commits are
    // answered by each merge.
    const unmerged: string[] = [];
    const byMerge = new Map<string, string[]>();
    for (const sha of wanted) {
      const merge = carrierFor(carrier, sha);
      if (merge) {
        const sharing = byMerge.get(merge);
        if (sharing) sharing.push(sha);
        else byMerge.set(merge, [sha]);
        continue;
      }
      // Only when the whole history was read. Otherwise nothing is known about
      // this commit yet, and nothing is written.
      if (exhausted) unmerged.push(sha);
    }

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
