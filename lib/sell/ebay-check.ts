/**
 * One eBay Browse round trip, reported in words.
 *
 * The credentials are set in a hosting dashboard and used by a deployed app,
 * so the two questions that matter — are they reaching the runtime, and does
 * eBay accept them — cannot be answered by looking at either end alone. This
 * runs the real thing and says what happened.
 *
 * The advice lives here rather than in the Browse client, so the button on the
 * sell page and `npm run check:ebay` cannot drift into telling you different
 * things about the same failure.
 */
import {
  EbayBrowseExpectedPriceSource,
  ebayKeysetEnvironment,
  type EbayFailure,
} from '@/lib/sell/expected-price';

/** A book with enough active listings that an empty result is informative. */
export const EBAY_CHECK_ISBN = '9780735211292';

export type EbayCheckResult = {
  /** True only when a real price came back. */
  ok: boolean;
  /** The one-line verdict, safe to show as-is. */
  headline: string;
  /** What eBay actually said, or the price found. Never contains a secret. */
  detail: string;
  /** What to do about it. Null when there is nothing to do. */
  hint: string | null;
  stage: EbayFailure['stage'] | 'unconfigured' | 'ok';
  status?: number;
  priceCents: number | null;
};

/**
 * What to do about a failure.
 *
 * `no_results` is the one stage that is about the book rather than the setup —
 * the integration is working, that title just has no live USD listings.
 */
export function ebayFailureHint(failure: EbayFailure): string | null {
  switch (failure.stage) {
    case 'credentials':
      return failure.detail.includes('sandbox')
        ? 'Use the production keyset (its client id contains -PRD-). Sandbox listings are invented, so a price from them would be meaningless.'
        : 'One of the two values is empty once whitespace is stripped. Re-copy it from the eBay developer portal.';
    case 'oauth':
      return failure.status === 400 || failure.status === 401
        ? 'eBay refused the keyset itself. Check the client id and secret match, and that the application has accepted the API License Agreement in the developer portal.'
        : 'The token request did not complete. If this names a blocked host, the deployment cannot reach api.ebay.com at all.';
    case 'search':
      return failure.status === 403
        ? 'The keyset authenticates, but the Buy APIs are a separate grant — a keyset is issued at once, Browse access takes days. Until it lands every search returns 403. Check the application has Browse access in the developer portal.'
        : 'The token worked, so the credentials are good; the search call itself failed. Worth retrying before changing anything.';
    case 'no_results':
      return 'This is not a configuration problem — the connection works, that ISBN just has no active USD listings right now.';
    default:
      return null;
  }
}

/**
 * Run the check. Returns a verdict rather than throwing, because every caller
 * wants to display the failure, not be interrupted by it.
 */
export async function checkEbayConnection(options: {
  clientId?: string | null;
  clientSecret?: string | null;
  isbn?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<EbayCheckResult> {
  const clientId = options.clientId ?? '';
  const clientSecret = options.clientSecret ?? '';
  const isbn = options.isbn ?? EBAY_CHECK_ISBN;

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId ? 'EBAY_CLIENT_ID' : null,
      !clientSecret ? 'EBAY_CLIENT_SECRET' : null,
    ].filter(Boolean);
    return {
      ok: false,
      stage: 'unconfigured',
      headline: 'Not configured — prices are coming from web search',
      detail: `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set in this environment.`,
      hint: 'Set both in your hosting environment, then redeploy — variables only reach a deployment built after they were set, in the environment you are actually visiting.',
      priceCents: null,
    };
  }

  const source = new EbayBrowseExpectedPriceSource({
    clientId,
    clientSecret,
    fetch: options.fetch,
  });
  const priceCents = await source.expectedSelfListCents(isbn);

  if (priceCents != null) {
    return {
      ok: true,
      stage: 'ok',
      headline: 'Connected — eBay Browse is answering',
      detail: `Priced ISBN ${isbn} from live listings.`,
      // Worth saying once: Browse is asks, not sold comps, however well it works.
      hint: 'These are active asking prices, not sold comps, so they run high.',
      priceCents,
    };
  }

  const failure = source.lastFailure;
  if (!failure) {
    return {
      ok: false,
      stage: 'search',
      headline: 'No price and no reason recorded',
      detail: 'The lookup returned nothing without reporting why.',
      hint: null,
      priceCents: null,
    };
  }

  return {
    ok: false,
    stage: failure.stage,
    status: failure.status,
    headline: headlineFor(failure),
    detail: failure.detail,
    hint: ebayFailureHint(failure),
    priceCents: null,
  };
}

/**
 * The verdict in one line.
 *
 * Status matters as much as stage: a 401 on the token call means eBay looked at
 * the keyset and said no, while a 403 from a proxy means nothing ever reached
 * eBay. Calling both "credentials refused" sends you to re-check keys that were
 * fine all along.
 */
function headlineFor(failure: EbayFailure): string {
  switch (failure.stage) {
    case 'credentials':
      return 'Rejected before the request was sent';
    case 'oauth':
      return failure.status === 400 || failure.status === 401
        ? 'eBay refused the credentials'
        : 'Could not reach eBay';
    case 'search':
      return 'Signed in, but the search was refused';
    case 'no_results':
      return 'Connected, but that ISBN has no listings';
  }
}

/** Whether the keyset looks like a production one, for display. */
export function describeKeyset(clientId?: string | null): string {
  if (!clientId) return 'not set';
  return ebayKeysetEnvironment(clientId);
}
