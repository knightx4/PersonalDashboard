import { NO_GROUP, type GroupBucket, type ListDisplaySpec } from '@/lib/list-display';

/**
 * What the orders list offers: four sorts, four groupings, and the lines a row
 * can lose.
 *
 * The list had no sort control at all and was locked into months. Everything
 * here reads off one row shape the page builds first, with the total already
 * converted into the display currency -- sorting by a mix of native totals
 * would put a 50,000 yen order above a 400 dollar one.
 */

export type SortableOrder = {
  orderDate: string;
  /** Already converted, so a sort by total compares like with like. */
  displayTotalCents: number;
  merchantName: string;
  status: string;
  statusLabel: string;
  statusRank: number;
  personName: string | null;
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function monthBucket(orderDate: string): GroupBucket | null {
  if (orderDate.length < 7) return null;
  const key = orderDate.slice(0, 7);
  const [year, month] = key.split('-').map(Number);
  const name = MONTH_NAMES[(month ?? 1) - 1];
  return name ? { key, label: `${name} ${year}` } : null;
}

/**
 * The declaration. `withPeople` is false on a one-person account, where
 * grouping by person is a heading over every row -- the same reason the person
 * filter is not drawn there.
 */
export function ordersDisplay<T extends SortableOrder>(options?: {
  withPeople?: boolean;
}): ListDisplaySpec<T> {
  const byDate = (a: T, b: T) => a.orderDate.localeCompare(b.orderDate);

  return {
    pathname: '/shopping/orders',
    sorts: [
      { id: 'newest', label: 'Newest', compare: (a, b) => byDate(b, a) },
      { id: 'oldest', label: 'Oldest', compare: byDate },
      {
        id: 'total_desc',
        label: 'Total: high to low',
        compare: (a, b) => b.displayTotalCents - a.displayTotalCents || byDate(b, a),
      },
      {
        id: 'total_asc',
        label: 'Total: low to high',
        compare: (a, b) => a.displayTotalCents - b.displayTotalCents || byDate(b, a),
      },
    ],
    groups: [
      {
        id: 'month',
        label: 'Month',
        bucket: (order) => monthBucket(order.orderDate),
        order: 'key-desc',
        emptyLabel: 'No date',
      },
      {
        id: 'merchant',
        label: 'Merchant',
        bucket: (order) => ({ key: order.merchantName.toLowerCase(), label: order.merchantName }),
      },
      {
        id: 'status',
        // Ranked rather than alphabetical: an order moves through these, and
        // "Cancelled, Delivered, Ordered, Shipped" is the order of nothing.
        label: 'Status',
        bucket: (order) => ({
          key: order.status,
          label: order.statusLabel,
          rank: order.statusRank,
        }),
      },
      ...(options?.withPeople === false
        ? []
        : [
            {
              id: 'person',
              label: 'Person',
              bucket: (order: T) =>
                order.personName ? { key: order.personName.toLowerCase(), label: order.personName } : null,
              emptyLabel: 'Nobody in particular',
            },
          ]),
    ],
    properties: [
      { id: 'merchant', label: 'Merchant', alwaysOn: true },
      { id: 'number', label: 'Order number' },
      { id: 'inbox', label: 'Inbox it came from' },
      { id: 'person', label: 'Whose order it is' },
      { id: 'items', label: 'What was in it' },
    ],
    defaultSort: 'newest',
    defaultGroup: 'month',
  };
}

/** The grouping the list opens on, kept beside the spec so the page and its links agree. */
export const DEFAULT_ORDERS_GROUP = 'month';
export const NO_ORDERS_GROUP = NO_GROUP;
