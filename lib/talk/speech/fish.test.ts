import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { fishEnv, fishSpeak, fishVoice, fishVoicePage, FISH_MODEL_URL, FISH_TTS_URL } from './fish';
import { DEFAULT_VOICE_FILTERS, filtersActive, filtersOf, languageName, sampleLine, usesLabel, voiceIdOf, voiceListUrl, voicesOf } from './voices-model';

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

  it('keeps the tags, languages and use count the picker shows (plan #3081)', () => {
    const [voice] = voicesOf({ items: [MODEL('v1', 'Calm', { tags: ['male', ' calm ', 3], languages: ['en'], task_count: 1200 })] });
    expect(voice).toMatchObject({ tags: ['male', 'calm'], languages: ['en'], uses: 1200 });
  });

  it('asks Fish for one page with every filter the picker set (plan #3081)', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ total: 45, items: Array.from({ length: 20 }, (_, i) => MODEL(`v${i}`, `Voice ${i}`)) }));
    const filters = { search: ' calm ', gender: 'male' as const, language: 'en', tags: ['narrator', 'deep'], mine: true, sort: 'created_at' as const };
    const out = await fishVoicePage({ apiKey: 'k', voiceId: null }, filters, 2, fetchImpl as unknown as typeof fetch);
    expect(out.voices).toHaveLength(20);
    expect(out.total).toBe(45);
    expect(out.more).toBe(true);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown as [string])[0]));
    expect(url.origin + url.pathname).toBe(FISH_MODEL_URL);
    expect(url.searchParams.get('title')).toBe('calm');
    expect(url.searchParams.getAll('tag')).toEqual(['male', 'narrator', 'deep']);
    expect(url.searchParams.get('language')).toBe('en');
    expect(url.searchParams.get('self')).toBe('true');
    expect(url.searchParams.get('sort_by')).toBe('created_at');
    expect(url.searchParams.get('page_number')).toBe('2');
  });

  it('leaves out what is at its default, and says when the last page is reached', async () => {
    const url = new URL(voiceListUrl(FISH_MODEL_URL, DEFAULT_VOICE_FILTERS, 1));
    expect([...url.searchParams.keys()].sort()).toEqual(['page_number', 'page_size', 'sort_by']);
    expect(url.searchParams.get('sort_by')).toBe('task_count');
    const fetchImpl = vi.fn(async () => Response.json({ total: 22, items: [MODEL('a', 'A'), MODEL('b', 'B')] }));
    expect((await fishVoicePage({ apiKey: 'k', voiceId: null }, DEFAULT_VOICE_FILTERS, 2, fetchImpl as unknown as typeof fetch)).more).toBe(false);
    const refused = vi.fn(async () => new Response('', { status: 500 }));
    await expect(fishVoicePage({ apiKey: 'k', voiceId: null }, DEFAULT_VOICE_FILTERS, 1, refused as unknown as typeof fetch)).rejects.toThrow();
  });

  it('reads filters back from storage, dropping anything it does not know', () => {
    expect(filtersOf(null)).toEqual(DEFAULT_VOICE_FILTERS);
    expect(filtersOf({ gender: 'robot', sort: 'random', language: 'English!', tags: ['calm', 'calm', '<b>'], mine: 'yes' })).toEqual({ ...DEFAULT_VOICE_FILTERS, tags: ['calm'] });
    expect(filtersActive(DEFAULT_VOICE_FILTERS)).toBe(false);
    expect(filtersActive({ ...DEFAULT_VOICE_FILTERS, mine: true })).toBe(true);
    expect(languageName('en')).toBe('English');
    expect(languageName('xx')).toBe('XX');
    expect([usesLabel(1), usesLabel(312), usesLabel(9870), usesLabel(48210), usesLabel(1203400), usesLabel(undefined)]).toEqual(['1 use', '312 uses', '9,870 uses', '48.2k uses', '1.2m uses', null]);
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
