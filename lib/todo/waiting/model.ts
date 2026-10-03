import { waitingOnName, type WaitingOn } from '@/lib/core/move';
import type { ApplicationMoveRow } from '@/lib/jobs/applications/moves';
import type { ModuleId } from '@/lib/modules';
import { returnMove } from '@/lib/returns/move';
import type { ReturnsTrackerRow } from '@/lib/returns/types';
import type { AgendaItemLink } from '@/lib/todo/agenda/sources';

/**
 * Todo's Waiting view (plan #1475; docs/CORE-AND-DASH-SPEC.md, Part 4):
 * everything whose move is `waiting`, from every workspace that works one
 * out, grouped by who it waits on. The moves come from each workspace's own
 * rule (lib/jobs/move.ts, lib/returns/move.ts), so a row says the same thing
 * here as on its own page, and it leaves this view the moment that rule says
 * the move is yours.
 *
 * Pure: the reading is in load.ts.
 */

export interface WaitingEntry {
  key: string;
  /** The row it is about, as `schema.table:id` (lib/core/refs.ts). */
  ref: string;
  module: ModuleId;
  title: string;
  detail: string | null;
  waitingOn?: WaitingOn;
  /** Why it is waiting, in its workspace's own words. */
  why: string;
  /** When it started waiting, as near as the workspace knows. */
  since: string | null;
  link: AgendaItemLink | null;
}

export interface WaitingGroup {
  key: string;
  /** Who it waits on, as the rows name them. */
  name: string;
  entries: WaitingEntry[];
}

/** Rows that know only that someone else has the move. */
export const SOMEONE_ELSE = 'Someone else';

/** One group per party, matched on a ref where there is one and otherwise on the name, ignoring case. */
function groupKey(waitingOn: WaitingOn | undefined): string {
  if (!waitingOn) return 'someone';
  if (typeof waitingOn !== 'string') return `ref:${waitingOn.ref}`;
  const name = waitingOn.trim().toLowerCase();
  return name ? `name:${name}` : 'someone';
}

function bySince(a: WaitingEntry, b: WaitingEntry): number {
  if (a.since && b.since) return a.since.localeCompare(b.since);
  if (a.since) return -1;
  if (b.since) return 1;
  return a.title.localeCompare(b.title);
}

/**
 * Group the waiting rows by who they wait on. Inside a group the one waited
 * on longest is first, and the groups are in the order of their longest
 * wait, so what has gone quietest is at the top. "Someone else" goes last.
 */
export function groupWaiting(entries: readonly WaitingEntry[]): WaitingGroup[] {
  const groups = new Map<string, WaitingGroup>();
  for (const entry of entries) {
    const key = groupKey(entry.waitingOn);
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
      continue;
    }
    const name = entry.waitingOn ? waitingOnName(entry.waitingOn).trim() : '';
    groups.set(key, { key, name: name || SOMEONE_ELSE, entries: [entry] });
  }

  const list = [...groups.values()];
  for (const group of list) group.entries.sort(bySince);
  return list.sort((a, b) => {
    if (a.key === 'someone') return 1;
    if (b.key === 'someone') return -1;
    return bySince(a.entries[0], b.entries[0]) || a.name.localeCompare(b.name);
  });
}

/** The applications waiting on their company. */
export function applicationWaits(rows: readonly ApplicationMoveRow[]): WaitingEntry[] {
  return rows.flatMap((row) => {
    if (row.move.state !== 'waiting') return [];
    return [
      {
        key: `application:${row.applicationId}`,
        ref: `job_search.applications:${row.applicationId}`,
        module: 'jobs' as const,
        title: row.roleTitle || 'An application',
        detail: null,
        waitingOn: row.move.waitingOn,
        why: row.why,
        since: row.since,
        link: row.roleId ? { href: `/jobs/roles/${row.roleId}`, label: 'Open the role' } : null,
      },
    ];
  });
}

/**
 * Orders still on their way, one entry per order rather than per item: the
 * carrier is bringing the parcel, not each thing in it.
 */
export function returnWaits(rows: readonly ReturnsTrackerRow[]): WaitingEntry[] {
  const orders = new Map<string, { rows: ReturnsTrackerRow[]; move: ReturnType<typeof returnMove> }>();
  for (const row of rows) {
    const move = returnMove(row);
    if (move?.move.state !== 'waiting') continue;
    const order = orders.get(row.orderId);
    if (order) order.rows.push(row);
    else orders.set(row.orderId, { rows: [row], move });
  }

  return [...orders.entries()].map(([orderId, { rows: items, move }]) => {
    const first = items[0];
    const more = items.length - 1;
    return {
      key: `order:${orderId}`,
      ref: `public.orders:${orderId}`,
      module: 'shopping' as const,
      title: more > 0 ? `${first.name} and ${more} more` : first.name,
      detail: first.externalOrderNumber ? `#${first.externalOrderNumber}` : null,
      waitingOn: move?.move.state === 'waiting' ? move.move.waitingOn : undefined,
      why: move?.title ?? '',
      since: first.orderDate,
      link: { href: `/shopping/orders/${orderId}`, label: 'Open the order' },
    };
  });
}

/**
 * "Since 22 May", in the reader's zone. A bare calendar day is shown as that
 * day, not moved through a zone.
 */
export function sinceLabel(since: string | null, timezone: string, now: Date = new Date()): string | null {
  if (!since) return null;
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(since);
  const date = new Date(dayOnly ? `${since}T00:00:00Z` : since);
  if (Number.isNaN(date.getTime())) return null;
  const zone = dayOnly ? 'UTC' : timezone;
  const sameYear =
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric' }).format(date) ===
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric' }).format(now);
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
  return `Since ${day}`;
}
