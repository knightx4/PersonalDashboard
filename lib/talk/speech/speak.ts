/**
 * Speaking one chat reply (plan #3006.3): the steps between the text and the
 * MP3, with everything that touches the outside handed in so the order can be
 * tested.
 *
 * 1. The reply is cut to what is worth hearing (text.ts). Nothing left, and
 *    nothing is sent.
 * 2. Without the Fish key, nothing is sent and the answer says voice is not
 *    set up.
 * 3. The bytes are reserved against the month's cap in one statement. A
 *    reply that would pass it is not sent, and the answer says voice is
 *    paused until next month. The reply is never shortened to fit what is
 *    left: half a sentence read aloud is worse than none.
 * 4. Fish is asked for the audio. When it sends none, the reservation is
 *    taken back, so the month counts only what was spoken.
 * 5. What was spoken is written to the spend ledger, which the spend page
 *    reads.
 */

import { MONTHLY_BYTE_CAP } from '@/lib/talk/speech/budget';
import { prepareSpeech, SPEAK_CHAR_LIMIT } from '@/lib/talk/speech/text';
import type { FishResult } from '@/lib/talk/speech/fish';

/** The longest reply text the route accepts; anything longer is cut by prepareSpeech anyway. */
export const SPEAK_INPUT_MAX = 40_000;

export type SpeakWhy = 'empty' | 'not-set' | 'paused' | 'credit' | 'failed';

export type SpeakOutcome =
  | { ok: true; audio: ArrayBuffer; bytes: number; trimmed: boolean; monthBytes: number; cap: number }
  | { ok: false; why: SpeakWhy; message: string; status: number };

export type SpeakDeps = {
  /** Whether FISH_AUDIO_API_KEY is set. */
  configured: boolean;
  /** The first day of this month in the account's timezone (speechMonth). */
  month: string;
  /** core.reserve_speech_bytes: the month's new total, or null when it would pass the cap. */
  reserve: (month: string, bytes: number, cap: number) => Promise<number | null>;
  /** core.release_speech_bytes. Never throws. */
  release: (month: string, bytes: number) => Promise<void>;
  synthesize: (text: string) => Promise<FishResult>;
  /** Writes the ledger row. Never throws. */
  recordSpend: (bytes: number) => Promise<void>;
  cap?: number;
  limit?: number;
};

/** What the person reads when a reply is not spoken. Dash's name, never the vendor's, except where the vendor is the fact. */
export const SPEAK_MESSAGES: Record<SpeakWhy, string> = {
  empty: 'There is nothing in this reply to read aloud.',
  'not-set': 'Voice is not set up yet: the Fish Audio key has not been added.',
  paused: "Voice is paused until next month: this month's 330,000 characters have been spoken.",
  credit: 'Voice is paused: the Fish Audio account has run out of credit.',
  failed: 'This reply could not be read aloud. Try again in a moment.',
};

function refused(why: SpeakWhy, status: number): SpeakOutcome {
  return { ok: false, why, message: SPEAK_MESSAGES[why], status };
}

export async function speakReply(reply: string, deps: SpeakDeps): Promise<SpeakOutcome> {
  const cap = deps.cap ?? MONTHLY_BYTE_CAP;
  const speech = prepareSpeech(reply.slice(0, SPEAK_INPUT_MAX), deps.limit ?? SPEAK_CHAR_LIMIT);
  if (!speech.text) return refused('empty', 422);
  if (!deps.configured) return refused('not-set', 503);

  let monthBytes: number | null;
  try {
    monthBytes = await deps.reserve(deps.month, speech.bytes, cap);
  } catch (error) {
    console.error('[speech] reserve failed', error instanceof Error ? error.message : error);
    return refused('failed', 500);
  }
  if (monthBytes === null) return refused('paused', 429);

  const result = await deps.synthesize(speech.text);
  if (!result.ok) {
    await deps.release(deps.month, speech.bytes);
    console.error('[speech] Fish refused', result.why, result.detail);
    return result.why === 'credit' ? refused('credit', 402) : refused('failed', 502);
  }

  await deps.recordSpend(speech.bytes);
  return { ok: true, audio: result.audio, bytes: speech.bytes, trimmed: speech.trimmed, monthBytes, cap };
}
