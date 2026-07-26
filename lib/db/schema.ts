/**
 * Drizzle schema.
 *
 * The SQL migrations under supabase/migrations are the source of truth for the
 * database -- they carry the RLS policies, triggers and partial indexes that
 * Drizzle cannot express. This file mirrors them for typed queries.
 *
 * If you change one, change the other. `npm run db:check` diffs them.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Supabase's auth schema. Declared so foreign keys type-check; never written to
// from application code.
const authSchema = pgSchema('auth');

export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  rawUserMetaData: jsonb('raw_user_meta_data'),
  createdAt: timestamp('created_at', { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// enums
// ---------------------------------------------------------------------------
export const emailProvider = pgEnum('email_provider', ['gmail', 'outlook']);

export const emailAccountStatus = pgEnum('email_account_status', [
  'active',
  'needs_reauth',
  'disconnected',
  'error',
]);

export const messageClassification = pgEnum('message_classification', [
  'order_confirmation',
  'shipping',
  'delivery',
  'return',
  'cancellation',
  'not_relevant',
]);

export const parseStatus = pgEnum('parse_status', [
  'pending',
  'parsed',
  'failed',
  'skipped',
  'needs_review',
]);

export const orderSource = pgEnum('order_source', ['email', 'manual', 'receipt_photo']);

export const orderStatus = pgEnum('order_status', [
  'ordered',
  'shipped',
  'delivered',
  'partially_returned',
  'returned',
  'cancelled',
]);

export const shipmentStatus = pgEnum('shipment_status', [
  'pending',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
]);

export const returnStatus = pgEnum('return_status', [
  'initiated',
  'in_transit',
  'received',
  'refunded',
  'denied',
]);

export const inventoryStatus = pgEnum('inventory_status', [
  'owned',
  'returned',
  'disposed',
  'gifted',
  'sold',
  'lost',
]);

export const disposalMethod = pgEnum('disposal_method', [
  'donated',
  'trashed',
  'sold',
  'gifted',
  'recycled',
]);

export const savedItemStatus = pgEnum('saved_item_status', ['saved', 'purchased', 'dismissed']);

export const syncJobType = pgEnum('sync_job_type', ['backfill', 'incremental']);

export const syncJobStatus = pgEnum('sync_job_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

// Shared column bundles
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------
export const profiles = pgTable('profiles', {
  id: uuid('id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  /** Period boundaries are computed in this zone, never the server's. */
  timezone: text('timezone').notNull().default('UTC'),
  /** Phase 2. Present now so Phase 2 needs no migration. */
  monthlyBudgetCents: integer('monthly_budget_cents'),
  defaultCooldownDays: integer('default_cooldown_days').notNull().default(7),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  ...timestamps,
});

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** null means a system category, shared and read-only. No is_system flag. */
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color'),
    ...timestamps,
  },
  (t) => [index('categories_parent_idx').on(t.parentId)],
);

export const merchants = pgTable(
  'merchants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Sender domains that map here, e.g. ["nike.com","order.nike.com"]. */
    domains: text('domains').array().notNull().default([]),
    logoUrl: text('logo_url'),
    defaultReturnWindowDays: integer('default_return_window_days'),
    createdByUserId: uuid('created_by_user_id').references(() => authUsers.id, {
      onDelete: 'cascade',
    }),
    isGlobal: boolean('is_global').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('merchants_domains_idx').using('gin', t.domains)],
);

export const emailAccounts = pgTable(
  'email_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    provider: emailProvider('provider').notNull(),
    emailAddress: text('email_address').notNull(),
    /** Ciphertext only -- see lib/crypto/tokens.ts. */
    oauthRefreshToken: text('oauth_refresh_token'),
    oauthAccessToken: text('oauth_access_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    /** Gmail historyId or Graph delta token. */
    syncCursor: text('sync_cursor'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    status: emailAccountStatus('status').notNull().default('active'),
    backfillWindowDays: integer('backfill_window_days').notNull().default(180),
    backfillCompletedAt: timestamp('backfill_completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('email_accounts_user_idx').on(t.userId)],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    source: orderSource('source').notNull().default('email'),
    externalOrderNumber: text('external_order_number'),
    orderDate: date('order_date').notNull(),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    shippingCents: integer('shipping_cents').notNull().default(0),
    discountCents: integer('discount_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /**
     * DERIVED. Written only by the sync_order_state() Postgres function.
     * Never assign this from application code -- see lib/status.ts.
     */
    status: orderStatus('status').notNull().default('ordered'),
    /** DERIVED alongside status. Null when the merchant has no seeded window. */
    returnDeadline: date('return_deadline'),
    needsReview: boolean('needs_review').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('orders_user_date_idx').on(t.userId, t.orderDate),
    index('orders_user_status_idx').on(t.userId, t.status),
    index('orders_merchant_idx').on(t.merchantId),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** The classifier's output. Never user-edited -- edits go to inventory. */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    variant: text('variant'),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull().default(0),
    imageUrl: text('image_url'),
    productUrl: text('product_url'),
    fingerprintStrict: text('fingerprint_strict'),
    fingerprintLoose: text('fingerprint_loose'),
    ...timestamps,
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_fp_strict_idx').on(t.fingerprintStrict),
    index('order_items_fp_loose_idx').on(t.fingerprintLoose),
  ],
);

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id').references(() => orderItems.id, { onDelete: 'cascade' }),
    /** User-editable, and the value every UI surface reads. */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    variant: text('variant'),
    imageUrl: text('image_url'),
    acquiredAt: date('acquired_at'),
    /** Landed cost -- see allocateLandedCost in lib/money.ts. */
    costCents: integer('cost_cents').notNull().default(0),
    status: inventoryStatus('status').notNull().default('owned'),
    disposedAt: date('disposed_at'),
    disposalMethod: disposalMethod('disposal_method'),
    disposalProceedsCents: integer('disposal_proceeds_cents'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('inventory_user_status_idx').on(t.userId, t.status),
    index('inventory_order_item_idx').on(t.orderItemId),
    index('inventory_category_idx').on(t.categoryId),
  ],
);

/** Phase 2. Empty until then, but present so cost-per-use needs no migration. */
export const itemUses = pgTable(
  'item_uses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    usedOn: date('used_on').notNull(),
    ...timestamps,
  },
  (t) => [index('item_uses_item_idx').on(t.inventoryItemId)],
);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    carrier: text('carrier'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    status: shipmentStatus('status').notNull().default('pending'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('shipments_order_idx').on(t.orderId)],
);

export const returns = pgTable(
  'returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    inventoryItemId: uuid('inventory_item_id').references(() => inventoryItems.id, {
      onDelete: 'set null',
    }),
    initiatedAt: date('initiated_at').notNull(),
    /** What was actually refunded, not the sticker price. */
    refundAmountCents: integer('refund_amount_cents').notNull().default(0),
    status: returnStatus('status').notNull().default('initiated'),
    refundedAt: date('refunded_at'),
    sourceMessageId: uuid('source_message_id'),
    ...timestamps,
  },
  (t) => [
    index('returns_user_idx').on(t.userId),
    index('returns_order_idx').on(t.orderId),
    index('returns_item_idx').on(t.inventoryItemId),
  ],
);

export const savedItems = pgTable(
  'saved_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'set null' }),
    url: text('url').notNull(),
    title: text('title'),
    imageUrl: text('image_url'),
    priceCents: integer('price_cents'),
    currency: text('currency').notNull().default('USD'),
    /** Loose on purpose: save from one store, buy from another, still matches. */
    fingerprintLoose: text('fingerprint_loose'),
    status: savedItemStatus('status').notNull().default('saved'),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    notes: text('notes'),
    purchasedOrderItemId: uuid('purchased_order_item_id').references(() => orderItems.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    index('saved_items_user_status_idx').on(t.userId, t.status),
    index('saved_items_fp_loose_idx').on(t.fingerprintLoose),
  ],
);

/** Phase 2. */
export const priceChecks = pgTable(
  'price_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    savedItemId: uuid('saved_item_id')
      .notNull()
      .references(() => savedItems.id, { onDelete: 'cascade' }),
    priceCents: integer('price_cents'),
    inStock: boolean('in_stock'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index('price_checks_item_idx').on(t.savedItemId, t.checkedAt)],
);

/**
 * Audit and dedupe log for email. The body is NEVER stored.
 *
 * For classification 'not_relevant', subject/fromAddress/threadId must stay
 * null -- a database CHECK enforces it, so this isn't left to every write path
 * remembering.
 */
export const ingestedMessages = pgTable(
  'ingested_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emailAccountId: uuid('email_account_id')
      .notNull()
      .references(() => emailAccounts.id, { onDelete: 'cascade' }),
    providerMessageId: text('provider_message_id').notNull(),
    threadId: text('thread_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    fromAddress: text('from_address'),
    subject: text('subject'),
    classification: messageClassification('classification'),
    parseStatus: parseStatus('parse_status').notNull().default('pending'),
    /** Weak secondary signal. Never gate on this alone -- arithmetic is the gate. */
    parseConfidence: numeric('parse_confidence', { precision: 3, scale: 2 }),
    parserVersion: text('parser_version'),
    resultingOrderId: uuid('resulting_order_id').references(() => orders.id, {
      onDelete: 'set null',
    }),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ingested_messages_provider_key').on(t.emailAccountId, t.providerMessageId),
    index('ingested_messages_account_idx').on(t.emailAccountId),
    index('ingested_messages_order_idx').on(t.resultingOrderId),
  ],
);

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    emailAccountId: uuid('email_account_id')
      .notNull()
      .references(() => emailAccounts.id, { onDelete: 'cascade' }),
    type: syncJobType('type').notNull(),
    status: syncJobStatus('status').notNull().default('queued'),
    messagesSeen: integer('messages_seen').notNull().default(0),
    messagesClassified: integer('messages_classified').notNull().default(0),
    messagesParsed: integer('messages_parsed').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('sync_jobs_account_idx').on(t.emailAccountId, t.createdAt)],
);
