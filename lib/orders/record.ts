import { recordScheduled } from '@/lib/core/scheduled-actions';
import { formatDay } from '@/lib/goals/dates';

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
