import { describe, expect, it } from 'vitest';
import { checkEbayConnection, ebayFailureHint } from './ebay-check';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const GOOD_ID = 'Shelf-Shelf-PRD-1a2b3c-4d5e';

function fakeFetch(search: () => Response, token?: Response): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) =>
    String(input) === TOKEN_URL
      ? (token ?? new Response(JSON.stringify({ access_token: 't', expires_in: 7200 })))
      : search()) as typeof globalThis.fetch;
}

function listings(...values: string[]) {
  return new Response(
    JSON.stringify({
      itemSummaries: values.map((value) => ({ price: { value, currency: 'USD' } })),
    }),
  );
}

describe('checkEbayConnection', () => {
  it('names the missing variable when nothing is configured', async () => {
    const result = await checkEbayConnection({ clientId: '', clientSecret: 'secret' });
    expect(result.ok).toBe(false);
    expect(result.stage).toBe('unconfigured');
    expect(result.detail).toContain('EBAY_CLIENT_ID');
    expect(result.detail).not.toContain('EBAY_CLIENT_SECRET');
    expect(result.hint).toContain('redeploy');
  });

  it('reports a working connection with the price it found', async () => {
    const result = await checkEbayConnection({
      clientId: GOOD_ID,
      clientSecret: 'secret',
      fetch: fakeFetch(() => listings('10.00', '20.00', '30.00', '40.00', '50.00')),
    });
    expect(result.ok).toBe(true);
    expect(result.stage).toBe('ok');
    expect(result.priceCents).toBe(2000);
  });

  it('separates a keyset without Browse access from a book with no listings', async () => {
    const forbidden = await checkEbayConnection({
      clientId: GOOD_ID,
      clientSecret: 'secret',
      fetch: fakeFetch(
        () => new Response(JSON.stringify({ errors: [{ message: 'denied' }] }), { status: 403 }),
      ),
    });
    expect(forbidden.ok).toBe(false);
    expect(forbidden.status).toBe(403);
    expect(forbidden.hint).toContain('separate grant');

    const empty = await checkEbayConnection({
      clientId: GOOD_ID,
      clientSecret: 'secret',
      fetch: fakeFetch(() => listings()),
    });
    // Still "not ok" -- no price came back -- but explicitly not a setup fault.
    expect(empty.ok).toBe(false);
    expect(empty.stage).toBe('no_results');
    expect(empty.headline).toContain('Connected');
    expect(empty.hint).toContain('not a configuration problem');
  });

  it('never echoes a credential into the result', async () => {
    const result = await checkEbayConnection({
      clientId: GOOD_ID,
      clientSecret: 'super-secret-value',
      fetch: fakeFetch(
        () => new Response('{}', { status: 500 }),
        new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }),
      ),
    });
    const shown = [result.headline, result.detail, result.hint ?? ''].join(' ');
    expect(shown).not.toContain('super-secret-value');
    expect(shown).not.toContain(GOOD_ID);
  });
});

describe('ebayFailureHint', () => {
  it('tells a sandbox keyset apart from an empty one', () => {
    expect(
      ebayFailureHint({ stage: 'credentials', detail: 'sandbox keyset (-SBX-)' }),
    ).toContain('production keyset');
    expect(
      ebayFailureHint({ stage: 'credentials', detail: 'client id or secret is empty' }),
    ).toContain('empty');
  });

  it('distinguishes a refused keyset from an unreachable host', () => {
    expect(ebayFailureHint({ stage: 'oauth', status: 401, detail: 'x' })).toContain(
      'refused the keyset',
    );
    expect(ebayFailureHint({ stage: 'oauth', status: 403, detail: 'x' })).toContain(
      'blocked host',
    );
  });
});
