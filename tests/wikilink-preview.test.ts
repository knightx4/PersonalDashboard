/**
 * Wikilinks in the note editor's live preview: which characters are hidden
 * away from the cursor and which are drawn as the link.
 */
import { describe, expect, it } from 'vitest';
import { wikiLinkPieces } from '@/lib/vault/markdown/wikilink-preview';

const always = () => true;

/** Each piece as the text it covers and whether it is hidden. */
function pieces(text: string, shown: boolean) {
  return wikiLinkPieces(text, 0, shown, always).map((piece) => ({
    text: text.slice(piece.from, piece.to),
    hidden: piece.deco.spec.class === undefined && !piece.deco.spec.attributes,
  }));
}

describe('a wikilink away from the cursor', () => {
  it('reads as its target', () => {
    expect(pieces('Related to [[Introversion]].', false)).toEqual([
      { text: '[[', hidden: true },
      { text: 'Introversion', hidden: false },
      { text: ']]', hidden: true },
    ]);
  });

  it('reads as its alias when it has one', () => {
    expect(pieces('[[Rest in reason|reason]]', false)).toEqual([
      { text: '[[Rest in reason|', hidden: true },
      { text: 'reason', hidden: false },
      { text: ']]', hidden: true },
    ]);
  });

  it('hides the mark of an embed too', () => {
    expect(pieces('![[photo.png]]', false)[0].text).toBe('![[');
  });
});

describe('a wikilink on the line being typed', () => {
  it('keeps every character, with the brackets dimmed', () => {
    const shown = wikiLinkPieces('[[career]]', 0, true, always);
    expect(shown.map((piece) => piece.deco.spec.class)).toEqual([
      'cm-wikilink-mark',
      'cm-wikilink',
      'cm-wikilink-mark',
    ]);
  });
});

it('draws a link to a note not in the vault fainter', () => {
  const [, label] = wikiLinkPieces('[[Nowhere]]', 0, false, () => false);
  expect(label.deco.spec.class).toBe('cm-wikilink cm-wikilink-missing');
});
