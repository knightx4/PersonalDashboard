import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { requestOrigin } from '@/inngest/cron/authorize';

function request(host: string): NextRequest {
  return new Request(`https://${host}/api/cron/daily`, { headers: { host } }) as unknown as NextRequest;
}

describe('requestOrigin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('calls back on the production domain when the cron arrives on a vercel.app host', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'dash.example.com');
    expect(requestOrigin(request('app-abc123-team.vercel.app'))).toBe('https://dash.example.com');
  });

  it('keeps a custom domain the request already came in on', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'dash.example.com');
    expect(requestOrigin(request('other.example.com'))).toBe('https://other.example.com');
  });

  it('leaves a preview on its own host', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'dash.example.com');
    expect(requestOrigin(request('app-git-branch-team.vercel.app'))).toBe('https://app-git-branch-team.vercel.app');
  });

  it('keeps the host when production has no custom domain', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'app-team.vercel.app');
    expect(requestOrigin(request('app-abc123-team.vercel.app'))).toBe('https://app-abc123-team.vercel.app');
  });
});
