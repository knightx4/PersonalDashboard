/**
 * The endpoint eBay validates before it will call the production keyset
 * compliant. Exercised through the real route handlers, because the failure
 * everyone hits is in the wiring — a missing token, a mismatched URL, a body
 * eBay's parser will not take — not in the hash itself.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const TOKEN = 'Shelf_Manager_Verification_Token_2026';

vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://shelf.example.com');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://stub.supabase.co');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'stub-anon-key');

const { NextRequest } = await import('next/server');
const route = await import('@/app/api/ebay/account-deletion/route');
const { challengeResponse } = await import('@/lib/ebay/account-deletion');

function get(query: string) {
  return route.GET(
    new NextRequest(`https://shelf.example.com/api/ebay/account-deletion${query}`),
  );
}

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET (eBay challenge)', () => {
  it('answers with the hash eBay will recompute, and nothing else', async () => {
    vi.stubEnv('EBAY_VERIFICATION_TOKEN', TOKEN);
    const response = await get('?challenge_code=abc123');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    // Says which URL it hashed, so a mismatch is one curl away from obvious.
    expect(response.headers.get('x-ebay-endpoint')).toBe(
      'https://shelf.example.com/api/ebay/account-deletion',
    );

    const body = await response.json();
    expect(body).toEqual({
      challengeResponse: challengeResponse({
        challengeCode: 'abc123',
        verificationToken: TOKEN,
        // Derived from NEXT_PUBLIC_APP_URL: the value registered with eBay.
        endpoint: 'https://shelf.example.com/api/ebay/account-deletion',
      }),
    });
    // A stray key would break eBay's parser, so the shape is asserted exactly.
    expect(Object.keys(body)).toEqual(['challengeResponse']);
  });

  it('honours an explicit endpoint override when a custom domain is registered', async () => {
    vi.stubEnv('EBAY_VERIFICATION_TOKEN', TOKEN);
    vi.stubEnv('EBAY_DELETION_ENDPOINT_URL', 'https://custom.example.com/ebay');

    const body = await (await get('?challenge_code=abc123')).json();
    expect(body.challengeResponse).toBe(
      challengeResponse({
        challengeCode: 'abc123',
        verificationToken: TOKEN,
        endpoint: 'https://custom.example.com/ebay',
      }),
    );
    vi.stubEnv('EBAY_DELETION_ENDPOINT_URL', '');
  });

  it('rejects a call with no challenge code', async () => {
    vi.stubEnv('EBAY_VERIFICATION_TOKEN', TOKEN);
    expect((await get('')).status).toBe(400);
  });

  it('refuses to answer with a missing or malformed token rather than a wrong hash', async () => {
    vi.stubEnv('EBAY_VERIFICATION_TOKEN', '');
    const unconfigured = await get('?challenge_code=abc123');
    expect(unconfigured.status).toBe(500);
    // Still reports the endpoint: the misconfiguration might be the URL too.
    expect(unconfigured.headers.get('x-ebay-endpoint')).toContain('/api/ebay/account-deletion');

    // Too short for eBay, so it would be rejected at registration anyway.
    vi.stubEnv('EBAY_VERIFICATION_TOKEN', 'short');
    expect((await get('?challenge_code=abc123')).status).toBe(500);
  });
});

describe('POST (the notification)', () => {
  it('acknowledges with 204 and an empty body', async () => {
    const response = await route.POST();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('does not log the closing user, which is the record we promise not to keep', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await route.POST();
    const written = log.mock.calls.flat().join(' ');
    expect(written).not.toMatch(/username|userId|eiasToken/i);
  });
});
