import 'server-only';

import { FISH_MODEL_HEADER } from '@/lib/talk/speech/budget';
import { VOICE_PAGE, voiceListUrl, voiceOf, voicePageOf, type FishVoice, type VoiceFilters, type VoicePage } from '@/lib/talk/speech/voices-model';

/**
 * Fish Audio's text-to-speech call (plan #3006.3), and the voices a bot's
 * form offers (plan #3006.5, filtered and sorted since plan #3081).
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
 *                        speaks in its default voice. It is Dash's voice, and
 *                        that of every bot with none of its own.
 */

export const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';
export const FISH_MODEL_URL = 'https://api.fish.audio/model';

/** How long one reply's audio may take before the call is given up. */
const FISH_TIMEOUT_MS = 30_000;

/** How long a voice list may take before the picker gives up on it. */
const FISH_LIST_TIMEOUT_MS = 10_000;

export type FishEnv = { apiKey: string; voiceId: string | null };

/** The key and voice, or null when the key is not set. */
export function fishEnv(env: Record<string, string | undefined> = process.env): FishEnv | null {
  if (typeof window !== 'undefined') throw new Error('fishEnv is server-only');
  const apiKey = env.FISH_AUDIO_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, voiceId: env.FISH_AUDIO_VOICE_ID?.trim() || null };
}

/**
 * `voice` means Fish turned down the bot's own voice (deleted or made
 * private since it was chosen), so the reply can go again in the default.
 */
export type FishResult =
  | { ok: true; audio: ArrayBuffer }
  | { ok: false; why: 'credit' | 'key' | 'busy' | 'voice' | 'failed'; detail: string };

/** The reason for a refused call; `own` is whether a bot's own voice was asked for. */
function whyOf(status: number, own: boolean): Exclude<FishResult, { ok: true }>['why'] {
  if (status === 402) return 'credit';
  if (status === 401) return 'key';
  if (status === 429 || status === 503) return 'busy';
  if (own && [400, 403, 404, 422].includes(status)) return 'voice';
  if (status === 403) return 'key';
  return 'failed';
}

/**
 * One reply's words to MP3. Never throws. `voiceId` is the bot's own voice;
 * null or absent speaks in the deployment's default.
 */
export async function fishSpeak(
  env: FishEnv,
  text: string,
  fetchImpl: typeof fetch = fetch,
  voiceId: string | null = null,
): Promise<FishResult> {
  const voice = voiceId || env.voiceId;
  const own = Boolean(voiceId) && voiceId !== env.voiceId;
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
        ...(voice ? { reference_id: voice } : {}),
        format: 'mp3',
        mp3_bitrate: 64,
        latency: 'balanced',
        normalize: true,
      }),
      signal: AbortSignal.timeout(FISH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      return { ok: false, why: whyOf(response.status, own), detail: `Fish answered ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    const audio = await response.arrayBuffer();
    if (audio.byteLength === 0) return { ok: false, why: 'failed', detail: 'Fish sent no audio' };
    return { ok: true, audio };
  } catch (error) {
    return { ok: false, why: 'failed', detail: error instanceof Error ? error.message : String(error) };
  }
}

function fishGet(env: FishEnv, url: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, {
    headers: { authorization: `Bearer ${env.apiKey}` },
    signal: AbortSignal.timeout(FISH_LIST_TIMEOUT_MS),
    cache: 'no-store',
  });
}

/**
 * One page of the voice picker (plan #3081): Fish's GET /model with the
 * picker's filters, the title, gender and style tags, language, the
 * person's own voices only, and the order. Throws when Fish cannot be asked.
 */
export async function fishVoicePage(env: FishEnv, filters: VoiceFilters, page: number, fetchImpl: typeof fetch = fetch): Promise<VoicePage> {
  const response = await fishGet(env, voiceListUrl(FISH_MODEL_URL, filters, page, VOICE_PAGE), fetchImpl);
  if (!response.ok) throw new Error(`Fish answered ${response.status} to the voice list`);
  return voicePageOf(await response.json().catch(() => null), page, VOICE_PAGE);
}

/**
 * What a bot's form says about its voice (plan #3006.5): 'not-set' without
 * the key, 'gone' when Fish no longer offers the saved voice (its replies
 * are read in the default), 'unknown' when Fish could not be asked, and
 * 'ok' otherwise, including a bot with no voice of its own.
 */
export async function botVoiceStatus(voiceId: string | null, fetchImpl: typeof fetch = fetch): Promise<'ok' | 'gone' | 'not-set' | 'unknown'> {
  const env = fishEnv();
  if (!env) return 'not-set';
  if (!voiceId) return 'ok';
  const found = await fishVoice(env, voiceId, fetchImpl);
  return found === 'gone' || found === 'unknown' ? found : 'ok';
}

/**
 * One voice by its id: the voice; 'gone' when Fish has no voice by that id
 * this account can use (deleted, private, or never one); or 'unknown' when
 * Fish could not be asked. Never throws.
 */
export async function fishVoice(env: FishEnv, id: string, fetchImpl: typeof fetch = fetch): Promise<FishVoice | 'gone' | 'unknown'> {
  try {
    const response = await fishGet(env, `${FISH_MODEL_URL}/${encodeURIComponent(id)}`, fetchImpl);
    if ([400, 403, 404, 422].includes(response.status)) return 'gone';
    if (!response.ok) return 'unknown';
    return voiceOf(await response.json().catch(() => null)) ?? 'gone';
  } catch {
    return 'unknown';
  }
}
