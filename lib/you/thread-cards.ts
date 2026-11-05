import type { ThreadMessage } from './chat-threads-model';

/**
 * Where a card goes in a People thread (plan #2854.2.1). Something someone
 * on People did hangs from your text that asked for it, and is drawn after
 * their reply to that text: under the last of their messages that follow
 * yours, before you wrote again. Until the reply comes in it sits under your
 * text, so a change is never hidden by a reply that has not arrived.
 *
 * Generic over what is placed, so the change cards (DashChange) and the live
 * card of #2854.3 share one rule. An item whose text is not on the page
 * (older than the page loaded, or removed) is left out; it shows once an
 * older page brings its text in.
 *
 * The result maps the id of the message to draw after to the items there,
 * each list in the order given.
 */
export function placeAfterReplies<T>(
  messages: readonly Pick<ThreadMessage, 'id' | 'role'>[],
  items: readonly T[],
  anchorOf: (item: T) => string | null | undefined,
): Map<string, T[]> {
  const after = new Map<string, string>();
  let asked: string | null = null;
  for (const m of messages) {
    if (m.role === 'person') {
      asked = m.id;
      after.set(m.id, m.id);
    } else if (asked) {
      after.set(asked, m.id);
    }
  }
  const placed = new Map<string, T[]>();
  for (const item of items) {
    const anchor = anchorOf(item);
    const at = anchor ? after.get(anchor) : undefined;
    if (!at) continue;
    const list = placed.get(at);
    if (list) list.push(item);
    else placed.set(at, [item]);
  }
  return placed;
}

/** A thread's list with one item replaced by id, or added at the end when it is new. */
export function withItem<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}
