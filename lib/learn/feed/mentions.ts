/**
 * The ideas a Learn now card mentions, underlined on the card (plan #1056).
 *
 * The card writer names up to three other ideas the card leans on, each as
 * the exact words the card already uses and one line on why it matters to the
 * card. They are stored in `feed_cards.mentions` and the card underlines each
 * one where it first appears; a tap opens the phrase explanation of plan
 * #1057 without selecting anything.
 *
 * No database and no server code here: the writer uses `keepMentions` to throw
 * out a phrase the card does not contain, and the page uses `markMentions` to
 * split its text around the phrases. Both match the way the explanation's own
 * check does (`phraseOnCard`): whitespace flattened, case ignored.
 */

export type CardMention = {
  /** The words as the card has them. */
  phrase: string;
  /** One line on why the idea matters to this card. */
  why: string;
};

/** Mentions one card keeps. More than three turns the card into a page of links. */
export const MAX_MENTIONS = 3;
/** A mention is a term or a short phrase. */
export const MAX_MENTION_CHARS = 80;
/** The why is one line. */
export const MAX_MENTION_WHY_CHARS = 240;

function flat(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The mentions worth keeping from whatever the writer or the column holds.
 *
 * A mention is kept when its phrase is in one of `texts` and is not the card's
 * own name, at most three, one per phrase whatever its case. The why is kept
 * as written, or cut to its cap; one with no why is kept with an empty one,
 * since the underline and the explanation do not need it. With no `texts`,
 * the phrase is not checked, which is how the page reads the stored column.
 */
export function keepMentions(
  raw: unknown,
  card: { name?: string | null; texts?: readonly (string | null | undefined)[] } = {},
): CardMention[] {
  if (!Array.isArray(raw)) return [];
  const name = flat(card.name).toLowerCase();
  const texts = card.texts?.map((text) => flat(text).toLowerCase()).filter(Boolean);
  const kept: CardMention[] = [];
  for (const entry of raw) {
    if (kept.length >= MAX_MENTIONS) break;
    if (!entry || typeof entry !== 'object') continue;
    const phrase = flat((entry as { phrase?: unknown }).phrase);
    const lower = phrase.toLowerCase();
    if (!phrase || phrase.length > MAX_MENTION_CHARS || lower === name) continue;
    if (texts && !texts.some((text) => text.includes(lower))) continue;
    if (kept.some((mention) => mention.phrase.toLowerCase() === lower)) continue;
    const why = flat((entry as { why?: unknown }).why).slice(0, MAX_MENTION_WHY_CHARS);
    kept.push({ phrase, why });
  }
  return kept;
}

/** A run of a card's text: plain, or a mention to underline. */
export type MarkedPart = { text: string; mention: CardMention | null };

/**
 * Each text split around the mentions, in the order the card shows them.
 *
 * A mention is underlined once, where it first appears across all the texts,
 * so a term the card uses four times is not underlined four times. The text
 * keeps its own case: "Tree search" at the start of a sentence is underlined
 * as written. Where two mentions overlap, the one that starts first wins, and
 * the longer one when they start together.
 */
export function markMentions(
  texts: readonly string[],
  mentions: readonly CardMention[],
): MarkedPart[][] {
  const left = [...mentions];
  return texts.map((text) => {
    const lower = text.toLowerCase();
    const found: { at: number; end: number; mention: CardMention }[] = [];
    for (const mention of left) {
      const at = lower.indexOf(mention.phrase.toLowerCase());
      if (at >= 0) found.push({ at, end: at + mention.phrase.length, mention });
    }
    found.sort((a, b) => a.at - b.at || b.end - a.end);

    const parts: MarkedPart[] = [];
    let cursor = 0;
    for (const hit of found) {
      if (hit.at < cursor) continue;
      if (hit.at > cursor) parts.push({ text: text.slice(cursor, hit.at), mention: null });
      parts.push({ text: text.slice(hit.at, hit.end), mention: hit.mention });
      cursor = hit.end;
      left.splice(left.indexOf(hit.mention), 1);
    }
    if (cursor < text.length || parts.length === 0)
      parts.push({ text: text.slice(cursor), mention: null });
    return parts;
  });
}
