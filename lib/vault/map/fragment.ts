/**
 * A text fragment (`#:~:text=…`) that makes the browser scroll to a position's
 * sentence and highlight it when the note opens. It is what makes the second
 * tap from a theme land on the sentence rather than the top of a long note
 * (#758), and it costs no anchor in the note and no script on the page.
 *
 * The quote is the note's markdown source, checked character for character,
 * and the page shows it rendered. So the markup that rendering removes is
 * removed here too: emphasis, code ticks, heading and list marks, and the
 * brackets of both kinds of link. What cannot be matched after that -- a quote
 * across a table, say -- fails quietly: the note opens at the top, as any link
 * to it would. A browser without text fragments does the same.
 *
 * Only the first line of the quote is used, and a long line becomes a start
 * and an end of a few words each, because a match across block elements is the
 * part browsers disagree on and a long exact string is the part most likely to
 * differ by one character.
 */

const EDGE_WORDS = 4;

export function quoteFragment(quote: string): string {
  const line = quote
    .split('\n')
    .map(renderedText)
    .find((l) => l.length > 0);
  if (!line) return '';

  const words = line.split(/\s+/);
  if (words.length <= EDGE_WORDS * 2) return `#:~:text=${encodePart(line)}`;
  const start = words.slice(0, EDGE_WORDS).join(' ');
  const end = words.slice(-EDGE_WORDS).join(' ');
  return `#:~:text=${encodePart(start)},${encodePart(end)}`;
}

/** One line of markdown as it reads on the page. */
export function renderedText(line: string): string {
  return line
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[target|alias]]
    .replace(/!?\[\[([^\]#|]+)(#[^\]]*)?\]\]/g, (_, target: string) =>
      target.slice(target.lastIndexOf('/') + 1),
    ) // [[folder/Target#heading]]
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url)
    .replace(/^\s*(?:>\s*)+/, '') // blockquote marks
    .replace(/^\s*#{1,6}\s+/, '') // heading marks
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '') // list and task marks
    .replace(/(\*\*|__|~~|==|`)/g, '')
    .replace(/(^|\W)[*_](?=\S)|(?<=\S)[*_](?=\W|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `-`, `,` and `&` are the directive's own syntax. encodeURIComponent already
 * escapes the last two and leaves the hyphen, so that one is done by hand.
 */
function encodePart(text: string): string {
  return encodeURIComponent(text).replace(/-/g, '%2D');
}
