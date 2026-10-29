/**
 * The route to GitHub this repository is asked about itself down, and the one
 * question closing a step puts to it.
 *
 * `ci.ts` holds the plan's readings -- what CI said about a commit, what has
 * been pushed since -- and it is `server-only`, because it writes to Supabase
 * over the app's client and has no business in a browser bundle. That marker
 * throws the moment node loads it, so `scripts/plan.ts` cannot import it, and
 * closing a step is a thing the CLI does. So the plumbing every reading shares
 * -- the repository, the token, the headers, and what a refusal means -- sits
 * here where both can have it, and `ci.ts` re-exports the parts the app was
 * already importing from it.
 *
 * This is not a second route to GitHub. It is the same `ask`, one level down,
 * so that when the key is rotated there is still one set of headers to fix.
 */
const API = 'https://api.github.com';

/** A repository and the branch that counts as shipped in it. */
export type Repo = { owner: string; repo: string; branch: string };

/**
 * The repository this app is built in, from the environment so the code names
 * no one's account: APP_REPOSITORY ("owner/name"), else the repository Vercel
 * deployed from (VERCEL_GIT_REPO_OWNER and VERCEL_GIT_REPO_SLUG), else the one
 * a GitHub Actions run is in (GITHUB_REPOSITORY). With none of them the owner
 * and name are empty, and every GitHub read below fails with GitHub's own
 * not-found rather than reading someone else's repository.
 */
export function appRepo(env: Readonly<Record<string, string | undefined>> = process.env): Repo {
  const vercel =
    env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : '';
  const named = env.APP_REPOSITORY?.trim() || vercel || env.GITHUB_REPOSITORY?.trim() || '';
  const [owner = '', repo = ''] = named.split('/');
  return { owner, repo, branch: 'main' };
}

/**
 * This app's repository (`appRepo`). A plan step is built here unless its
 * feature sits under a Dev project (lib/plan/projects), whose own repository
 * every question below takes instead (plan #2553.2).
 */
export const REPO: Repo = appRepo();

/** How `plan_main_checks` names a repository: its primary key. */
export function repoKey(repo: Pick<Repo, 'owner' | 'repo'>): string {
  return `${repo.owner}/${repo.repo}`;
}

/** This app's row in `plan_main_checks`. */
export const REPO_KEY = repoKey(REPO);

/** Whether a repository is this app's own, which alone has screens and migrations here. */
export function isAppRepo(repo: Pick<Repo, 'owner' | 'repo'>): boolean {
  return repoKey(repo).toLowerCase() === REPO_KEY.toLowerCase();
}

/** The token that may read this repository's checks. Set in Vercel. */
export function readToken(): string | null {
  return process.env.GITHUB_READ_TOKEN?.trim() || null;
}

/**
 * Which permission each endpoint here is refused for want of.
 *
 * A fine-grained token grants these separately, so a token that reads the
 * repository fine can still be refused the workflow runs -- which is exactly
 * the shape this failed in.
 *
 * Only the ones this file is sure of are named. The activity listing falls
 * through to the unnamed form on purpose: sending someone to tick the wrong
 * box is worse than telling them a box is missing.
 */
const PERMISSION_FOR: ReadonlyArray<readonly [string, string]> = [
  ['/actions/runs', 'Actions: Read'],
  ['/commits', 'Contents: Read'],
  ['/contents/', 'Contents: Read'],
  ['/deployments', 'Deployments: Read'],
];

/**
 * What a refusal from GitHub means, said to the person who can fix it.
 *
 * This came back as a bug report reading "Could not read CI: GitHub answered
 * 403 for /repos/…/check-runs?per_page=100", with "I dont even know what this
 * means" under it -- which is fair, because the page was repeating HTTP at
 * somebody who never asked GitHub anything. Law 2 wants a source that failed
 * to say so in place; it does not want it said in status codes.
 *
 * A 403 or a 404 on these paths is neither a bug nor an outage. It is
 * GITHUB_READ_TOKEN missing one permission, or having expired, and both of
 * those are a sentence rather than a number. The status stays in the text
 * because it is the thing to search for if the sentence turns out wrong.
 */
export function refusalFor(status: number, path: string): string {
  // The repository the refused path is about, so a token that reads this app
  // but not a project's repository is told which one it is missing.
  const named = /^\/repos\/([^/]+)\/([^/?]+)/.exec(path);
  const where = named ? `${named[1]}/${named[2]}` : REPO_KEY;
  if (status === 401) {
    return `GITHUB_READ_TOKEN was rejected by GitHub (401) — it has expired or is mistyped. Set a new one in Vercel and redeploy.`;
  }
  if (status === 403 || status === 404) {
    const permission = PERMISSION_FOR.find(([fragment]) => path.includes(fragment))?.[1];
    const grant = permission
      ? `Give it "${permission}" on ${where}`
      : `Give it access to ${where}`;
    return `GITHUB_READ_TOKEN is missing a permission (${status}). ${grant} in the token's settings, then redeploy.`;
  }
  return `GitHub answered ${status} for ${path}`;
}

export async function ask<T>(
  path: string,
  token: string,
  doFetch: typeof globalThis.fetch,
): Promise<T> {
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
    throw new Error(refusalFor(res.status, path));
  }
  return (await res.json()) as T;
}

/** Where a commit stands against main, as the compare endpoint puts it. */
export type CommitLanding = {
  /** On main, definitely not on main, or null when GitHub would not say. */
  onMain: boolean | null;
  /** GitHub's word for the comparison: identical, behind, ahead, diverged. */
  status: string | null;
  /** Why the answer is missing, in a sentence. Null when GitHub answered. */
  error: string | null;
};

/**
 * The two comparisons that mean main already carries the commit.
 *
 * `behind` is main...sha read from main's side: the commit is behind main, so
 * it is an ancestor of it. `identical` is the commit being main's own head.
 * `ahead` and `diverged` both mean main does not carry it.
 */
const ON_MAIN: ReadonlySet<string> = new Set(['identical', 'behind']);

/**
 * Whether main carries a commit.
 *
 * One request. The compare endpoint answers this exactly and at any depth,
 * where walking main's commits answers it only as far back as it pages -- and
 * a step closed on work merged a month ago is exactly the case that walk would
 * give up on.
 *
 * Every failure is `onMain: null` rather than false, including the 404 for a
 * commit GitHub has never seen. A commit nobody pushed is certainly not on
 * main, but a 404 here is equally a token that cannot read this repository,
 * and the two cannot be told apart from the status alone. Saying "GitHub would
 * not tell us" for both is the answer that is true either way; the caller
 * refuses the close on it, so nothing is let through by the ambiguity.
 */
export async function commitOnMain(input: {
  sha: string;
  /** The repository to ask about. This app's unless the step is a project's. */
  repo?: Repo;
  fetch?: typeof globalThis.fetch;
}): Promise<CommitLanding> {
  const repo = input.repo ?? REPO;
  const token = readToken();
  if (!token) {
    return {
      onMain: null,
      status: null,
      error: `No GITHUB_READ_TOKEN is set, so whether a commit is on ${repo.branch} cannot be read.`,
    };
  }

  const path = `/repos/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(repo.branch)}...${encodeURIComponent(input.sha)}`;
  try {
    const body = await ask<{ status?: string }>(path, token, input.fetch ?? globalThis.fetch);
    const status = body.status ?? null;
    if (!status) {
      return {
        onMain: null,
        status: null,
        error: `GitHub compared ${repo.branch} with ${input.sha} and said nothing about how the two stand.`,
      };
    }
    return { onMain: ON_MAIN.has(status), status, error: null };
  } catch (error) {
    return {
      onMain: null,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Why closing a step (or a note) against this commit is refused, or null
 * when it may go ahead.
 *
 * A step carries the commit it shipped in, and that commit is what the plan
 * page, the CI mark and anybody reading back through the history trusts. A
 * close on a commit that only ever existed on a branch makes all three wrong
 * at once, and it has happened: a session commits, never merges, closes the
 * step, and the plan says shipped about work that is nowhere.
 *
 * So the unknown answer is refused too. A check that passes when it could not
 * ask is the check that let this through in the first place: it would be
 * green every time the token expired, which is the one time it matters.
 */
export function closeRefusal(input: {
  sha: string;
  landing: CommitLanding;
  branches?: readonly string[];
  /** What is being closed, as the sentence names it. A plan step by default. */
  what?: string;
  /** The repository the commit was asked about. This app's by default. */
  repo?: Repo;
}): string | null {
  const what = input.what ?? 'the step';
  const repo = input.repo ?? REPO;
  // A project's branch is named with its repository, since "main" alone reads
  // as this app's.
  const branch = isAppRepo(repo) ? repo.branch : `${repo.branch} in ${repoKey(repo)}`;
  if (input.landing.onMain === true) return null;

  if (input.landing.onMain === null) {
    return (
      `Whether ${input.sha} is on ${branch} could not be read, so this close was refused. ` +
      `${input.landing.error ?? 'GitHub said nothing.'} ` +
      `Close ${what} from somewhere that can reach GitHub, once the work is on ${branch}.`
    );
  }

  // Main itself is never the interesting answer here -- we are only here
  // because main does not carry the commit -- and a local checkout usually
  // lists both the branch and its remote.
  const branches = [...new Set(input.branches ?? [])].filter(
    (name) => name !== repo.branch && name !== `origin/${repo.branch}`,
  );
  const where =
    branches.length > 0
      ? `it is on ${branches.join(', ')}`
      : isAppRepo(repo)
        ? `no branch here carries it`
        : `it is only on a branch there, or not pushed`;
  return (
    `${input.sha} is not on ${branch} — ${where}. ` +
    `Merge the work to ${branch}, then close ${what} against what landed.`
  );
}
