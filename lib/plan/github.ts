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

/** The repository the plan is built in. The app is the thing being checked. */
export const REPO = { owner: 'knightx4', repo: 'PersonalDashboard', branch: 'main' };

/** How `plan_main_checks` names that repository: its primary key. */
export const REPO_KEY = `${REPO.owner}/${REPO.repo}`;

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
  if (status === 401) {
    return `GITHUB_READ_TOKEN was rejected by GitHub (401) — it has expired or is mistyped. Set a new one in Vercel and redeploy.`;
  }
  if (status === 403 || status === 404) {
    const permission = PERMISSION_FOR.find(([fragment]) => path.includes(fragment))?.[1];
    const grant = permission
      ? `Give it "${permission}" on ${REPO.owner}/${REPO.repo}`
      : `Give it access to ${REPO.owner}/${REPO.repo}`;
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
  fetch?: typeof globalThis.fetch;
}): Promise<CommitLanding> {
  const token = readToken();
  if (!token) {
    return {
      onMain: null,
      status: null,
      error: `No GITHUB_READ_TOKEN is set, so whether a commit is on ${REPO.branch} cannot be read.`,
    };
  }

  const path = `/repos/${REPO.owner}/${REPO.repo}/compare/${REPO.branch}...${encodeURIComponent(input.sha)}`;
  try {
    const body = await ask<{ status?: string }>(path, token, input.fetch ?? globalThis.fetch);
    const status = body.status ?? null;
    if (!status) {
      return {
        onMain: null,
        status: null,
        error: `GitHub compared ${REPO.branch} with ${input.sha} and said nothing about how the two stand.`,
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
 * Why closing a step against this commit is refused, or null when it may go
 * ahead.
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
}): string | null {
  if (input.landing.onMain === true) return null;

  if (input.landing.onMain === null) {
    return (
      `Whether ${input.sha} is on ${REPO.branch} could not be read, so this close was refused. ` +
      `${input.landing.error ?? 'GitHub said nothing.'} ` +
      `Close the step from somewhere that can reach GitHub, once the work is on ${REPO.branch}.`
    );
  }

  // Main itself is never the interesting answer here -- we are only here
  // because main does not carry the commit -- and a local checkout usually
  // lists both the branch and its remote.
  const branches = [...new Set(input.branches ?? [])].filter(
    (branch) => branch !== REPO.branch && branch !== `origin/${REPO.branch}`,
  );
  const where =
    branches.length > 0 ? `it is on ${branches.join(', ')}` : `no branch here carries it`;
  return (
    `${input.sha} is not on ${REPO.branch} — ${where}. ` +
    `Merge the work to ${REPO.branch}, then close the step against what landed.`
  );
}
