import { RangeSetBuilder, type Extension, type Text } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EASE, MOTION_MS } from '@/lib/motion';

/**
 * The CodeMirror pieces the essay editor is made of (docs/LEARN-ESSAYS-SPEC.md,
 * "The writing surface"; plan #1865). The editor edits the markdown text
 * itself, so nothing here changes what is saved: the look is decorations and
 * styles over the same characters.
 */

/**
 * The page's type. One column of about 66 characters at 19px and line height
 * 1.6, times the text size the person chose (`--essay-scale`, note 210d50b9).
 * The colours are the app's tokens, so the four themes follow.
 */
export const essayTheme = EditorView.theme({
  '&': { fontSize: 'calc(19px * var(--essay-scale, 1))', color: 'var(--color-ink)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6', overflow: 'visible' },
  // 33em rather than 66ch: `ch` is the width of a zero, wider than the
  // average letter, so 66ch held about 85 characters of prose.
  '.cm-content': { maxWidth: '33em', padding: '0', caretColor: 'var(--color-ink)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-ink)', borderLeftWidth: '2px' },
  '.cm-placeholder': { color: 'var(--color-ink-muted)' },
  '.cm-essay-dim': { opacity: '0.35', transition: `opacity ${MOTION_MS.quick}ms ${EASE.outSoft}` },
});

/**
 * Markdown symbols dimmed where they show: on the cursor's line, and `>` and
 * list marks everywhere. Elsewhere live-preview.ts hides them, as Obsidian's
 * live preview does. Headings are larger.
 */
export const essayHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.processingInstruction, color: 'var(--color-ink-muted)' },
    { tag: tags.heading1, fontSize: '1.45em', fontWeight: '600', lineHeight: '1.3' },
    { tag: tags.heading2, fontSize: '1.25em', fontWeight: '600', lineHeight: '1.35' },
    {
      tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
      fontSize: '1.1em',
      fontWeight: '600',
    },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: '600' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: [tags.link, tags.url], color: 'var(--color-ink-muted)' },
    { tag: tags.quote, fontStyle: 'italic' },
    { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  ]),
);

/**
 * The paragraph a line sits in, as first and last line numbers: the run of
 * non-blank lines around it. A blank line is a paragraph of its own.
 */
export function paragraphAround(doc: Text, lineNumber: number): { first: number; last: number } {
  const blank = (n: number) => doc.line(n).text.trim() === '';
  if (blank(lineNumber)) return { first: lineNumber, last: lineNumber };
  let first = lineNumber;
  let last = lineNumber;
  while (first > 1 && !blank(first - 1)) first -= 1;
  while (last < doc.lines && !blank(last + 1)) last += 1;
  return { first, last };
}

function dimOutside(view: EditorView): DecorationSet {
  const { state } = view;
  const here = state.doc.lineAt(state.selection.main.head).number;
  const { first, last } = paragraphAround(state.doc, here);
  const dim = Decoration.line({ class: 'cm-essay-dim' });
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (line.number < first || line.number > last) builder.add(line.from, line.from, dim);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** Focus mode: every line outside the paragraph you are in is dimmed. */
export const focusParagraph: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = dimOutside(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = dimOutside(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Room kept around the caret, so the line you are typing never sits on the
 * screen's edge. The page scrolls only when the caret would come within a
 * third of the screen of the bottom, or under the app's header at the top,
 * and then only as far as it must. Re-centring on every keystroke, as this
 * did before, moved the page under the person on each letter (note of 16
 * October 2026). `wide` is asked each time, so a phone, where the keyboard
 * takes half the screen, keeps the browser's own scrolling.
 */
export function caretRoom(wide: () => boolean): Extension {
  return EditorView.scrollMargins.of(() =>
    wide() ? { top: 128, bottom: Math.round(window.innerHeight / 3) } : null,
  );
}
