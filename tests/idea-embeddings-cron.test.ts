/**
 * The idea sweep's clock (plan #2147.1): the route that embeds ideas without a
 * vector, and the pg_cron job that calls it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/learn/idea-embeddings', () => ({
  runIdeaEmbeddingsTick: vi.fn(async () => ({ users: [], more: false })),
}));

const { GET, POST } = await import('@/app/api/cron/idea-embeddings/route');
const { runIdeaEmbeddingsTick } = await import('@/inngest/learn/idea-embeddings');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/idea-embeddings', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the idea embeddings route', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'secret-token');
    vi.mocked(runIdeaEmbeddingsTick).mockClear();
  });

  it('refuses a call without the secret, on both verbs', async () => {
    expect((await POST(tickRequest(null))).status).toBe(401);
    expect((await GET(tickRequest('wrong'))).status).toBe(401);
    expect(runIdeaEmbeddingsTick).not.toHaveBeenCalled();
  });

  it('runs the sweep for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, users: [], more: false });
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0248_idea_embeddings_tick_cron.sql'),
  'utf8',
);
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the idea embeddings schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'idea-embeddings-tick'");
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(statements.indexOf('cron.schedule('));
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/idea-embeddings'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});
