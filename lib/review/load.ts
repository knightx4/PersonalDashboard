import type { SupabaseClient } from '@supabase/supabase-js';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { orderItemsSummary } from '@/lib/orders/search';

export const REVIEW_VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'orders', label: 'Orders' },
  { id: 'emails', label: 'Emails' },
] as const;

export type ReviewView = (typeof REVIEW_VIEWS)[number]['id'];

export function parseReviewView(value: string | undefined): ReviewView {
  if (value === 'orders' || value === 'emails' || value === 'all') return value;
  return 'all';
}

export type ReviewOrderRow = {
  kind: 'order';
  id: string;
  orderId: string;
  orderDate: string;
  merchantName: string;
  externalOrderNumber: string | null;
  totalCents: number;
  currency: string;
  itemSummary: string;
  reason: string;
  gmailHref: string | null;
  sortAt: string;
};

export type ReviewEmailRow = {
  kind: 'email';
  id: string;
  messageId: string;
  subject: string | null;
  fromAddress: string | null;
  receivedAt: string | null;
  classification: string;
  error: string | null;
  reason: string;
  gmailHref: string | null;
  inboxEmail: string | null;
  linkedOrderId: string | null;
  sortAt: string;
};

export type ReviewRow = ReviewOrderRow | ReviewEmailRow;

export type ReviewCounts = {
  all: number;
  orders: number;
  emails: number;
};

function reasonForOrder(sourceError: string | null | undefined): string {
  if (sourceError?.trim()) return sourceError.trim();
  return 'Imported with the fallback parser — check the totals and items before trusting spend.';
}

function reasonForEmail(
  classification: string,
  error: string | null | undefined,
): string {
  if (error?.trim()) return error.trim();
  if (classification === 'shipping_update' || classification === 'refund') {
    return 'Could not match this update to an existing order.';
  }
  return 'Could not extract a confident order from this email.';
}

/**
 * Orders flagged needs_review plus orphan (or unmatched) emails that failed
 * the arithmetic / matching gates. Bodies are never stored — Gmail links only.
 */
export async function loadReviewQueue(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ rows: ReviewRow[]; counts: ReviewCounts }> {
  const { data: accounts } = await supabase
    .from('email_accounts')
    .select('id, email_address')
    .eq('user_id', userId);
  const accountIds = (accounts ?? []).map((row) => row.id as string);
  const inboxById = new Map(
    (accounts ?? []).map((row) => [row.id as string, row.email_address as string]),
  );

  const [{ data: orders }, messagesResult] = await Promise.all([
    supabase
      .from('orders')
      .select(
        `
        id, order_date, external_order_number, total_cents, currency, created_at,
        merchants ( name ),
        order_items ( name, variant, quantity, categories ( name ) )
      `,
      )
      .eq('user_id', userId)
      .eq('needs_review', true)
      .order('order_date', { ascending: false }),
    accountIds.length > 0
      ? supabase
          .from('ingested_messages')
          .select(
            `
            id, email_account_id, provider_message_id, thread_id, subject,
            from_address, received_at, classification, error, resulting_order_id, created_at
          `,
          )
          .in('email_account_id', accountIds)
          .eq('parse_status', 'needs_review')
          .order('received_at', { ascending: false })
      : Promise.resolve({ data: [] as const }),
  ]);

  const orderIds = (orders ?? []).map((row) => row.id as string);
  const sourceByOrder = new Map<
    string,
    {
      provider_message_id: string | null;
      thread_id: string | null;
      error: string | null;
      email_account_id: string;
    }
  >();

  if (orderIds.length > 0) {
    const { data: sources } = await supabase
      .from('ingested_messages')
      .select(
        'resulting_order_id, provider_message_id, thread_id, error, email_account_id, classification',
      )
      .in('resulting_order_id', orderIds)
      .order('received_at', { ascending: true });

    for (const row of sources ?? []) {
      const orderId = row.resulting_order_id as string | null;
      if (!orderId || sourceByOrder.has(orderId)) continue;
      if (row.classification && row.classification !== 'order_confirmation') continue;
      sourceByOrder.set(orderId, {
        provider_message_id: (row.provider_message_id as string | null) ?? null,
        thread_id: (row.thread_id as string | null) ?? null,
        error: (row.error as string | null) ?? null,
        email_account_id: row.email_account_id as string,
      });
    }
    // Fallback: any linked message if no order_confirmation row.
    for (const row of sources ?? []) {
      const orderId = row.resulting_order_id as string | null;
      if (!orderId || sourceByOrder.has(orderId)) continue;
      sourceByOrder.set(orderId, {
        provider_message_id: (row.provider_message_id as string | null) ?? null,
        thread_id: (row.thread_id as string | null) ?? null,
        error: (row.error as string | null) ?? null,
        email_account_id: row.email_account_id as string,
      });
    }
  }

  const orderRows: ReviewOrderRow[] = (orders ?? []).map((order) => {
    const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
    const source = sourceByOrder.get(order.id as string);
    const inboxEmail = source ? inboxById.get(source.email_account_id) : null;
    return {
      kind: 'order' as const,
      id: `order:${order.id}`,
      orderId: order.id as string,
      orderDate: order.order_date as string,
      merchantName: (merchant?.name as string | undefined) ?? 'Unknown merchant',
      externalOrderNumber: (order.external_order_number as string | null) ?? null,
      totalCents: order.total_cents as number,
      currency: (order.currency as string) ?? 'USD',
      itemSummary: orderItemsSummary({
        order_items: order.order_items ?? [],
      }).label,
      reason: reasonForOrder(source?.error),
      gmailHref: gmailOpenUrl({
        emailAddress: inboxEmail,
        threadId: source?.thread_id,
        messageId: source?.provider_message_id,
      }),
      sortAt: (order.order_date as string) || (order.created_at as string),
    };
  });

  const emailRows: ReviewEmailRow[] = (messagesResult.data ?? []).map((message) => {
    const inboxEmail = inboxById.get(message.email_account_id as string) ?? null;
    const receivedAt = (message.received_at as string | null) ?? null;
    return {
      kind: 'email' as const,
      id: `email:${message.id}`,
      messageId: message.id as string,
      subject: (message.subject as string | null) ?? null,
      fromAddress: (message.from_address as string | null) ?? null,
      receivedAt,
      classification: message.classification as string,
      error: (message.error as string | null) ?? null,
      reason: reasonForEmail(
        message.classification as string,
        message.error as string | null,
      ),
      gmailHref: gmailOpenUrl({
        emailAddress: inboxEmail,
        threadId: message.thread_id as string | null,
        messageId: message.provider_message_id as string | null,
      }),
      inboxEmail,
      linkedOrderId: (message.resulting_order_id as string | null) ?? null,
      sortAt: receivedAt ?? (message.created_at as string),
    };
  });

  const counts: ReviewCounts = {
    orders: orderRows.length,
    emails: emailRows.length,
    all: orderRows.length + emailRows.length,
  };

  const rows = [...orderRows, ...emailRows].sort((a, b) =>
    b.sortAt.localeCompare(a.sortAt),
  );

  return { rows, counts };
}

export function filterReviewRows(rows: ReviewRow[], view: ReviewView): ReviewRow[] {
  if (view === 'orders') return rows.filter((row) => row.kind === 'order');
  if (view === 'emails') return rows.filter((row) => row.kind === 'email');
  return rows;
}

/** Nav badge: heuristic orders + emails stuck in needs_review. */
export async function countReviewItems(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const [{ count: orderCount }, { data: accounts }] = await Promise.all([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('needs_review', true),
    supabase.from('email_accounts').select('id').eq('user_id', userId),
  ]);

  const accountIds = (accounts ?? []).map((row) => row.id as string);
  if (accountIds.length === 0) return orderCount ?? 0;

  const { count: emailCount } = await supabase
    .from('ingested_messages')
    .select('id', { count: 'exact', head: true })
    .in('email_account_id', accountIds)
    .eq('parse_status', 'needs_review');

  return (orderCount ?? 0) + (emailCount ?? 0);
}
