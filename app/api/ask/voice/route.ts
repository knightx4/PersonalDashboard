import { NextResponse, type NextRequest } from 'next/server';
import { tokenFromAuthorization } from '@/lib/capture/tokens';
import { answerVoiceAsk } from '@/lib/talk/voice-ask';
import { voiceAskDeps } from '@/lib/talk/voice-ask-server';

/**
 * The ask address: a Siri Shortcut posts `{ question }` with
 * `Authorization: Bearer <ask token>` and hears Dash's answer read from the
 * reply's `spoken` field. Public in proxy.ts, since it carries a token rather
 * than the sign-in cookie; lib/talk/voice-ask.ts checks the token before the
 * question is read, and the answer is written on a session as the token's
 * owner (lib/talk/voice-session.ts).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Dash's answer has a forty-second budget (TIME_BUDGET_MS); the sign-in and the writes fit in the rest. */
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  const reply = await answerVoiceAsk(
    {
      token: tokenFromAuthorization(request.headers.get('authorization')),
      contentLength: request.headers.get('content-length'),
      body: await request.text().catch(() => ''),
    },
    voiceAskDeps(),
  );
  const body = reply.body.ok && reply.body.href ? { ...reply.body, href: new URL(reply.body.href, request.nextUrl.origin).toString() } : reply.body;
  return NextResponse.json(body, {
    status: reply.status,
    headers: { 'Cache-Control': 'no-store', ...reply.headers },
  });
}
