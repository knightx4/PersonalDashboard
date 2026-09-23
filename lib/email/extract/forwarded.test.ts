import { describe, expect, it } from 'vitest';
import { quotedOriginal, unwrapQuotedOriginal } from './forwarded';

const gmailForward = [
  'See below.',
  '',
  '---------- Forwarded message ---------',
  'From: Goods of Desire <store+123@shopifyemail.com>',
  'Date: Fri, Sep 18, 2026 at 9:14 AM',
  'Subject: Order Confirmation #1RGJRCL',
  'To: <samantha.kuo@gmail.com>',
  '',
  '',
  'Thank you for your order.',
  'Tea towel × 2  HK$200.00',
].join('\n');

const outlookForward = [
  '',
  'Get Outlook for iOS',
  '________________________________',
  'From: Hen & Heifer <hello@henandheifer.com>',
  'Sent: Thursday, September 17, 2026 4:02 PM',
  'To: Samantha Kuo <kuosamantha@yahoo.com>;',
  '    Eddy Liu <eddy@god.com.hk>',
  'Subject: Your order #8028 is ready for pickup',
  '',
  'Your order is ready.',
].join('\n');

describe('quotedOriginal', () => {
  it('reads the sender, subject and text under a Gmail forward header', () => {
    expect(quotedOriginal(gmailForward)).toEqual({
      fromAddress: '"Goods of Desire" <store+123@shopifyemail.com>',
      subject: 'Order Confirmation #1RGJRCL',
      text: 'Thank you for your order.\nTea towel × 2  HK$200.00',
    });
  });

  it('reads an Outlook forward, with its Sent: line and a wrapped To:', () => {
    expect(quotedOriginal(outlookForward)).toEqual({
      fromAddress: '"Hen & Heifer" <hello@henandheifer.com>',
      subject: 'Your order #8028 is ready for pickup',
      text: 'Your order is ready.',
    });
  });

  it('reads an Outlook "Original Message" header with a mailto address and bold labels', () => {
    const text = [
      'Please see the order below.',
      '-----Original Message-----',
      '*From:* Goods of Desire [mailto:shop@god.com.hk]',
      '*Sent:* Monday, September 14, 2026 10:00 AM',
      '*To:* Selvey Knight',
      '*Subject:* [Goods of Desire] Order #11888 placed by Selvey Knight',
      '',
      'Order summary',
    ].join('\n');
    expect(quotedOriginal(text)).toMatchObject({
      fromAddress: '"Goods of Desire" <shop@god.com.hk>',
      subject: '[Goods of Desire] Order #11888 placed by Selvey Knight',
      text: 'Order summary',
    });
  });

  it('reads a Gmail reply attribution and strips the quote markers', () => {
    const text = [
      'Could you change the colour?',
      '',
      'On Mon, Sep 14, 2026 at 10:02 AM Goods of Desire <',
      'shop@god.com.hk> wrote:',
      '',
      '> Order #11888',
      '> Tea towel × 2',
    ].join('\n');
    expect(quotedOriginal(text)).toEqual({
      fromAddress: '"Goods of Desire" <shop@god.com.hk>',
      subject: null,
      text: 'Order #11888\nTea towel × 2',
    });
  });

  it('takes the deepest quoted message in a thread', () => {
    const text = [
      'Thanks, will do.',
      '',
      'On Tue, Sep 15, 2026 at 8:00 AM Selvey Knight <selveyknight4@gmail.com> wrote:',
      '> Here it is.',
      '>',
      '> ---------- Forwarded message ---------',
      '> From: Goods of Desire <shop@god.com.hk>',
      '> Date: Mon, Sep 14, 2026 at 10:00 AM',
      '> Subject: Order #11888 placed',
      '> To: <selveyknight4@gmail.com>',
      '>',
      '> Order summary',
    ].join('\n');
    expect(quotedOriginal(text)?.fromAddress).toBe('"Goods of Desire" <shop@god.com.hk>');
    expect(quotedOriginal(text)?.text).toBe('Order summary');
  });

  it('ignores an email with no quoted header', () => {
    expect(quotedOriginal('Thanks for your order.\nTotal $12.00')).toBeNull();
  });

  it('ignores a From: and To: pair that is a shipping label, not a header', () => {
    const text = ['Shipment details', 'From: Warehouse 4, Kowloon', 'To: Samantha Kuo', '', 'Arriving Friday'].join('\n');
    expect(quotedOriginal(text)).toBeNull();
  });
});

describe('unwrapQuotedOriginal', () => {
  it('replaces the forwarder, their name and the outer text with the quoted message', () => {
    const unwrapped = unwrapQuotedOriginal({
      subject: 'Fwd: Order Confirmation #1RGJRCL',
      text: gmailForward,
      fromAddress: 'Samantha Kuo <samantha.kuo@gmail.com>',
      merchantName: 'Samantha Kuo',
      merchantSlug: null,
    });
    expect(unwrapped).toEqual({
      subject: 'Order Confirmation #1RGJRCL',
      text: 'Thank you for your order.\nTea towel × 2  HK$200.00',
      fromAddress: '"Goods of Desire" <store+123@shopifyemail.com>',
      merchantName: 'Goods of Desire',
      merchantSlug: null,
    });
  });

  it('keeps a known merchant name the caller classified', () => {
    const unwrapped = unwrapQuotedOriginal({
      subject: 'Fwd: Order',
      text: gmailForward,
      fromAddress: 'Samantha Kuo <samantha.kuo@gmail.com>',
      merchantName: 'Target',
    });
    expect(unwrapped.merchantName).toBe('Target');
  });

  it('returns an email with no quoted header unchanged', () => {
    const input = { subject: 'Your order', text: 'Thanks.', fromAddress: 'a@b.com', merchantName: null };
    expect(unwrapQuotedOriginal(input)).toBe(input);
  });
});
