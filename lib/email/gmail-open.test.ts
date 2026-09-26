import { describe, expect, it } from 'vitest';
import { gmailAppUrl, gmailOpenUrl, isIOS } from './gmail-open';

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

describe('gmailAppUrl', () => {
  it('turns the web link into the iOS app conversation link', () => {
    expect(
      gmailAppUrl('https://mail.google.com/mail/?authuser=you%40gmail.com#all/1a050663d3c93b93'),
    ).toBe('googlegmail:///cv=1a050663d3c93b93/accountId=0');
  });

  it('returns null for a link that does not name a conversation', () => {
    expect(gmailAppUrl('https://mail.google.com/mail/?view=cm&to=a%40b.com')).toBeNull();
  });
});

describe('isIOS', () => {
  it('recognises an iPhone', () => {
    expect(
      isIOS('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(true);
  });

  it('recognises an iPad that reports itself as a Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
    expect(isIOS(ua, 5)).toBe(true);
    expect(isIOS(ua, 0)).toBe(false);
  });

  it('leaves Android alone', () => {
    expect(isIOS('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36')).toBe(false);
  });
});
