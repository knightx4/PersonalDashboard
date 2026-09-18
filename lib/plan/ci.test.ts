import { describe, expect, it, vi } from 'vitest';
import {
  commitSubjects,
  listPushes,
  refreshCommitChecks,
  refreshMainCheck,
  refusalFor,
} from '@/lib/plan/ci';

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
    expect(refusalFor(500, '/repos/x/y/commits')).toBe(
      'GitHub answered 500 for /repos/x/y/commits',
    );
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

/** Commits per listing request, as `ci.ts` asks for them. */
const PAGE_SIZE = 100;

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

  it("is running while the merge's workflow has not finished", async () => {
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

/**
 * A step closed against a commit main does not carry.
 *
 * This is the reading the plan page draws "Not on main" from, and for a while
 * it could not be had at all: the answer used to be written only when the
 * listing of main had reached the start of the history, and main outgrew the
 * page cap, so the walk stopped reaching it and nothing was ever written. The
 * commits below are eight full pages of them, which is what that looks like
 * from here -- the walk never runs out, so an answer that waits for it never
 * comes.
 */
describe('refreshCommitChecks on a commit the listing never reaches', () => {
  /** What a step closed on its own branch records: nowhere in main's listing. */
  const LOST = 'd'.repeat(7);

  /** Main, longer than the page cap can read, and carrying none of the above. */
  const filler = (page: number) =>
    Array.from({ length: PAGE_SIZE }, (_, i) => {
      const n = page * PAGE_SIZE + i;
      return { sha: String(n).padStart(40, '0'), parents: [{ sha: String(n + 1).padStart(40, '0') }] };
    });

  async function refresh(compare: () => Response) {
    const { supabase, upsert } = db([{ commit_sha: LOST }]);
    const fetchFn = vi.fn(async (url: string) => {
      const path = String(url);
      if (path.includes('/compare/')) return compare();
      if (path.includes('/actions/runs')) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? '1');
      return new Response(JSON.stringify(filler(page)), { status: 200 });
    });

    const result = await refreshCommitChecks({
      supabase: supabase as never,
      userId: 'user-1',
      now: Date.parse('2026-09-17T12:00:00Z'),
      fetch: fetchFn as never,
    });
    const written = (upsert.mock.calls as unknown as unknown[][])[0]?.[0] as
      | Array<{ commit_sha: string; merge_sha: string | null; conclusion: string }>
      | undefined;
    return { result, written, fetchFn };
  }

  it('marks it unmerged however deep main has grown', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { result, written, fetchFn } = await refresh(
      () => new Response(JSON.stringify({ status: 'ahead' }), { status: 200 }),
    );

    expect(result).toEqual({ checked: 1, error: null });
    expect(written).toEqual([
      expect.objectContaining({ commit_sha: LOST, merge_sha: null, conclusion: 'unmerged' }),
    ]);
    // One comparison, against main, for the one commit the listing missed.
    const compares = fetchFn.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/compare/'));
    expect(compares).toHaveLength(1);
    expect(compares[0]).toContain(`/compare/main...${LOST}`);
    vi.unstubAllEnvs();
  });

  it('writes nothing when main turns out to carry it after all', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { result, written } = await refresh(
      () => new Response(JSON.stringify({ status: 'behind' }), { status: 200 }),
    );

    expect(result).toEqual({ checked: 0, error: null });
    expect(written).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('writes nothing when GitHub will not say, rather than guessing unmerged', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { result, written } = await refresh(() => new Response('{}', { status: 404 }));

    expect(result).toEqual({ checked: 0, error: null });
    expect(written).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

/**
 * Main's own head, read on every tick and stored for the status line.
 *
 * The properties are about what gets written down rather than what is
 * returned: the dot is drawn from the row, so a tick that asked and was
 * refused has to leave a row saying so, and a tick that asked and was answered
 * has to leave the sha it asked about beside the answer.
 */
describe('refreshMainCheck', () => {
  const NOW = Date.parse('2026-09-18T21:40:00.000Z');

  function store() {
    const upsert = vi.fn(async () => ({ error: null as null }));
    return {
      upsert,
      supabase: { from: () => ({ upsert }) } as never,
    };
  }

  const written = (upsert: ReturnType<typeof vi.fn>) =>
    (upsert.mock.calls as unknown as unknown[][])[0]?.[0] as Record<string, unknown>;

  it("stores main's newest commit and what CI made of it", async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, upsert } = store();
    const fetchFn = vi.fn(async (url: string) =>
      String(url).includes('/actions/runs')
        ? new Response(
            JSON.stringify({ workflow_runs: [{ status: 'completed', conclusion: 'failure' }] }),
            { status: 200 },
          )
        : new Response(JSON.stringify([{ sha: MERGE, parents: [] }]), { status: 200 }),
    );

    const result = await refreshMainCheck({ supabase, now: NOW, fetch: fetchFn as never });

    expect(result).toEqual({ sha: MERGE, conclusion: 'failed', error: null });
    expect(written(upsert)).toEqual({
      repo: 'knightx4/PersonalDashboard',
      head_sha: MERGE,
      conclusion: 'failed',
      checked_at: new Date(NOW).toISOString(),
      error: null,
    });

    // One commit, not eight pages of them: the whole question is what is at the
    // head of the branch.
    const asked = fetchFn.mock.calls.map(([url]) => String(url));
    expect(asked[0]).toContain('/commits?sha=main&per_page=1');
    expect(asked[1]).toContain(`/actions/runs?head_sha=${MERGE}`);
    vi.unstubAllEnvs();
  });

  it('stores the refusal rather than throwing it, so silence is not mistaken for a pass', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const { supabase, upsert } = store();
    const fetchFn = vi.fn(async () => new Response('{}', { status: 403 }));

    const result = await refreshMainCheck({ supabase, now: NOW, fetch: fetchFn as never });

    expect(result.conclusion).toBeNull();
    expect(result.error).toContain('Contents: Read');
    const row = written(upsert);
    expect(row.conclusion).toBeNull();
    expect(row.head_sha).toBeNull();
    expect(row.error).toContain('Contents: Read');
    // Still stamped: how long ago the app last tried is knowable even when the
    // trying failed.
    expect(row.checked_at).toBe(new Date(NOW).toISOString());
    vi.unstubAllEnvs();
  });

  it('says there is no key rather than asking GitHub without one', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', '');
    const { supabase, upsert } = store();
    const fetchFn = vi.fn();

    const result = await refreshMainCheck({ supabase, now: NOW, fetch: fetchFn as never });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.error).toContain('GITHUB_READ_TOKEN');
    expect(written(upsert).error).toContain('GITHUB_READ_TOKEN');
    vi.unstubAllEnvs();
  });
});

describe('commitSubjects', () => {
  it('reads the first line of each commit asked about', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const fetchFn = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify({
            commit: {
              message: `Subject for ${String(url).slice(-7)}\n\nA body nobody stores.`,
            },
          }),
          { status: 200 },
        ),
    );

    const subjects = await commitSubjects({
      shas: ['abc1234', 'def5678', 'abc1234'],
      fetch: fetchFn as never,
    });

    expect(subjects).toEqual({
      abc1234: 'Subject for abc1234',
      def5678: 'Subject for def5678',
    });
    // Asked once per distinct commit.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    vi.unstubAllEnvs();
  });

  it('leaves out a commit GitHub would not answer for, rather than failing', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    const fetchFn = vi.fn(async () => new Response('{}', { status: 404 }));

    await expect(commitSubjects({ shas: ['abc1234'], fetch: fetchFn as never })).resolves.toEqual(
      {},
    );
    vi.unstubAllEnvs();
  });

  it('asks nothing without a token, and nothing about what is not a commit', async () => {
    vi.stubEnv('GITHUB_READ_TOKEN', '');
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await commitSubjects({ shas: ['abc1234'], fetch: fetchFn as never })).toEqual({});

    vi.stubEnv('GITHUB_READ_TOKEN', 'ghp_test');
    expect(await commitSubjects({ shas: ['', 'nope'], fetch: fetchFn as never })).toEqual({});
    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
