import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { DashboardView } from '@/app/shopping/dashboard/dashboard-view';
import { AddBooksView } from '@/app/shopping/inventory/add/books/books-view';
import { AddGamesView } from '@/app/shopping/inventory/add/games/games-view';
import { OrderDetailView, type OrderDetail } from '@/app/shopping/orders/[id]/order-detail-view';
import { NewOrderView } from '@/app/shopping/orders/new/new-order-view';
import { ReceiptView } from '@/app/shopping/orders/receipt/receipt-view';
import { ReturnsPageView } from '@/app/shopping/returns/returns-view';
import { SavedItemView } from '@/app/shopping/saved/[id]/saved-item-view';
import { SavedQueueView, type SavedQueueItem } from '@/app/shopping/saved/saved-view';
import { ShoppingSettingsView } from '@/app/shopping/settings/settings-view';
import { ShareDetailView, type ShareGroup } from '@/app/shopping/share/[id]/share-detail-view';
import { FamiliesView } from '@/app/shopping/share/families/families-view';
import { SharesView, type ShareListRow } from '@/app/shopping/share/shares-view';
import type { DashboardData } from '@/lib/dashboard/load';
import type { Person } from '@/lib/people/load';
import type { ReturnsTrackerData, ReturnsTrackerRow } from '@/lib/returns/types';
import type { MerchantPolicyRow } from '@/lib/returns/policies';
import type { PendingSuggestion } from '@/lib/share/families-store';

/**
 * The Shopping pages that had no picture (plan #1604), each drawn by the view
 * its page hands its reads to, from fixtures shaped like the live rows.
 */

const TODAY = '2026-10-07';

/**
 * A product photo stand-in: a flat SVG drawn inline, so the shot has a
 * picture where most saved links have one and needs no network.
 */
function productImage(ground: string, shape: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="${ground}"/>${shape}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const casseroleImage = productImage(
  '#e9e4dc',
  '<ellipse cx="200" cy="200" rx="130" ry="40" fill="#3a3a3a"/><rect x="70" y="120" width="260" height="80" rx="20" fill="#c2410c"/><ellipse cx="200" cy="120" rx="130" ry="30" fill="#9a3412"/><rect x="185" y="80" width="30" height="20" rx="6" fill="#a8a29e"/>',
);

const kindleImage = productImage(
  '#dfe6ec',
  '<rect x="130" y="40" width="140" height="220" rx="14" fill="#1f2937"/><rect x="145" y="60" width="110" height="170" fill="#f5f5f4"/><rect x="160" y="80" width="80" height="6" fill="#a8a29e"/><rect x="160" y="96" width="70" height="6" fill="#a8a29e"/><rect x="160" y="112" width="76" height="6" fill="#a8a29e"/>',
);

const people: Person[] = [
  { id: 'p1', name: 'Alex', colour: 'brand', isDefault: true },
  { id: 'p2', name: 'Samantha Okonkwo-Henderson', colour: 'pink', isDefault: false },
];

// ---- Dashboard -------------------------------------------------------------

const dashboard: DashboardData = {
  timezone: 'Europe/London',
  today: TODAY,
  range: 'this_month',
  period: { start: '2026-10-01', end: '2026-10-31' },
  previousPeriod: { start: '2026-09-01', end: '2026-09-30' },
  orderCount: 14,
  currency: 'USD',
  current: { grossCents: 84_217, refundedCents: 6_499, netCents: 77_718 },
  previous: { grossCents: 112_040, refundedCents: 0, netCents: 112_040 },
  categories: [
    { categoryId: 'c1', name: 'Clothing', color: '#6A82FB', cents: 31_250 },
    { categoryId: 'c2', name: 'Electronics', color: '#4A9DD4', cents: 24_999 },
    { categoryId: 'c3', name: 'Home', color: '#FF8A4C', cents: 14_420 },
    { categoryId: 'c4', name: 'Beauty', color: '#FF6B9D', cents: 7_049 },
    { categoryId: null, name: 'Uncategorized', color: '#9CA3AF', cents: 6_499 },
  ],
  merchants: [
    { merchantId: 'm1', name: 'Amazon', cents: 38_112 },
    { merchantId: 'm2', name: 'Uniqlo', cents: 21_400 },
    { merchantId: 'm3', name: 'The Conran Shop and Kitchen Supplies', cents: 14_420 },
    { merchantId: 'm4', name: 'Boots', cents: 7_049 },
    { merchantId: null, name: 'Unknown merchant', cents: 3_236 },
  ],
  merchantTrend: new Map([
    ['m1', [22_000, 31_000, 18_500, 40_200, 35_000, 29_900, 41_000, 38_000, 27_500, 33_100, 36_400, 38_112]],
    ['m2', [0, 4_500, 12_000, 0, 9_900, 0, 0, 15_000, 6_000, 0, 18_000, 21_400]],
    ['m3', [0, 0, 0, 0, 0, 0, 52_000, 0, 0, 0, 0, 14_420]],
  ]),
  valueOwnedCents: 1_284_400,
  returnable: [
    {
      inventoryItemId: 'r1',
      name: 'Merino crew-neck jumper, navy, size M',
      orderId: 'o2',
      merchantName: 'Uniqlo',
      returnDeadline: '2026-10-10',
      daysLeft: 3,
      windowDays: 30,
    },
    {
      inventoryItemId: 'r2',
      name: 'Sony WH-1000XM6 wireless noise-cancelling headphones',
      orderId: 'o1',
      merchantName: 'Amazon',
      returnDeadline: '2026-11-02',
      daysLeft: 26,
      windowDays: 30,
    },
  ],
  byPerson: [
    { personId: 'p1', netCents: 52_118 },
    { personId: 'p2', netCents: 21_400 },
    { personId: null, netCents: 4_200 },
  ],
};

export function ShoppingDashboardSurface() {
  return <DashboardView range="this_month" personId={null} people={people} data={dashboard} />;
}

// ---- Add books and games ---------------------------------------------------

export function ShoppingAddBooksSurface() {
  return <AddBooksView mode="search" />;
}

export function ShoppingAddGamesSurface() {
  return <AddGamesView mode="photo" />;
}

// ---- One order -------------------------------------------------------------

const order: OrderDetail = {
  order: {
    id: '00000000-0000-4000-8000-000000001604',
    title: 'The Conran Shop and Kitchen Supplies',
    merchantName: 'The Conran Shop and Kitchen Supplies',
    order_date: '2026-09-28',
    status: 'delivered',
    source: 'email',
    external_order_number: 'CS-20260928-448812',
    return_deadline: '2026-10-28',
    needs_review: false,
    deleted: false,
    nativeCurrency: 'GBP',
    inboxAddress: 'alex.morgan.household@gmail.com',
    emailHref: 'https://mail.google.com/mail/u/0/#all/1',
  },
  totals: {
    subtotal: '$182.40 · £138.00',
    tax: '$0.00 · £0.00',
    shipping: '$7.93 · £6.00',
    discount: '$13.22 · £10.00',
    total: '$177.11 · £134.00',
  },
  shipments: [
    {
      id: 's1',
      status: 'delivered',
      carrier: 'DPD',
      tracking_number: '15501234567890',
      tracking_url: 'https://example.com/track/15501234567890',
      shipped_at: '2026-09-29T09:00:00Z',
      delivered_at: '2026-10-01T13:20:00Z',
      links: {
        shippingHref: 'https://mail.google.com/mail/u/0/#all/2',
        deliveryHref: 'https://mail.google.com/mail/u/0/#all/3',
      },
    },
  ],
  returns: [
    {
      id: 'rt1',
      status: 'refunded',
      initiated_at: '2026-10-02',
      refunded_at: '2026-10-05',
      refundLabel: '$39.66 · £30.00',
      emailHref: 'https://mail.google.com/mail/u/0/#all/4',
    },
  ],
  emails: [
    {
      id: 'e1',
      subject: 'Thank you for your order CS-20260928-448812 — here is everything you bought',
      classification: 'order_confirmation',
      received_at: '2026-09-28T18:02:00Z',
      href: 'https://mail.google.com/mail/u/0/#all/1',
    },
    {
      id: 'e2',
      subject: 'Your parcel is on its way',
      classification: 'shipping',
      received_at: '2026-09-29T09:05:00Z',
      href: 'https://mail.google.com/mail/u/0/#all/2',
    },
    {
      id: 'e3',
      subject: null,
      classification: 'delivery',
      received_at: '2026-10-01T13:25:00Z',
      href: 'https://mail.google.com/mail/u/0/#all/3',
    },
  ],
  items: [
    {
      id: 'oi1',
      name: 'Hand-thrown stoneware serving bowl with reactive glaze, large',
      variant: 'Oatmeal',
      quantity: 2,
      categoryName: 'Home',
      product_url: 'https://example.com/bowl',
      tags: [
        { id: 't1', name: 'kitchen' },
        { id: 't2', name: 'gifts' },
      ],
      unitLabel: '$59.49 · £45.00',
      lineLabel: '$118.98 · £90.00',
      units: [
        { id: 'u1', status: 'owned', costLabel: '$57.88 · £43.78' },
        { id: 'u2', status: 'returned', costLabel: '$57.88 · £43.78' },
      ],
    },
    {
      id: 'oi2',
      name: 'Linen tea towels, set of three',
      variant: null,
      quantity: 1,
      categoryName: null,
      product_url: null,
      tags: [],
      unitLabel: '$63.45 · £48.00',
      lineLabel: '$63.45 · £48.00',
      units: [{ id: 'u3', status: 'owned', costLabel: '$61.35 · £46.41' }],
    },
  ],
  thread: [
    {
      id: 'c1',
      author: 'me',
      body: 'One bowl arrived chipped, so it went back. The other is for Mum’s birthday.',
      createdAt: '2026-10-02T08:30:00Z',
    },
  ],
};

export function ShoppingOrderSurface() {
  return <OrderDetailView {...order} />;
}

// ---- Add an order and the receipt photo ------------------------------------

export function ShoppingOrderNewSurface() {
  return (
    <NewOrderView
      people={people}
      defaultPersonId="p1"
      merchants={[
        { id: 'm1', name: 'Amazon' },
        { id: 'm2', name: 'Uniqlo' },
        { id: 'm3', name: 'The Conran Shop and Kitchen Supplies' },
      ]}
      categories={[
        { id: 'c1', name: 'Clothing' },
        { id: 'c2', name: 'Electronics' },
        { id: 'c3', name: 'Home' },
      ]}
      defaultDate={TODAY}
      prefill={{
        merchantId: 'm2',
        merchantName: 'Uniqlo',
        orderDate: '2026-10-06',
        externalOrderNumber: 'UQ-77120934',
        currency: 'USD',
        lines: [
          {
            name: 'Merino crew-neck jumper',
            variant: 'Navy, M',
            quantity: '1',
            unitPrice: '49.90',
            categoryId: 'c1',
          },
          {
            name: 'Ultra Light Down packable jacket with a longer name than most',
            variant: 'Olive, L',
            quantity: '2',
            unitPrice: '79.90',
            categoryId: 'c1',
          },
        ],
        tax: '15.66',
        shipping: '',
        discount: '10.00',
      }}
      sourceMessageId="e9"
      readError={null}
    />
  );
}

/* The shopping layout hands every paid press its estimate; the gallery has no
 * layout, so the receipt read gets a typical figure here and its hint draws. */
export function ShoppingOrderReceiptSurface() {
  return (
    <PaidCostsProvider
      costs={{
        'app/shopping/orders/receipt/actions.ts#previewReceiptPhoto': {
          lowMicros: 6_000,
          medianMicros: 9_000,
          highMicros: 18_000,
          runs: 7,
          basis: 'measured',
          per: 'run',
        },
      }}
    >
      <ReceiptView />
    </PaidCostsProvider>
  );
}

// ---- Returns ---------------------------------------------------------------

function returnRow(
  over: Partial<ReturnsTrackerRow> & Pick<ReturnsTrackerRow, 'inventoryItemId' | 'name'>,
): ReturnsTrackerRow {
  return {
    variant: null,
    costCents: 4_990,
    orderId: 'o2',
    orderDate: '2026-09-10',
    externalOrderNumber: 'UQ-77120934',
    orderStatus: 'delivered',
    merchantId: 'm2',
    merchantName: 'Uniqlo',
    returnDeadline: '2026-10-10',
    daysLeft: 3,
    returnPlanned: false,
    returnWindowDays: 30,
    delivered: true,
    carrier: null,
    status: 'owned',
    returnId: null,
    refundedAt: null,
    ...over,
  };
}

const returnRows: ReturnsTrackerRow[] = [
  returnRow({
    inventoryItemId: 'ri1',
    name: 'Merino crew-neck jumper',
    variant: 'Navy, M',
    returnPlanned: true,
  }),
  returnRow({
    inventoryItemId: 'ri2',
    name: 'Sony WH-1000XM6 wireless noise-cancelling headphones with carry case',
    costCents: 39_999,
    orderId: 'o1',
    orderDate: '2026-10-01',
    externalOrderNumber: '114-3941689-8772232',
    merchantId: 'm1',
    merchantName: 'Amazon',
    returnDeadline: '2026-10-12',
    daysLeft: 5,
    orderStatus: 'shipped',
    delivered: false,
    carrier: 'UPS',
  }),
  returnRow({
    inventoryItemId: 'ri3',
    name: 'Hand-thrown stoneware serving bowl',
    variant: 'Oatmeal',
    costCents: 5_788,
    orderId: 'o3',
    merchantId: 'm3',
    merchantName: 'The Conran Shop and Kitchen Supplies',
    externalOrderNumber: 'CS-20260928-448812',
    returnDeadline: '2026-10-13',
    daysLeft: 6,
    returnWindowDays: 14,
  }),
];

const returnsData: ReturnsTrackerData = {
  timezone: 'Europe/London',
  today: TODAY,
  view: 'soon',
  dueSoonDays: 7,
  rows: returnRows,
  counts: { soon: 3, overdue: 1, marked: 1, all: 18, returned: 4 },
};

export function ShoppingReturnsSurface() {
  return (
    <ReturnsPageView
      data={returnsData}
      savings={[{ currency: 'USD', totalCents: 21_437, recent: [] }]}
      working={[]}
      view="soon"
      group="items"
      merchantFilter={undefined}
    />
  );
}

// ---- Saved -----------------------------------------------------------------

const savedItems: SavedQueueItem[] = [
  {
    id: 'sv1',
    title: 'Le Creuset signature round cast-iron casserole, 24 cm, in Volcanic with a stainless knob',
    image_url: casseroleImage,
    price_cents: 32_500,
    currency: 'USD',
    created_at: '2026-10-05T10:00:00Z',
    merchant: { name: 'John Lewis & Partners' },
  },
  {
    id: 'sv2',
    title: 'Kindle Paperwhite Signature Edition',
    image_url: kindleImage,
    price_cents: 18_999,
    currency: 'USD',
    created_at: '2026-10-02T10:00:00Z',
    merchant: { name: 'Amazon' },
  },
  {
    id: 'sv3',
    title: null,
    image_url: null,
    price_cents: null,
    currency: null,
    created_at: '2026-09-21T10:00:00Z',
    merchant: null,
  },
];

export function ShoppingSavedSurface() {
  return <SavedQueueView status="saved" items={savedItems} />;
}

export function ShoppingSavedItemSurface() {
  return (
    <SavedItemView
      item={{
        id: 'sv2',
        url: 'https://www.amazon.com/Kindle-Paperwhite-Signature-Edition-wireless/dp/B0CFP6F89F/ref=sr_1_1',
        title: 'Kindle Paperwhite Signature Edition',
        image_url: kindleImage,
        price_cents: 18_999,
        currency: 'USD',
        notes: 'Wait for the November sale; it dropped to $149 last year.',
        status: 'saved',
        merchant_id: 'm1',
        created_at: '2026-10-02T10:00:00Z',
      }}
      merchant={{ name: 'Amazon' }}
      ownedMatches={[
        {
          id: 'inv9',
          name: 'Kindle Paperwhite',
          variant: '11th generation, 16 GB',
          cost_cents: 13_999,
          acquired_at: '2022-11-25',
        },
      ]}
    />
  );
}

// ---- Settings --------------------------------------------------------------

const policies: MerchantPolicyRow[] = [
  {
    merchantId: 'm1',
    name: 'Amazon',
    seededDays: 30,
    overrideDays: null,
    hasOverride: false,
    effectiveDays: 30,
    onOrders: true,
    isGlobal: true,
  },
  {
    merchantId: 'm3',
    name: 'The Conran Shop and Kitchen Supplies',
    seededDays: null,
    overrideDays: 14,
    hasOverride: true,
    effectiveDays: 14,
    onOrders: true,
    isGlobal: false,
  },
];

export function ShoppingSettingsSurface() {
  return (
    <ShoppingSettingsView
      email="alex.morgan.household@gmail.com"
      settings={{ displayName: 'Alex Morgan', timezone: 'Europe/London', displayCurrency: 'USD' }}
      people={people}
      accounts={[
        {
          id: 'a1',
          email_address: 'alex.morgan.household@gmail.com',
          status: 'active',
          last_synced_at: '2026-10-07T06:00:00Z',
          backfill_completed_at: '2026-08-01T10:00:00Z',
          person_id: 'p1',
        },
        {
          id: 'a2',
          email_address: 'samantha.okonkwo.henderson.work@example-company.co.uk',
          status: 'needs_reauth',
          last_synced_at: '2026-09-20T06:00:00Z',
          backfill_completed_at: null,
          person_id: 'p2',
        },
      ]}
      bannerCode={undefined}
      latestJobs={{}}
      mutedMerchants={[
        { id: 'x1', match_domain: 'deals.groupon.com', merchants: { name: 'Groupon' } },
        { id: 'x2', match_domain: null, merchants: { name: 'Deliveroo' } },
      ]}
      deletedOrders={[
        {
          id: 'd1',
          order_date: '2026-08-14',
          total_cents: 1_299,
          currency: 'USD',
          external_order_number: '114-0000001-0000001',
          deleted_at: '2026-08-20T10:00:00Z',
          merchants: { name: 'Amazon' },
        },
      ]}
      categories={[
        { id: 'c1', name: 'Clothing', slug: 'clothing', color: '#6A82FB', user_id: null },
        { id: 'c2', name: 'Electronics', slug: 'electronics', color: '#4A9DD4', user_id: null },
        { id: 'c9', name: 'Board games', slug: 'board-games', color: '#FF8A4C', user_id: 'u1' },
      ]}
      itemTags={[
        { id: 't1', name: 'kitchen', slug: 'kitchen' },
        { id: 't2', name: 'gifts', slug: 'gifts' },
      ]}
      lists={[{ id: 'l1', name: 'Christmas presents to wrap', slug: 'christmas', color: null }]}
      returnPolicies={policies}
    />
  );
}

// ---- Shared forms ----------------------------------------------------------

const shareRows: ShareListRow[] = [
  {
    id: 'sh1',
    title: 'Board games from the loft, for the Henderson family to look through',
    status: 'active',
    share_link_items: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
    share_link_responses: [{ id: '1' }, { id: '2' }],
    share_link_tokens: [{ id: 'k1', revoked_at: null, last_seen_at: '2026-10-06T19:00:00Z' }],
  },
  {
    id: 'sh2',
    title: 'Baby clothes',
    status: 'active',
    share_link_items: [{ id: '1' }],
    share_link_responses: [],
    share_link_tokens: [{ id: 'k2', revoked_at: null, last_seen_at: null }],
  },
  {
    id: 'sh3',
    title: 'Books before the move',
    status: 'archived',
    share_link_items: [{ id: '1' }, { id: '2' }],
    share_link_responses: [{ id: '1' }, { id: '2' }],
    share_link_tokens: [{ id: 'k3', revoked_at: '2026-07-01T10:00:00Z', last_seen_at: null }],
  },
];

export function ShoppingSharesSurface() {
  return <SharesView rows={shareRows} />;
}

const shareGroups: ShareGroup[] = [
  {
    groupKey: 'ticket-to-ride',
    name: 'Ticket to Ride: Europe — 15th Anniversary Deluxe Edition',
    quantity: 1,
    imageUrl: null,
    unitPriceCents: 9_999,
    keepQty: 0,
    sellQty: 1,
    giveawayQty: 0,
    note: 'Ours has a torn box lid, but every piece is there.',
    answeredAt: '2026-10-06T19:05:00Z',
  },
  {
    groupKey: 'catan',
    name: 'Catan',
    quantity: 3,
    imageUrl: null,
    unitPriceCents: null,
    keepQty: 1,
    sellQty: 0,
    giveawayQty: 2,
    note: null,
    answeredAt: '2026-10-06T19:06:00Z',
  },
  {
    groupKey: 'wingspan',
    name: 'Wingspan',
    quantity: 1,
    imageUrl: null,
    unitPriceCents: 4_500,
    keepQty: 0,
    sellQty: 0,
    giveawayQty: 0,
    note: null,
    answeredAt: null,
  },
];

export function ShoppingShareSurface() {
  return (
    <ShareDetailView
      share={{ id: 'sh1', title: shareRows[0]!.title, status: 'active' }}
      groups={shareGroups}
      tokens={[
        {
          id: 'k1',
          token: 'q7Lm2xV9kPz4RtY8wB3n',
          label: 'Henderson family',
          revoked_at: null,
          last_seen_at: '2026-10-06T19:00:00Z',
        },
        {
          id: 'k0',
          token: 'aB1cD2eF3gH4iJ5kL6mN',
          label: 'First link',
          revoked_at: '2026-10-01T10:00:00Z',
          last_seen_at: null,
        },
      ]}
      events={[
        { id: 'ev1', kind: 'answer_saved', group_key: 'catan', created_at: '2026-10-06T19:06:00Z' },
        { id: 'ev2', kind: 'answer_saved', group_key: 'ticket-to-ride', created_at: '2026-10-06T19:05:00Z' },
        { id: 'ev3', kind: 'opened', group_key: null, created_at: '2026-10-06T19:00:00Z' },
      ]}
      origin="https://dash.example.com"
    />
  );
}

const families: PendingSuggestion[] = [
  {
    slug: 'ticket-to-ride',
    name: 'Ticket to Ride',
    members: [
      { inventoryItemId: 'g1', role: 'base', confidence: 0.95, name: 'Ticket to Ride' },
      { inventoryItemId: 'g2', role: 'expansion', confidence: 0.9, name: 'Ticket to Ride: Europa 1912' },
      {
        inventoryItemId: 'g3',
        role: 'edition',
        confidence: 0.7,
        name: 'Ticket to Ride: Europe — 15th Anniversary Deluxe Edition',
      },
    ],
  },
  {
    slug: 'wingspan',
    name: 'Wingspan',
    members: [
      { inventoryItemId: 'g4', role: 'base', confidence: 0.95, name: 'Wingspan' },
      { inventoryItemId: 'g5', role: 'accessory', confidence: 0.8, name: 'Wingspan neoprene playmat' },
    ],
  },
];

export function ShoppingShareFamiliesSurface() {
  return <FamiliesView suggestions={families} />;
}
