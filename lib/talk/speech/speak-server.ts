import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { recordSpend, recordSpendReports } from '@/lib/core/spend/record';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { todayInTimezone } from '@/lib/money';
import { FISH_S2_1_PRO, speechMonth } from '@/lib/talk/speech/budget';
import { fishEnv, fishSpeak } from '@/lib/talk/speech/fish';
import type { SpeakDeps } from '@/lib/talk/speech/speak';
import { spokenFor } from '@/lib/talk/speech/script';
import { writeSpokenScript } from '@/lib/talk/speech/script-model';
import { createYouClient } from '@/lib/you/auth/server';

/** The ledger operation a spoken reply is recorded under (lib/core/spend/operations.ts). */
export const SPEAK_SPEND_OPERATION = 'speak-reply';
/** The ledger operation a bubble's spoken version is recorded under (plan #3079). */
export const SCRIPT_SPEND_OPERATION = 'write-spoken-script';

/** An ISO day as it is said, for the rewrite's "yesterday" and "on Friday": `Sunday 8 November 2026`. */
function sayDay(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return iso;
  return day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The words to send to Fish for one bubble (plan #3079): its short spoken
 * version rather than the bubble as written. `message` is the id of the
 * bot's message in you.advisor_messages, when the bubble is one; its kept
 * script is read from there and a new one kept there, under RLS as the
 * person's own row. Without it (an answer of Dash's on the Ask tab) the
 * script is written each time and kept nowhere, and the player keeps the
 * audio for the visit. A rewrite that fails speaks the bubble as before.
 */
export async function spokenTextFor(userId: string, bubble: string, message: string | null): Promise<string> {
  const [you, core, settings] = await Promise.all([createYouClient(), createCoreClient(), loadAccountSettings(userId)]);
  const today = sayDay(todayInTimezone(settings.timezone));
  const spent: SpendReport[] = [];
  const { text } = await spokenFor(bubble, {
    kept: async () => {
      if (!message) return null;
      const { data, error } = await you
        .from('advisor_messages')
        .select('spoken_text')
        .eq('user_id', userId)
        .eq('id', message)
        .eq('role', 'advisor')
        .maybeSingle();
      if (error) throw new Error(error.message);
      const kept = (data as { spoken_text?: unknown } | null)?.spoken_text;
      return typeof kept === 'string' ? kept : null;
    },
    write: (words) =>
      writeSpokenScript(words, today, { onSpend: (report) => spent.push(report) }),
    keep: async (script) => {
      if (!message) return;
      const { error } = await you
        .from('advisor_messages')
        .update({ spoken_text: script })
        .eq('user_id', userId)
        .eq('id', message)
        .eq('role', 'advisor')
        .is('spoken_text', null);
      if (error) console.error('[speech] spoken script not kept', error.message);
    },
  });
  await recordSpendReports(core, userId, { module: 'core', operation: SCRIPT_SPEND_OPERATION }, spent);
  return text;
}

/**
 * speakReply's outside world for the signed-in person (plan #3006.3): their
 * session's core client, so the counter functions read auth.uid() and the
 * ledger row lands under RLS as theirs; their timezone for the month; and the
 * Fish key from the server's environment.
 */
export async function speakDeps(userId: string, voice: string | null = null): Promise<SpeakDeps> {
  const [core, settings] = await Promise.all([createCoreClient(), loadAccountSettings(userId)]);
  const fish = fishEnv();
  return {
    configured: fish !== null,
    voice,
    month: speechMonth(todayInTimezone(settings.timezone)),
    reserve: async (month, bytes, cap) => {
      const { data, error } = await core.rpc('reserve_speech_bytes', { p_month: month, p_bytes: bytes, p_cap: cap });
      if (error) throw new Error(error.message);
      return typeof data === 'number' ? data : null;
    },
    release: async (month, bytes) => {
      const { error } = await core.rpc('release_speech_bytes', { p_month: month, p_bytes: bytes });
      if (error) console.error('[speech] release failed', error.message);
    },
    synthesize: (text, voiceId) =>
      fish ? fishSpeak(fish, text, fetch, voiceId) :Promise.resolve({ ok: false, why: 'key', detail: 'FISH_AUDIO_API_KEY is not set' }),
    recordSpend: async (bytes) => {
      // Fish bills bytes, so the bytes go in the input column and the price
      // table charges them at $15 a million.
      await recordSpend(core, userId, {
        module: 'core',
        operation: SPEAK_SPEND_OPERATION,
        model: FISH_S2_1_PRO,
        usage: { inputTokens: bytes, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      });
    },
  };
}
