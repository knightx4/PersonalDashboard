import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyMessage, type MerchantDomainHit } from '@/lib/email/extract/classify';
import { extractOrderFromEmail } from '@/lib/email/extract/extract-order';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import { extractLifecycleFromEmail } from '@/lib/email/extract/lifecycle';
import { PARSER_VERSION, type MessageClassification } from '@/lib/email/extract/schema';
import { gmailProvider } from '@/lib/email/providers/gmail';
import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';
import { attachBookDetailsForInventory } from '@/lib/books/attach-order-books';
import { buildEmailOrder } from '@/lib/orders/create-email-order';
import { applyLifecycleToOrder } from '@/lib/orders/apply-lifecycle';
import { findOrderForLifecycleEmail } from '@/lib/orders/find-for-lifecycle';
import {
  isExcludedSender,
  type MerchantExclusionRow,
} from '@/lib/inbox/merchant-exclusions';
import { isPlatformMerchantSlug } from '@/lib/merchants/platform';
import { resolveOrderMerchant } from '@/lib/merchants/resolve-order-merchant';
import { ensureItemTags, linkOrderItemTags } from '@/lib/tags/ensure';
import { mapPool } from '@/lib/async/map-pool';

/** Optional key; Google Books answers without one at a lower quota. */
function googleBooksApiKey(): string | null {
  return process.env.GOOGLE_BOOKS_API_KEY ?? null;
}

/** Parallel Gmail metadata fetches — well under user rate quota. */
/** Parallel full-body + extract for confirmations / lifecycle. */
const EXTRACT_CONCURRENCY = 2;

export type IngestCounters = {
  messagesSeen: number;
  messagesClassified: number;
  messagesParsed: number;
  ordersCreated: number;
  skipped: number;
  errors: number;
};

const LIFECYCLE: ReadonlySet<MessageClassification> = new Set([
  'shipping',
  'delivery',
  'return',
  'cancellation',
]);

type FetchedMessage = Awaited<ReturnType<typeof gmailProvider.getMessage>>;

type ClassifiedMessage = {
  message: FetchedMessage;
  classified: ReturnType<typeof classifyMessage>;
  /** The core message this is a verdict about. Always known: core saw it first. */
  coreId: string;
};

async function userTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return data?.timezone ?? 'UTC';
}

async function upsertLifecycleLedger(
  supabase: SupabaseClient,
  opts: {
    coreId: string;
    message: FetchedMessage;
    classification: MessageClassification;
    parseStatus: 'pending' | 'parsed' | 'needs_review' | 'failed' | 'skipped';
    parserVersion?: string;
    resultingOrderId?: string | null;
    error?: string | null;
    confidence?: number | null;
  },
): Promise<string | null> {
  // The envelope is core's now; this row is only what commerce concluded.
  // Keyed by the core message id, so a verdict and its message cannot drift
  // apart and re-running the sync overwrites rather than duplicates.
  const row = {
    id: opts.coreId,
    classification: opts.classification,
    parse_status: opts.parseStatus,
    parser_version: opts.parserVersion ?? PARSER_VERSION,
    resulting_order_id: opts.resultingOrderId ?? null,
    error: opts.error ?? null,
    parse_confidence: opts.confidence ?? null,
  };

  const { error } = await supabase.from('ingested_messages').upsert(row);
  if (error) {
    console.error('lifecycle ledger upsert failed', opts.message.id, error.message);
    return null;
  }
  return opts.coreId;
}

async function handleLifecycleMessage(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    item: ClassifiedMessage;
    counters: IngestCounters;
    timezone: string;
  },
): Promise<void> {
  const { userId, item, counters, timezone } = opts;
  const { message, classified, coreId } = item;
  const classification = classified.classification;

  const extraction = extractLifecycleFromEmail({
    classification,
    subject: message.subject ?? '',
    text: message.text,
    html: message.html,
    receivedAt: message.internalDate,
  });

  if (!extraction) {
    await upsertLifecycleLedger(supabase, {
      coreId,
      message,
      classification,
      parseStatus: 'needs_review',
      error: 'Could not extract lifecycle fields',
    });
    counters.errors += 1;
    return;
  }

  const order = await findOrderForLifecycleEmail(supabase, {
    userId,
    merchantId: classified.merchant?.id ?? null,
    externalOrderNumber: extraction.externalOrderNumber,
    threadId: message.threadId,
  });

  if (!order) {
    await upsertLifecycleLedger(supabase, {
      coreId,
      message,
      classification,
      parseStatus: 'needs_review',
      error: 'No matching order yet',
      confidence: extraction.confidence,
    });
    // Not a hard error — confirmation may land in a later batch.
    counters.skipped += 1;
    return;
  }

  // Write the verdict first so returns can reference source_message_id.
  const sourceId = await upsertLifecycleLedger(supabase, {
    coreId,
    message,
    classification,
    parseStatus: 'pending',
    resultingOrderId: order.id,
    confidence: extraction.confidence,
  });

  if (!sourceId) {
    counters.errors += 1;
    return;
  }

  const applied = await applyLifecycleToOrder(supabase, {
    userId,
    order,
    classification,
    extraction,
    sourceMessageId: sourceId,
    receivedAt: message.internalDate,
    timezone,
  });

  if (!applied.ok) {
    await upsertLifecycleLedger(supabase, {
      coreId,
      message,
      classification,
      parseStatus: 'needs_review',
      resultingOrderId: order.id,
      error: applied.error,
      confidence: extraction.confidence,
    });
    counters.errors += 1;
    return;
  }

  await upsertLifecycleLedger(supabase, {
    coreId,
    message,
    classification,
    parseStatus: 'parsed',
    resultingOrderId: order.id,
    confidence: extraction.confidence,
    error: null,
  });
  counters.messagesParsed += 1;
}

async function handleOrderConfirmation(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    coreId: string;
    message: FetchedMessage;
    classified: ReturnType<typeof classifyMessage>;
    exclusions: MerchantExclusionRow[];
    categoryIdsBySlug: Map<string, string>;
    categoryOptions?: Array<{ slug: string; name: string }>;
    counters: IngestCounters;
    /** Whose mailbox this arrived in; null when nobody owns it yet. */
    personId?: string | null;
  },
): Promise<void> {
  const {
    userId,
    coreId,
    message,
    classified,
    exclusions,
    categoryIdsBySlug,
    categoryOptions,
    counters,
    personId = null,
  } = opts;

  if (
    isExcludedSender(exclusions, {
      merchantId: classified.merchant?.id ?? null,
      fromAddress: message.fromAddress,
    })
  ) {
    await supabase.from('ingested_messages').upsert({
      id: coreId,
      classification: 'order_confirmation',
      parse_status: 'skipped',
      parser_version: PARSER_VERSION,
      error: 'Excluded by user merchant mute',
    });
    counters.skipped += 1;
    return;
  }

  const platformSender = isPlatformMerchantSlug(classified.merchant?.slug);
  const extraction = await extractOrderFromEmail({
    subject: message.subject ?? '',
    text: message.text,
    html: message.html,
    merchantSlug: platformSender ? null : classified.merchant?.slug,
    merchantName: platformSender
      ? displayNameFromAddress(message.fromAddress)
      : (classified.merchant?.name ?? displayNameFromAddress(message.fromAddress)),
    fromAddress: message.fromAddress,
    receivedAt: message.internalDate,
    categoryOptions,
  });

  if (!extraction.result.ok) {
    await supabase.from('ingested_messages').upsert({
      id: coreId,
      classification: 'order_confirmation',
      parse_status: 'needs_review',
      parser_version: extraction.parserVersion,
      error: extraction.result.reason,
    });
    counters.errors += 1;
    return;
  }

  const resolvedMerchant = await resolveOrderMerchant(supabase, {
    userId,
    classified: classified.merchant,
    fromAddress: message.fromAddress,
    extractedName: extraction.result.order.merchantName,
  });

  const bundle = buildEmailOrder({
    userId,
    merchantId: resolvedMerchant?.id ?? null,
    merchantSlug:
      resolvedMerchant?.slug ??
      (platformSender ? null : classified.merchant?.slug) ??
      null,
    extraction: extraction.result.order,
    categoryIdsBySlug,
    needsReview: extraction.source === 'heuristic' && !extraction.trusted,
  });

  const { error: orderError } = await supabase.from('orders').insert({
    id: bundle.order.id,
    user_id: bundle.order.userId,
    // Whose mailbox this arrived in. The whole people feature rests on this
    // one assignment: nothing downstream asks the user to label an order.
    person_id: personId,
    merchant_id: bundle.order.merchantId,
    source: bundle.order.source,
    external_order_number: bundle.order.externalOrderNumber,
    order_date: bundle.order.orderDate,
    subtotal_cents: bundle.order.subtotalCents,
    tax_cents: bundle.order.taxCents,
    shipping_cents: bundle.order.shippingCents,
    discount_cents: bundle.order.discountCents,
    total_cents: bundle.order.totalCents,
    currency: bundle.order.currency,
    needs_review: bundle.order.needsReview,
  });

  if (orderError) {
    // Same order # from another inbox (or a re-sync) — link this message to the
    // existing order instead of failing the ledger row.
    const isUnique =
      /duplicate|unique|orders_external_number/i.test(orderError.message) ||
      orderError.code === '23505';
    if (isUnique && bundle.order.externalOrderNumber) {
      let existingQuery = supabase
        .from('orders')
        .select('id')
        .eq('user_id', userId)
        .eq('external_order_number', bundle.order.externalOrderNumber)
        .is('deleted_at', null)
        .limit(1);
      if (bundle.order.merchantId) {
        existingQuery = existingQuery.eq('merchant_id', bundle.order.merchantId);
      }
      const { data: existingRows } = await existingQuery;
      const existingOrder = existingRows?.[0];
      if (existingOrder) {
        await supabase.from('ingested_messages').upsert({
          id: coreId,
          classification: 'order_confirmation',
          parse_status: 'parsed',
          parse_confidence: extraction.result.order.confidence ?? null,
          parser_version: extraction.parserVersion,
          resulting_order_id: existingOrder.id,
          error: 'Linked to existing order (already imported)',
        });
        counters.messagesParsed += 1;
        return;
      }
    }

    await supabase.from('ingested_messages').upsert({
      id: coreId,
      classification: 'order_confirmation',
      parse_status: 'failed',
      parser_version: extraction.parserVersion,
      error: orderError.message,
    });
    counters.errors += 1;
    return;
  }

  const { error: itemsError } = await supabase.from('order_items').insert(
    bundle.orderItems.map((item) => ({
      id: item.id,
      order_id: item.orderId,
      category_id: item.categoryId,
      name: item.name,
      short_name: item.shortName,
      variant: item.variant,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      fingerprint_strict: item.fingerprintStrict,
      fingerprint_loose: item.fingerprintLoose,
      product_url: item.productUrl,
      image_url: item.imageUrl,
    })),
  );

  if (itemsError) {
    await supabase.from('orders').delete().eq('id', bundle.order.id);
    counters.errors += 1;
    return;
  }

  for (const item of bundle.orderItems) {
    if (item.tags.length === 0) continue;
    try {
      const resolved = await ensureItemTags(supabase, userId, item.tags);
      await linkOrderItemTags(
        supabase,
        item.id,
        resolved.map((tag) => tag.id),
      );
    } catch (error) {
      console.error('linkOrderItemTags failed', error);
    }
  }

  const { error: invError } = await supabase.from('inventory_items').insert(
    bundle.inventoryItems.map((item) => ({
      id: item.id,
      user_id: item.userId,
      order_item_id: item.orderItemId,
      category_id: item.categoryId,
      name: item.name,
      short_name: item.shortName,
      variant: item.variant,
      fingerprint_loose: item.fingerprintLoose,
      // Denormalised, like name and fingerprint above and for the same reason:
      // the inventory list filters by person, and a hand-added item has no
      // order to reach one through.
      person_id: personId,
      acquired_at: item.acquiredAt,
      cost_cents: item.costCents,
      image_url: item.imageUrl,
      search_tags: item.searchTags,
      source: item.source,
    })),
  );

  if (invError) {
    await supabase.from('orders').delete().eq('id', bundle.order.id);
    counters.errors += 1;
    return;
  }

  // Books get their ISBN identity here so the sell assistant can route them
  // without the user re-entering anything. Soft-failure: the order stands
  // even when a metadata provider is down.
  try {
    const slugByCategoryId = new Map(
      [...categoryIdsBySlug.entries()].map(([slug, id]) => [id, slug] as const),
    );
    const orderItemById = new Map(bundle.orderItems.map((item) => [item.id, item]));
    await attachBookDetailsForInventory(supabase, {
      userId,
      autoImported: true,
      googleBooksApiKey: googleBooksApiKey(),
      isbndbApiKey: process.env.ISBNDB_API_KEY ?? null,
      lines: bundle.inventoryItems.map((unit) => {
        const orderItem = orderItemById.get(unit.orderItemId);
        return {
          inventoryItemId: unit.id,
          name: unit.name,
          variant: unit.variant,
          productUrl: orderItem?.productUrl ?? null,
          categorySlug: unit.categoryId
            ? (slugByCategoryId.get(unit.categoryId) ?? null)
            : null,
          imageUrl: unit.imageUrl,
          searchTags: unit.searchTags,
        };
      }),
    });
  } catch (error) {
    console.error('book auto-import failed', bundle.order.id, error);
  }

  await supabase.from('ingested_messages').upsert({
    id: coreId,
    classification: 'order_confirmation',
    parse_status: 'parsed',
    parse_confidence: extraction.result.order.confidence ?? null,
    parser_version: extraction.parserVersion,
    resulting_order_id: bundle.order.id,
  });

  counters.messagesParsed += 1;
  counters.ordersCreated += 1;
}

/**
 * Classify + extract + persist one Gmail message id. Shared by backfill and
 * incremental sync. Skips ids already fully handled in ingested_messages.
 * Lifecycle mail (shipping/delivery/return/cancel) that was previously skipped
 * or needs_review is retried so status can catch up once the order exists.
 */
export async function linkEnvelopes(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accessToken: string;
    envelopes: MessageEnvelope[];
    merchants: MerchantDomainHit[];
    exclusions: MerchantExclusionRow[];
    categoryIdsBySlug: Map<string, string>;
    categoryOptions?: Array<{ slug: string; name: string }>;
    counters: IngestCounters;
    /**
     * Whose mailbox this batch came from.
     *
     * Resolved once per sync rather than per message: it is a property of the
     * mailbox, and every order out of this batch inherits it.
     */
    personId?: string | null;
  },
): Promise<void> {
  const {
    userId,
    accessToken,
    envelopes,
    merchants,
    exclusions,
    categoryIdsBySlug,
    categoryOptions,
    personId = null,
    counters,
  } = opts;

  const timezone = await userTimezone(supabase, userId);
  const deferredLifecycle: ClassifiedMessage[] = [];

  if (envelopes.length === 0) return;

  // One lookup for the whole page instead of N round-trips. Keyed by core id
  // now rather than provider id: the envelope already resolved that.
  const { data: existingRows } = await supabase
    .from('ingested_messages')
    .select('id, classification, parse_status')
    .in(
      'id',
      envelopes.map((e) => e.id),
    );

  const existingByCoreId = new Map(
    (existingRows ?? []).map((row) => [row.id as string, row]),
  );

  type WorkItem = {
    envelope: MessageEnvelope;
    existing: {
      id: string;
      classification: string;
      parse_status: string;
    } | null;
  };

  const work: WorkItem[] = envelopes.map((envelope) => {
    const row = existingByCoreId.get(envelope.id);
    return {
      envelope,
      existing: row
        ? {
            id: row.id as string,
            classification: row.classification as string,
            parse_status: row.parse_status as string,
          }
        : null,
    };
  });

  // Pass 1: classify from the envelope. This used to be a Gmail metadata call
  // per message; core has already made it, once, for both workspaces. Tier A is
  // pure computation over the sender and subject we were handed, so the whole
  // pass is now free and the API budget goes entirely on bodies.
  type NeedsBody = {
    envelope: MessageEnvelope;
    existing: WorkItem['existing'];
    classified: ReturnType<typeof classifyMessage>;
  };

  const needsBody: NeedsBody[] = [];

  for (const item of work) {
    counters.messagesSeen += 1;

    const retryLifecycle =
      item.existing &&
      LIFECYCLE.has(item.existing.classification as MessageClassification) &&
      (item.existing.parse_status === 'skipped' ||
        item.existing.parse_status === 'needs_review');

    if (item.existing && !retryLifecycle) {
      counters.skipped += 1;
      continue;
    }

    const classified = classifyMessage({
      fromAddress: item.envelope.fromAddress,
      subject: item.envelope.subject,
      merchants,
    });
    counters.messagesClassified += 1;

    // Every message gets a verdict recorded, including the ones this workspace
    // wants nothing to do with. Saying "not mine" out loud is what lets core
    // decide the envelope is unclaimed by everyone and scrub it -- silence
    // would keep it alive forever.
    if (
      classified.classification === 'not_relevant' ||
      (classified.classification !== 'order_confirmation' &&
        !LIFECYCLE.has(classified.classification))
    ) {
      if (!item.existing) {
        await supabase.from('ingested_messages').upsert({
          id: item.envelope.id,
          classification: classified.classification,
          parse_status: 'skipped',
          parser_version: PARSER_VERSION,
        });
      }
      counters.skipped += 1;
      continue;
    }

    needsBody.push({
      envelope: item.envelope,
      existing: item.existing,
      classified,
    });
  }

  // Pass 2: full body + extract/lifecycle with a small concurrency cap.
  await mapPool(needsBody, EXTRACT_CONCURRENCY, async (item) => {
    try {
      const message = await gmailProvider.getMessage(
        accessToken,
        item.envelope.providerMessageId,
        { format: 'full' },
      );
      // Fall back to the envelope core stored if the full payload omits a header.
      if (!message.fromAddress) message.fromAddress = item.envelope.fromAddress;
      if (!message.subject) message.subject = item.envelope.subject;
      if (!message.internalDate) {
        message.internalDate = item.envelope.receivedAt ? new Date(item.envelope.receivedAt) : null;
      }
      if (!message.threadId) message.threadId = item.envelope.threadId;

      if (LIFECYCLE.has(item.classified.classification)) {
        deferredLifecycle.push({
          message,
          classified: item.classified,
          coreId: item.envelope.id,
        });
        return;
      }

      await handleOrderConfirmation(supabase, {
        userId,
        coreId: item.envelope.id,
        message,
        classified: item.classified,
        exclusions,
        categoryIdsBySlug,
        categoryOptions,
        counters,
        personId,
      });
    } catch (err) {
      console.error('sync message failed', item.envelope.providerMessageId, err);
      counters.errors += 1;
      const { error: ledgerError } = await supabase.from('ingested_messages').upsert({
        id: item.envelope.id,
        classification: 'order_confirmation',
        parse_status: 'failed',
        parser_version: PARSER_VERSION,
        error: err instanceof Error ? err.message.slice(0, 500) : 'Sync failed',
      });
      if (ledgerError) {
        console.error('verdict upsert failed', item.envelope.providerMessageId, ledgerError.message);
      }
    }
  });

  // Confirmations in this batch land first; then shipping/delivery/return/cancel.
  await mapPool(deferredLifecycle, EXTRACT_CONCURRENCY, async (item) => {
    try {
      await handleLifecycleMessage(supabase, {
        userId,
        item,
        counters,
        timezone,
      });
    } catch (err) {
      console.error('lifecycle message failed', item.message.id, err);
      counters.errors += 1;
    }
  });
}

/**
 * Re-fetch previously skipped / needs_review lifecycle emails so they can
 * attach once the matching order confirmation exists.
 */
export async function reprocessPendingLifecycleMessages(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    accessToken: string;
    merchants: MerchantDomainHit[];
    exclusions: MerchantExclusionRow[];
    categoryIdsBySlug: Map<string, string>;
    categoryOptions?: Array<{ slug: string; name: string }>;
    counters: IngestCounters;
    limit?: number;
  },
): Promise<void> {
  const limit = opts.limit ?? 25;
  // Through the view: the verdict is ours but received_at, the sender and the
  // subject are core's, and this needs both halves to rebuild an envelope.
  const { data: pending } = await supabase
    .from('inbox_messages')
    .select('id, provider_message_id, thread_id, received_at, from_address, reply_to_address, subject')
    .eq('email_account_id', opts.accountId)
    .in('classification', ['shipping', 'delivery', 'return', 'cancellation'])
    .in('parse_status', ['skipped', 'needs_review'])
    .order('received_at', { ascending: true })
    .limit(limit);

  const envelopes: MessageEnvelope[] = (pending ?? []).map((row) => ({
    id: row.id as string,
    providerMessageId: row.provider_message_id as string,
    threadId: (row.thread_id as string | null) ?? null,
    receivedAt: (row.received_at as string | null) ?? null,
    fromAddress: (row.from_address as string | null) ?? null,
    replyToAddress: (row.reply_to_address as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    isNew: false,
  }));
  if (envelopes.length === 0) return;

  await linkEnvelopes(supabase, {
    userId: opts.userId,
    accessToken: opts.accessToken,
    envelopes,
    merchants: opts.merchants,
    exclusions: opts.exclusions,
    categoryIdsBySlug: opts.categoryIdsBySlug,
    categoryOptions: opts.categoryOptions,
    counters: opts.counters,
  });
}
