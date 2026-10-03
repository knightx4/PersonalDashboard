import type { Move } from '@/lib/core/move';
import type { ReturnsTrackerRow } from './types';

/**
 * Whose move a row on the returns list is (plan #1454;
 * docs/CORE-AND-DASH-SPEC.md, Part 3).
 *
 * Not yet delivered, it is waiting on whoever has the parcel: the carrier
 * once it has shipped, the shop before then. Delivered and inside its return
 * window, keeping it or sending it back is on you. Past the window, or with
 * no window, only an item you marked to return is still on you. A returned
 * item shows no move.
 */
export function returnMove(
  row: Pick<
    ReturnsTrackerRow,
    | 'status'
    | 'delivered'
    | 'orderStatus'
    | 'carrier'
    | 'merchantName'
    | 'daysLeft'
    | 'returnPlanned'
  >,
): { move: Move; title: string } | null {
  if (row.status === 'returned') return null;

  if (!row.delivered) {
    if (row.orderStatus === 'shipped') {
      return {
        move: { state: 'waiting', waitingOn: row.carrier?.trim() || 'the carrier' },
        title: 'On its way; the return window starts when it arrives.',
      };
    }
    return {
      move: { state: 'waiting', waitingOn: row.merchantName.trim() || 'the shop' },
      title: 'Not shipped yet; the return window starts when it arrives.',
    };
  }

  if (row.daysLeft != null && row.daysLeft >= 0) {
    return {
      move: { state: 'on_you' },
      title: row.returnPlanned
        ? 'You marked this to return; sending it back is yours.'
        : 'Inside its return window; keeping it or sending it back is yours.',
    };
  }

  if (row.returnPlanned) {
    return {
      move: { state: 'on_you' },
      title:
        row.daysLeft != null
          ? 'Marked to return and past its window; ask the shop or keep it.'
          : 'You marked this to return; sending it back is yours.',
    };
  }
  return null;
}
