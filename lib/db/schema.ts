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
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
// uniqueIndex already imported above
import { sql } from 'drizzle-orm';

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

export const orderSource = pgEnum('order_source', [
  'email',
  'manual',
  'receipt_photo',
  'photo',
]);

export const bookCondition = pgEnum('book_condition', [
  'new',
  'like_new',
  'very_good',
  'good',
  'acceptable',
]);

export const bookResolutionSource = pgEnum('book_resolution_source', [
  'google_books',
  'open_library',
  'isbndb',
  'manual',
]);

export const gameResolutionSource = pgEnum('game_resolution_source', [
  'bgg',
  'wikidata',
  'upc_lookup',
  'manual',
]);

export const gameCondition = pgEnum('game_condition', [
  'new_sealed',
  'like_new',
  'complete_used',
  'incomplete',
  'damaged',
]);

export const bookPriceQuoteSource = pgEnum('book_price_quote_source', [
  'buyback',
  'ebay_browse',
  'sold_comps',
  /** Web-search estimate — the stand-in until eBay API access lands. */
  'web_estimate',
]);

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
  'consumed',
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
  /** Preferred currency for dashboard / list display (orders keep native). */
  displayCurrency: text('display_currency').notNull().default('USD'),
  /** Phase 2. Present now so Phase 2 needs no migration. */
  monthlyBudgetCents: integer('monthly_budget_cents'),
  defaultCooldownDays: integer('default_cooldown_days').notNull().default(7),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  /** Sell assistant: only surface items that net at least this many cents. */
  sellNetFloorCents: integer('sell_net_floor_cents'),
  /** Flat per-listing effort penalty used in net_self math. */
  sellEffortCents: integer('sell_effort_cents').notNull().default(500),
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

/**
 * User-owned mute list for import. Survives Reset & re-scan.
 * Either merchant_id or match_domain (or both) identifies the sender.
 */
export const merchantExclusions = pgTable(
  'merchant_exclusions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id').references(() => merchants.id, { onDelete: 'cascade' }),
    matchDomain: text('match_domain'),
    ...timestamps,
  },
  (t) => [
    index('merchant_exclusions_user_idx').on(t.userId),
    uniqueIndex('merchant_exclusions_user_merchant_uidx')
      .on(t.userId, t.merchantId)
      .where(sql`merchant_id is not null`),
    uniqueIndex('merchant_exclusions_user_domain_uidx')
      .on(t.userId, t.matchDomain)
      .where(sql`match_domain is not null`),
  ],
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
    /** Durable mailbox cursor: Gmail historyId or Graph delta token. */
    syncCursor: text('sync_cursor'),
    /** Transient pagination token for an in-flight backfill or incremental sync. */
    syncPageToken: text('sync_page_token'),
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
     * Soft-delete. Null means active. Hidden from orders/inventory lists;
     * restore from Settings → Deleted orders.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
    /** Human-readable title for list UIs; raw name stays for search/audit. */
    shortName: text('short_name'),
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
    /** Short title for list UIs; raw name stays for search/audit. */
    shortName: text('short_name'),
    variant: text('variant'),
    imageUrl: text('image_url'),
    /**
     * Tokens for smart search (synonyms like makeup→lipstick).
     * Filled at ingest; see lib/inventory/search-tags.ts.
     */
    searchTags: text('search_tags').array().notNull().default([]),
    /** Denormalized so the already-own check works for manual items too. */
    fingerprintLoose: text('fingerprint_loose'),
    acquiredAt: date('acquired_at'),
    /** Landed cost -- see allocateLandedCost in lib/money.ts. */
    costCents: integer('cost_cents').notNull().default(0),
    status: inventoryStatus('status').notNull().default('owned'),
    disposedAt: date('disposed_at'),
    disposalMethod: disposalMethod('disposal_method'),
    disposalProceedsCents: integer('disposal_proceeds_cents'),
    notes: text('notes'),
    /**
     * Free-form structured details, keyed by the template field's key.
     * See lib/inventory/attributes.ts; identity still lives in the detail
     * tables (book_details, game_details), which is what pricing reads.
     */
    attributes: jsonb('attributes').notNull().default({}),
    /** User intent: show on the returns tracker “to return” filter. */
    returnPlanned: boolean('return_planned').notNull().default(false),
    /** User intent: show on the sell page, whatever a catalog does or does not know. */
    forSale: boolean('for_sale').notNull().default(false),
    /**
     * A sell price you typed yourself, for an item with no detail row to hold
     * one. Read only when book_details and game_details are both absent, so an
     * item never has two manual prices to choose between.
     */
    manualExpectedPriceCents: integer('manual_expected_price_cents'),
    /**
     * Provenance for this physical unit. For order-backed rows this mirrors
     * orders.source; for standalone owned items (scanned books, etc.) it is
     * set directly (manual / photo / receipt_photo).
     */
    source: orderSource('source').notNull().default('manual'),
    ...timestamps,
  },
  (t) => [
    index('inventory_user_status_idx').on(t.userId, t.status),
    index('inventory_order_item_idx').on(t.orderItemId),
    index('inventory_category_idx').on(t.categoryId),
    index('inventory_fp_loose_idx').on(t.fingerprintLoose),
  ],
);

/**
 * Which structured details items in a category should carry, per user.
 * A row exists only once the user has edited the template; before that the
 * built-in defaults in lib/inventory/attributes.ts apply.
 */
export const categoryAttributeTemplates = pgTable(
  'category_attribute_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** [{ key, label, type }] — see AttributeField. */
    fields: jsonb('fields').notNull().default([]),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('category_attribute_templates_user_category_idx').on(t.userId, t.categoryId),
  ],
);

/**
 * Book-specific identity and enrichment, 1:1 with inventory_items.
 * Category-agnostic core stays on inventory_items; media/clothing get their
 * own detail tables later.
 */
export const bookDetails = pgTable(
  'book_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    isbn13: text('isbn_13'),
    isbn10: text('isbn_10'),
    authors: text('authors').array().notNull().default([]),
    edition: text('edition'),
    publisher: text('publisher'),
    publishedYear: integer('published_year'),
    weightGrams: integer('weight_grams'),
    condition: bookCondition('condition'),
    resolutionSource: bookResolutionSource('resolution_source').notNull().default('manual'),
    matchConfidence: numeric('match_confidence', { precision: 4, scale: 3 }),
    needsConfirmation: boolean('needs_confirmation').notNull().default(false),
    /** Runner-up editions the resolver saw, shown next to the confirm prompt. */
    candidates: jsonb('candidates').notNull().default([]),
    /** Plain-English reason the edition needs a human look. */
    confirmationReason: text('confirmation_reason'),
    /** True when order-email ingestion created this row, not a capture flow. */
    autoImported: boolean('auto_imported').notNull().default(false),
    /** A price the user looked up themselves; beats every provider. */
    manualExpectedPriceCents: integer('manual_expected_price_cents'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('book_details_inventory_item_id_key').on(t.inventoryItemId),
    index('book_details_isbn_13_idx').on(t.isbn13),
  ],
);

/**
 * Board-game identity, 1:1 with inventory_items. Mirrors book_details: BGG id
 * plays the role of the ISBN, and an uncertain match waits for a confirm.
 */
export const gameDetails = pgTable(
  'game_details',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    bggId: integer('bgg_id'),
    /** Wikidata item, when BGG was unreachable and Wikidata answered. */
    wikidataId: text('wikidata_id'),
    /** EAN-13 form of the scanned barcode. */
    barcode: text('barcode'),
    yearPublished: integer('year_published'),
    publisher: text('publisher'),
    minPlayers: integer('min_players'),
    maxPlayers: integer('max_players'),
    playingTimeMinutes: integer('playing_time_minutes'),
    condition: gameCondition('condition'),
    resolutionSource: gameResolutionSource('resolution_source').notNull().default('manual'),
    matchConfidence: numeric('match_confidence', { precision: 4, scale: 3 }),
    needsConfirmation: boolean('needs_confirmation').notNull().default(false),
    candidates: jsonb('candidates').notNull().default([]),
    confirmationReason: text('confirmation_reason'),
    autoImported: boolean('auto_imported').notNull().default(false),
    /** A price you typed yourself; beats every lookup. */
    manualExpectedPriceCents: integer('manual_expected_price_cents'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('game_details_inventory_item_id_key').on(t.inventoryItemId),
    index('game_details_bgg_id_idx').on(t.bggId),
    index('game_details_wikidata_id_idx').on(t.wikidataId),
    index('game_details_barcode_idx').on(t.barcode),
  ],
);

export const feedbackKind = pgEnum('feedback_kind', ['bug', 'feature']);

export const feedbackStatus = pgEnum('feedback_status', [
  'open',
  'planned',
  'in_progress',
  'blocked',
  'done',
  'declined',
]);

/**
 * Bugs and feature requests captured from the header button, with the page
 * the user was on when they wrote it.
 */
export const feedbackItems = pgTable(
  'feedback_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    kind: feedbackKind('kind').notNull(),
    body: text('body').notNull(),
    pagePath: text('page_path'),
    userAgent: text('user_agent'),
    status: feedbackStatus('status').notNull().default('open'),
    /** 1 next, 2 normal, 3 someday. Bugs outrank features at equal priority. */
    priority: smallint('priority').notNull().default(2),
    /** What was done, or what is being waited on. Set whenever status leaves open. */
    resolutionNote: text('resolution_note'),
    /** The commit that closed it. */
    commitSha: text('commit_sha'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('feedback_user_created_idx').on(t.userId, t.createdAt),
    index('feedback_status_idx').on(t.status),
    index('feedback_queue_idx').on(t.userId, t.status, t.priority, t.createdAt),
  ],
);

/** Shared ISBN quote cache (buyback / Browse / later sold comps). */
export const bookPriceQuotes = pgTable(
  'book_price_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    isbn13: text('isbn_13').notNull(),
    source: bookPriceQuoteSource('source').notNull(),
    quotedCents: integer('quoted_cents'),
    shippingCents: integer('shipping_cents').notNull().default(0),
    vendorName: text('vendor_name'),
    vendorUrl: text('vendor_url'),
    payload: jsonb('payload'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('book_price_quotes_isbn_source_key').on(t.isbn13, t.source),
    index('book_price_quotes_fetched_at_idx').on(t.fetchedAt),
  ],
);

/**
 * The same cache for games, keyed by BGG id because they have no ISBN.
 * Separate table rather than a widened book_price_quotes — see 0030.
 */
export const gamePriceQuotes = pgTable(
  'game_price_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bggId: integer('bgg_id').notNull(),
    source: bookPriceQuoteSource('source').notNull(),
    quotedCents: integer('quoted_cents'),
    shippingCents: integer('shipping_cents').notNull().default(0),
    vendorName: text('vendor_name'),
    vendorUrl: text('vendor_url'),
    payload: jsonb('payload'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('game_price_quotes_bgg_source_key').on(t.bggId, t.source),
    index('game_price_quotes_fetched_at_idx').on(t.fetchedAt),
  ],
);

/**
 * Quotes for an item that is neither a book nor a board game — keyed by the
 * item, because a title search is all the identity it has.
 *
 * Not shared the way the two caches above are: "what a grey desk lamp goes for"
 * is only an answer to the person who named it that, so this is user-scoped
 * through inventory_items. See 0045.
 */
export const itemPriceQuotes = pgTable(
  'item_price_quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    source: bookPriceQuoteSource('source').notNull(),
    quotedCents: integer('quoted_cents'),
    shippingCents: integer('shipping_cents').notNull().default(0),
    vendorName: text('vendor_name'),
    vendorUrl: text('vendor_url'),
    payload: jsonb('payload'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('item_price_quotes_item_source_key').on(t.inventoryItemId, t.source),
    index('item_price_quotes_fetched_at_idx').on(t.fetchedAt),
  ],
);

/**
 * Per-user override of a merchant's return window.
 * Global merchants are read-only; this is how users edit policies.
 * Presence of a row wins over merchants.default_return_window_days
 * (including when return_window_days is null = no window for this user).
 */
export const merchantReturnPolicies = pgTable(
  'merchant_return_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    returnWindowDays: integer('return_window_days'),
    ...timestamps,
  },
  (t) => [
    index('merchant_return_policies_user_idx').on(t.userId),
    uniqueIndex('merchant_return_policies_user_merchant_uidx').on(t.userId, t.merchantId),
  ],
);

/** User-owned trackers (not taxonomy). Items can belong to many lists. */
export const itemLists = pgTable(
  'item_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color'),
    ...timestamps,
  },
  (t) => [
    index('item_lists_user_idx').on(t.userId),
    uniqueIndex('item_lists_user_slug_key').on(t.userId, t.slug),
  ],
);

export const inventoryItemLists = pgTable(
  'inventory_item_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    listId: uuid('list_id')
      .notNull()
      .references(() => itemLists.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    index('inventory_item_lists_item_idx').on(t.inventoryItemId),
    index('inventory_item_lists_list_idx').on(t.listId),
    uniqueIndex('inventory_item_lists_item_list_uidx').on(t.inventoryItemId, t.listId),
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
    /** listing | reading | linking | done — see lib/core/inbox/progress.ts. */
    phase: text('phase'),
    messagesSeen: integer('messages_seen').notNull().default(0),
    messagesClassified: integer('messages_classified').notNull().default(0),
    messagesParsed: integer('messages_parsed').notNull().default(0),
    /** What the list step found, where that is a whole run's worth. */
    messagesTotal: integer('messages_total'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('sync_jobs_account_idx').on(t.emailAccountId, t.createdAt)],
);

/** User-facing labels on order lines (shoes) — separate from categories (clothing). */
export const itemTags = pgTable(
  'item_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('item_tags_user_slug_key').on(t.userId, t.slug),
    index('item_tags_user_idx').on(t.userId),
  ],
);

export const orderItemTags = pgTable(
  'order_item_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => itemTags.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('order_item_tags_unique').on(t.orderItemId, t.tagId),
    index('order_item_tags_item_idx').on(t.orderItemId),
    index('order_item_tags_tag_idx').on(t.tagId),
  ],
);

/** Historical FX quotes (Frankfurter). Shared reference data, not user-scoped. */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rateDate: date('rate_date').notNull(),
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    rate: numeric('rate').notNull(),
    source: text('source').notNull().default('frankfurter'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fx_rates_pair_date_key').on(t.rateDate, t.baseCurrency, t.quoteCurrency),
    index('fx_rates_lookup_idx').on(t.baseCurrency, t.quoteCurrency, t.rateDate),
  ],
);

// ---------------------------------------------------------------------------
// Item families -- see supabase/migrations/0041_item_families.sql
// ---------------------------------------------------------------------------

export const itemFamilyRole = pgEnum('item_family_role', [
  'base',
  'expansion',
  'edition',
  'accessory',
  'member',
]);

export const itemFamilySource = pgEnum('item_family_source', [
  'manual',
  'bgg_link',
  'title_cluster',
]);

/** A named group of things that belong together: Monopoly, Catan, Ticket to Ride. */
export const itemFamilies = pgTable(
  'item_families',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('item_families_user_slug_key').on(t.userId, t.slug),
    index('item_families_user_idx').on(t.userId),
  ],
);

/**
 * One family per item, and three states: suggested, confirmed, rejected.
 * The partial unique indexes that enforce that are in the migration -- Drizzle
 * cannot express a `where` on a unique index, so this mirrors the columns only.
 */
export const inventoryItemFamilies = pgTable(
  'inventory_item_families',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => itemFamilies.id, { onDelete: 'cascade' }),
    role: itemFamilyRole('role').notNull().default('member'),
    source: itemFamilySource('source').notNull().default('manual'),
    position: integer('position').notNull().default(0),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('inventory_item_families_family_idx').on(t.familyId)],
);

/** The join 0018 gave order lines, now on inventory where scanned items live. */
export const inventoryItemTags = pgTable(
  'inventory_item_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inventoryItemId: uuid('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => itemTags.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('inventory_item_tags_unique').on(t.inventoryItemId, t.tagId),
    index('inventory_item_tags_item_idx').on(t.inventoryItemId),
    index('inventory_item_tags_tag_idx').on(t.tagId),
  ],
);

// ---------------------------------------------------------------------------
// Share links -- see supabase/migrations/0040_share_links.sql
// ---------------------------------------------------------------------------

export const shareLinkKind = pgEnum('share_link_kind', ['disposition']);

export const shareLinkStatus = pgEnum('share_link_status', ['active', 'archived']);

export const shareSubjectType = pgEnum('share_subject_type', ['inventory_item']);

export const shareLinkEventKind = pgEnum('share_link_event_kind', [
  'viewed',
  'responded',
  'item_added',
  'item_removed',
  'regrouped',
  'token_issued',
  'token_revoked',
]);

export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    kind: shareLinkKind('kind').notNull().default('disposition'),
    title: text('title').notNull(),
    intro: text('intro'),
    status: shareLinkStatus('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [index('share_links_user_idx').on(t.userId)],
);

/**
 * The credential is a row, not a column: a second reader is a second row, and
 * revoking one leaves the answers and the other links alone.
 */
export const shareLinkTokens = pgTable(
  'share_link_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    label: text('label').notNull().default('Anyone with the link'),
    canRespond: boolean('can_respond').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('share_link_tokens_token_key').on(t.token),
    index('share_link_tokens_share_idx').on(t.shareLinkId),
  ],
);

/**
 * One row per real unit. `groupKey` and `familyKey` are denormalized from the
 * grouping layer so share_respond() can count a quantity instead of trusting
 * one from the caller.
 */
export const shareLinkItems = pgTable(
  'share_link_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    subjectType: shareSubjectType('subject_type').notNull().default('inventory_item'),
    // Polymorphic, so no foreign key. A prune trigger on inventory_items keeps
    // it honest -- see the migration.
    subjectId: uuid('subject_id').notNull(),
    groupKey: text('group_key').notNull(),
    familyKey: text('family_key'),
    position: integer('position').notNull().default(0),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('share_link_items_subject_key').on(t.shareLinkId, t.subjectType, t.subjectId),
    index('share_link_items_share_group_idx').on(t.shareLinkId, t.groupKey),
    index('share_link_items_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

/** Keyed by group, not by item: which two of three identical boxes is not a question. */
export const shareLinkResponses = pgTable(
  'share_link_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    groupKey: text('group_key').notNull(),
    keepQty: integer('keep_qty').notNull().default(0),
    sellQty: integer('sell_qty').notNull().default(0),
    giveawayQty: integer('giveaway_qty').notNull().default(0),
    note: text('note'),
    answeredByToken: uuid('answered_by_token').references(() => shareLinkTokens.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('share_link_responses_group_key').on(t.shareLinkId, t.groupKey),
    index('share_link_responses_share_idx').on(t.shareLinkId),
    index('share_link_responses_token_idx').on(t.answeredByToken),
  ],
);

/** Append-only. No updatedAt and no update grant: an editable audit trail is not one. */
export const shareLinkEvents = pgTable(
  'share_link_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id').references(() => shareLinkTokens.id, { onDelete: 'set null' }),
    kind: shareLinkEventKind('kind').notNull(),
    groupKey: text('group_key'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('share_link_events_share_created_idx').on(t.shareLinkId, t.createdAt),
    index('share_link_events_token_created_idx').on(t.tokenId, t.createdAt),
  ],
);
