import { recordScheduled, scheduledBefore, scheduledChanged } from '@/lib/core/scheduled-actions';
import { formatDay } from '@/lib/goals/dates';
import type { LifecycleChange } from '@/lib/orders/apply-lifecycle';

/**
 * Recording an order the mail sync imports (plan #1576, feature #1456).
 *
 * One record per order rather than one per inventory item: the order, its
 * items and the inventory items they made all come from one email, and Home
 * reads better with one line naming what came in. Its Undo removes the order,
 * and the database takes the items and inventory items with it. An order
 * that has since gained a shipment, a return, a task, or a use, list or
 * family on one of its things is refused (DEPENDENTS in
 * lib/core/dash-actions.ts), as is one later mail has changed.
 *
 * Later mail about the order is recorded too (plan #1577): a shipment added
 * or moved on, a return, a cancellation. Each is its own record on the row it
 * wrote, so undoing the shipment puts the order back to what the earlier mail
 * left, and the import's own Undo stays refused while any of them stands.
 */

/** The ref an imported order is recorded under. */
export function orderRef(orderId: string): string {
  return `public.orders:${orderId}`;
}

export type ImportedLine = { name: string; shortName?: string | null; quantity: number };

const MOST_NAMED = 3;
const NAME_LIMIT = 40;

function lineName(line: ImportedLine): string {
  const raw = (line.shortName?.trim() || line.name.trim() || 'an item').replace(/\s+/g, ' ');
  const name = raw.length > NAME_LIMIT ? `${raw.slice(0, NAME_LIMIT - 1).trimEnd()}…` : raw;
  return line.quantity > 1 ? `${line.quantity} × ${name}` : name;
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The sentence Home reads for an imported order. */
export function orderImportedSummary(opts: {
  merchant: string | null;
  orderDate: string;
  lines: ImportedLine[];
  units: number;
}): string {
  const from = opts.merchant?.trim() ? ` from ${opts.merchant.trim()}` : '';
  const head = `Dash added your order${from} of ${formatDay(opts.orderDate)}`;
  if (opts.units === 0) return `${head}. Nothing in it went into your inventory.`;
  const named = opts.lines.slice(0, MOST_NAMED).map(lineName);
  const rest = opts.lines.length - named.length;
  if (rest > 0) named.push(`${rest} more`);
  const things = opts.units === 1 ? '1 thing' : `${opts.units} things`;
  return `${head}, and ${things} to your inventory: ${list(named)}.`;
}

/** Record an order the sync has just imported, with an Undo that removes it. */
export async function recordOrderImport(
  client: unknown,
  userId: string,
  opts: { orderId: string; merchant: string | null; orderDate: string; lines: ImportedLine[]; units: number },
): Promise<string | null> {
  return recordScheduled(client, userId, {
    kind: 'import_order',
    subjectRef: orderRef(opts.orderId),
    op: 'insert',
    summary: orderImportedSummary(opts),
  });
}

/** Why a return of several things from one email has no Undo. */
export const RETURNS_NO_UNDO =
  'There is no Undo, because one email marked these things returned together and split the refund between them.';

const SHIPMENT_STATUS: Record<string, string> = {
  pending: 'waiting to ship',
  in_transit: 'on its way',
  out_for_delivery: 'out for delivery',
  delivered: 'delivered',
  exception: 'held up by the carrier',
};

/** "your order from Bookshop of 28 Sept", or as much of it as could be read. */
export function orderPhrase(merchant: string | null, orderDate: string | null): string {
  const from = merchant?.trim() ? ` from ${merchant.trim()}` : '';
  const of = orderDate ? ` of ${formatDay(orderDate)}` : '';
  return `your order${from}${of}`;
}

/** The sentence Home reads for a shipment the sync added or moved on. */
export function shipmentSummary(opts: {
  order: string;
  op: 'insert' | 'update';
  status: string | null;
  expectedOn: string | null;
}): string {
  if (opts.status === 'delivered') return `Dash marked ${opts.order} delivered.`;
  const label = SHIPMENT_STATUS[opts.status ?? ''] ?? 'on its way';
  const due = opts.expectedOn ? `, due ${formatDay(opts.expectedOn)}` : '';
  return opts.op === 'insert'
    ? `Dash added a shipment to ${opts.order}: ${label}${due}.`
    : `Dash updated the shipment on ${opts.order}: ${label}${due}.`;
}

/** The sentence Home reads for things the sync marked returned. */
export function returnSummary(opts: { order: string; units: number; name: string | null }): string {
  const what = opts.units === 1 ? (opts.name?.trim() ? lineName({ name: opts.name, quantity: 1 }) : '1 thing') : `${opts.units} things`;
  return `Dash marked ${what} from ${opts.order} returned and refunded.`;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

async function describeOrder(client: unknown, userId: string, orderId: string): Promise<string> {
  const order = await scheduledBefore(client, userId, orderRef(orderId));
  const merchantId = text(order?.merchant_id);
  const merchant = merchantId ? await scheduledBefore(client, userId, `public.merchants:${merchantId}`) : null;
  return orderPhrase(text(merchant?.name), text(order?.order_date));
}

/**
 * Record what a later email changed on an order, after the sync's last write
 * for that email. A shipment it rewrote with what it already held records
 * nothing.
 */
export async function recordLifecycleChange(
  client: unknown,
  userId: string,
  orderId: string,
  change: LifecycleChange,
): Promise<string | null> {
  try {
    return await recordChange(client, userId, orderId, change);
  } catch (error) {
    console.error(`order lifecycle: could not record a change on ${orderId}`, error);
    return null;
  }
}

async function recordChange(
  client: unknown,
  userId: string,
  orderId: string,
  change: LifecycleChange,
): Promise<string | null> {
  if (change.what === 'cancel') {
    return recordScheduled(client, userId, {
      kind: 'cancel_order',
      subjectRef: orderRef(orderId),
      op: 'update',
      beforeValues: change.before,
      summary: `Dash marked ${await describeOrder(client, userId, orderId)} cancelled.`,
    });
  }

  if (change.what === 'return') {
    const subjectRef = `public.returns:${change.returnIds[0]}`;
    const units = change.returnIds.length;
    let name: string | null = null;
    if (units === 1) {
      const row = await scheduledBefore(client, userId, subjectRef);
      const itemId = text(row?.inventory_item_id);
      const item = itemId ? await scheduledBefore(client, userId, `public.inventory_items:${itemId}`) : null;
      name = text(item?.short_name) ?? text(item?.name);
    }
    return recordScheduled(client, userId, {
      kind: 'mark_returned',
      subjectRef,
      op: 'insert',
      summary: returnSummary({ order: await describeOrder(client, userId, orderId), units, name }),
      ...(units > 1 ? { noUndo: RETURNS_NO_UNDO } : {}),
    });
  }

  const subjectRef = `public.shipments:${change.shipmentId}`;
  if (change.op === 'update' && !(await scheduledChanged(client, userId, subjectRef, change.before))) return null;
  const shipment = await scheduledBefore(client, userId, subjectRef);
  return recordScheduled(client, userId, {
    kind: change.op === 'insert' ? 'add_shipment' : 'update_shipment',
    subjectRef,
    op: change.op,
    ...(change.op === 'update' ? { beforeValues: change.before } : {}),
    summary: shipmentSummary({
      order: await describeOrder(client, userId, orderId),
      op: change.op,
      status: text(shipment?.status),
      expectedOn: text(shipment?.expected_on),
    }),
  });
}
