/**
 * The gap that cost two subscriptions.
 *
 * `NEWS_MAIL_DOMAIN` was set and `MAILGUN_SIGNING_KEY` was not, so News
 * settings showed an address under a sentence saying newsletters sent to it
 * arrive here -- while the inbound endpoint answered 500 to every post and
 * stored nothing. These assertions are what stop the pages assuming again.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deliveryGap } from './readiness';

const KEYS = ['NEWS_MAIL_DOMAIN', 'MAILGUN_SIGNING_KEY'] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('deliveryGap', () => {
  it('names the missing domain first, since without it there is no address at all', () => {
    process.env.MAILGUN_SIGNING_KEY = 'key-abc';
    expect(deliveryGap()).toBe('no-domain');
  });

  it('names the missing signing key -- the one that used to show nothing', () => {
    process.env.NEWS_MAIL_DOMAIN = 'in.example.com';
    expect(deliveryGap()).toBe('no-signing-key');
  });

  it('reports the domain when both are missing, so one fix is offered at a time', () => {
    expect(deliveryGap()).toBe('no-domain');
  });

  it('is null when the deployment is configured', () => {
    process.env.NEWS_MAIL_DOMAIN = 'in.example.com';
    process.env.MAILGUN_SIGNING_KEY = 'key-abc';
    expect(deliveryGap()).toBeNull();
  });

  it('treats an empty string as missing, which is how a blank Vercel field arrives', () => {
    process.env.NEWS_MAIL_DOMAIN = 'in.example.com';
    process.env.MAILGUN_SIGNING_KEY = '';
    expect(deliveryGap()).toBe('no-signing-key');
  });
});
