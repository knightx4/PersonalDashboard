import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import {
  challengeResponse,
  ebayDeletionEndpointUrl,
  isValidVerificationToken,
} from '@/lib/ebay/account-deletion';

// node:crypto, and never worth caching.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function endpointUrl(): string {
  return ebayDeletionEndpointUrl({
    configuredUrl: process.env.EBAY_DELETION_ENDPOINT_URL ?? null,
    appUrl: publicEnv().NEXT_PUBLIC_APP_URL,
  });
}

/**
 * eBay's ownership check: it calls with ?challenge_code=… and expects a hash
 * only someone holding the verification token could produce.
 *
 * Failures are logged with the endpoint this deployment hashed against, because
 * a URL that does not match the registered one is the usual cause and the
 * portal only ever says "validation failed".
 */
export async function GET(request: NextRequest) {
  const challengeCode = request.nextUrl.searchParams.get('challenge_code');
  if (!challengeCode) {
    return NextResponse.json({ error: 'challenge_code is required' }, { status: 400 });
  }

  const endpoint = endpointUrl();

  // The endpoint this deployment hashed, echoed where curl -i can see it.
  // A mismatch with the URL registered at eBay is the usual cause of a failed
  // validation, and the portal only ever says "validation failed" -- so the
  // answer should not require reading a log. eBay ignores unknown headers, and
  // the value is the endpoint's own public URL, so there is nothing to leak.
  const headers = { 'Content-Type': 'application/json', 'x-ebay-endpoint': endpoint };

  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN;
  if (!isValidVerificationToken(verificationToken)) {
    console.error(
      '[ebay] EBAY_VERIFICATION_TOKEN is missing or malformed ' +
        '(needs 32-80 chars of A-Z a-z 0-9 _ -); cannot answer the challenge',
    );
    return NextResponse.json({ error: 'endpoint not configured' }, { status: 500, headers });
  }

  console.log(`[ebay] answering account-deletion challenge for ${endpoint}`);

  // Exactly this one key: eBay parses the body strictly.
  return NextResponse.json(
    {
      challengeResponse: challengeResponse({
        challengeCode,
        verificationToken,
        endpoint,
      }),
    },
    { status: 200, headers },
  );
}

/**
 * The notification itself. eBay needs a 2xx promptly or it retries and
 * eventually marks the endpoint down.
 *
 * Nothing is deleted because nothing is held: the Browse integration stores one
 * price per ISBN and never learns who listed it. The payload carries the
 * closing user's username and id, which are deliberately not logged — writing
 * them here would create the very record this endpoint exists to promise we do
 * not keep.
 *
 * The body is not cryptographically verified, and that is a decision rather
 * than an omission: the handler takes no action on the contents, so a forged
 * notification can achieve nothing a discarded one cannot. If this ever grows
 * to erase real data, verify eBay's signature before it does.
 */
export async function POST() {
  console.log('[ebay] account-deletion notification acknowledged; no stored data to erase');
  return new NextResponse(null, { status: 204 });
}
