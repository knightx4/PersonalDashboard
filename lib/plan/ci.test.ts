import { describe, expect, it, vi } from 'vitest';
import { listPushes, refusalFor } from '@/lib/plan/ci';

describe('refusalFor', () => {
  it('names the permission a refused check-runs read is short of', () => {
    const said = refusalFor(
      403,
      '/repos/knightx4/PersonalDashboard/commits/a405587/check-runs?per_page=100',
    );
    expect(said).toContain('Checks: Read');
    expect(said).toContain('GITHUB_READ_TOKEN');
    expect(said).toContain('403');
    // The path carries /commits as well, and the longer match is the right one.
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
