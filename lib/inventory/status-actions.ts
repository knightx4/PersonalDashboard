/**
 * Inventory status changes that application code is allowed to make.
 *
 * "Returned" is NOT here. A return is a row in `returns` with status
 * `refunded`; public.sync_order_state() is the only thing that may set
 * inventory_items.status = 'returned'. Disposed / sold / gifted / lost are
 * user actions on the unit itself, so those statuses are written directly.
 */
import type { InventoryStatus } from '@/lib/status';

export type DisposalMethod = 'donated' | 'trashed' | 'sold' | 'gifted' | 'recycled';

/** Map a disposal method onto the inventory status it implies. */
export function inventoryStatusForDisposal(method: DisposalMethod): InventoryStatus {
  switch (method) {
    case 'sold':
      return 'sold';
    case 'gifted':
      return 'gifted';
    case 'donated':
    case 'trashed':
    case 'recycled':
      return 'disposed';
  }
}

export const DISPOSAL_METHODS = [
  'donated',
  'trashed',
  'sold',
  'gifted',
  'recycled',
] as const satisfies readonly DisposalMethod[];
