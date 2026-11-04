/**
 * Whether a Dev project's latest work is live (plan #2800.6): its last commit
 * on main, what its checks made of that commit, and its newest production
 * deploy on Vercel.
 *
 * The reading is taken when the project's page is opened, by
 * `project-live-read.ts`, and kept for a minute. This file is the half the
 * page draws from: the shape of a reading and the words for it. Pure, so the
 * tests and the gallery can build one without a network.
 *
 * Each source carries its own failure. GitHub that would not answer leaves
 * the deploy standing, and the other way round, and a token that is not set
 * is said by name rather than drawn as an empty fact.
 */
import type { CheckConclusion } from './checks';

/** Main's newest commit. */
export type LiveCommit = {
  sha: string;
  /** The commit message's first line. */
  subject: string;
  /** The commit on GitHub. */
  url: string;
  /** When it was committed, ISO. Null when GitHub did not say. */
  at: string | null;
};

/** What the workflow runs for that commit concluded. */
export type LiveChecks = {
  conclusion: CheckConclusion;
  /** Which job and step broke, or why GitHub never started them. Failed only. */
  reason: string | null;
  /** The failing run on GitHub. Failed only. */
  runUrl: string | null;
};

/** Vercel's states folded to the four a person needs. */
export type LiveDeployState = 'ready' | 'building' | 'failed' | 'canceled';

/** The newest production deploy on Vercel. */
export type LiveDeploy = {
  state: LiveDeployState;
  /** The site the deploy serves, https. Null when Vercel gave none. */
  url: string | null;
  /** The deploy's page on Vercel, for a failed build's log. */
  inspectorUrl: string | null;
  /** When the deploy was created, ISO. */
  at: string | null;
  /** The commit it built. Null for a deploy not made from Git. */
  sha: string | null;
};

export type ProjectLive = {
  /** "owner/repo". */
  repo: string;
  branch: string;
  /** When this reading was taken, ISO. */
  readAt: string;
  commit: LiveCommit | null;
  checks: LiveChecks | null;
  /**
   * Why GitHub was not read: the token is not set, or it was refused, in the
   * sentence `refusalFor` writes. Null when it was read.
   */
  githubError: string | null;
  githubTokenMissing: boolean;
  deploy: LiveDeploy | null;
  /** The Vercel project the repository deploys through. Null when none was found. */
  vercelProject: string | null;
  /** Why Vercel was not read. Null when it was, project found or not. */
  deployError: string | null;
  vercelTokenMissing: boolean;
};

/** The Vercel deployment states, read into the four above. */
export function liveDeployState(state: string | null | undefined): LiveDeployState {
  switch (state) {
    case 'READY':
      return 'ready';
    case 'ERROR':
      return 'failed';
    case 'CANCELED':
      return 'canceled';
    default:
      // BUILDING, QUEUED, INITIALIZING, and anything Vercel adds later.
      return 'building';
  }
}

/** The commit's first line, no longer than the page has room for. */
export function commitSubject(message: string | null | undefined): string {
  const first = (message ?? '').split('\n')[0].trim();
  if (!first) return 'No commit message';
  return first.length > 200 ? `${first.slice(0, 197)}...` : first;
}

/** The word for the checks fact. */
export const CHECKS_SAYS: Record<CheckConclusion, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  none: 'No checks run',
  unmerged: 'Not on main',
};

/** The word for the deploy fact. */
export const DEPLOY_STATE_SAYS: Record<LiveDeployState, string> = {
  ready: 'Live',
  building: 'Building',
  failed: 'Failed',
  canceled: 'Canceled',
};

/**
 * Whether the newest deploy is of main's newest commit: true, false, or null
 * when either side is unknown. A ready deploy of an older commit is the case
 * "is it live?" is asked about, so the page says it in words.
 */
export function deployIsCurrent(live: ProjectLive): boolean | null {
  if (!live.commit || !live.deploy?.sha) return null;
  return live.deploy.sha === live.commit.sha;
}

/** One sentence under the facts. `caution` wants the person; `plain` only informs. */
export type LiveNote = { tone: 'caution' | 'plain'; text: string };

/**
 * The sentences under the facts: why something was not read (a token not
 * set, or refused), a deploy behind main, a project with no Vercel project.
 * In the order a person fixes them. The failing-check detail is drawn on its
 * own, with its link, and is not among these.
 */
export function liveNotes(live: ProjectLive): LiveNote[] {
  const notes: LiveNote[] = [];
  if (live.githubError) notes.push({ tone: 'caution', text: live.githubError });
  if (live.deployError) notes.push({ tone: 'caution', text: live.deployError });
  const current = deployIsCurrent(live);
  if (current === false && live.deploy?.sha && live.commit) {
    const of =
      live.deploy.state === 'ready'
        ? 'The site is running an older commit'
        : 'The newest deploy is of an older commit';
    notes.push({
      tone: 'caution',
      text: `${of} (${live.deploy.sha.slice(0, 7)}): Vercel has no production deploy of ${live.commit.sha.slice(0, 7)} yet.`,
    });
  }
  if (!live.deployError && !live.vercelTokenMissing && !live.vercelProject) {
    notes.push({ tone: 'plain', text: `No Vercel project deploys ${live.repo}, so this shows its checks only.` });
  }
  return notes;
}

/** "just now", "4 min ago", "3 h ago", "2 days ago": short enough for a fact. */
export function shortAgo(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
