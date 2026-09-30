import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyExtraction } from './apply';
import { classifyMessage } from './classify';
import { heuristicExtractOrder } from './heuristic';

const amazonFixture = readFileSync(
  resolve(__dirname, '../../../fixtures/emails/amazon-order-confirmation.txt'),
  'utf8',
);

describe('classifyMessage', () => {
  const amazon = {
    id: 'm1',
    slug: 'amazon',
    name: 'Amazon',
    domains: ['amazon.com', 'order-update.amazon.com'],
  };

  it('marks known-merchant order subjects as order_confirmation', () => {
    const result = classifyMessage({
      fromAddress: 'auto-confirm@amazon.com',
      subject: 'Your Amazon.com order of Headphones',
      merchants: [amazon],
    });
    expect(result.classification).toBe('order_confirmation');
    expect(result.merchant?.slug).toBe('amazon');
    expect(result.tier).toBe('A');
  });

  it('matches Amazon order subjects via ORDER_SUBJECT without relying on merchant', () => {
    const result = classifyMessage({
      fromAddress: 'ship-confirm@amazon.com',
      subject: 'Your Amazon.com order of USB-C Hub',
      merchants: [],
    });
    expect(result.classification).toBe('order_confirmation');
  });

  it('marks Amazon Ordered: title subjects as order_confirmation', () => {
    const result = classifyMessage({
      fromAddress: 'Amazon.com <auto-confirm@amazon.com>',
      subject: 'Ordered: "The Well-Tempered City:..."',
      merchants: [amazon],
    });
    expect(result.classification).toBe('order_confirmation');
    expect(result.merchant?.slug).toBe('amazon');
  });

  it('marks Shopify-style Order N confirmed subjects as order_confirmation', () => {
    const result = classifyMessage({
      fromAddress: 'Ms Betters <hello@msbetters.us>',
      subject: 'Order 5781 confirmed',
      merchants: [],
    });
    expect(result.classification).toBe('order_confirmation');
    expect(result.merchant).toBeNull();
  });

  it.each([
    "Order Confirmed! We'll Take It From Here",
    'Your order is confirmed',
    'Thank you for your order',
    'Thank you for your purchase!',
    'Purchase confirmation',
  ])('marks "%s" from an unknown sender as order_confirmation', (subject) => {
    const result = classifyMessage({
      fromAddress: 'James Avery Artisan Jewelry <order-info@email.jamesavery.com>',
      subject,
      merchants: [],
    });
    expect(result.classification).toBe('order_confirmation');
  });

  it('still reads "Order Shipped!" as shipping', () => {
    const result = classifyMessage({
      fromAddress: 'order-info@email.jamesavery.com',
      subject: 'Order Shipped!',
      merchants: [],
    });
    expect(result.classification).toBe('shipping');
  });

  it('marks Amazon review prompts as not_relevant', () => {
    const result = classifyMessage({
      fromAddress: 'no-reply@amazon.com',
      subject: 'Did your recent Amazon order meet your expectations? Review it on Amazon',
      merchants: [amazon],
    });
    expect(result.classification).toBe('not_relevant');
  });

  it('marks unknown personal mail as not_relevant', () => {
    const result = classifyMessage({
      fromAddress: 'friend@gmail.com',
      subject: 'Dinner plans?',
      merchants: [amazon],
    });
    expect(result.classification).toBe('not_relevant');
  });
});

// Subjects from the live review queue, September 2026. The first list is what
// the person reported as "obviously not shopping"; the second is real purchase
// mail that has to keep its type.
describe('classifyMessage on the review queue', () => {
  const merchants = [
    { id: 'm1', slug: 'amazon', name: 'Amazon', domains: ['amazon.com'] },
    { id: 'm2', slug: 'uber-eats', name: 'Uber Eats', domains: ['ubereats.com', 'uber.com'] },
    { id: 'm3', slug: 'doordash', name: 'DoorDash', domains: ['doordash.com'] },
    { id: 'm4', slug: 'etsy', name: 'Etsy', domains: ['etsy.com'] },
    { id: 'm5', slug: 'shopify', name: 'Shopify', domains: ['shopifyemail.com'] },
    { id: 'm6', slug: 'clean-skin-club', name: 'Clean Skin Club', domains: ['cleanskinclub.com'] },
    { id: 'm7', slug: 'target', name: 'Target', domains: ['target.com'] },
  ];

  it.each([
    ['D: Ye’s return to Chicago #ye #kanyewest #chicago', 'TikTok <notification@service.tiktok.com>'],
    ['Tonight at 8: Will Fanbase not return?', 'Chatter <hello@go.chattersocial.io>'],
    ['Did you ever cancel that old subscription?', 'ChatGPT <noreply@email.openai.com>'],
    ['Elevator Car 1 - service is on the way', '475 Clermont <no-reply@modernmsg.com>'],
    ['Stop tracking who still owes you', 'SignUpGenius <info@signupgenius.com>'],
    ['Introducing Shipped by Profound ', 'Nick Lafferty <nick@tryprofound.com>'],
    ['Time to confirm or modify your rental return', 'Enterprise <No-Reply@enterprise.com>'],
    ['Your equipment return details', 'Xfinity <online.communications@alerts.comcast.net>'],
    ["You're receiving a refund", 'Xfinity <online.communications@alerts.comcast.net>'],
    ['Why Wait for the IRS? Get Up to $4,000 Today With a Tax Refund Advance Loan', 'Investopedia <Investopedia@mail.investopedia.com>'],
    ['A Return to Leisure', 'Buck Mason <help@buckmason.com>'],
    ['Signed, sealed, and delivered in a snap', 'Adobe Acrobat <mail@e.adobe.com>'],
    ['Avery save $25—order again today.', 'Uber Eats <uber@uber.com>'],
    ['$25 off makes your order more affordable', 'Uber Eats <uber@uber.com>'],
    ['Skip the umbrella—just order in.', 'Uber Eats <noreply@uber.com>'],
    ['Get up to $25 worth of free food before it’s too late. Sit down and order up before it’s gone.', 'Uber Eats <uber@uber.com>'],
    ['Less hassle, more saving—easily place an order', 'Uber Eats <uber@uber.com>'],
    ['Place your first order and save', 'Uber Eats <uber@uber.com>'],
    ['Trending favorites, delivered to you', 'Uber Eats <uber@uber.com>'],
    ['50% off an order with your Chase card', 'DoorDash <no-reply@messages.doordash.com>'],
    ['Your first alcohol order is still 30% off', 'DoorDash <no-reply@messages.doordash.com>'],
    ['Your next order could earn double 🛍️', 'Clean Skin Club <wecare@cleanskinclub.com>'],
    ['One more reason to place the order 🩵', 'Clean Skin Club <wecare@cleanskinclub.com>'],
    ['Your $50+ order just got better 😍', 'Clean Skin Club <wecare@cleanskinclub.com>'],
    ['Your order just got an upgrade 👀', 'Clean Skin Club <wecare@cleanskinclub.com>'],
  ])('turns away "%s"', (subject, fromAddress) => {
    expect(classifyMessage({ subject, fromAddress, merchants }).classification).toBe('not_relevant');
  });

  it.each([
    ['Ordered: 1 Cosmetics item', '"Amazon.com" <auto-confirm@amazon.com>', 'order_confirmation'],
    ['Order Confirmation for Avery from Lucky Lab', 'DoorDash Order <no-reply@doordash.com>', 'order_confirmation'],
    ['Adjustment to your order from CAVA (The Drag)', 'no-reply@doordash.com', 'order_confirmation'],
    ['Order #613080 confirmed', 'Gold Hinge <store+1@t.shopifyemail.com>', 'order_confirmation'],
    ['Thanks for shopping with us! Here\'s your order #:102003572839771.', 'Target <orders@oe1.target.com>', 'order_confirmation'],
    ['Pottery Barn Teen Order Confirmation #362062684729', 'Pottery Barn Teen <PotteryBarnTeen@o.pbteen.com>', 'order_confirmation'],
    ['Fwd: Your order #8028 is ready for pickup — hen & heifer', 'Samantha Kuo <samantha.kuo@gmail.com>', 'order_confirmation'],
    ['A shipment from order #613080 is on the way', 'Gold Hinge <store+1@t.shopifyemail.com>', 'shipping'],
    ['A shipment from order #1533287 is out for delivery', 'Clean Skin Club <wecare@cleanskinclub.com>', 'shipping'],
    ['Your order has been shipped! Shopify Store', '"1800ceiling.com" <tracking@shipstation.com>', 'shipping'],
    ['Your order from @sydddbushman has been shipped', 'Depop <bought@alerts.depop.com>', 'shipping'],
    ['And it’s off! DHL has your order 🚚', 'Etsy <email@email.etsy.com>', 'shipping'],
    ['Get ready for something special! An item from order #102003572839771 is about to ship.', 'Target <orders@oe.target.com>', 'shipping'],
    ['Delivery estimate update for your Amazon.com order #114-3630811-7869015', '"Amazon.com" <no-reply@amazon.com>', 'shipping'],
    ['Your Package Has Shipped', 'UPS <pkginfo@ups.com>', 'shipping'],
    ['Your Order #6413918145  Has Shipped', 'Allbirds <hello@info.allbirds.com>', 'shipping'],
    ['Your Order\'s On The Way! 🚚', 'Velvet Caviar <hi@velvetcaviar.com>', 'shipping'],
    ['Your Etsy Order Shipped (Receipt #4128656010)', 'Etsy Shipping Notifications <no-reply@account.etsy.com>', 'shipping'],
    ['Ding dong! Your special delivery is on the way✨', 'Etsy Shipping Notifications <no-reply@account.etsy.com>', 'shipping'],
    ['An item has arrived from order #102003572839771!', 'Target <orders@oe.target.com>', 'delivery'],
    ['UPS Update: Package Delivered', 'UPS <pkginfo@ups.com>', 'delivery'],
    ['Mark & Graham Delivery Confirmation #362173885967', '"Mark & Graham" <MarkandGraham@o.markandgraham.com>', 'delivery'],
    ['A package has been delivered!', 'Texas Longhorns Official Team Shop <shop@s.fanaticsretailgroup.com>', 'delivery'],
    ['Your Babyboo return is approved (HRDMWKGJ)', 'Happy Returns <confirmation@notify.happyreturns.com>', 'return'],
    ['Re: Your return has been submitted', 'Selvey Knight <selveyknight4@gmail.com>', 'return'],
    ['Babyboo Fashion Return Confirmation - Order#2241944', 'BABYBOO <babyboofashion@loopreturns.com>', 'return'],
    ['You have a refund from Fandango', '"service@paypal.com" <service@paypal.com>', 'return'],
  ])('keeps "%s"', (subject, fromAddress, expected) => {
    expect(classifyMessage({ subject, fromAddress, merchants }).classification).toBe(expected);
  });
});

describe('heuristicExtractOrder + applyExtraction', () => {
  it('extracts the Amazon fixture and reconciles', () => {
    const firstLine = amazonFixture.split('\n')[0] ?? '';
    const subject = firstLine.replace(/^Subject:\s*/i, '');
    const body = amazonFixture.replace(/^Subject:.*\n\n?/, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      merchantSlug: 'amazon',
      merchantName: 'Amazon',
      // Simulate a Yahoo→Gmail forward: mailbox date is today, body date is older.
      receivedAt: new Date('2026-08-20T18:00:00Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.orderDate).toBe('2026-01-15');
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.order.externalOrderNumber).toBe('123-4567890-1234567');
      expect(applied.order.orderDate).toBe('2026-01-15');
      expect(applied.order.totalCents).toBe(37584);
      expect(applied.order.lines[0]?.name).toMatch(/Sony/i);
    }
  });

  it('names DoorDash-style orders from the subject when line items are missing', () => {
    const raw = heuristicExtractOrder({
      subject: 'Your order from bb.q Chicken (order #350db292)',
      text: 'Thanks for ordering.\nTotal: $4.39\n',
      merchantSlug: 'doordash',
      merchantName: 'DoorDash',
      fromAddress: '"bb.q Chicken" <noreply@order.online>',
      receivedAt: new Date('2026-06-17T12:00:00Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.externalOrderNumber).toBe('350db292');
    expect(raw?.lines[0]?.name).toMatch(/bb\.q Chicken/i);
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
  });

  it('parses Amazon Ordered: subjects with Grand Total in USD', () => {
    const raw = heuristicExtractOrder({
      subject: 'Ordered: "The Well-Tempered City:..."',
      text: [
        'Thanks for your order!',
        'Order #',
        '114-1276134-9911401',
        '* The Well-Tempered City: What Modern Science',
        '  Paperback',
        '  Quantity: 1',
        '  15.19 USD',
        'Grand Total:',
        '16.15 USD',
      ].join('\n'),
      merchantSlug: 'amazon',
      merchantName: 'Amazon',
      fromAddress: '"Amazon.com" <auto-confirm@amazon.com>',
      receivedAt: new Date('2026-06-11T02:53:10Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.externalOrderNumber).toBe('114-1276134-9911401');
    expect(raw?.totalCents).toBe(1615);
    expect(raw?.taxCents).toBe(96);
    expect(raw?.lines).toHaveLength(1);
    expect(raw?.lines[0]?.name).toMatch(/Well-Tempered City/i);
    expect(raw?.lines[0]?.unitPriceCents).toBe(1519);
    expect(raw?.lines[0]?.categorySlug).toBe('books');
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
  });

  it('parses Amazon multi-item Ordered: confirmations into separate lines', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../../../fixtures/emails/amazon-multi-item-ordered.txt'),
      'utf8',
    );
    const subject = (fixture.split('\n')[0] ?? '').replace(/^Subject:\s*/i, '');
    const body = fixture.replace(/^Subject:.*\n\n?/, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      merchantSlug: 'amazon',
      merchantName: 'Amazon',
      fromAddress: '"Amazon.com" <auto-confirm@amazon.com>',
      receivedAt: new Date('2026-03-30T04:37:57Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.externalOrderNumber).toBe('114-9014714-4960229');
    expect(raw?.totalCents).toBe(4996);
    expect(raw?.taxCents).toBe(298);
    expect(raw?.lines).toHaveLength(2);
    expect(raw?.lines[0]?.name).toMatch(/Baseball Hat/i);
    expect(raw?.lines[0]?.unitPriceCents).toBe(2699);
    expect(raw?.lines[0]?.categorySlug).toBe('clothing');
    expect(raw?.lines[1]?.name).toMatch(/T Shirt/i);
    expect(raw?.lines[1]?.unitPriceCents).toBe(1999);
    expect(raw?.lines[1]?.categorySlug).toBe('clothing');
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
  });

  it('parses Shopify Order confirmed emails with store From + product × qty', () => {
    const fixture = readFileSync(
      resolve(__dirname, '../../../fixtures/emails/shopify-ms-betters-order.txt'),
      'utf8',
    );
    const subject = (fixture.match(/^Subject:\s*(.*)$/im)?.[1] ?? '').trim();
    const from = (fixture.match(/^From:\s*(.*)$/im)?.[1] ?? '').trim();
    const body = fixture.replace(/^Subject:.*\nFrom:.*\n\n?/i, '');
    const raw = heuristicExtractOrder({
      subject,
      text: body,
      fromAddress: from,
      receivedAt: new Date('2026-04-01T12:00:00Z'),
    });
    expect(raw).not.toBeNull();
    expect(raw?.merchantName).toMatch(/Ms Betters/i);
    expect(raw?.externalOrderNumber).toBe('5781');
    expect(raw?.totalCents).toBe(3999);
    expect(raw?.shippingCents).toBe(799);
    expect(raw?.lines).toHaveLength(1);
    expect(raw?.lines[0]?.name).toMatch(/Miraculous Foamer/i);
    expect(raw?.lines[0]?.variant).toMatch(/4 oz/i);
    expect(raw?.lines[0]?.unitPriceCents).toBe(3200);
    expect(raw?.lines[0]?.quantity).toBe(1);
    expect(raw?.lines[0]?.categorySlug).toBe('beauty');
    const applied = applyExtraction(raw);
    expect(applied.ok).toBe(true);
  });

  it('rejects extractions totals that do not reconcile', () => {
    const applied = applyExtraction({
      merchantSlug: 'amazon',
      orderDate: '2026-01-15',
      taxCents: 0,
      shippingCents: 0,
      discountCents: 0,
      totalCents: 99999,
      lines: [{ name: 'Widget', quantity: 1, unitPriceCents: 100 }],
    });
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.reason).toBe('reconcile');
  });
});
