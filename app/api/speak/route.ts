import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { speakReply, SPEAK_INPUT_MAX } from '@/lib/talk/speech/speak';
import { speakDeps } from '@/lib/talk/speech/speak-server';

/**
 * A chat reply read aloud (plan #3006.3): the chat posts `{ text }`, the
 * reply as written, and gets back the MP3 Fish Audio made of it.
 *
 * The text is cut to what is worth hearing and to 600 characters before it
 * goes (lib/talk/speech/text.ts), and its bytes are counted against the
 * month's 330,000 (lib/talk/speech/budget.ts). Anything that stops it comes
 * back as JSON, `{ why, message }`, with a status the chat can tell apart:
 *
 *   422 empty     nothing in the reply worth reading
 *   503 not-set   FISH_AUDIO_API_KEY is not set
 *   429 paused    the month's cap is reached; voice is back on the 1st
 *   402 credit    the Fish account is out of credit
 *   502 failed    Fish sent no audio
 *
 * The audio's headers say what the month has spent, for the chat to show:
 * X-Speech-Bytes (this reply), X-Speech-Month-Bytes, X-Speech-Cap, and
 * X-Speech-Trimmed when the reply was cut.
 *
 * The person comes from the session, and JSON only, so a form on another
 * site cannot spend the month's characters without the browser asking first.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Send the reply as JSON.' }, { status: 415 });
  }

  let text: unknown;
  try {
    const body: unknown = await request.json();
    text = body && typeof body === 'object' ? (body as Record<string, unknown>).text : undefined;
  } catch {
    text = undefined;
  }
  if (typeof text !== 'string' || text.length > SPEAK_INPUT_MAX) {
    return NextResponse.json({ error: `Send the reply as text of at most ${SPEAK_INPUT_MAX} characters.` }, { status: 400 });
  }

  const outcome = await speakReply(text, await speakDeps(user.id));
  if (!outcome.ok) {
    return NextResponse.json(
      { why: outcome.why, message: outcome.message },
      { status: outcome.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return new Response(outcome.audio, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Speech-Bytes': String(outcome.bytes),
      'X-Speech-Month-Bytes': String(outcome.monthBytes),
      'X-Speech-Cap': String(outcome.cap),
      ...(outcome.trimmed ? { 'X-Speech-Trimmed': '1' } : {}),
    },
  });
}
