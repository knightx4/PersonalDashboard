import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { mapPool } from '@/lib/async/map-pool';
import { classifyMessage, type MerchantDomainHit } from '@/lib/email/extract/classify';
import { extractOrderFromEmail } from '@/lib/email/extract/extract-order';
import { quotedOriginal } from '@/lib/email/extract/forwarded';
import { displayNameFromAddress } from '@/lib/email/extract/heuristic';
import { fetchMessageBody } from '@/lib/inbox/fetch-message-body';
import { loadCategoryContext } from '@/lib/inbox/context';
import { loadMerchantsForUser } from '@/lib/merchants/resolve-order-merchant';
import { draftFromExtraction, type ReadOutcome } from '@/lib/review/read-order';

export type ReadOrderContext = {
  userId: string;
  merchants: MerchantDomainHit[];
  categoryIdsBySlug: Map<string, string>;
  categoryOptions: Array<{ slug: string; name: string }>;
  timezone: string;
};

/** What reading an order needs besides the email, loaded once per request. */
export async function loadReadOrderContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<ReadOrderContext> {
  const [merchants, categories, { data: profile }] = await Promise.all([
    loadMerchantsForUser(supabase, userId),
    loadCategoryContext(supabase, userId),
    supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
  ]);
  return {
    userId,
    merchants,
    ...categories,
    timezone: (profile?.timezone as string | null) ?? 'UTC',
  };
}

type MessageRow = {
  id: string;
  email_account_id: string;
  provider_message_id: string;
  subject: string | null;
  from_address: string | null;
  received_at: string | null;
};

const MESSAGE_COLUMNS =
  'id, email_account_id, provider_message_id, subject, from_address, received_at';

/**
 * Fetch one stored email from Gmail and read an order out of it. Writes
 * nothing: not to orders, not to merchants, not to the message's verdict.
 */
async function readRow(
  core: CoreSupabaseClient,
  context: ReadOrderContext,
  row: MessageRow,
): Promise<ReadOutcome> {
  const fetched = await fetchMessageBody(core, {
    userId: context.userId,
    accountId: row.email_account_id,
    providerMessageId: row.provider_message_id,
  });
  if (!fetched.ok) {
    return { messageId: row.id, subject: row.subject, ok: false, error: fetched.reason };
  }
  const message = fetched.message;
  const fromAddress = message.fromAddress ?? row.from_address;
  const subject = message.subject ?? row.subject;
  const date = message.internalDate ?? (row.received_at ? new Date(row.received_at) : null);
  // A forward is classified by the shop it quotes, so a known merchant's slug
  // reaches the extractor instead of nothing for the forwarder's own address.
  const classified = classifyMessage({
    fromAddress: quotedOriginal(message.text)?.fromAddress ?? fromAddress,
    subject,
    merchants: context.merchants,
  });

  let extraction: Awaited<ReturnType<typeof extractOrderFromEmail>> | null = null;
  try {
    extraction = await extractOrderFromEmail({
      subject: subject ?? '',
      text: message.text,
      html: message.html,
      merchantSlug: classified.merchant?.slug,
      merchantName: classified.merchant?.name ?? displayNameFromAddress(fromAddress),
      fromAddress,
      receivedAt: date,
      categoryOptions: context.categoryOptions,
    });
  } catch (err) {
    // The draft still carries merchant, date and order number from the email.
    console.error('read order: extraction failed', row.id, err);
  }

  const draft = draftFromExtraction({
    extraction,
    email: { subject, text: message.text, fromAddress, date },
    merchants: context.merchants,
    categoryIdsBySlug: context.categoryIdsBySlug,
    timezone: context.timezone,
  });
  return { messageId: row.id, subject, ok: true, draft };
}

/** One order confirmation waiting in review, read by its inbox message id. */
export async function readOrderFromMessage(
  supabase: SupabaseClient,
  core: CoreSupabaseClient,
  context: ReadOrderContext,
  messageId: string,
): Promise<ReadOutcome> {
  const { data, error } = await supabase
    .from('inbox_messages')
    .select(`${MESSAGE_COLUMNS}, classification`)
    .eq('id', messageId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (error) return { messageId, subject: null, ok: false, error: error.message };
  if (!data) return { messageId, subject: null, ok: false, error: 'Email not found.' };
  if (data.classification !== 'order_confirmation') {
    return {
      messageId,
      subject: data.subject as string | null,
      ok: false,
      error: 'Only an order confirmation can be read as an order.',
    };
  }
  return readRow(core, context, data as MessageRow);
}

/** Every order confirmation waiting in review, read two at a time. */
export async function readWaitingConfirmations(
  supabase: SupabaseClient,
  core: CoreSupabaseClient,
  context: ReadOrderContext,
): Promise<ReadOutcome[]> {
  const { data, error } = await supabase
    .from('inbox_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', context.userId)
    .eq('classification', 'order_confirmation')
    .eq('parse_status', 'needs_review')
    .order('received_at', { ascending: false });
  if (error) throw error;
  return mapPool((data ?? []) as MessageRow[], 2, (row) => readRow(core, context, row));
}
