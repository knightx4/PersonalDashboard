/**
 * The route the plan page calls once it has drawn.
 *
 * What is pinned here is the contract the page and the dev pages read it
 * through: a POST, the user taken from the session and never from the request,
 * the readings keyed by step id, and a GitHub refusal answered as a reading
 * rather than as a failed request. The work itself is `refreshRunReadings`,
 * covered in `lib/plan/runs.test.ts`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const session = vi.fn<() => Promise<{ id: string } | null>>();
const refresh = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  getUser: () => session(),
  createClient: async () => ({ from: () => ({}) }),
}));

vi.mock('@/lib/plan/runs', () => ({
  refreshRunReadings: (input: unknown) => refresh(input),
}));

const { POST } = await import('@/app/api/plan/runs/route');

const reading = {
  checkedAt: '2026-09-17T12:00:00.000Z',
  lastPush: { at: '2026-09-17T11:54:00.000Z', sha: 'abc1234', subject: 'Did a thing (plan #1)' },
  refusal: null,
};

beforeEach(() => {
  session.mockReset();
  refresh.mockReset();
});

describe('POST /api/plan/runs', () => {
  it('hands back the reading now stored against each claimed step', async () => {
    session.mockResolvedValue({ id: 'user-1' });
    refresh.mockResolvedValue({ readings: { 'step-1': reading }, written: 1, error: null });

    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      readings: { 'step-1': reading },
      written: 1,
      error: null,
    });
    // The user comes from the session, and there is no body to take one from.
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('answers a refusal with the reason, since that is what GitHub said', async () => {
    session.mockResolvedValue({ id: 'user-1' });
    refresh.mockResolvedValue({
      readings: {
        'step-1': {
          checkedAt: '2026-09-17T12:00:00.000Z',
          lastPush: null,
          refusal: 'GITHUB_READ_TOKEN was rejected by GitHub (401)',
        },
      },
      written: 1,
      error: 'GITHUB_READ_TOKEN was rejected by GitHub (401)',
    });

    const res = await POST();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('401');
  });

  it('refuses a caller with no session, and asks GitHub nothing', async () => {
    session.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
  });
});
