import { describe, expect, it, vi } from 'vitest';
import {
  sendXThread,
  uploadXImage,
  X_MEDIA_UPLOAD_URL,
  X_TWEETS_URL,
  XPostError,
  xPostProblem,
  xPostUrl,
  xSendCheck,
} from './post';
import { formatXPrice } from './price';

/** Posting a draft to X from the Posts tab (plan #2072). X is always a stand-in here. */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch that answers each POST /2/tweets with the next id, recording what it was sent. */
function fakeX(answers: Array<Response | Error>) {
  const sent: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(X_TWEETS_URL);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
    sent.push(JSON.parse(String(init?.body)));
    const next = answers.shift();
    if (!next) throw new Error('X was asked more often than the test expected');
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, sent };
}

describe('the price and the check before sending', () => {
  it('prices a plain post at 0.015 and one with a link at 0.200', () => {
    expect(formatXPrice(xSendCheck({ body: ['A plain post about the gate.'] }).priceUsd)).toBe('$0.015');
    const linked = xSendCheck({ body: ['The write-up is at https://example.com/gate'] });
    expect(linked.ok).toBe(true);
    expect(linked.linkPosts).toEqual([1]);
    expect(formatXPrice(linked.priceUsd)).toBe('$0.200');
  });

  it('prices a thread per post, and only the posts not yet on X', () => {
    const body = ['First post.', 'Second, see example.com/a', 'Third post.'];
    expect(xSendCheck({ body })).toMatchObject({ requests: 3, priceUsd: 0.23, linkPosts: [2] });
    expect(xSendCheck({ body, sent: 2 })).toMatchObject({ requests: 1, priceUsd: 0.015 });
    expect(xSendCheck({ body, sent: 3 })).toMatchObject({ ok: false, requests: 0, priceUsd: 0 });
  });

  it('warns about a post past 280 and the never-in-a-post rules without stopping the send, and prices a link', () => {
    const long = xSendCheck({ body: ['x'.repeat(281)] });
    expect(long.ok).toBe(true);
    expect(long.warnings.join(' ')).toMatch(/281 characters; the limit is 280/);
    const mention = xSendCheck({ body: ['Thanks @someone for the idea'] });
    expect(mention.ok).toBe(true);
    expect(mention.warnings.join(' ')).toMatch(/mentions an account/);
    expect(xSendCheck({ body: ['Read www.example.com'] }).warnings).toEqual([]);
  });
});

describe('images', () => {
  it('uploads an image as multipart tweet_image and returns its media id', async () => {
    let form: FormData | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(X_MEDIA_UPLOAD_URL);
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      form = init?.body as FormData;
      return json(200, { data: { id: '555', media_key: '3_555' } });
    }) as unknown as typeof fetch;
    const id = await uploadXImage({
      token: 'tok',
      image: { bytes: new Blob([new Uint8Array([1, 2, 3])]), type: 'image/png' },
      fetchImpl,
    });
    expect(id).toBe('555');
    expect(form!.get('media_category')).toBe('tweet_image');
    const media = form!.get('media') as Blob;
    expect(media.type).toBe('image/png');
    expect(media.size).toBe(3);
  });

  it('says the image did not upload when X refuses it', async () => {
    const fetchImpl = vi.fn(async () => json(403, { title: 'Forbidden' })) as unknown as typeof fetch;
    const err = await uploadXImage({
      token: 'tok',
      image: { bytes: new Blob([new Uint8Array([1])]), type: 'image/png' },
      fetchImpl,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(XPostError);
    expect(err.message).toMatch(/^The image did not upload/);
    expect(err.reconnect).toBe(true);
  });

  it('puts the images on the first post of a thread only', async () => {
    const { fetchImpl, sent } = fakeX([json(201, { data: { id: '1' } }), json(201, { data: { id: '2' } })]);
    await sendXThread({ token: 'tok', posts: ['one', 'two'], mediaIds: ['555', '556'], fetchImpl });
    expect(sent).toEqual([
      { text: 'one', media: { media_ids: ['555', '556'] } },
      { text: 'two', reply: { in_reply_to_tweet_id: '1' } },
    ]);
  });
});

describe('sending to X', () => {
  it('posts a single post with no reply field', async () => {
    const { fetchImpl, sent } = fakeX([json(201, { data: { id: '100', text: 'Hi' } })]);
    const ids = await sendXThread({ token: 'tok', posts: ['Hi'], fetchImpl });
    expect(ids).toEqual(['100']);
    expect(sent).toEqual([{ text: 'Hi' }]);
  });

  it('chains a thread in order, each a reply to the one before, storing ids as they come', async () => {
    const { fetchImpl, sent } = fakeX([
      json(201, { data: { id: '1' } }),
      json(201, { data: { id: '2' } }),
      json(201, { data: { id: '3' } }),
    ]);
    const progress: string[][] = [];
    const ids = await sendXThread({
      token: 'tok',
      posts: ['one', 'two', 'three'],
      fetchImpl,
      onSent: async (so) => {
        progress.push(so);
      },
    });
    expect(ids).toEqual(['1', '2', '3']);
    expect(sent).toEqual([
      { text: 'one' },
      { text: 'two', reply: { in_reply_to_tweet_id: '1' } },
      { text: 'three', reply: { in_reply_to_tweet_id: '2' } },
    ]);
    expect(progress).toEqual([['1'], ['1', '2'], ['1', '2', '3']]);
  });

  it('carries on a thread that stopped part-way from the last post that went up', async () => {
    const { fetchImpl, sent } = fakeX([json(201, { data: { id: '3' } })]);
    const ids = await sendXThread({ token: 'tok', posts: ['one', 'two', 'three'], sent: ['1', '2'], fetchImpl });
    expect(ids).toEqual(['1', '2', '3']);
    expect(sent).toEqual([{ text: 'three', reply: { in_reply_to_tweet_id: '2' } }]);
  });

  it('stops at a refusal, saying which posts went up', async () => {
    const { fetchImpl, sent } = fakeX([
      json(201, { data: { id: '1' } }),
      json(429, { title: 'Too Many Requests' }),
    ]);
    const err = await sendXThread({ token: 'tok', posts: ['one', 'two', 'three'], fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(XPostError);
    expect(err.sent).toEqual(['1']);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/rate limit/);
    expect(sent).toHaveLength(2);
  });

  it('says when X cannot be reached', async () => {
    const { fetchImpl } = fakeX([new Error('socket hang up')]);
    const err = await sendXThread({ token: 'tok', posts: ['one'], fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(XPostError);
    expect(err.sent).toEqual([]);
    expect(err.status).toBeNull();
  });
});

describe('what a refusal says', () => {
  it('names a duplicate, no credit, and a sign-in that cannot post', () => {
    expect(xPostProblem(403, { detail: 'You are not allowed to create a Tweet with duplicate content.' })).toMatchObject({
      reconnect: false,
      message: expect.stringMatching(/duplicate/),
    });
    expect(xPostProblem(402, { title: 'CreditsDepleted' }).message).toMatch(/out of credit/);
    expect(xPostProblem(403, { title: 'Forbidden' })).toMatchObject({ reconnect: true });
    expect(xPostProblem(401, {})).toMatchObject({ reconnect: true });
    expect(xPostProblem(503, {}).message).toMatch(/\(503\)/);
  });

  it('links to the post the way the reads store it', () => {
    expect(xPostUrl('alexbuilds', '123')).toBe('https://x.com/alexbuilds/status/123');
  });
});
