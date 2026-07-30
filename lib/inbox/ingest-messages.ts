import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyMessage, type MerchantDomainHit } from '@/lib/email/extract/classify';
import { extractOrderFromEmail } from '@/lib/email/extract/extract-order';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import { extractLifecycleFromEmail } from '@/lib/email/extract/lifecycle';
import { PARSER_VERSION, type MessageClassification } from '@/lib/email/extract/schema';
import { gmailProvider } from '@/lib/email/providers/gmail';
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

/** Parallel Gmail metadata fetches — well under user rate quota. */
const METADATA_CONCURRENCY = 5;
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
  /** Existing ledger row when reprocessing a skipped/needs_review lifecycle mail. */
  ledgerId: string | null;
};

async function userTimezone(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return data?.timezone ?? 'UTC';
}

async function upsertLifecycleLedger(
  supabase: SupabaseClient,
  opts: {
    ledgerId: string | null;
    accountId: string;
    message: FetchedMessage;
    classification: MessageClassification;
    parseStatus: 'pending' | 'parsed' | 'needs_review' | 'failed' | 'skipped';
    parserVersion?: string;
    resultingOrderId?: string | null;
    error?: string | null;
    confidence?: number | null;
  },
): Promise<string | null> {
  const row = {
    email_account_id: opts.accountId,
    provider_message_id: opts.message.id,
    thread_id: opts.message.threadId,
    received_at: opts.message.internalDate?.toISOString() ?? null,
    from_address: opts.message.fromAddress,
    subject: opts.message.subject,
    classification: opts.classification,
    parse_status: opts.parseStatus,
    parser_version: opts.parserVersion ?? PARSER_VERSION,
    resulting_order_id: opts.resultingOrderId ?? null,
    error: opts.error ?? null,
    parse_confidence: opts.confidence ?? null,
  };

  if (opts.ledgerId) {
    const { error } = await supabase.from('ingested_messages').update(row).eq('id', opts.ledgerId);
    if (error) {
      console.error('lifecycle ledger update failed', opts.message.id, error.message);
      return opts.ledgerId;
    }
    return opts.ledgerId;
  }

  const { data, error } = await supabase.from('ingested_messages').insert(row).select('id').single();
  if (error) {
    console.error('lifecycle ledger insert failed', opts.message.id, error.message);
    return null;
  }
  return data?.id ?? null;
}

async function handleLifecycleMessage(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    item: ClassifiedMessage;
    counters: IngestCounters;
    timezone: string;
  },
): Promise<void> {
  const { userId, accountId, item, counters, timezone } = opts;
  const { message, classified, ledgerId } = item;
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
      ledgerId,
      accountId,
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
      ledgerId,
      accountId,
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

  // Insert/update ledger first so returns can reference source_message_id.
  const sourceId = await upsertLifecycleLedger(supabase, {
    ledgerId,
    accountId,
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
      ledgerId: sourceId,
      accountId,
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
    ledgerId: sourceId,
    accountId,
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
    accountId: string;
    message: FetchedMessage;
    classified: ReturnType<typeof classifyMessage>;
    exclusions: MerchantExclusionRow[];
    categoryIdsBySlug: Map<string, string>;
    categoryOptions?: Array<{ slug: string; name: string }>;
    counters: IngestCounters;
  },
): Promise<void> {
  const {
    userId,
    accountId,
    message,
    classified,
    exclusions,
    categoryIdsBySlug,
    categoryOptions,
    counters,
  } = opts;

  if (
    isExcludedSender(exclusions, {
      merchantId: classified.merchant?.id ?? null,
      fromAddress: message.fromAddress,
    })
  ) {
    await supabase.from('ingested_messages').insert({
      email_account_id: accountId,
      provider_message_id: message.id,
      thread_id: message.threadId,
      received_at: message.internalDate?.toISOString() ?? null,
      from_address: message.fromAddress,
      subject: message.subject,
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
    await supabase.from('ingested_messages').insert({
      email_account_id: accountId,
      provider_message_id: message.id,
      thread_id: message.threadId,
      received_at: message.internalDate?.toISOString() ?? null,
      from_address: message.fromAddress,
      subject: message.subject,
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
        await supabase.from('ingested_messages').insert({
          email_account_id: accountId,
          provider_message_id: message.id,
          thread_id: message.threadId,
          received_at: message.internalDate?.toISOString() ?? null,
          from_address: message.fromAddress,
          subject: message.subject,
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

    await supabase.from('ingested_messages').insert({
      email_account_id: accountId,
      provider_message_id: message.id,
      thread_id: message.threadId,
      received_at: message.internalDate?.toISOString() ?? null,
      from_address: message.fromAddress,
      subject: message.subject,
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
      acquired_at: item.acquiredAt,
      cost_cents: item.costCents,
      image_url: item.imageUrl,
      search_tags: item.searchTags,
    })),
  );

  if (invError) {
    await supabase.from('orders').delete().eq('id', bundle.order.id);
    counters.errors += 1;
    return;
  }

  await supabase.from('ingested_messages').insert({
    email_account_id: accountId,
    provider_message_id: message.id,
    thread_id: message.threadId,
    received_at: message.internalDate?.toISOString() ?? null,
    from_address: message.fromAddress,
    subject: message.subject,
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
export async function ingestGmailMessageIds(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    accessToken: string;
    messageIds: string[];
    merchants: MerchantDomainHit[];
    exclusions: MerchantExclusionRow[];
    categoryIdsBySlug: Map<string, string>;
    categoryOptions?: Array<{ slug: string; name: string }>;
    counters: IngestCounters;
  },
): Promise<void> {
  const {
    userId,
    accountId,
    accessToken,
    messageIds,
    merchants,
    exclusions,
    categoryIdsBySlug,
    categoryOptions,
    counters,
  } = opts;

  const timezone = await userTimezone(supabase, userId);
  const deferredLifecycle: ClassifiedMessage[] = [];

  if (messageIds.length === 0) return;

  // One ledger lookup for the whole page instead of N round-trips.
  const { data: existingRows } = await supabase
    .from('ingested_messages')
    .select('id, provider_message_id, classification, parse_status')
    .eq('email_account_id', accountId)
    .in('provider_message_id', messageIds);

  const existingByProviderId = new Map(
    (existingRows ?? []).map((row) => [row.provider_message_id as string, row]),
  );

  type WorkItem = {
    messageId: string;
    existing: {
      id: string;
      classification: string;
      parse_status: string;
    } | null;
  };

  const work: WorkItem[] = messageIds.map((messageId) => {
    const row = existingByProviderId.get(messageId);
    return {
      messageId,
      existing: row
        ? {
            id: row.id as string,
            classification: row.classification as string,
            parse_status: row.parse_status as string,
          }
        : null,
    };
  });

  // Pass 1: metadata-only classify (cheap). Full MIME only when needed.
  type NeedsBody = {
    messageId: string;
    existing: WorkItem['existing'];
    meta: FetchedMessage;
    classified: ReturnType<typeof classifyMessage>;
  };

  const needsBody: NeedsBody[] = [];

  await mapPool(work, METADATA_CONCURRENCY, async (item) => {
    counters.messagesSeen += 1;

    const retryLifecycle =
      item.existing &&
      LIFECYCLE.has(item.existing.classification as MessageClassification) &&
      (item.existing.parse_status === 'skipped' ||
        item.existing.parse_status === 'needs_review');

    if (item.existing && !retryLifecycle) {
      counters.skipped += 1;
      return;
    }

    try {
      const meta = await gmailProvider.getMessage(accessToken, item.messageId, {
        format: 'metadata',
      });
      const classified = classifyMessage({
        fromAddress: meta.fromAddress,
        subject: meta.subject,
        merchants,
      });
      counters.messagesClassified += 1;

      if (classified.classification === 'not_relevant') {
        // CHECK ingested_not_relevant_is_bare_ck: no subject/from/thread for not_relevant.
        if (!item.existing) {
          await supabase.from('ingested_messages').insert({
            email_account_id: accountId,
            provider_message_id: meta.id,
            thread_id: null,
            received_at: meta.internalDate?.toISOString() ?? null,
            from_address: null,
            subject: null,
            classification: 'not_relevant',
            parse_status: 'skipped',
            parser_version: PARSER_VERSION,
          });
        }
        counters.skipped += 1;
        return;
      }

      if (
        classified.classification !== 'order_confirmation' &&
        !LIFECYCLE.has(classified.classification)
      ) {
        if (!item.existing) {
          await supabase.from('ingested_messages').insert({
            email_account_id: accountId,
            provider_message_id: meta.id,
            thread_id: meta.threadId,
            received_at: meta.internalDate?.toISOString() ?? null,
            from_address: meta.fromAddress,
            subject: meta.subject,
            classification: classified.classification,
            parse_status: 'skipped',
            parser_version: PARSER_VERSION,
          });
        }
        counters.skipped += 1;
        return;
      }

      needsBody.push({
        messageId: item.messageId,
        existing: item.existing,
        meta,
        classified,
      });
    } catch (err) {
      console.error('sync message metadata failed', item.messageId, err);
      counters.errors += 1;
      if (!item.existing) {
        const { error: ledgerError } = await supabase.from('ingested_messages').insert({
          email_account_id: accountId,
          provider_message_id: item.messageId,
          classification: 'order_confirmation',
          parse_status: 'failed',
          parser_version: PARSER_VERSION,
          error: err instanceof Error ? err.message.slice(0, 500) : 'Sync failed',
        });
        if (ledgerError && !/duplicate|unique/i.test(ledgerError.message)) {
          console.error('sync ledger insert failed', item.messageId, ledgerError.message);
        }
      }
    }
  });

  // Pass 2: full body + extract/lifecycle with a small concurrency cap.
  await mapPool(needsBody, EXTRACT_CONCURRENCY, async (item) => {
    try {
      const message = await gmailProvider.getMessage(accessToken, item.messageId, {
        format: 'full',
      });
      // Keep headers from metadata if full payload somehow omits them.
      if (!message.fromAddress) message.fromAddress = item.meta.fromAddress;
      if (!message.subject) message.subject = item.meta.subject;
      if (!message.internalDate) message.internalDate = item.meta.internalDate;
      if (!message.threadId) message.threadId = item.meta.threadId;

      if (LIFECYCLE.has(item.classified.classification)) {
        deferredLifecycle.push({
          message,
          classified: item.classified,
          ledgerId: item.existing?.id ?? null,
        });
        return;
      }

      await handleOrderConfirmation(supabase, {
        userId,
        accountId,
        message,
        classified: item.classified,
        exclusions,
        categoryIdsBySlug,
        categoryOptions,
        counters,
      });
    } catch (err) {
      console.error('sync message failed', item.messageId, err);
      counters.errors += 1;
      if (!item.existing) {
        const { error: ledgerError } = await supabase.from('ingested_messages').insert({
          email_account_id: accountId,
          provider_message_id: item.messageId,
          classification: 'order_confirmation',
          parse_status: 'failed',
          parser_version: PARSER_VERSION,
          error: err instanceof Error ? err.message.slice(0, 500) : 'Sync failed',
        });
        if (ledgerError && !/duplicate|unique/i.test(ledgerError.message)) {
          console.error('sync ledger insert failed', item.messageId, ledgerError.message);
        }
      }
    }
  });

  // Confirmations in this batch land first; then shipping/delivery/return/cancel.
  await mapPool(deferredLifecycle, EXTRACT_CONCURRENCY, async (item) => {
    try {
      await handleLifecycleMessage(supabase, {
        userId,
        accountId,
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
  const { data: pending } = await supabase
    .from('ingested_messages')
    .select('provider_message_id')
    .eq('email_account_id', opts.accountId)
    .in('classification', ['shipping', 'delivery', 'return', 'cancellation'])
    .in('parse_status', ['skipped', 'needs_review'])
    .order('received_at', { ascending: true })
    .limit(limit);

  const ids = (pending ?? []).map((row) => row.provider_message_id as string);
  if (ids.length === 0) return;

  await ingestGmailMessageIds(supabase, {
    userId: opts.userId,
    accountId: opts.accountId,
    accessToken: opts.accessToken,
    messageIds: ids,
    merchants: opts.merchants,
    exclusions: opts.exclusions,
    categoryIdsBySlug: opts.categoryIdsBySlug,
    categoryOptions: opts.categoryOptions,
    counters: opts.counters,
  });
}
