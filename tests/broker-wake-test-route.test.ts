/**
 * The broker wake-time route (plan #2789.3) is never public: without the
 * server secret it answers 401 and touches nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/threads/broker-wake-test', () => ({
  advanceWakeTest: vi.fn(async () => ({ run: null, finished: false })),
}));
vi.mock('@/inngest/supabase-admin', () => ({
  createServiceSupabase: vi.fn(() => ({})),
  createServiceSchemaSupabase: vi.fn(() => ({})),
}));

const { GET, POST } = await import('@/app/api/cron/broker-wake-test/route');
const { advanceWakeTest } = await import('@/lib/threads/broker-wake-test');

function request(token: string | null, query = '') {
  const headers = new Headers({ host: 'example.test' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`https://example.test/api/cron/broker-wake-test${query}`, {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the broker wake-test route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(advanceWakeTest).mockClear();
  });

  it('refuses a request without the shared secret', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('wrong'))).status).toBe(401);
    expect(advanceWakeTest).not.toHaveBeenCalled();
  });

  it('starts a run only when asked to', async () => {
    expect((await POST(request('secret-token', '?start=1'))).status).toBe(200);
    expect(vi.mocked(advanceWakeTest).mock.calls[0][0].start).toBe(true);
    await POST(request('secret-token'));
    expect(vi.mocked(advanceWakeTest).mock.calls[1][0].start).toBe(false);
  });
});
