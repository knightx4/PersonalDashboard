import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  publicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  }),
}));

import { connectorAccess } from './access';

/**
 * connectorAccess end to end (plan #1255): a token signed with a real ES256
 * key and verified by supabase-js's own getClaims against a stubbed JWKS,
 * then every schema's client carrying that token to the database. The
 * database is a stubbed fetch that records what each request sent.
 */

const URL_BASE = 'https://project.supabase.co';
const ME = '00000000-0000-4000-8000-00000000000a';
const KID = 'test-key';

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
});

function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
  return buf.toString('base64url');
}

async function sign(claims: Record<string, unknown>): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: KID }));
  const body = b64url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
}

function tokenClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: ME,
    iss: `${URL_BASE}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now - 60,
    exp: now + 3000,
    client_id: 'claude-client',
    ...overrides,
  };
}

type Seen = { url: string; authorization: string | null; profile: string | null };

function stubDatabase(options: { revokedAt?: string | null } = {}): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    seen.push({
      url,
      authorization: headers.get('authorization'),
      profile: headers.get('accept-profile'),
    });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/auth/v1/.well-known/jwks.json')) {
      return json({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256', key_ops: ['verify'] }] });
    }
    if (url.includes('/rest/v1/connector_revocations')) {
      return json(options.revokedAt ? [{ revoked_at: options.revokedAt }] : []);
    }
    if (url.includes('/rest/v1/account_settings')) {
      return json({
        display_name: null,
        timezone: 'Europe/London',
        display_currency: 'GBP',
        enabled_modules: ['todo', 'vault'],
        theme: null,
      });
    }
    return json([]);
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connectorAccess', () => {
  it('verifies a connector token and builds the lookups on it', async () => {
    const seen = stubDatabase();
    const token = await sign(tokenClaims());
    const access = await connectorAccess(`Bearer ${token}`);
    if (!access.ok) throw new Error(access.error);

    expect(access.caller).toMatchObject({ userId: ME, clientId: 'claude-client' });
    expect(access.ctx.userId).toBe(ME);
    expect(access.ctx.enabledModules).toEqual(['todo', 'vault']);
    expect(access.ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(access.ctx.searchSources.length).toBeGreaterThan(0);

    // Every read so far, and a lookup's read in another schema, went as the token's holder.
    const todo = await access.ctx.db('todo');
    await todo.from('tasks').select('id');
    const reads = seen.filter((s) => s.url.includes('/rest/v1/'));
    expect(reads.map((s) => s.profile)).toEqual(['core', 'core', 'todo']);
    for (const read of reads) expect(read.authorization).toBe(`Bearer ${token}`);
    expect(await access.ctx.db('todo')).toBe(todo);
  });

  it('refuses a request with no bearer token', async () => {
    const seen = stubDatabase();
    expect(await connectorAccess(null)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await connectorAccess('Basic abc')).toMatchObject({ ok: false, reason: 'missing' });
    expect(seen).toEqual([]);
  });

  it('refuses a sign-in session token', async () => {
    stubDatabase();
    const token = await sign(tokenClaims({ client_id: undefined }));
    expect(await connectorAccess(`Bearer ${token}`)).toMatchObject({ ok: false, reason: 'not_connector' });
  });

  it('refuses an expired token', async () => {
    stubDatabase();
    const now = Math.floor(Date.now() / 1000);
    const token = await sign(tokenClaims({ iat: now - 7200, exp: now - 3600 }));
    expect(await connectorAccess(`Bearer ${token}`)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses a token issued before the app was removed', async () => {
    stubDatabase({ revokedAt: new Date().toISOString() });
    const token = await sign(tokenClaims());
    expect(await connectorAccess(`Bearer ${token}`)).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('refuses a token whose signature does not match', async () => {
    stubDatabase();
    const token = await sign(tokenClaims());
    const [head, , sig] = token.split('.');
    const forged = `${head}.${b64url(JSON.stringify(tokenClaims({ sub: 'someone-else' })))}.${sig}`;
    expect(await connectorAccess(`Bearer ${forged}`)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
