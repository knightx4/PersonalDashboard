import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNSUBSCRIBE_SUBJECT,
  mailgunMessagesUrl,
  parseUnsubscribeMailto,
  sendUnsubscribeMail,
} from './send';

const LOCAL_PART = 'k7m2pq4xv9zd3b1n';
const DOMAIN = 'in.example.com';
const KEY = 'a-sending-key';

/** Records the one request and answers with what the test asked for. */
function recordingFetch(response: Response | (() => never)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return typeof response === 'function' ? response() : response;
  }) as typeof globalThis.fetch;
  return { calls, fetchFn };
}

/** The form Mailgun was posted, read back out of the recorded body. */
function postedFields(init: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init.body));
}

function queued() {
  return new Response(JSON.stringify({ id: '<20260519.1@in.example.com>', message: 'Queued.' }));
}

async function send(storedAddress: string, response: Response | (() => never)) {
  const { calls, fetchFn } = recordingFetch(response);
  const result = await sendUnsubscribeMail({
    localPart: LOCAL_PART,
    storedAddress,
    domain: DOMAIN,
    apiKey: KEY,
    fetch: fetchFn,
  });
  return { result, calls };
}

describe('parseUnsubscribeMailto', () => {
  it('reads a bare address and falls back to unsubscribe for the subject', () => {
    expect(parseUnsubscribeMailto('unsub@thepaper.com')).toEqual({
      to: 'unsub@thepaper.com',
      subject: DEFAULT_UNSUBSCRIBE_SUBJECT,
    });
  });

  it('decodes the subject the header asked for', () => {
    expect(parseUnsubscribeMailto('unsub@thepaper.com?subject=unsubscribe%20me')).toEqual({
      to: 'unsub@thepaper.com',
      subject: 'unsubscribe me',
    });
  });

  it('keeps a plus in the subject, which a mailto query does not use for a space', () => {
    expect(parseUnsubscribeMailto('u@x.com?subject=stop+now')?.subject).toBe('stop+now');
  });

  it('finds the subject past another parameter, and ignores the body', () => {
    expect(parseUnsubscribeMailto('u@x.com?body=whatever&subject=remove%20me')).toEqual({
      to: 'u@x.com',
      subject: 'remove me',
    });
  });

  it('falls back when the subject parameter is there but empty', () => {
    expect(parseUnsubscribeMailto('u@x.com?subject=')?.subject).toBe(DEFAULT_UNSUBSCRIBE_SUBJECT);
  });

  it('keeps a plus address on the left of the question mark', () => {
    expect(parseUnsubscribeMailto('list+unsub@x.com?subject=go')?.to).toBe('list+unsub@x.com');
  });

  it('survives a broken escape rather than throwing', () => {
    expect(parseUnsubscribeMailto('u@x.com?subject=100%%20off')?.subject).toBe('100%%20off');
  });

  it('returns null for something with no address in it', () => {
    expect(parseUnsubscribeMailto('@x.com')).toBeNull();
    expect(parseUnsubscribeMailto('not an address?subject=go')).toBeNull();
  });
});

describe('sendUnsubscribeMail', () => {
  it('posts to the messages endpoint for the news domain, from your own address', async () => {
    const { result, calls } = await send('unsub@thepaper.com?subject=unsubscribe%20me', queued());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(mailgunMessagesUrl(DOMAIN));
    expect(calls[0].url).toBe('https://api.mailgun.net/v3/in.example.com/messages');
    expect(calls[0].init.method).toBe('POST');

    const fields = postedFields(calls[0].init);
    expect(fields.get('from')).toBe(`${LOCAL_PART}@${DOMAIN}`);
    expect(fields.get('to')).toBe('unsub@thepaper.com');
    expect(fields.get('subject')).toBe('unsubscribe me');

    expect(result).toEqual({
      ok: true,
      from: `${LOCAL_PART}@${DOMAIN}`,
      to: 'unsub@thepaper.com',
      subject: 'unsubscribe me',
      status: 200,
      messageId: '<20260519.1@in.example.com>',
    });
  });

  it('sends the subject unsubscribe when the header asked for none', async () => {
    const { result, calls } = await send('unsub@thepaper.com', queued());
    expect(postedFields(calls[0].init).get('subject')).toBe('unsubscribe');
    expect(result.ok && result.subject).toBe('unsubscribe');
  });

  it('authenticates as api with the sending key', async () => {
    const { calls } = await send('unsub@thepaper.com', queued());
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`api:${KEY}`).toString('base64')}`);
  });

  it('names the missing variable when the deployment has no sending key', async () => {
    const { calls, fetchFn } = recordingFetch(queued());
    const result = await sendUnsubscribeMail({
      localPart: LOCAL_PART,
      storedAddress: 'unsub@thepaper.com',
      domain: DOMAIN,
      apiKey: null,
      fetch: fetchFn,
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('unconfigured');
    expect(!result.ok && result.detail).toContain('MAILGUN_API_KEY');
    expect(!result.ok && result.detail).not.toContain('NEWS_MAIL_DOMAIN');
    expect(calls).toHaveLength(0);
  });

  it('names both variables when neither is set', async () => {
    const result = await sendUnsubscribeMail({
      localPart: LOCAL_PART,
      storedAddress: 'unsub@thepaper.com',
      domain: null,
      apiKey: null,
    });
    expect(!result.ok && result.detail).toContain('NEWS_MAIL_DOMAIN');
    expect(!result.ok && result.detail).toContain('MAILGUN_API_KEY');
  });

  it('reports a refusal with its status and what Mailgun said', async () => {
    const { result, calls } = await send(
      'unsub@thepaper.com',
      new Response('Forbidden: domain not allowed to send', { status: 403 }),
    );

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('refused');
    expect(!result.ok && result.status).toBe(403);
    expect(!result.ok && result.detail).toContain('403');
    expect(!result.ok && result.detail).toContain('domain not allowed to send');
  });

  it('reports a request that never arrived', async () => {
    const { result } = await send('unsub@thepaper.com', () => {
      throw new Error('getaddrinfo ENOTFOUND api.mailgun.net');
    });
    expect(!result.ok && result.reason).toBe('unreachable');
    expect(!result.ok && result.detail).toContain('ENOTFOUND');
  });

  it('sends nothing when the stored address cannot be read', async () => {
    const { result, calls } = await send('@thepaper.com', queued());
    expect(!result.ok && result.reason).toBe('unusable_address');
    expect(calls).toHaveLength(0);
  });
});
