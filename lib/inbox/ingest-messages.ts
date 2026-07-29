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
import { resolveOrderMerchant } from '@/lib/merchants/resolve-order-merchant';

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

  const extraction = await extractOrderFromEmail({
    subject: message.subject ?? '',
    text: message.text,
    html: message.html,
    merchantSlug: classified.merchant?.slug,
    merchantName:
      classified.merchant?.name ?? displayNameFromAddress(message.fromAddress),
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
    merchantSlug: resolvedMerchant?.slug ?? classified.merchant?.slug ?? null,
    extraction: extraction.result.order,
    categoryIdsBySlug,
    needsReview: extraction.source === 'heuristic',
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

  const { error: invError } = await supabase.from('inventory_items').insert(
    bundle.inventoryItems.map((item) => ({
      id: item.id,
      user_id: item.userId,
      order_item_id: item.orderItemId,
      category_id: item.categoryId,
      name: item.name,
      variant: item.variant,
      fingerprint_loose: item.fingerprintLoose,
      acquired_at: item.acquiredAt,
      cost_cents: item.costCents,
      image_url: item.imageUrl,
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

  for (const messageId of messageIds) {
    counters.messagesSeen += 1;

    const { data: existing } = await supabase
      .from('ingested_messages')
      .select('id, classification, parse_status')
      .eq('email_account_id', accountId)
      .eq('provider_message_id', messageId)
      .maybeSingle();

    const retryLifecycle =
      existing &&
      LIFECYCLE.has(existing.classification as MessageClassification) &&
      (existing.parse_status === 'skipped' || existing.parse_status === 'needs_review');

    if (existing && !retryLifecycle) {
      counters.skipped += 1;
      continue;
    }

    try {
      const message = await gmailProvider.getMessage(accessToken, messageId);
      const classified = classifyMessage({
        fromAddress: message.fromAddress,
        subject: message.subject,
        merchants,
      });
      counters.messagesClassified += 1;

      if (classified.classification === 'not_relevant') {
        // CHECK ingested_not_relevant_is_bare_ck: no subject/from/thread for not_relevant.
        if (!existing) {
          await supabase.from('ingested_messages').insert({
            email_account_id: accountId,
            provider_message_id: message.id,
            thread_id: null,
            received_at: message.internalDate?.toISOString() ?? null,
            from_address: null,
            subject: null,
            classification: 'not_relevant',
            parse_status: 'skipped',
            parser_version: PARSER_VERSION,
          });
        }
        counters.skipped += 1;
        continue;
      }

      if (LIFECYCLE.has(classified.classification)) {
        deferredLifecycle.push({
          message,
          classified,
          ledgerId: existing?.id ?? null,
        });
        continue;
      }

      if (classified.classification !== 'order_confirmation') {
        if (!existing) {
          await supabase.from('ingested_messages').insert({
            email_account_id: accountId,
            provider_message_id: message.id,
            thread_id: message.threadId,
            received_at: message.internalDate?.toISOString() ?? null,
            from_address: message.fromAddress,
            subject: message.subject,
            classification: classified.classification,
            parse_status: 'skipped',
            parser_version: PARSER_VERSION,
          });
        }
        counters.skipped += 1;
        continue;
      }

      await handleOrderConfirmation(supabase, {
        userId,
        accountId,
        message,
        classified,
        exclusions,
        categoryIdsBySlug,
        categoryOptions,
        counters,
      });
    } catch (err) {
      console.error('sync message failed', messageId, err);
      counters.errors += 1;
      if (!existing) {
        const { error: ledgerError } = await supabase.from('ingested_messages').insert({
          email_account_id: accountId,
          provider_message_id: messageId,
          classification: 'order_confirmation',
          parse_status: 'failed',
          parser_version: PARSER_VERSION,
          error: err instanceof Error ? err.message.slice(0, 500) : 'Sync failed',
        });
        if (ledgerError && !/duplicate|unique/i.test(ledgerError.message)) {
          console.error('sync ledger insert failed', messageId, ledgerError.message);
        }
      }
    }
  }

  // Confirmations in this batch land first; then shipping/delivery/return/cancel.
  for (const item of deferredLifecycle) {
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
  }
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
