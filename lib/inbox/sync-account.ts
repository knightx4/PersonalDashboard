import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptToken, encryptToken } from '@/lib/crypto/tokens';
import { classifyMessage, type MerchantDomainHit } from '@/lib/email/extract/classify';
import { extractOrderFromEmail } from '@/lib/email/extract/extract-order';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import { PARSER_VERSION } from '@/lib/email/extract/schema';
import { gmailOAuthEnv } from '@/lib/email/gmail-env';
import { orderCandidateQuery } from '@/lib/email/providers/gmail-query';
import { gmailProvider } from '@/lib/email/providers/gmail';
import { buildEmailOrder } from '@/lib/orders/create-email-order';
import {
  isExcludedSender,
  loadMerchantExclusions,
} from '@/lib/inbox/merchant-exclusions';
import {
  loadMerchantsForUser,
  resolveOrderMerchant,
} from '@/lib/merchants/resolve-order-merchant';

export interface SyncProgress {
  jobId: string;
  messagesSeen: number;
  messagesClassified: number;
  messagesParsed: number;
  ordersCreated: number;
  skipped: number;
  errors: number;
  done: boolean;
  /** Pass back on the next /api/inbox/sync call to advance Gmail pages. */
  nextPageToken?: string | null;
  /** Gmail search used for this batch — useful when seen=0. */
  query?: string;
  error?: string;
}

type AccountRow = {
  id: string;
  user_id: string;
  email_address: string;
  oauth_refresh_token: string | null;
  oauth_access_token: string | null;
  token_expires_at: string | null;
  backfill_window_days: number;
  status: string;
};

async function loadMerchants(
  supabase: SupabaseClient,
  userId: string,
): Promise<MerchantDomainHit[]> {
  const rows = await loadMerchantsForUser(supabase, userId);
  return rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    domains: m.domains,
  }));
}

async function ensureAccessToken(
  supabase: SupabaseClient,
  account: AccountRow,
  encryptionKey: string,
): Promise<string> {
  if (!account.oauth_refresh_token) {
    throw new Error('Inbox has no refresh token — reconnect Gmail.');
  }

  const refresh = decryptToken(account.oauth_refresh_token, encryptionKey);
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const stillValid =
    account.oauth_access_token && expiresAt - Date.now() > 60_000
      ? decryptToken(account.oauth_access_token, encryptionKey)
      : null;

  if (stillValid) return stillValid;

  try {
    const tokens = await gmailProvider.refreshAccessToken(refresh);
    await supabase
      .from('email_accounts')
      .update({
        oauth_access_token: encryptToken(tokens.accessToken, encryptionKey),
        oauth_refresh_token: encryptToken(tokens.refreshToken ?? refresh, encryptionKey),
        token_expires_at: tokens.expiresAt?.toISOString() ?? null,
        status: 'active',
      })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
    return tokens.accessToken;
  } catch (err) {
    await supabase
      .from('email_accounts')
      .update({ status: 'needs_reauth' })
      .eq('id', account.id)
      .eq('user_id', account.user_id);
    throw err;
  }
}

/**
 * Process one batch of Gmail order-candidate messages for a connected account.
 * Uses the caller's RLS-scoped Supabase client (session user).
 */
export async function syncEmailAccountBatch(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    accountId: string;
    maxMessages?: number;
    jobId?: string;
    pageToken?: string | null;
  },
): Promise<SyncProgress> {
  const encryptionKey = gmailOAuthEnv().TOKEN_ENCRYPTION_KEY;
  const maxMessages = opts.maxMessages ?? 15;

  const { data: account, error: accountError } = await supabase
    .from('email_accounts')
    .select(
      'id, user_id, email_address, oauth_refresh_token, oauth_access_token, token_expires_at, backfill_window_days, status',
    )
    .eq('id', opts.accountId)
    .eq('user_id', opts.userId)
    .maybeSingle();

  if (accountError || !account) {
    throw new Error('Inbox not found.');
  }

  let jobId = opts.jobId;
  let priorSeen = 0;
  let priorClassified = 0;
  let priorParsed = 0;

  if (!jobId) {
    const { data: job, error: jobError } = await supabase
      .from('sync_jobs')
      .insert({
        email_account_id: account.id,
        type: 'backfill',
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (jobError || !job) throw new Error(jobError?.message ?? 'Could not start sync job.');
    jobId = job.id as string;
  } else {
    const { data: existingJob } = await supabase
      .from('sync_jobs')
      .select('messages_seen, messages_classified, messages_parsed')
      .eq('id', jobId)
      .maybeSingle();
    priorSeen = existingJob?.messages_seen ?? 0;
    priorClassified = existingJob?.messages_classified ?? 0;
    priorParsed = existingJob?.messages_parsed ?? 0;
    await supabase.from('sync_jobs').update({ status: 'running' }).eq('id', jobId);
  }

  const activeJobId: string = jobId;

  const progress: SyncProgress = {
    jobId: activeJobId,
    messagesSeen: priorSeen,
    messagesClassified: priorClassified,
    messagesParsed: priorParsed,
    ordersCreated: 0,
    skipped: 0,
    errors: 0,
    done: false,
    nextPageToken: null,
  };

  try {
    const accessToken = await ensureAccessToken(supabase, account as AccountRow, encryptionKey);
    const merchants = await loadMerchants(supabase, opts.userId);
    const exclusions = await loadMerchantExclusions(supabase, opts.userId);
    const { data: categoryRows } = await supabase
      .from('categories')
      .select('id, slug, name, user_id')
      .is('parent_id', null)
      .or(`user_id.is.null,user_id.eq.${opts.userId}`);
    const categoryIdsBySlug = new Map<string, string>(
      (categoryRows ?? []).map((row) => [row.slug as string, row.id as string]),
    );
    const categoryOptions = (categoryRows ?? []).map((row) => ({
      slug: row.slug as string,
      name: row.name as string,
    }));
    const query = orderCandidateQuery(account.backfill_window_days);
    progress.query = query;
    console.info('gmail sync query', {
      accountId: account.id,
      query,
      pageToken: Boolean(opts.pageToken),
    });
    const listed = await gmailProvider.listMessages(accessToken, {
      query,
      maxResults: maxMessages,
      pageToken: opts.pageToken ?? undefined,
    });
    console.info('gmail sync list', {
      accountId: account.id,
      count: listed.messages.length,
      nextPageToken: Boolean(listed.nextPageToken),
    });

    for (const ref of listed.messages) {
      progress.messagesSeen += 1;

      const { data: existing } = await supabase
        .from('ingested_messages')
        .select('id')
        .eq('email_account_id', account.id)
        .eq('provider_message_id', ref.id)
        .maybeSingle();

      if (existing) {
        progress.skipped += 1;
        continue;
      }

      try {
        const message = await gmailProvider.getMessage(accessToken, ref.id);
        const classified = classifyMessage({
          fromAddress: message.fromAddress,
          subject: message.subject,
          merchants,
        });
        progress.messagesClassified += 1;

        if (classified.classification === 'not_relevant') {
          // CHECK ingested_not_relevant_is_bare_ck: no subject/from/thread for not_relevant.
          await supabase.from('ingested_messages').insert({
            email_account_id: account.id,
            provider_message_id: message.id,
            thread_id: null,
            received_at: message.internalDate?.toISOString() ?? null,
            from_address: null,
            subject: null,
            classification: 'not_relevant',
            parse_status: 'skipped',
            parser_version: PARSER_VERSION,
          });
          progress.skipped += 1;
          continue;
        }

        if (classified.classification !== 'order_confirmation') {
          await supabase.from('ingested_messages').insert({
            email_account_id: account.id,
            provider_message_id: message.id,
            thread_id: message.threadId,
            received_at: message.internalDate?.toISOString() ?? null,
            from_address: message.fromAddress,
            subject: message.subject,
            classification: classified.classification,
            parse_status: 'skipped',
            parser_version: PARSER_VERSION,
          });
          progress.skipped += 1;
          continue;
        }

        if (
          isExcludedSender(exclusions, {
            merchantId: classified.merchant?.id ?? null,
            fromAddress: message.fromAddress,
          })
        ) {
          await supabase.from('ingested_messages').insert({
            email_account_id: account.id,
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
          progress.skipped += 1;
          continue;
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
            email_account_id: account.id,
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
          progress.errors += 1;
          continue;
        }

        const resolvedMerchant = await resolveOrderMerchant(supabase, {
          userId: opts.userId,
          classified: classified.merchant,
          fromAddress: message.fromAddress,
          extractedName: extraction.result.order.merchantName,
        });

        const bundle = buildEmailOrder({
          userId: opts.userId,
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
          await supabase.from('ingested_messages').insert({
            email_account_id: account.id,
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
          progress.errors += 1;
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
          progress.errors += 1;
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
          progress.errors += 1;
          continue;
        }

        await supabase.from('ingested_messages').insert({
          email_account_id: account.id,
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

        progress.messagesParsed += 1;
        progress.ordersCreated += 1;
      } catch (err) {
        console.error('sync message failed', ref.id, err);
        progress.errors += 1;
        // Best-effort ledger so a hard failure does not leave the message invisible forever.
        const { error: ledgerError } = await supabase.from('ingested_messages').insert({
          email_account_id: account.id,
          provider_message_id: ref.id,
          classification: 'order_confirmation',
          parse_status: 'failed',
          parser_version: PARSER_VERSION,
          error: err instanceof Error ? err.message.slice(0, 500) : 'Sync failed',
        });
        if (ledgerError && !/duplicate|unique/i.test(ledgerError.message)) {
          console.error('sync ledger insert failed', ref.id, ledgerError.message);
        }
      }
    }

    // Advance with Gmail's page token; empty result ends the backfill.
    progress.nextPageToken = listed.nextPageToken;
    progress.done = listed.nextPageToken == null || listed.messages.length === 0;

    await supabase
      .from('sync_jobs')
      .update({
        status: progress.done ? 'completed' : 'queued',
        messages_seen: progress.messagesSeen,
        messages_classified: progress.messagesClassified,
        messages_parsed: progress.messagesParsed,
        finished_at: progress.done ? new Date().toISOString() : null,
      })
      .eq('id', activeJobId);

    await supabase
      .from('email_accounts')
      .update({
        last_synced_at: new Date().toISOString(),
        ...(progress.done
          ? { backfill_completed_at: new Date().toISOString(), sync_cursor: null }
          : { sync_cursor: progress.nextPageToken }),
      })
      .eq('id', account.id)
      .eq('user_id', opts.userId);

    return progress;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('sync_jobs')
      .update({
        status: 'failed',
        error: message,
        finished_at: new Date().toISOString(),
        messages_seen: progress.messagesSeen,
        messages_classified: progress.messagesClassified,
        messages_parsed: progress.messagesParsed,
      })
      .eq('id', activeJobId);
    progress.done = true;
    progress.error = message;
    progress.nextPageToken = null;
    return progress;
  }
}
