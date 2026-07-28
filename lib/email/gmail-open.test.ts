import { describe, expect, it } from 'vitest';
import { gmailOpenUrl } from './gmail-open';

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
