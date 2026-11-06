import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/server';
import { speakReply, SPEAK_INPUT_MAX } from '@/lib/talk/speech/speak';
import { speakDeps } from '@/lib/talk/speech/speak-server';
import { VOICE_ID } from '@/lib/talk/speech/voices-model';
import { createYouClient } from '@/lib/you/auth/server';
import { readBotVoice } from '@/lib/you/bot-voices';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A chat reply read aloud (plan #3006.3): the chat posts `{ text }`, the
 * reply as written, and gets back the MP3 Fish Audio made of it.
 *
 * With `bot`, the id of the bot that wrote it, the reply is read in that
 * bot's own voice when it has one (plan #3006.5); without, or with none, in
 * the default. A bot's form posts `voice`, a Fish voice id, to hear a sample
 * of a voice that has no recording of its own; it counts against the month
 * like a reply.
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

  let fields: Record<string, unknown> = {};
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object') fields = body as Record<string, unknown>;
  } catch {
    fields = {};
  }
  const { text, bot, voice } = fields;
  if (typeof text !== 'string' || text.length > SPEAK_INPUT_MAX) {
    return NextResponse.json({ error: `Send the reply as text of at most ${SPEAK_INPUT_MAX} characters.` }, { status: 400 });
  }
  if ((bot !== undefined && (typeof bot !== 'string' || !UUID.test(bot))) || (voice !== undefined && (typeof voice !== 'string' || !VOICE_ID.test(voice)))) {
    return NextResponse.json({ error: 'Name the bot by its id, or the voice by a Fish voice id.' }, { status: 400 });
  }

  // A sample names the voice itself; a reply names its bot, whose own voice it is read in.
  let voiceId: string | null = typeof voice === 'string' ? voice : null;
  if (!voiceId && typeof bot === 'string') {
    try {
      voiceId = (await readBotVoice(await createYouClient(), user.id, bot))?.id ?? null;
    } catch (error) {
      console.error('[speech] bot voice not read, using the default', error instanceof Error ? error.message : error);
    }
  }

  const outcome = await speakReply(text, await speakDeps(user.id, voiceId));
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
