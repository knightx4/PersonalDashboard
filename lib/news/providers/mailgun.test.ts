import { describe, expect, it } from 'vitest';
import {
  createMailgunProvider,
  mailgunSignature,
  parseFrom,
  signatureIsCurrent,
} from '@/lib/news/providers/mailgun';

const KEY = 'a-signing-key';
const NOW = new Date('2026-05-01T12:00:00Z');
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));

/** What Mailgun posts for a fully parsed inbound message, minus the parts we ignore. */
function payload(over: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields: Record<string, string> = {
    timestamp: TIMESTAMP,
    token: 'a-token-unique-to-this-delivery',
    signature: mailgunSignature(KEY, TIMESTAMP, 'a-token-unique-to-this-delivery'),
    recipient: 'k7m2pq4xv9zd3b1n@in.example.com',
    sender: 'bounces+7f3@mail.thepaper.com',
    from: 'The Paper <hello@thepaper.com>',
    subject: 'This week',
    'body-plain': 'Morning.',
    'body-html': '<p>Morning.</p>',
    'message-headers': JSON.stringify([
      ['From', 'The Paper <hello@thepaper.com>'],
      ['Message-Id', '<issue-42@thepaper.com>'],
    ]),
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

const provider = createMailgunProvider({ signingKey: KEY, now: () => NOW });

describe('the Mailgun provider', () => {
  it('reads a signed delivery into a message', async () => {
    expect(await provider.read(payload())).toEqual({
      recipient: 'k7m2pq4xv9zd3b1n@in.example.com',
      senderEmail: 'hello@thepaper.com',
      senderName: 'The Paper',
      subject: 'This week',
      messageId: '<issue-42@thepaper.com>',
      textBody: 'Morning.',
      htmlBody: '<p>Morning.</p>',
    });
  });

  it('refuses a signature that does not match', async () => {
    expect(await provider.read(payload({ signature: 'f'.repeat(64) }))).toBe('unsigned');
  });

  it('refuses a post with no signature at all', async () => {
    const form = payload();
    form.delete('signature');
    expect(await provider.read(form)).toBe('unsigned');
  });

  it('refuses a signature signed with another key', async () => {
    const token = 'a-token-unique-to-this-delivery';
    const wrong = mailgunSignature('some-other-key', TIMESTAMP, token);
    expect(await provider.read(payload({ signature: wrong }))).toBe('unsigned');
  });

  it('refuses one signed a week ago', async () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 7 * 86_400);
    const token = 'a-token-unique-to-this-delivery';
    expect(
      await provider.read(
        payload({ timestamp: old, signature: mailgunSignature(KEY, old, token) }),
      ),
    ).toBe('unsigned');
  });

  it('takes the Message-ID out of the headers when there is no field for it', async () => {
    const form = payload();
    const message = await provider.read(form);
    expect(message).not.toBe('unsigned');
    expect(typeof message === 'object' && message.messageId).toBe('<issue-42@thepaper.com>');
  });

  it('falls back to the delivery token when the message carried no id', async () => {
    const form = payload({ 'message-headers': JSON.stringify([['Subject', 'This week']]) });
    const message = await provider.read(form);
    expect(typeof message === 'object' && message.messageId).toBe(
      'a-token-unique-to-this-delivery',
    );
  });

  it('drops a signed post with neither body, which is a failed delivery', async () => {
    const form = payload();
    form.delete('body-plain');
    form.delete('body-html');
    expect(await provider.read(form)).toBe('malformed');
  });

  it('keeps the html when there is no text part', async () => {
    const form = payload();
    form.delete('body-plain');
    const message = await provider.read(form);
    expect(typeof message === 'object' && message.textBody).toBeNull();
    expect(typeof message === 'object' && message.htmlBody).toBe('<p>Morning.</p>');
  });
});

describe('parseFrom', () => {
  it('splits a name from an address', () => {
    expect(parseFrom('The Paper <Hello@ThePaper.com>')).toEqual({
      email: 'hello@thepaper.com',
      name: 'The Paper',
    });
  });

  it('takes a bare address', () => {
    expect(parseFrom('hello@thepaper.com')).toEqual({ email: 'hello@thepaper.com', name: null });
  });

  it('unquotes a quoted name', () => {
    expect(parseFrom('"Paper, The" <hello@thepaper.com>')?.name).toBe('Paper, The');
  });

  it('is null for something that is not an address', () => {
    expect(parseFrom('undisclosed recipients')).toBeNull();
  });
});

describe('signatureIsCurrent', () => {
  it('accepts a retry hours later, because the service retries for hours', () => {
    const hoursAgo = String(Math.floor(NOW.getTime() / 1000) - 6 * 3600);
    expect(signatureIsCurrent(hoursAgo, NOW)).toBe(true);
  });

  it('rejects a timestamp from the future and one from last week', () => {
    expect(signatureIsCurrent(String(Math.floor(NOW.getTime() / 1000) + 3600), NOW)).toBe(false);
    expect(signatureIsCurrent(String(Math.floor(NOW.getTime() / 1000) - 604_800), NOW)).toBe(false);
  });

  it('rejects one that is not a number', () => {
    expect(signatureIsCurrent('soon', NOW)).toBe(false);
  });
});
