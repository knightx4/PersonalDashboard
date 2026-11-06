import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { fishEnv, fishSpeak, FISH_TTS_URL } from './fish';

describe('fishEnv', () => {
  it('is null without the key', () => {
    expect(fishEnv({})).toBeNull();
    expect(fishEnv({ FISH_AUDIO_API_KEY: '  ' })).toBeNull();
  });

  it('reads the key and the optional voice', () => {
    expect(fishEnv({ FISH_AUDIO_API_KEY: 'k', FISH_AUDIO_VOICE_ID: 'v' })).toEqual({ apiKey: 'k', voiceId: 'v' });
    expect(fishEnv({ FISH_AUDIO_API_KEY: 'k' })).toEqual({ apiKey: 'k', voiceId: null });
  });
});

describe('fishSpeak', () => {
  it('asks for S2.1 Pro MP3 in the chosen voice', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 }));
    const out = await fishSpeak({ apiKey: 'k', voiceId: 'voice-1' }, 'Hello.', fetchImpl as unknown as typeof fetch);
    expect(out.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FISH_TTS_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.model).toBe('s2.1-pro');
    expect(headers.authorization).toBe('Bearer k');
    expect(JSON.parse(String(init.body))).toMatchObject({ text: 'Hello.', reference_id: 'voice-1', format: 'mp3' });
  });

  it('tells an empty account from a failure', async () => {
    const credit = vi.fn(async () => new Response('{"message":"no balance"}', { status: 402 }));
    expect(await fishSpeak({ apiKey: 'k', voiceId: null }, 'Hi.', credit as unknown as typeof fetch)).toMatchObject({
      ok: false,
      why: 'credit',
    });
    const down = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await fishSpeak({ apiKey: 'k', voiceId: null }, 'Hi.', down as unknown as typeof fetch)).toMatchObject({
      ok: false,
      why: 'failed',
    });
  });
});
