/**
 * What is wrong with the job search's own machinery, read once a day
 * (check.ts) and raised to the bell, so a failure reaches the person instead
 * of sitting in a run's row. Each problem has a stable key, so a problem that
 * lasts several days is one raise, and one that clears closes its raise.
 * Pure, so the rules are tested apart from the reads.
 */

export type HealthInput = {
  now: Date;
  /** The latest run of each search, as search-runs.ts reads it. */
  rolesRun: RunFact | null;
  peopleRun: RunFact | null;
  /** Followed companies with a known board, and how many the run is allowed to read. */
  followedBoards: number;
  boardLimit: number;
  discovery: { stage: string; startedAt: string; offered: number; error: string | null } | null;
  jevOn: boolean;
  /** Open roles still unscored a day and a half after they were written. */
  staleUnscored: number;
};

export type RunFact = {
  state: 'running' | 'done' | 'failed' | 'stopped';
  startedAt: string;
  boardsRead: number;
  error: string | null;
};

export type HealthProblem = {
  key: 'roles-search' | 'people-search' | 'boards' | 'discovery-failed' | 'discovery-empty' | 'scoring';
  title: string;
  detail: string;
};

const DAY = 24 * 60 * 60 * 1000;

function within(iso: string, now: Date, days: number): boolean {
  return now.getTime() - new Date(iso).getTime() <= days * DAY;
}

/** A run's failure, recent enough that it is still the state of things. */
function runFailure(run: RunFact | null, now: Date): string | null {
  if (!run || !within(run.startedAt, now, 3)) return null;
  if (run.state === 'failed') return run.error ?? 'It gave no reason.';
  if (run.state === 'stopped') return 'It was cut off before it finished and did not record why.';
  return null;
}

export function healthProblems(input: HealthInput): HealthProblem[] {
  const problems: HealthProblem[] = [];

  const roles = runFailure(input.rolesRun, input.now);
  if (roles) {
    problems.push({ key: 'roles-search', title: 'The roles search failed', detail: roles });
  }
  const people = runFailure(input.peopleRun, input.now);
  if (people) {
    problems.push({ key: 'people-search', title: 'The people search failed', detail: people });
  }

  // A board that fails to load is skipped without a word (suggest/boards.ts),
  // so a vendor changing its endpoint shows only as a falling count.
  const expected = Math.min(input.followedBoards, input.boardLimit);
  const run = input.rolesRun;
  if (run && run.state === 'done' && within(run.startedAt, input.now, 3) && expected >= 4 && run.boardsRead < expected / 2) {
    problems.push({
      key: 'boards',
      title: `Only ${run.boardsRead} of ${expected} followed job boards could be read`,
      detail:
        'The latest roles search could not load most of the boards of companies you follow, so their openings are missing from Recommended roles. A job board site may have changed how it publishes.',
    });
  }

  const discovery = input.discovery;
  if (discovery && within(discovery.startedAt, input.now, 8)) {
    if (discovery.stage === 'failed') {
      problems.push({
        key: 'discovery-failed',
        title: 'Startup discovery failed',
        detail: discovery.error ?? 'It gave no reason.',
      });
    } else if (discovery.stage === 'done' && discovery.offered === 0) {
      problems.push({
        key: 'discovery-empty',
        title: 'Startup discovery read no hiring startups',
        detail:
          'The YC list and the Hacker News thread gave nothing that passed your preferences. One of them may have stopped loading, or the filters may leave nothing.',
      });
    }
  }

  if (input.jevOn && input.staleUnscored >= 3) {
    problems.push({
      key: 'scoring',
      title: `${input.staleUnscored} roles have waited over a day for a fit score`,
      detail:
        'Jev has not scored them, so they show without fit or chance and your lowest fit score is not applied to them. Jev may be failing or out of credit.',
    });
  }
  return problems;
}

/** The raise's source, which is how a problem finds its own raise again. */
export const HEALTH_SOURCE_PREFIX = 'job search health: ';

export function healthSource(key: HealthProblem['key']): string {
  return `${HEALTH_SOURCE_PREFIX}${key}`;
}
