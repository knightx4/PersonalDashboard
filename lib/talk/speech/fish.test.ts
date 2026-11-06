import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { fishEnv, fishSpeak, fishVoice, fishVoices, FISH_TTS_URL } from './fish';
import { sampleLine, voiceIdOf, voicesOf } from './voices-model';

const MODEL = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  _id: id,
  type: 'tts',
  state: 'trained',
  title,
  author: { _id: 'a', nickname: 'Fishy', avatar: '' },
  samples: [{ title: 's', text: 't', task_id: 'x', audio: `https://cdn.fish.audio/${id}.mp3` }],
  ...extra,
});

describe('fish voices', () => {
  it('reads trained voices with their sample, and leaves out the rest', () => {
    const list = voicesOf({
      total: 3,
      items: [MODEL('v1', 'Calm narrator'), MODEL('v2', 'Training', { state: 'training' }), MODEL('v3', 'No sample', { samples: [] }), { nope: 1 }],
    });
    expect(list).toEqual([
      { id: 'v1', name: 'Calm narrator', author: 'Fishy', sample: 'https://cdn.fish.audio/v1.mp3' },
      { id: 'v3', name: 'No sample', author: 'Fishy', sample: null },
    ]);
  });

  it('lists your own voices first and keeps them out of the library', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      Response.json(url.includes('self=true') ? { total: 1, items: [MODEL('mine', 'My clone')] } : { total: 2, items: [MODEL('mine', 'My clone'), MODEL('lib', 'Library voice')] }),
    );
    const out = await fishVoices({ apiKey: 'k', voiceId: null }, ' calm ', fetchImpl as unknown as typeof fetch);
    expect(out.mine.map((v) => v.id)).toEqual(['mine']);
    expect(out.library.map((v) => v.id)).toEqual(['lib']);
    expect(fetchImpl.mock.calls.every(([url]) => String(url).includes('title=calm'))).toBe(true);
  });

  it('tells a voice that is gone from one Fish could not be asked about', async () => {
    const gone = vi.fn(async () => new Response('', { status: 404 }));
    expect(await fishVoice({ apiKey: 'k', voiceId: null }, 'x', gone as unknown as typeof fetch)).toBe('gone');
    const down = vi.fn(async () => new Response('', { status: 500 }));
    expect(await fishVoice({ apiKey: 'k', voiceId: null }, 'x', down as unknown as typeof fetch)).toBe('unknown');
    const ok = vi.fn(async () => Response.json(MODEL('x', 'Found')));
    expect(await fishVoice({ apiKey: 'k', voiceId: null }, 'x', ok as unknown as typeof fetch)).toMatchObject({ id: 'x', name: 'Found' });
  });

  it('takes a pasted id or a fish.audio link to one', () => {
    expect(voiceIdOf(' 7f92f8afb8ec43bf81429cc1c9199cb1 ')).toBe('7f92f8afb8ec43bf81429cc1c9199cb1');
    expect(voiceIdOf('https://fish.audio/m/7f92f8afb8ec43bf81429cc1c9199cb1/')).toBe('7f92f8afb8ec43bf81429cc1c9199cb1');
    expect(voiceIdOf('https://fish.audio/zh-CN/m/abc123/')).toBe('abc123');
    expect(voiceIdOf('not a voice!')).toBeNull();
    expect(voiceIdOf('')).toBeNull();
  });

  it('writes a sample line with the bot’s name', () => {
    expect(sampleLine('Zena')).toMatch(/^Hi, this is Zena\./);
  });
});

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

  it("sends the bot's own voice in place of the default, and calls its refusal a voice problem", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"not found"}', { status: 404 }));
    const out = await fishSpeak({ apiKey: 'k', voiceId: 'dash' }, 'Hi.', fetchImpl as unknown as typeof fetch, 'zena');
    expect(out).toMatchObject({ ok: false, why: 'voice' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ reference_id: 'zena' });
    // The default voice refused is not a voice problem: there is nothing to fall back to.
    expect(await fishSpeak({ apiKey: 'k', voiceId: 'dash' }, 'Hi.', fetchImpl as unknown as typeof fetch)).toMatchObject({ why: 'failed' });
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
