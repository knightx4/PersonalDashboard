/**
 * A note's maths, rendered.
 *
 * Note 575cab72: the vault mirrors Obsidian notes, and a note about the Kelly
 * criterion was showing its formulae as the dollar signs and backslashes they
 * are written with.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteBody } from '@/components/vault/note-body';

function render(markdown: string): string {
  return renderToStaticMarkup(<NoteBody markdown={markdown} />);
}

describe('maths in a note', () => {
  it('sets an inline formula as maths rather than as its source', () => {
    const html = render('The edge is $f^* = \\frac{bp - q}{b}$ of the bankroll.');

    expect(html).toContain('class="katex"');
    // The MathML KaTeX writes beside the visible glyphs, which is what a
    // screen reader and a copy out of the page both read. The TeX itself is
    // in there too, as the annotation KaTeX keeps for copying out.
    expect(html).toContain('<math');
    expect(html).toContain('annotation encoding="application/x-tex"');
  });

  it('sets a formula on its own line as a block', () => {
    const html = render('The bet size:\n\n$$\nf^* = p - \\frac{q}{b}\n$$\n');

    expect(html).toContain('katex-display');
  });

  // The closing dollar has to sit against the character before it, so prices
  // in a sentence are prices.
  it('leaves two dollar amounts in a sentence alone', () => {
    const html = render('It went for $20 and the next one for $30.');

    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$20 and the next one for $30.');
  });

  // The walk that hands prices back has to reach every block, not only the
  // paragraphs at the top of the note.
  it('reads maths inside a list the same as maths in a paragraph', () => {
    const html = render('- The edge, $b$, against the odds\n- Paid $15 and then $25\n');

    expect(html).toContain('class="katex"');
    expect(html).toContain('Paid $15 and then $25');
  });

  // One bad formula must cost the formula, not the note.
  it('shows an expression it cannot parse as its own source, marked wrong', () => {
    const html = render('Broken: $\\frac{1}{2$ and the rest of the note.');

    expect(html).toContain('katex-error');
    expect(html).toContain('and the rest of the note.');
  });
});
