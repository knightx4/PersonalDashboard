import { describe, expect, it } from 'vitest';
import { confirmScore, findConfirmLink, htmlLinks, pickConfirmLink, textLinks } from './confirm-link';

/**
 * Picking the confirmation link out of a signup email (plan #1723).
 *
 * The emails are shaped on the confirmation emails News has received: a
 * Substack button behind a tracking address, a Mailchimp "Yes, subscribe me"
 * link beside an unsubscribe link, a Ghost signup link carrying a token, a
 * welcome email whose only subscribe-ish link is "unsubscribe here", and a
 * verification-code email with nothing to press. Tokens are made up.
 */

const html = (body: string) =>
  `<html><head><style>a{color:red}</style><title>Confirm</title></head><body>${body}</body></html>`;

const SUBSTACK = html(`
  <a href="https://example.substack.com/?utm_source=email">Example Weekly</a>
  <p>Thanks for signing up. Please confirm your subscription below.</p>
  <table><tr><td>
    <a href="https://email.mg-d1.substack.com/c/eJyMk8uS6jYQhp_G3gFAKEtokenOne?x=1&amp;y=2"
       style="background:#ff6719"><span>Confirm subscription</span></a>
  </td></tr></table>
  <p>If you didn't sign up, you can ignore this.
  <a href="https://email.mg-d1.substack.com/c/eJyMk8uS6jYQhp_G3gFAKEtokenTwo">Unsubscribe</a></p>`);

const MAILCHIMP = html(`
  <p>Quanta Magazine: please confirm your subscription.</p>
  <a href="https://click.mailchimp.com/track/click/30010842/quanta.us1.list-manage.com?p=eyJzIjoiTzBPdkg0T0ZD">Yes, subscribe me to this list.</a>
  <p>If you received this email by mistake, simply delete it.</p>
  <a href="https://click.mailchimp.com/track/click/30010842/quanta.us1.list-manage.com?p=eyJzIjoibU1xTDVSR3lF">unsubscribe here</a>
  <a href="https://www.quantamagazine.org/">Quanta Magazine</a>`);

const GHOST = html(`
  <h1>Complete your sign up to Platformer!</h1>
  <a href="https://www.platformer.news/">Platformer</a>
  <a href='https://www.platformer.news/members/?token=MnkWp1ww6Q_agyjVMowDKFz1&amp;action=signup'>Confirm signup</a>
  <p>For your security, the link will expire in 24 hours.</p>`);

const ALREADY_CONFIRMED = html(`
  <h1>Subscription Confirmed</h1>
  <p>Your subscription to our list has been confirmed.</p>
  <a href="https://www.quantamagazine.org/">Read the latest</a>
  <a href="https://click.mailchimp.com/track/click/1/quanta.us1.list-manage.com?p=eyJzIjoibU1xTDVSR3lFUFZl">unsubscribe here</a>
  <a href="https://quanta.us1.list-manage.com/profile?u=abc123def456ghi789">update your preferences</a>`);

const CODE_ONLY = html(`
  <h2>Verify Your Email Address</h2>
  <p>Enter this code to finish verification.</p><p><b>GVWH7Q</b></p>
  <p>If you need assistance, please visit
  <a href="https://link.axios.com/click/6ab533dcc53c1f5c750c5956/aHR0cHM6Ly9oZWxw">help.axios.com</a>.</p>`);

describe('finding the confirmation link', () => {
  it('picks the confirm button over the unsubscribe link, decoding &amp;', () => {
    expect(findConfirmLink({ htmlBody: SUBSTACK, textBody: null })).toBe(
      'https://email.mg-d1.substack.com/c/eJyMk8uS6jYQhp_G3gFAKEtokenOne?x=1&y=2',
    );
  });

  it('takes "Yes, subscribe me" and never "unsubscribe here"', () => {
    expect(findConfirmLink({ htmlBody: MAILCHIMP, textBody: null })).toBe(
      'https://click.mailchimp.com/track/click/30010842/quanta.us1.list-manage.com?p=eyJzIjoiTzBPdkg0T0ZD',
    );
  });

  it('takes the signup link carrying a token, not the site address', () => {
    expect(findConfirmLink({ htmlBody: GHOST, textBody: null })).toBe(
      'https://www.platformer.news/members/?token=MnkWp1ww6Q_agyjVMowDKFz1&action=signup',
    );
  });

  it('finds none in an email that only says the signup is done', () => {
    expect(findConfirmLink({ htmlBody: ALREADY_CONFIRMED, textBody: null })).toBeNull();
  });

  it('finds none in an email that asks for a code', () => {
    expect(
      findConfirmLink({
        htmlBody: CODE_ONLY,
        textBody: 'Verify Your Email Address\nGVWH7Q\nhelp.axios.com (https://link.axios.com/click/6ab5)',
      }),
    ).toBeNull();
  });

  it('finds none in an email with no links at all', () => {
    expect(findConfirmLink({ htmlBody: html('<p>Welcome aboard.</p>'), textBody: 'Welcome aboard.' })).toBeNull();
    expect(findConfirmLink({ htmlBody: null, textBody: null })).toBeNull();
  });

  it('keeps only https links', () => {
    const plain = html('<a href="http://example.com/confirm?token=abcdefghijklmnopqrstu">Confirm</a>');
    expect(findConfirmLink({ htmlBody: plain, textBody: null })).toBeNull();
    const script = html('<a href="javascript:confirm(1)">Confirm</a>');
    expect(findConfirmLink({ htmlBody: script, textBody: null })).toBeNull();
  });

  it('never offers a bare site address, whatever its words say', () => {
    const bare = html('<a href="https://www.nature.com/">Yes, I confirm</a>');
    expect(findConfirmLink({ htmlBody: bare, textBody: null })).toBeNull();
  });

  it('prefers the link with a token when two say confirm', () => {
    const two = html(`
      <a href="https://www.nature.com/news">Please confirm</a>
      <a href="https://www.nature.com/briefing/journey/confirm?memberId=bf19bd90762b935c0dc0a7">Yes, I confirm</a>`);
    expect(findConfirmLink({ htmlBody: two, textBody: null })).toBe(
      'https://www.nature.com/briefing/journey/confirm?memberId=bf19bd90762b935c0dc0a7',
    );
  });

  it('falls back to the text body, judging an address by the words before it', () => {
    const text = [
      'Thanks for signing up!',
      '',
      'Confirm subscription (https://email.mg-d1.substack.com/c/eJx0U01zqzgQ_DVwC4UkxMeBgxOHLK4XXK9MnNgXSkgCxIdgkWQb__otnK3aHPYdpZlWz3S3KNG)',
      '',
      'Unsubscribe https://email.mg-d1.substack.com/c/eJx0U01zqzgQ_DVwC4UkxMeBgxOHUNSUB',
    ].join('\r\n');
    expect(findConfirmLink({ htmlBody: '<p>No links here</p>', textBody: text })).toBe(
      'https://email.mg-d1.substack.com/c/eJx0U01zqzgQ_DVwC4UkxMeBgxOHLK4XXK9MnNgXSkgCxIdgkWQb__otnK3aHPYdpZlWz3S3KNG',
    );
  });

  it('takes an address that says confirm and carries a token, even under plain words', () => {
    const text = 'Click below:\nhttps://www.densediscovery.com/inc/eo.php?action=optin&id=98be3031c7b011ea9f2b';
    expect(findConfirmLink({ htmlBody: null, textBody: text })).toBe(
      'https://www.densediscovery.com/inc/eo.php?action=optin&id=98be3031c7b011ea9f2b',
    );
  });
});

describe('reading the links', () => {
  it('reads each anchor with its words stripped of tags and entities', () => {
    expect(htmlLinks('<a class="b" href="https://a.example/x?y=1&amp;z=2"><b>Confirm</b>&nbsp;email&nbsp;→</a>')).toEqual([
      { url: 'https://a.example/x?y=1&z=2', text: 'Confirm email →' },
    ]);
  });

  it('reads each written-out address with the words on its line before it', () => {
    expect(textLinks('Verify: https://a.example/v/123 or https://b.example/x.')).toEqual([
      { url: 'https://a.example/v/123', text: 'Verify' },
      { url: 'https://b.example/x', text: 'or' },
    ]);
  });

  it('scores words above the address, and a token as the tie-breaker', () => {
    const words = confirmScore({ url: 'https://a.example/c/abc', text: 'Confirm' });
    const token = confirmScore({ url: 'https://a.example/c/abcdefghijklmnopqrstuv', text: 'Confirm' });
    const subscribe = confirmScore({ url: 'https://a.example/c/abc', text: 'Subscribe me' });
    expect(token).toBeGreaterThan(words);
    expect(words).toBeGreaterThan(subscribe);
    expect(pickConfirmLink([])).toBeNull();
  });
});
