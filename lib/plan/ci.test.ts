import { describe, expect, it, vi } from 'vitest';
import { listPushes } from '@/lib/plan/ci';

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
