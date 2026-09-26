import { cardTitle, type FeedCardRow } from './card';

/**
 * What Dash is given when you ask about a Learn now card (plan #1052): the
 * card's own text and the passage it was written from.
 *
 * A section card's passage is its catalogue section; a lesson's is the
 * section it cites, when one was close enough to its claim. A unit check has
 * nothing to ask about here, since its expected answer stays on the server
 * until the check is answered, and a queued reading is not a card.
 */

export type CardMaterial = { title: string; text: string };

export function cardMaterial(row: FeedCardRow): CardMaterial | null {
  if (row.reason === 'queued' || row.reason === 'unit_check') return null;

  const lesson = row.reason === 'lesson';
  const item = lesson ? (row.source_item ?? null) : row.item;
  const segment = lesson ? (item ? (row.source_segment ?? null) : null) : row.segment;
  if (!lesson && (!item || !segment)) return null;

  const title =
    row.idea_name?.trim() || (item && segment ? cardTitle(item.title, segment.heading) : '');
  if (!title) return null;

  const parts: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const text = value?.trim();
    if (text) parts.push(`${label}: ${text}`);
  };
  add('Takeaway', row.takeaway);
  add('Context', row.context);
  add('Summary', row.summary);
  add('Example', row.example);
  if (item && segment?.text.trim()) {
    const where = cardTitle(item.title, segment.heading);
    parts.push(`The passage the card was written from (${where}):\n\n${segment.text.trim()}`);
  }
  if (parts.length === 0) return null;
  return { title, text: parts.join('\n\n') };
}

/** Added to Dash's instructions for a card: the material is the card and its passage. */
export const CARD_REPLY_GUIDANCE = `THE MATERIAL IS A LEARNING CARD: its takeaway, context, summary and example,
then the passage it was written from. When a question goes past what the card
and the passage cover, say so in a sentence before anything else, and do not
guess at what the passage would have said. Answer beyond it only with what you
are sure of, marked as going beyond the card.`;
