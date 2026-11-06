import 'server-only';

import { FISH_MODEL_HEADER } from '@/lib/talk/speech/budget';

/**
 * Fish Audio's text-to-speech call (plan #3006.3).
 *
 * POST https://api.fish.audio/v1/tts with the key as a bearer and the model
 * in a `model` header; the body names the text, the voice and the format, and
 * the reply is the MP3 itself. The key is a server secret: it is read here
 * and nowhere a browser bundle can reach.
 *
 *   FISH_AUDIO_API_KEY   the account's API key, from fish.audio's API keys
 *                        page. Without it nothing is sent and voice says it
 *                        is not set up.
 *   FISH_AUDIO_VOICE_ID  optional: the voice model's id (the `reference_id`),
 *                        from the voice's page on fish.audio. Without it Fish
 *                        speaks in its default voice.
 */

export const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';

/** How long one reply's audio may take before the call is given up. */
const FISH_TIMEOUT_MS = 30_000;

export type FishEnv = { apiKey: string; voiceId: string | null };

/** The key and voice, or null when the key is not set. */
export function fishEnv(env: Record<string, string | undefined> = process.env): FishEnv | null {
  if (typeof window !== 'undefined') throw new Error('fishEnv is server-only');
  const apiKey = env.FISH_AUDIO_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, voiceId: env.FISH_AUDIO_VOICE_ID?.trim() || null };
}

export type FishResult =
  | { ok: true; audio: ArrayBuffer }
  | { ok: false; why: 'credit' | 'key' | 'busy' | 'failed'; detail: string };

/** One reply's words to MP3. Never throws. */
export async function fishSpeak(
  env: FishEnv,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FishResult> {
  try {
    const response = await fetchImpl(FISH_TTS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.apiKey}`,
        'content-type': 'application/json',
        model: FISH_MODEL_HEADER,
      },
      body: JSON.stringify({
        text,
        ...(env.voiceId ? { reference_id: env.voiceId } : {}),
        format: 'mp3',
        mp3_bitrate: 64,
        latency: 'balanced',
        normalize: true,
      }),
      signal: AbortSignal.timeout(FISH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      const why = response.status === 402 ? 'credit' : response.status === 401 || response.status === 403 ? 'key' : response.status === 429 || response.status === 503 ? 'busy' : 'failed';
      return { ok: false, why, detail: `Fish answered ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    const audio = await response.arrayBuffer();
    if (audio.byteLength === 0) return { ok: false, why: 'failed', detail: 'Fish sent no audio' };
    return { ok: true, audio };
  } catch (error) {
    return { ok: false, why: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }
}
