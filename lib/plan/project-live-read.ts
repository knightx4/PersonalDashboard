/**
 * Reads whether a Dev project's latest work is live (plan #2800.6), for its
 * page: main's newest commit and its checks from GitHub, and the newest
 * production deploy from Vercel. `project-live.ts` holds the shape and the
 * words; this is the part that goes over the wire.
 *
 * GitHub is asked with GITHUB_READ_TOKEN, through the same `ask` as every
 * other reading in the plan, so one token rotation covers all of them. Vercel
 * is asked with PROJECTS_VERCEL_TOKEN (plan #2800.5), which only reads. The
 * Vercel project is found by the repository it is connected to, so nothing
 * has to be recorded on the project row: a repository no Vercel project is
 * connected to shows its checks only.
 *
 * A reading is kept for a minute per repository, so a page opened twice, or
 * by two tabs, asks once. The overnight tick's stored row
 * (`refreshProjectMainChecks`) is still what the projects list draws its dot
 * from; this is the fresher, fuller reading the one project's page wants.
 */
import 'server-only';

import { ask, readToken, repoKey, type Repo } from './github';
import { explainFailure, type WorkflowRun } from './ci';
import { conclusionFrom } from './checks';
import {
  commitSubject,
  liveDeployState,
  type LiveChecks,
  type LiveCommit,
  type LiveDeploy,
  type ProjectLive,
} from './project-live';

/** How long one reading stands for, per repository. */
export const LIVE_CACHE_MS = 60_000;

const VERCEL_API = 'https://api.vercel.com';

/** The token that may read the projects' deployments. Set in Vercel. */
export function vercelReadToken(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  return env.PROJECTS_VERCEL_TOKEN?.trim() || null;
}

type Fetch = typeof globalThis.fetch;

/** A refusal from Vercel, said to the person who can fix it. */
export function vercelRefusal(status: number, repo: string): string {
  if (status === 401) {
    return 'PROJECTS_VERCEL_TOKEN was rejected by Vercel (401): it has expired or is mistyped. Set a new one in Vercel and redeploy.';
  }
  if (status === 403 || status === 404) {
    return `PROJECTS_VERCEL_TOKEN cannot read the Vercel project for ${repo} (${status}). Give it access to the team that holds the project, then redeploy.`;
  }
  return `Vercel answered ${status} when asked about ${repo}'s deploys.`;
}

class VercelRefused extends Error {
  constructor(readonly status: number) {
    super(`Vercel answered ${status}`);
  }
}

async function askVercel<T>(path: string, token: string, doFetch: Fetch): Promise<T> {
  const res = await doFetch(`${VERCEL_API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new VercelRefused(res.status);
  return (await res.json()) as T;
}

function scoped(path: string, teamId: string | null): string {
  if (!teamId) return path;
  return `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`;
}

/** Main's newest commit and what its workflow runs concluded. */
async function readGithub(
  repo: Repo,
  token: string,
  doFetch: Fetch,
): Promise<{ commit: LiveCommit | null; checks: LiveChecks | null; error: string | null }> {
  try {
    const rows = await ask<
      Array<{
        sha: string;
        html_url?: string;
        commit?: { message?: string; committer?: { date?: string } };
      }>
    >(
      `/repos/${repo.owner}/${repo.repo}/commits?sha=${encodeURIComponent(repo.branch)}&per_page=1`,
      token,
      doFetch,
    );
    const head = rows[0];
    if (!head) {
      return { commit: null, checks: null, error: `GitHub named no commits on ${repoKey(repo)} ${repo.branch}.` };
    }
    const commit: LiveCommit = {
      sha: head.sha,
      subject: commitSubject(head.commit?.message),
      url: head.html_url ?? `https://github.com/${repo.owner}/${repo.repo}/commit/${head.sha}`,
      at: head.commit?.committer?.date ?? null,
    };

    const body = await ask<{ workflow_runs?: WorkflowRun[] }>(
      `/repos/${repo.owner}/${repo.repo}/actions/runs?head_sha=${head.sha}&per_page=100`,
      token,
      doFetch,
    );
    const runs = body.workflow_runs ?? [];
    const conclusion = conclusionFrom(runs);
    const explained =
      conclusion === 'failed'
        ? await explainFailure(runs, repo, token, doFetch)
        : { reason: null, runUrl: null };
    return { commit, checks: { conclusion, ...explained }, error: null };
  } catch (err) {
    return { commit: null, checks: null, error: err instanceof Error ? err.message : String(err) };
  }
}

type VercelProject = { id: string; name: string };
type VercelDeployment = {
  url?: string | null;
  state?: string;
  readyState?: string;
  created?: number;
  createdAt?: number;
  inspectorUrl?: string | null;
  meta?: { githubCommitSha?: string };
};

/**
 * The Vercel project connected to the repository, and the team it is under.
 *
 * A token may be scoped to the person's own account or to a team, and the
 * projects live under a team, so the teams the token can see are asked first
 * and the account itself last. A scope that refuses is passed over; only a
 * token every scope refuses is an error.
 */
async function findVercelProject(
  repo: Repo,
  token: string,
  doFetch: Fetch,
): Promise<{ project: VercelProject; teamId: string | null } | null> {
  let teams: Array<{ id: string }> = [];
  try {
    teams = (await askVercel<{ teams?: Array<{ id: string }> }>('/v2/teams?limit=20', token, doFetch)).teams ?? [];
  } catch (err) {
    // A 401 here is the token, and every other call would say the same.
    if (err instanceof VercelRefused && err.status === 401) throw err;
  }

  const repoUrl = encodeURIComponent(`https://github.com/${repo.owner}/${repo.repo}`);
  let refused: VercelRefused | null = null;
  let answered = false;
  for (const teamId of [...teams.map((team) => team.id), null]) {
    try {
      const body = await askVercel<{ projects?: VercelProject[] }>(
        scoped(`/v10/projects?repoUrl=${repoUrl}&limit=1`, teamId),
        token,
        doFetch,
      );
      answered = true;
      const project = body.projects?.[0];
      if (project) return { project, teamId };
    } catch (err) {
      if (!(err instanceof VercelRefused)) throw err;
      if (err.status === 401) throw err;
      refused = err;
    }
  }
  if (!answered && refused) throw refused;
  return null;
}

/** The newest production deploy of the project connected to the repository. */
async function readVercel(
  repo: Repo,
  token: string,
  doFetch: Fetch,
): Promise<{ deploy: LiveDeploy | null; project: string | null; error: string | null }> {
  try {
    const found = await findVercelProject(repo, token, doFetch);
    if (!found) return { deploy: null, project: null, error: null };
    const body = await askVercel<{ deployments?: VercelDeployment[] }>(
      scoped(
        `/v6/deployments?projectId=${encodeURIComponent(found.project.id)}&target=production&limit=1`,
        found.teamId,
      ),
      token,
      doFetch,
    );
    const newest = body.deployments?.[0];
    if (!newest) return { deploy: null, project: found.project.name, error: null };
    const created = newest.created ?? newest.createdAt;
    return {
      project: found.project.name,
      error: null,
      deploy: {
        state: liveDeployState(newest.state ?? newest.readyState),
        url: newest.url ? `https://${newest.url.replace(/^https?:\/\//, '')}` : null,
        inspectorUrl: newest.inspectorUrl ?? null,
        at: typeof created === 'number' ? new Date(created).toISOString() : null,
        sha: newest.meta?.githubCommitSha ?? null,
      },
    };
  } catch (err) {
    const error =
      err instanceof VercelRefused
        ? vercelRefusal(err.status, repoKey(repo))
        : `Vercel could not be reached for ${repoKey(repo)}'s deploys.`;
    return { deploy: null, project: null, error };
  }
}

/** One reading of a project's repository, taken now, with nothing kept. */
export async function readProjectLive(input: {
  repo: Repo;
  now?: number;
  fetch?: Fetch;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<ProjectLive> {
  const now = input.now ?? Date.now();
  const doFetch = input.fetch ?? globalThis.fetch;
  const env = input.env ?? process.env;
  const githubToken = input.env ? env.GITHUB_READ_TOKEN?.trim() || null : readToken();
  const vercelToken = vercelReadToken(env);
  const key = repoKey(input.repo);

  const [github, vercel] = await Promise.all([
    githubToken
      ? readGithub(input.repo, githubToken, doFetch)
      : Promise.resolve({
          commit: null,
          checks: null,
          error: `GITHUB_READ_TOKEN is not set, so ${key}'s last commit and its checks cannot be read. Set it in Vercel and redeploy.`,
        }),
    vercelToken
      ? readVercel(input.repo, vercelToken, doFetch)
      : Promise.resolve({
          deploy: null,
          project: null,
          error: `PROJECTS_VERCEL_TOKEN is not set, so ${key}'s deploys cannot be read. Set it in Vercel and redeploy.`,
        }),
  ]);

  return {
    repo: key,
    branch: input.repo.branch,
    readAt: new Date(now).toISOString(),
    commit: github.commit,
    checks: github.checks,
    githubError: github.error,
    githubTokenMissing: !githubToken,
    deploy: vercel.deploy,
    vercelProject: vercel.project,
    deployError: vercel.error,
    vercelTokenMissing: !vercelToken,
  };
}

const kept = new Map<string, { at: number; reading: Promise<ProjectLive> }>();

/**
 * The reading for the page: the one taken in the last minute for this
 * repository, or a new one. The promise is kept, so two pages opened at once
 * share one set of requests.
 */
export function loadProjectLive(repo: Repo, now: number = Date.now()): Promise<ProjectLive> {
  const key = `${repoKey(repo)}@${repo.branch}`;
  const hit = kept.get(key);
  if (hit && now - hit.at < LIVE_CACHE_MS) return hit.reading;
  const reading = readProjectLive({ repo, now });
  kept.set(key, { at: now, reading });
  return reading;
}

/** For tests: forget every kept reading. */
export function forgetProjectLive(): void {
  kept.clear();
}
