import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitSubject,
  deployIsCurrent,
  liveDeployState,
  liveNotes,
  shortAgo,
  type ProjectLive,
} from '@/lib/plan/project-live';
import { forgetProjectLive, loadProjectLive, readProjectLive } from '@/lib/plan/project-live-read';

const REPO = { owner: 'knightx4', repo: 'symboliclogic', branch: 'main' };
const NOW = Date.parse('2026-11-04T12:00:00Z');
const HEAD = 'fd48806c9fd5711016466a79245adb78c4cb09eb';

type Route = (url: URL) => { status?: number; body: unknown } | null;

function fakeFetch(routes: Route[]) {
  const asked: string[] = [];
  const doFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(`${url.host}${url.pathname}${url.search}`);
    for (const route of routes) {
      const hit = route(url);
      if (hit) {
        return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 });
      }
    }
    return new Response('{}', { status: 404 });
  }) as typeof globalThis.fetch;
  return { doFetch, asked };
}

const github: Route[] = [
  (url) =>
    url.host === 'api.github.com' && url.pathname.endsWith('/commits')
      ? {
          body: [
            {
              sha: HEAD,
              html_url: `https://github.com/knightx4/symboliclogic/commit/${HEAD}`,
              commit: {
                message: 'Add CLAUDE.md for Dash\n\nCo-Authored-By: someone',
                committer: { date: '2026-11-04T11:40:00Z' },
              },
            },
          ],
        }
      : null,
  (url) =>
    url.host === 'api.github.com' && url.pathname.endsWith('/actions/runs')
      ? { body: { workflow_runs: [{ status: 'completed', conclusion: 'success' }] } }
      : null,
];

const vercel: Route[] = [
  (url) =>
    url.host === 'api.vercel.com' && url.pathname === '/v2/teams'
      ? { body: { teams: [{ id: 'team_1' }] } }
      : null,
  (url) =>
    url.host === 'api.vercel.com' && url.pathname === '/v10/projects'
      ? {
          body: {
            projects:
              url.searchParams.get('teamId') === 'team_1' &&
              url.searchParams.get('repoUrl') === 'https://github.com/knightx4/symboliclogic'
                ? [{ id: 'prj_1', name: 'symbolic-logic' }]
                : [],
          },
        }
      : null,
  (url) =>
    url.host === 'api.vercel.com' && url.pathname === '/v6/deployments'
      ? {
          body: {
            deployments: [
              {
                url: 'symbolic-logic-abc.vercel.app',
                state: 'READY',
                created: Date.parse('2026-11-04T11:42:00Z'),
                inspectorUrl: 'https://vercel.com/x/symbolic-logic/abc',
                meta: { githubCommitSha: HEAD },
              },
            ],
          },
        }
      : null,
];

const TOKENS = { GITHUB_READ_TOKEN: 'gh', PROJECTS_VERCEL_TOKEN: 'vc' };

describe('readProjectLive', () => {
  it('reads the last commit, its checks and the newest production deploy', async () => {
    const { doFetch, asked } = fakeFetch([...github, ...vercel]);
    const live = await readProjectLive({ repo: REPO, now: NOW, fetch: doFetch, env: TOKENS });

    expect(live.commit).toMatchObject({ sha: HEAD, subject: 'Add CLAUDE.md for Dash' });
    expect(live.checks?.conclusion).toBe('passed');
    expect(live.vercelProject).toBe('symbolic-logic');
    expect(live.deploy).toMatchObject({
      state: 'ready',
      url: 'https://symbolic-logic-abc.vercel.app',
      sha: HEAD,
      at: '2026-11-04T11:42:00.000Z',
    });
    expect(live.githubError).toBeNull();
    expect(live.deployError).toBeNull();
    expect(deployIsCurrent(live)).toBe(true);
    expect(liveNotes(live)).toEqual([]);
    // The deployments were asked under the team that holds the project.
    expect(asked.some((a) => a.includes('/v6/deployments') && a.includes('teamId=team_1'))).toBe(true);
  });

  it('says plainly which token is missing, and asks nobody', async () => {
    const { doFetch, asked } = fakeFetch([...github, ...vercel]);
    const live = await readProjectLive({ repo: REPO, now: NOW, fetch: doFetch, env: {} });

    expect(asked).toEqual([]);
    expect(live.githubTokenMissing).toBe(true);
    expect(live.vercelTokenMissing).toBe(true);
    expect(live.githubError).toContain('GITHUB_READ_TOKEN is not set');
    expect(live.deployError).toContain('PROJECTS_VERCEL_TOKEN is not set');
    expect(liveNotes(live).map((n) => n.tone)).toEqual(['caution', 'caution']);
  });

  it('shows checks only for a repository no Vercel project deploys', async () => {
    const { doFetch } = fakeFetch([...github, ...vercel]);
    const live = await readProjectLive({
      repo: { ...REPO, repo: 'music-pipeline' },
      now: NOW,
      fetch: doFetch,
      env: TOKENS,
    });

    expect(live.checks?.conclusion).toBe('passed');
    expect(live.deploy).toBeNull();
    expect(live.vercelProject).toBeNull();
    expect(live.deployError).toBeNull();
    expect(liveNotes(live)).toEqual([
      { tone: 'plain', text: 'No Vercel project deploys knightx4/music-pipeline, so this shows its checks only.' },
    ]);
  });

  it('keeps one source standing when the other refuses', async () => {
    const refusing: Route = (url) => (url.host === 'api.vercel.com' ? { status: 401, body: {} } : null);
    const { doFetch } = fakeFetch([refusing, ...github]);
    const live = await readProjectLive({ repo: REPO, now: NOW, fetch: doFetch, env: TOKENS });

    expect(live.checks?.conclusion).toBe('passed');
    expect(live.deploy).toBeNull();
    expect(live.deployError).toContain('PROJECTS_VERCEL_TOKEN was rejected by Vercel (401)');
  });

  it('explains a failed check and links its run', async () => {
    const failing: Route = (url) => {
      if (url.pathname.endsWith('/actions/runs')) {
        return {
          body: {
            workflow_runs: [
              { id: 7, name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/run/7' },
            ],
          },
        };
      }
      if (url.pathname.endsWith('/actions/runs/7/jobs')) {
        return {
          body: {
            jobs: [
              {
                name: 'build',
                conclusion: 'failure',
                runner_id: 3,
                steps: [{ name: 'Type-check', conclusion: 'failure' }],
              },
            ],
          },
        };
      }
      return null;
    };
    const { doFetch } = fakeFetch([failing, ...github, ...vercel]);
    const live = await readProjectLive({ repo: REPO, now: NOW, fetch: doFetch, env: TOKENS });

    expect(live.checks).toEqual({
      conclusion: 'failed',
      reason: 'Failed at build › Type-check.',
      runUrl: 'https://github.com/run/7',
    });
  });
});

describe('loadProjectLive', () => {
  beforeEach(() => {
    forgetProjectLive();
    vi.stubGlobal('fetch', fakeFetch([]).doFetch);
    return () => vi.unstubAllGlobals();
  });

  it('keeps a reading for a minute', () => {
    const first = loadProjectLive(REPO, NOW);
    expect(loadProjectLive(REPO, NOW + 59_000)).toBe(first);
    expect(loadProjectLive(REPO, NOW + 61_000)).not.toBe(first);
  });
});

describe('the words', () => {
  const base: ProjectLive = {
    repo: 'knightx4/symboliclogic',
    branch: 'main',
    readAt: '2026-11-04T12:00:00Z',
    commit: { sha: HEAD, subject: 'x', url: 'u', at: null },
    checks: { conclusion: 'passed', reason: null, runUrl: null },
    githubError: null,
    githubTokenMissing: false,
    deploy: { state: 'ready', url: null, inspectorUrl: null, at: null, sha: 'b4c19d07e2a1' },
    vercelProject: 'symbolic-logic',
    deployError: null,
    vercelTokenMissing: false,
  };

  it('says when the site runs an older commit', () => {
    expect(deployIsCurrent(base)).toBe(false);
    expect(liveNotes(base)[0].text).toBe(
      'The site is running an older commit (b4c19d0): Vercel has no production deploy of fd48806 yet.',
    );
  });

  it('folds Vercel states into four', () => {
    expect(liveDeployState('READY')).toBe('ready');
    expect(liveDeployState('ERROR')).toBe('failed');
    expect(liveDeployState('CANCELED')).toBe('canceled');
    expect(liveDeployState('QUEUED')).toBe('building');
  });

  it('keeps the first line of a commit message', () => {
    expect(commitSubject('Fix it\n\nbody')).toBe('Fix it');
    expect(commitSubject('')).toBe('No commit message');
  });

  it('gives short ages', () => {
    expect(shortAgo('2026-11-04T11:40:00Z', NOW)).toBe('20 min ago');
    expect(shortAgo('2026-11-04T09:00:00Z', NOW)).toBe('3 h ago');
    expect(shortAgo(null, NOW)).toBeNull();
  });
});
