import { Package, Receipt } from 'lucide-react';
import { AimButton } from '@/components/shell/aim-button';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import Link from '@/components/ui/link';

/**
 * The Add buttons on the Orders and Inventory lists (plan #1950.3.1), apart
 * from the pages so the gallery draws them as the pages do
 * (shopping-list-adds). Each opens capture aimed at its kind: one press makes
 * the order or the item and opens it.
 *
 * The receipt photo and the books and games flows keep a link of their own
 * until a photo and a barcode are steps inside capture (plan #1950.3.2).
 */

export function OrdersAddActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/shopping/orders/receipt" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        Receipt photo
      </Link>
      <AimButton aim={{ kind: 'order' }} label="Add an order" />
    </div>
  );
}

/**
 * No orders at all. The header's Add is already on screen, so the empty list
 * offers only what the header does not: connecting an inbox.
 */
export function OrdersEmpty() {
  return (
    <EmptyState
      icon={Receipt}
      title="No orders yet"
      description="Orders appear here as we find them in your inboxes, grouped by month. You can also add one by hand at any time."
      action={{ label: 'Connect an inbox', href: '/shopping/settings#inboxes' }}
    />
  );
}

export function InventoryAddActions() {
  return (
    <>
      <Link href="/shopping/inventory/add" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        Books and games
      </Link>
      <AimButton aim={{ kind: 'inventory-item' }} label="Add something you own" />
    </>
  );
}

/**
 * Nothing owned yet. The header's Add is already on screen, so the empty
 * list offers the other way in: an order, which adds what it holds.
 */
export function InventoryEmpty() {
  return (
    <EmptyState
      icon={Package}
      title="Nothing in your inventory yet"
      description="Every item from an order lands here as its own entry, so you can search what you own, mark things returned, or record that you got rid of them."
    >
      <AimButton aim={{ kind: 'order' }} label="Add an order" variant="secondary" size="md" />
    </EmptyState>
  );
}
