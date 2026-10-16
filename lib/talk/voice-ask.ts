import { z } from 'zod';
import type { CaptureTokenCheck } from '@/lib/capture/tokens';
import type { AskDashResult } from '@/lib/dash/ask';

/**
 * The ask address (app/api/ask/voice/route.ts, docs/INPUT-CHANNELS.md):
 * `POST /api/ask/voice`, which a Siri Shortcut holding an ask token calls to
 * ask Dash a question and hear the answer.
 *
 * It takes `{ question }` and answers JSON whose `spoken` field is the
 * answer as a Shortcut can read it aloud: Markdown taken out, and a long
 * answer cut at a sentence with a pointer to the rest. The question and the
 * whole answer are kept as an Ask conversation, so `href` opens it in the app.
 *
 * Asked this way, Dash only looks things up. It makes and proposes no
 * changes, since nobody is there to see a proposal or press Undo; adding
 * things by voice is the capture address's job.
 *
 * No client here: the token check and the asking are passed in, so every
 * refusal is tested without a database. lib/talk/voice-ask-server.ts binds them.
 */

/** The most a request body may be, in bytes: a spoken question and the JSON around it. */
export const VOICE_REQUEST_MAX_BYTES = 8_000;

/** The longest spoken answer, in characters: about forty seconds read aloud. */
export const SPOKEN_MAX = 600;

export type VoiceAskDeps = {
  /** checkDashToken for 'ask', which counts the question against the token's limit. Throws when the database cannot be reached. */
  check: (token: string | null) => Promise<CaptureTokenCheck>;
  /** Asks Dash as the token's owner. Throws only when no session could be opened. */
  ask: (userId: string, question: string) => Promise<AskDashResult>;
};

export type VoiceAskRequest = {
  token: string | null;
  contentLength: string | null;
  body: string;
};

export type VoiceAskBody =
  | {
      ok: true;
      /** The answer as it should be read aloud. */
      spoken: string;
      /** The answer as Dash wrote it. */
      answer: string;
      /** Where the conversation opens in the app. */
      href: string | null;
    }
  | {
      ok: false;
      error: VoiceAskError;
      spoken: string;
    };

export type VoiceAskError =
  | Extract<CaptureTokenCheck, { ok: false }>['reason']
  | 'too_long'
  | 'bad_request'
  | 'not_answered'
  | 'unavailable';

export type VoiceAskReply = {
  status: number;
  headers: Record<string, string>;
  body: VoiceAskBody;
};

const UNAVAILABLE = 'Dash could not be asked just now. Try again in a minute.';

const Body = z.object({ question: z.string() });

function refuse(status: number, error: VoiceAskError, spoken: string, headers: Record<string, string> = {}): VoiceAskReply {
  return { status, headers, body: { ok: false, error, spoken } };
}

/**
 * An answer as a voice reads it: links become their text, Markdown marks go,
 * list items and lines become sentences, and an answer past SPOKEN_MAX stops
 * at the last sentence that fits.
 */
export function spokenAnswer(answer: string, max: number = SPOKEN_MAX): string {
  const lines = answer
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/\|/g, ' ')
        .replace(/(\*\*|__|\*|_|`|~~)(?=\S)([^\n]*?\S)\1/g, '$2')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line !== '' && !/^[-:\s]+$/.test(line));
  const text = lines.map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`)).join(' ');
  if (text.length <= max) return text;

  const rest = ' The rest is in Ask on Dash.';
  const room = max - rest.length;
  const cut = text.slice(0, room);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  const kept = end > room / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  return `${kept}${rest}`;
}

/** One request to the ask address, answered. Never throws. */
export async function answerVoiceAsk(request: VoiceAskRequest, deps: VoiceAskDeps): Promise<VoiceAskReply> {
  const declared = Number(request.contentLength);
  if ((Number.isFinite(declared) && declared > VOICE_REQUEST_MAX_BYTES) || request.body.length > VOICE_REQUEST_MAX_BYTES) {
    return refuse(413, 'too_long', 'That question is too long for Dash to take by voice.');
  }

  // The token is checked before the body is read, so a stranger learns
  // nothing about what the address takes.
  let check: CaptureTokenCheck;
  try {
    check = await deps.check(request.token);
  } catch {
    return refuse(503, 'unavailable', UNAVAILABLE);
  }
  if (!check.ok) {
    const headers: Record<string, string> = check.retryAfterSeconds ? { 'Retry-After': String(check.retryAfterSeconds) } : {};
    return refuse(check.status, check.reason, check.message, headers);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    parsed = null;
  }
  const body = Body.safeParse(parsed);
  if (!body.success) {
    return refuse(400, 'bad_request', 'Dash did not get a question. Send it as JSON with a field named question.');
  }
  const question = body.data.question.replace(/\s+/g, ' ').trim();
  if (!question) return refuse(400, 'bad_request', 'Dash did not hear a question. Try again.');

  let result: AskDashResult;
  try {
    result = await deps.ask(check.userId, question);
  } catch {
    return refuse(503, 'unavailable', UNAVAILABLE);
  }

  const answer = [...result.turns].reverse().find((turn) => turn.role === 'assistant')?.body.trim() ?? '';
  const href = result.conversation ? `/ask/${result.conversation.ref}` : null;
  if (!answer) {
    const why = result.error ?? 'Dash did not answer that.';
    return refuse(502, 'not_answered', /[.!?]$/.test(why) ? why : `${why}.`);
  }
  return { status: 200, headers: {}, body: { ok: true, spoken: spokenAnswer(answer), answer, href } };
}
