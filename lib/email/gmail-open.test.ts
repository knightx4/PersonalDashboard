import { describe, expect, it } from 'vitest';
import {
  bareAddress,
  gmailIdFromHref,
  gmailOpenUrl,
  isMobileBrowser,
  replyMailto,
} from './gmail-open';

describe('gmailOpenUrl', () => {
  it('targets the connected inbox via authuser', () => {
    expect(
      gmailOpenUrl({
        emailAddress: 'you@gmail.com',
        threadId: '19ed6ac2eb7106f4',
      }),
    ).toBe(
      'https://mail.google.com/mail/?authuser=you%40gmail.com#all/19ed6ac2eb7106f4',
    );
  });

  it('returns null without a thread or message id', () => {
    expect(gmailOpenUrl({ emailAddress: 'you@gmail.com' })).toBeNull();
  });
});

describe('gmailIdFromHref', () => {
  it('reads the conversation id from the web link', () => {
    expect(
      gmailIdFromHref('https://mail.google.com/mail/?authuser=you%40gmail.com#all/1a050663d3c93b93'),
    ).toBe('1a050663d3c93b93');
  });

  it('returns null for a link that does not name a conversation', () => {
    expect(gmailIdFromHref('https://mail.google.com/mail/?view=cm&to=a%40b.com')).toBeNull();
  });
});

describe('isMobileBrowser', () => {
  it('recognises an iPhone and an Android phone', () => {
    expect(
      isMobileBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(true);
    expect(isMobileBrowser('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36')).toBe(
      true,
    );
  });

  it('counts an iPad that reports itself as a Mac, but not a Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(isMobileBrowser(ua, 5)).toBe(true);
    expect(isMobileBrowser(ua, 0)).toBe(false);
  });

  it('leaves a desktop browser alone', () => {
    expect(
      isMobileBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0'),
    ).toBe(false);
  });
});

describe('bareAddress', () => {
  it('takes the address out of a named header', () => {
    expect(bareAddress('Jane Doe <jane@example.com>')).toBe('jane@example.com');
    expect(bareAddress('jane@example.com')).toBe('jane@example.com');
    expect(bareAddress('Jane Doe')).toBeNull();
  });
});

describe('replyMailto', () => {
  it('replies to Reply-To over From, with Re: once', () => {
    expect(
      replyMailto({
        fromAddress: 'Workday <noreply@workday.com>',
        replyToAddress: 'Recruiter <sam@acme.com>',
        subject: 'Your interview',
      }),
    ).toBe('mailto:sam%40acme.com?subject=Re%3A%20Your%20interview');
    expect(
      replyMailto({ fromAddress: 'a@b.com', replyToAddress: null, subject: 'RE: hello' }),
    ).toBe('mailto:a%40b.com?subject=RE%3A%20hello');
  });

  it('returns null without an address to reply to', () => {
    expect(replyMailto({ fromAddress: null, replyToAddress: null, subject: 'x' })).toBeNull();
  });
});
