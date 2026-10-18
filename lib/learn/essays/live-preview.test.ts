import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { activeLines, hiddenRanges } from './live-preview';

/** The markdown symbols hidden off the cursor's line (note 210d50b9). */
function shownText(doc: string, cursorLine: number | null): string {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  if (cursorLine !== null)
    state = state.update({ selection: EditorSelection.cursor(state.doc.line(cursorLine).from) }).state;
  ensureSyntaxTree(state, state.doc.length, 5000);
  const ranges = hiddenRanges(state, activeLines(state, cursorLine !== null));
  let out = '';
  let at = 0;
  for (const range of ranges) {
    out += doc.slice(at, range.from);
    at = Math.max(at, range.to);
  }
  return out + doc.slice(at);
}

describe('livePreview', () => {
  const doc = '## Why gold\n\nIt is *rare* and **heavy**, see [the book](https://x.com) and `code`.\n\n> A quote\n- a list item';

  it('hides the symbols on every line when the editor is not focused', () => {
    expect(shownText(doc, null)).toBe(
      'Why gold\n\nIt is rare and heavy, see the book and code.\n\n> A quote\n- a list item',
    );
  });

  it('shows the symbols on the line the cursor is on', () => {
    expect(shownText(doc, 3)).toBe(
      'Why gold\n\nIt is *rare* and **heavy**, see [the book](https://x.com) and `code`.\n\n> A quote\n- a list item',
    );
    expect(shownText(doc, 1).startsWith('## Why gold\n\nIt is rare')).toBe(true);
  });

  it('keeps the fences of a code block', () => {
    const fenced = '```\nlet x = *y*;\n```';
    expect(shownText(fenced, null)).toBe(fenced);
  });
});
