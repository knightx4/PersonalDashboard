import { NextResponse, type NextRequest } from 'next/server';
import { answerCapture } from '@/lib/capture/address';
import { captureAddressDeps } from '@/lib/capture/address-server';
import { tokenFromAuthorization } from '@/lib/capture/tokens';

/**
 * The capture address (plan #1706): a Siri Shortcut or another tool posts
 * `{ text, url?, place? }` with `Authorization: Bearer <capture token>` and
 * the app files it as the capture box would. Public in proxy.ts, since it
 * carries a token rather than the sign-in cookie; the token is checked in
 * lib/capture/address.ts before anything is filed, and every write is for
 * the account the token belongs to.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A sort and a goals filing are two model calls; a Shortcut waits for the reply. */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const reply = await answerCapture(
    {
      token: tokenFromAuthorization(request.headers.get('authorization')),
      contentLength: request.headers.get('content-length'),
      body: await request.text().catch(() => ''),
    },
    captureAddressDeps(),
  );
  return NextResponse.json(reply.body, {
    status: reply.status,
    headers: { 'Cache-Control': 'no-store', ...reply.headers },
  });
}
