import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyMessage, type MerchantDomainHit } from '@/lib/email/extract/classify';
import { extractOrderFromEmail } from '@/lib/email/extract/extract-order';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import { PARSER_VERSION } from '@/lib/email/extract/schema';
import { gmailProvider } from '@/lib/email/providers/gmail';
import {
  isExcludedSender,
  type MerchantExclusionRow,
} from '@/lib/inbox/merchant-exclusions';
import { resolveOrderMerchant } from '@/lib/merchants/resolve-order-merchant';
import { buildEmailOrder } from '@/lib/orders/create-email-order';
import { allocateLandedCost } from '@/lib/money';
import { mapPool } from '@/lib/async/map-pool';
import { matchExistingOrderItem } from '@/lib/inbox/reparse-match';

export { matchExistingOrderItem } from '@/lib/inbox/reparse-match';

const REPARSE_CONCURRENCY = 2;

export type ReparseCounters = {
  considered: number;
  updated: number;
  skipped: number;
  errors: number;
};

type ExistingOrderItem = {
  id: string;
  name: string;
  variant: string | null;
  quantity: number;
  unit_price_cents: number;
  fingerprint_strict: string | null;
  fingerprint_loose: string | null;
  inventory_items:
    | Array<{
        id: string;
        status: string;
        cost_cents: number;
      }>
    | null;
};

type BuiltLine = ReturnType<typeof buildEmailOrder>['orderItems'][number];

async function inventoryHasUserData(
  supabase: SupabaseClient,
  inventoryItemId: string,
): Promise<boolean> {
  const [{ count: uses }, { count: lists }] = await Promise.all([
    supabase
      .from('item_uses')
      .select('id', { count: 'exact', head: true })
      .eq('inventory_item_id', inventoryItemId),
    supabase
      .from('inventory_item_lists')
      .select('id', { count: 'exact', head: true })
      .eq('inventory_item_id', inventoryItemId),
  ]);
  return (uses ?? 0) > 0 || (lists ?? 0) > 0;
}

/**
 * Re-fetch Gmail bodies for already-imported confirmation messages and update
 * the linked orders in place. Does not delete orders or reset the sync cursor.
 */
export async function reparseInboxConfirmations(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    accessToken: string;
    merchants: MerchantDomainHit[];
    exclusions: MerchantExclusionRow[];
    categoryIdsBySlug: Map<string, string>;
    categoryOptions: Array<{ slug: string; name: string }>;
    /** When true, only rows whose parser_version differs from current. */
    onlyOutdated?: boolean;
    limit?: number;
    counters?: ReparseCounters;
  },
): Promise<ReparseCounters> {
  const counters = opts.counters ?? {
    considered: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
  const limit = opts.limit ?? 200;

  const query = supabase
    .from('ingested_messages')
    .select(
      'id, provider_message_id, from_address, subject, parser_version, resulting_order_id, parse_status',
    )
    .eq('email_account_id', opts.accountId)
    .eq('classification', 'order_confirmation')
    .in('parse_status', ['parsed', 'needs_review'])
    .not('resulting_order_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(limit);

  const { data: rawRows, error } = await query;
  if (error) throw error;

  const rows =
    opts.onlyOutdated === false
      ? (rawRows ?? [])
      : (rawRows ?? []).filter(
          (row) => !row.parser_version || row.parser_version !== PARSER_VERSION,
        );
  if (!rows.length) return counters;

  await mapPool(rows, REPARSE_CONCURRENCY, async (row) => {
    counters.considered += 1;
    const orderId = row.resulting_order_id as string;
    const providerMessageId = row.provider_message_id as string;

    try {
      const { data: order } = await supabase
        .from('orders')
        .select('id, deleted_at, source')
        .eq('id', orderId)
        .eq('user_id', opts.userId)
        .maybeSingle();

      if (!order || order.deleted_at) {
        counters.skipped += 1;
        return;
      }

      const message = await gmailProvider.getMessage(opts.accessToken, providerMessageId, {
        format: 'full',
      });

      const classified = classifyMessage({
        fromAddress: message.fromAddress,
        subject: message.subject,
        merchants: opts.merchants,
      });

      if (
        isExcludedSender(opts.exclusions, {
          merchantId: classified.merchant?.id ?? null,
          fromAddress: message.fromAddress,
        })
      ) {
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
        categoryOptions: opts.categoryOptions,
      });

      if (!extraction.result.ok) {
        await supabase
          .from('ingested_messages')
          .update({
            parse_status: 'needs_review',
            parser_version: extraction.parserVersion,
            error: extraction.result.reason,
          })
          .eq('id', row.id);
        counters.errors += 1;
        return;
      }

      const resolvedMerchant = await resolveOrderMerchant(supabase, {
        userId: opts.userId,
        classified: classified.merchant,
        fromAddress: message.fromAddress,
        extractedName: extraction.result.order.merchantName,
      });

      const needsReview = extraction.source === 'heuristic' && !extraction.trusted;
      const bundle = buildEmailOrder({
        userId: opts.userId,
        merchantId: resolvedMerchant?.id ?? null,
        merchantSlug: resolvedMerchant?.slug ?? classified.merchant?.slug ?? null,
        extraction: extraction.result.order,
        categoryIdsBySlug: opts.categoryIdsBySlug,
        needsReview,
      });

      const { data: existingItems, error: itemsError } = await supabase
        .from('order_items')
        .select(
          `
          id, name, variant, quantity, unit_price_cents,
          fingerprint_strict, fingerprint_loose,
          inventory_items ( id, status, cost_cents )
        `,
        )
        .eq('order_id', orderId);
      if (itemsError) throw itemsError;

      const existing = (existingItems ?? []) as ExistingOrderItem[];
      const used = new Set<string>();
      const updates: Array<{ existing: ExistingOrderItem; built: BuiltLine }> = [];
      const inserts: BuiltLine[] = [];

      for (const built of bundle.orderItems) {
        const match = matchExistingOrderItem(existing, built, used, {
          builtCount: bundle.orderItems.length,
        });
        if (match) {
          used.add(match.id);
          const full = existing.find((item) => item.id === match.id);
          if (full) updates.push({ existing: full, built });
        } else {
          inserts.push(built);
        }
      }

      const { error: orderUpdateError } = await supabase
        .from('orders')
        .update({
          merchant_id: bundle.order.merchantId,
          external_order_number: bundle.order.externalOrderNumber,
          order_date: bundle.order.orderDate,
          subtotal_cents: bundle.order.subtotalCents,
          tax_cents: bundle.order.taxCents,
          shipping_cents: bundle.order.shippingCents,
          discount_cents: bundle.order.discountCents,
          total_cents: bundle.order.totalCents,
          currency: bundle.order.currency,
          needs_review: bundle.order.needsReview,
        })
        .eq('id', orderId)
        .eq('user_id', opts.userId);
      if (orderUpdateError) throw orderUpdateError;

      // Apply line updates (preserve order_item + inventory ids).
      for (const { existing: ex, built } of updates) {
        await supabase
          .from('order_items')
          .update({
            category_id: built.categoryId,
            name: built.name,
            short_name: built.shortName,
            variant: built.variant,
            quantity: built.quantity,
            unit_price_cents: built.unitPriceCents,
            fingerprint_strict: built.fingerprintStrict,
            fingerprint_loose: built.fingerprintLoose,
            product_url: built.productUrl,
            image_url: built.imageUrl,
          })
          .eq('id', ex.id);

        const units = [...(ex.inventory_items ?? [])];
        const owned = units.filter((unit) => unit.status === 'owned');

        // Grow quantity: add inventory units.
        while (owned.length < built.quantity) {
          const { data: created, error: createError } = await supabase
            .from('inventory_items')
            .insert({
              user_id: opts.userId,
              order_item_id: ex.id,
              category_id: built.categoryId,
              name: built.name,
              short_name: built.shortName,
              variant: built.variant,
              fingerprint_loose: built.fingerprintLoose,
              acquired_at: bundle.order.orderDate,
              cost_cents: 0,
              image_url: built.imageUrl,
              search_tags: built.searchTags,
            })
            .select('id, status, cost_cents')
            .single();
          if (createError || !created) throw createError ?? new Error('inventory insert failed');
          owned.push(created as { id: string; status: string; cost_cents: number });
          units.push(created as { id: string; status: string; cost_cents: number });
        }

        // Shrink quantity: remove surplus owned units without user activity.
        if (owned.length > built.quantity) {
          const surplus = owned.slice(built.quantity);
          for (const unit of surplus.reverse()) {
            if (await inventoryHasUserData(supabase, unit.id)) continue;
            await supabase.from('inventory_items').delete().eq('id', unit.id);
            const idx = units.findIndex((row) => row.id === unit.id);
            if (idx >= 0) units.splice(idx, 1);
            const oidx = owned.findIndex((row) => row.id === unit.id);
            if (oidx >= 0) owned.splice(oidx, 1);
          }
        }

        // Refresh display fields on surviving units (keep status / notes / lists).
        for (const unit of units) {
          await supabase
            .from('inventory_items')
            .update({
              category_id: built.categoryId,
              name: built.name,
              short_name: built.shortName,
              variant: built.variant,
              fingerprint_loose: built.fingerprintLoose,
              image_url: built.imageUrl,
              search_tags: built.searchTags,
            })
            .eq('id', unit.id);
        }
      }

      // Insert brand-new lines the old parse missed.
      for (const built of inserts) {
        const { error: insertItemError } = await supabase.from('order_items').insert({
          id: built.id,
          order_id: orderId,
          category_id: built.categoryId,
          name: built.name,
          short_name: built.shortName,
          variant: built.variant,
          quantity: built.quantity,
          unit_price_cents: built.unitPriceCents,
          fingerprint_strict: built.fingerprintStrict,
          fingerprint_loose: built.fingerprintLoose,
          product_url: built.productUrl,
          image_url: built.imageUrl,
        });
        if (insertItemError) throw insertItemError;

        const unitCosts = bundle.inventoryItems
          .filter((inv) => inv.orderItemId === built.id)
          .map((inv) => inv.costCents);
        while (unitCosts.length < built.quantity) unitCosts.push(0);

        const { error: invError } = await supabase.from('inventory_items').insert(
          unitCosts.slice(0, built.quantity).map((costCents) => ({
            user_id: opts.userId,
            order_item_id: built.id,
            category_id: built.categoryId,
            name: built.name,
            short_name: built.shortName,
            variant: built.variant,
            fingerprint_loose: built.fingerprintLoose,
            acquired_at: bundle.order.orderDate,
            cost_cents: costCents,
            image_url: built.imageUrl,
            search_tags: built.searchTags,
            source: 'email',
          })),
        );
        if (invError) throw invError;
      }

      // Re-allocate landed costs across current items/units.
      const { data: freshItems } = await supabase
        .from('order_items')
        .select('id, quantity, unit_price_cents, inventory_items ( id, status )')
        .eq('order_id', orderId);

      if (freshItems && freshItems.length > 0) {
        const allocated = allocateLandedCost(
          freshItems.map((item) => ({
            id: item.id as string,
            quantity: item.quantity as number,
            unitPriceCents: item.unit_price_cents as number,
          })),
          {
            subtotalCents: bundle.order.subtotalCents,
            taxCents: bundle.order.taxCents,
            shippingCents: bundle.order.shippingCents,
            discountCents: bundle.order.discountCents,
            totalCents: bundle.order.totalCents,
          },
        );
        const costByItem = new Map<string, number[]>();
        for (const unit of allocated) {
          const list = costByItem.get(unit.orderItemId) ?? [];
          list.push(unit.costCents);
          costByItem.set(unit.orderItemId, list);
        }
        for (const item of freshItems) {
          const costs = costByItem.get(item.id as string) ?? [];
          const inv = Array.isArray(item.inventory_items)
            ? item.inventory_items
            : item.inventory_items
              ? [item.inventory_items]
              : [];
          for (let i = 0; i < inv.length; i++) {
            const cost = costs[i] ?? costs[costs.length - 1] ?? 0;
            await supabase
              .from('inventory_items')
              .update({ cost_cents: cost })
              .eq('id', (inv[i] as { id: string }).id);
          }
        }
      }

      await supabase
        .from('ingested_messages')
        .update({
          parse_status: 'parsed',
          parser_version: PARSER_VERSION,
          error: null,
          parse_confidence: extraction.result.order.confidence ?? null,
          from_address: message.fromAddress,
          subject: message.subject,
        })
        .eq('id', row.id);

      counters.updated += 1;
    } catch (err) {
      console.error('reparse confirmation failed', providerMessageId, err);
      counters.errors += 1;
      await supabase
        .from('ingested_messages')
        .update({
          error: err instanceof Error ? err.message : 'Reparse failed',
          parser_version: PARSER_VERSION,
        })
        .eq('id', row.id);
    }
  });

  return counters;
}
