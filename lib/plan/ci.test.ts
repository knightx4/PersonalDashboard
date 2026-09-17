import { describe, expect, it, vi } from 'vitest';
import { listPushes, refreshCommitChecks, refusalFor } from '@/lib/plan/ci';

describe('refusalFor', () => {
  it('names the permission a refused workflow-runs read is short of', () => {
    const said = refusalFor(
      403,
      '/repos/knightx4/PersonalDashboard/actions/runs?head_sha=a405587&per_page=100',
    );
    expect(said).toContain('Actions: Read');
    expect(said).toContain('GITHUB_READ_TOKEN');
    expect(said).toContain('403');
    expect(said).not.toContain('Contents: Read');
  });

  it('names Contents for the commit listing', () => {
    expect(
      refusalFor(404, '/repos/knightx4/PersonalDashboard/commits?sha=main&per_page=100'),
    ).toContain('Contents: Read');
  });

  it('asks for no particular permission where it does not know which', () => {
    const said = refusalFor(403, '/repos/knightx4/PersonalDashboard/activity?per_page=100');
    expect(said).toContain('knightx4/PersonalDashboard');
    expect(said).not.toContain(': Read"');
  });

  it('says an expired token is expired rather than unpermitted', () => {
    const said = refusalFor(401, '/repos/knightx4/PersonalDashboard/activity');
    expect(said).toContain('401');
    expect(said).toMatch(/expired/);
  });

  it('leaves a status it has nothing to say about as it found it', () => {
    expect(refusalFor(500, '/repos/x/y/commits')).toBe('GitHub answered 500 for /repos/x/y/commits');
  });
});

describe('listPushes', () => {
  it('asks for the repository activity and reads the pushes out of it', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              activity_type: 'push',
              ref: 'refs/heads/main',
              after: 'abc1234',
              timestamp: '2026-09-17T11:50:00Z',
            },
          ]),
          { status: 200 },
        ),
    );

    const { pushes, error } = await listPushes({
      since: Date.parse('2026-09-17T10:00:00Z'),
      fetch: fetchFn as never,
    });

    expect(error).toBeNull();
    expect(pushes).toEqual([{ ref: 'main', sha: 'abc1234', at: '2026-09-17T11:50:00Z' }]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/knightx4/PersonalDashboard/activity');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_test');
    vi.unstubAllEnvs();
  });

  it('says so rather than throwing when there is no key', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', '');
    await expect(listPushes({ since: 0 })).resolves.toEqual({
      pushes: [],
      error: 'No GITHUB_READ_TOKEN is set, so pushes cannot be read.',
    });
    vi.unstubAllEnvs();
  });

  it('carries back what GitHub refused with', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const fetchFn = vi.fn(async () => new Response('{}', { status: 401 }));

    const { pushes, error } = await listPushes({ since: 0, fetch: fetchFn as never });

    expect(pushes).toEqual([]);
    expect(error).toContain('401');
    vi.unstubAllEnvs();
  });
});

/** One merge on main carrying one branch commit, which is what a step records. */
const MERGE = 'a'.repeat(40);
const BRANCH = 'b'.repeat(40);
const ROOT = 'c'.repeat(40);

const MAIN = [
  { sha: MERGE, parents: [{ sha: ROOT }, { sha: BRANCH }] },
  { sha: BRANCH, parents: [{ sha: ROOT }] },
  { sha: ROOT, parents: [] },
];

type Chain = {
  select: () => Chain;
  eq: () => Chain;
  not: () => Chain;
  upsert: (...args: unknown[]) => Promise<{ error: null }>;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
};

/**
 * The two reads and the one write the refresh makes: the closed steps with
 * commits, what is already known about them, and the rows it writes back.
 */
function db(steps: Array<{ commit_sha: string }>) {
  const upsert = vi.fn(async () => ({ error: null as null }));
  const answering = (result: unknown): Chain => {
    const node: Chain = {
      select: () => node,
      eq: () => node,
      not: () => node,
      upsert,
      then: (resolve) => Promise.resolve(result).then(resolve),
    };
    return node;
  };
  const supabase = {
    from: (table: string) =>
      answering(table === 'plan_items' ? { data: steps, error: null } : { data: [], error: null }),
  };
  return { supabase, upsert };
}

/** Main's listing, and whatever workflow runs the merge is said to have. */
function github(runs: Array<{ status: string; conclusion: string | null }>) {
  return vi.fn(async (url: string) =>
    String(url).includes('/actions/runs')
      ? new Response(JSON.stringify({ workflow_runs: runs }), { status: 200 })
      : new Response(JSON.stringify(MAIN), { status: 200 }),
  );
}

async function refreshAgainst(runs: Array<{ status: string; conclusion: string | null }>) {
  const { supabase, upsert } = db([{ commit_sha: BRANCH.slice(0, 7) }]);
  const fetchFn = github(runs);
  const result = await refreshCommitChecks({
    supabase: supabase as never,
    userId: 'user-1',
    now: Date.parse('2026-09-17T12:00:00Z'),
    fetch: fetchFn as never,
  });
  const [firstUpsert] = upsert.mock.calls as unknown as unknown[][];
  const written = firstUpsert?.[0] as Array<{
    commit_sha: string;
    merge_sha: string | null;
    conclusion: string;
  }>;
  return { result, written, fetchFn };
}

describe('refreshCommitChecks', () => {
  it('reads the merge from the workflow runs rather than the check runs', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { result, written, fetchFn } = await refreshAgainst([
      { status: 'completed', conclusion: 'failure' },
    ]);

    expect(result).toEqual({ checked: 1, error: null });
    expect(written).toEqual([
      expect.objectContaining({
        commit_sha: BRANCH.slice(0, 7),
        merge_sha: MERGE,
        conclusion: 'failed',
      }),
    ]);
    const asked = fetchFn.mock.calls.map(([url]) => String(url));
    expect(asked).toContainEqual(expect.stringContaining(`/actions/runs?head_sha=${MERGE}`));
    expect(asked.some((url) => url.includes('check-runs'))).toBe(false);
    vi.unstubAllEnvs();
  });

  it('is running while the merge\'s workflow has not finished', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { result, written } = await refreshAgainst([{ status: 'in_progress', conclusion: null }]);

    expect(result.error).toBeNull();
    expect(written[0].conclusion).toBe('running');
    vi.unstubAllEnvs();
  });

  it('is none when the merge ran no workflows at all', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { result, written } = await refreshAgainst([]);

    expect(result.error).toBeNull();
    expect(written[0].conclusion).toBe('none');
    vi.unstubAllEnvs();
  });
});
