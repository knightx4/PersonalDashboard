import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { recordSpend } from '@/lib/core/spend/record';
import { todayInTimezone } from '@/lib/money';
import { FISH_S2_1_PRO, speechMonth } from '@/lib/talk/speech/budget';
import { fishEnv, fishSpeak } from '@/lib/talk/speech/fish';
import type { SpeakDeps } from '@/lib/talk/speech/speak';

/** The ledger operation a spoken reply is recorded under (lib/core/spend/operations.ts). */
export const SPEAK_SPEND_OPERATION = 'speak-reply';

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
