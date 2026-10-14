import type { LearnChangeInput } from './learn-changes';

/**
 * The Shopping changes Dash makes straight away (plan #1894.5.1, feature
 * #1894.5), beyond change_items' bulk ones (lib/dash/bulk-items.ts).
 *
 * They take the shape Learn's six set out (lib/ask/learn-changes.ts): the
 * tool that made the change wrote the sentence and the link when it made it
 * (lib/dash/shopping-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The write tools, by name, which is the kind each change is kept under. */
export const SHOPPING_CHANGE_KINDS = [
  'change_item',
  'item_lists',
  'add_items',
  'change_saved_item',
  'change_recurring',
  'return_window',
  'change_person',
] as const;

export type ShoppingChangeKind = (typeof SHOPPING_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type ShoppingChangeInput = LearnChangeInput;

export function isShoppingChangeKind(kind: string): kind is ShoppingChangeKind {
  return (SHOPPING_CHANGE_KINDS as readonly string[]).includes(kind);
}
