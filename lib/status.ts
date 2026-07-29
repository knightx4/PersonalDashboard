/**
 * Derived order and inventory status.
 *
 * Status is fully determined by an order's shipments and returns, so writing
 * it by hand from several code paths guarantees it drifts out of sync with
 * reality. Exactly one thing owns it.
 *
 * That owner is the Postgres function `public.sync_order_state(order_id)`,
 * fired by triggers on shipments, returns, inventory_items and orders. Putting
 * it in the database rather than here means a background job, a route handler
 * and a manual SQL fix all get the same answer, and there is no path that
 * writes a shipment without updating the order.
 *
 * `deriveOrderStatus` below is the same rule expressed in TypeScript, for
 * optimistic UI and for tests. It is NOT a second source of truth:
 * tests/status.test.ts asserts the two agree across every case, so if the SQL
 * changes without this, CI fails.
 *
 * Do not add a fourth place that computes this.
 */

export type OrderStatus =
  | 'ordered'
  | 'shipped'
  | 'delivered'
  | 'partially_returned'
  | 'returned'
  | 'cancelled';

export type ShipmentStatus =
  | 'pending'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception';

export type InventoryStatus =
  | 'owned'
  | 'returned'
  | 'disposed'
  | 'gifted'
  | 'sold'
  | 'lost';

export interface OrderStateInput {
  cancelled: boolean;
  /** One entry per inventory_item belonging to this order. */
  inventoryStatuses: readonly InventoryStatus[];
  /** One entry per shipment on this order. */
  shipmentStatuses: readonly ShipmentStatus[];
}

/**
 * The rule, in precedence order:
 *
 *   cancelled            the order was cancelled
 *   returned             every inventory_item is 'returned'
 *   partially_returned   some but not all are
 *   delivered            all shipments delivered
 *   shipped              any shipment has left 'pending'
 *   ordered              otherwise
 */
export function deriveOrderStatus(input: OrderStateInput): OrderStatus {
  if (input.cancelled) return 'cancelled';

  const totalItems = input.inventoryStatuses.length;
  const returnedItems = input.inventoryStatuses.filter((s) => s === 'returned').length;

  if (totalItems > 0 && returnedItems === totalItems) return 'returned';
  if (returnedItems > 0) return 'partially_returned';

  const totalShipments = input.shipmentStatuses.length;
  const deliveredShipments = input.shipmentStatuses.filter((s) => s === 'delivered').length;
  const movedShipments = input.shipmentStatuses.filter((s) => s !== 'pending').length;

  if (totalShipments > 0 && deliveredShipments === totalShipments) return 'delivered';
  if (movedShipments > 0) return 'shipped';

  return 'ordered';
}

/**
 * Return deadline = delivery date + the merchant's return window.
 *
 * Window resolution: a per-user merchant_return_policies row wins (including
 * when its days are null = no window); otherwise merchants.default_return_window_days.
 *
 * Null when there is no effective window, or nothing has been delivered.
 * Show nothing rather than guessing: a wrong return deadline is worse than no
 * return deadline, because the user acts on it.
 *
 * Confirmation emails almost never state the return window, which is why this
 * comes from merchant policy and not from the parser.
 */
export function deriveReturnDeadline(input: {
  deliveredAt: Date | string | null;
  merchantReturnWindowDays: number | null;
}): string | null {
  if (input.deliveredAt === null || input.merchantReturnWindowDays === null) return null;

  const delivered =
    typeof input.deliveredAt === 'string' ? new Date(input.deliveredAt) : input.deliveredAt;
  if (Number.isNaN(delivered.getTime())) return null;

  const deadline = new Date(delivered.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + input.merchantReturnWindowDays);
  return deadline.toISOString().slice(0, 10);
}

/**
 * Whether a unit should read as 'returned', given the returns pointing at it.
 *
 * `returns` is the source of truth for return state. A return only moves the
 * unit once it has actually been refunded -- an initiated return that the
 * merchant later denies must leave the item owned.
 */
export function deriveInventoryStatus(input: {
  current: InventoryStatus;
  returnStatuses: readonly string[];
}): InventoryStatus {
  if (input.returnStatuses.some((s) => s === 'refunded')) return 'returned';
  return input.current;
}

/**
 * Re-derive an order's state in the database.
 *
 * Prefer letting the triggers do this. Call it explicitly only after a bulk
 * import that deferred triggers, or from a backfill repair job.
 */
export async function syncOrderState(
  db: { unsafe: (query: string, params: unknown[]) => Promise<unknown> },
  orderId: string,
): Promise<void> {
  await db.unsafe('select public.sync_order_state($1)', [orderId]);
}
