import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyMessage, type MerchantDomainHit } from '@/lib/email/extract/classify';
import { extractOrderFromEmail } from '@/lib/email/extract/extract-order';
import { PARSER_VERSION } from '@/lib/email/extract/schema';
import { gmailProvider } from '@/lib/email/providers/gmail';
import { buildEmailOrder } from '@/lib/orders/create-email-order';
import {
  isExcludedSender,
  type MerchantExclusionRow,
} from '@/lib/inbox/merchant-exclusions';

export type IngestCounters = {
  messagesSeen: number;
  messagesClassified: number;
  messagesParsed: number;
  ordersCreated: number;
  skipped: number;
  errors: number;
};

/**
 * Classify + extract + persist one Gmail message id. Shared by backfill and
 * incremental sync. Skips ids already in ingested_messages.
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
    counters,
  } = opts;

  for (const messageId of messageIds) {
    counters.messagesSeen += 1;

    const { data: existing } = await supabase
      .from('ingested_messages')
      .select('id')
      .eq('email_account_id', accountId)
      .eq('provider_message_id', messageId)
      .maybeSingle();

    if (existing) {
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
        counters.skipped += 1;
        continue;
      }

      if (classified.classification !== 'order_confirmation') {
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
        counters.skipped += 1;
        continue;
      }

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
        continue;
      }

      const extraction = await extractOrderFromEmail({
        subject: message.subject ?? '',
        text: message.text,
        html: message.html,
        merchantSlug: classified.merchant?.slug,
        merchantName: classified.merchant?.name,
        fromAddress: message.fromAddress,
        receivedAt: message.internalDate,
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
        continue;
      }

      const bundle = buildEmailOrder({
        userId,
        merchantId: classified.merchant?.id ?? null,
        merchantSlug: classified.merchant?.slug ?? null,
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
        continue;
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
        continue;
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
        continue;
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
    } catch (err) {
      console.error('sync message failed', messageId, err);
      counters.errors += 1;
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
