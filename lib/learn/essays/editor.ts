import { EditorState, RangeSetBuilder, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
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
 * 1.6. The colours are the app's tokens, so the four themes follow.
 */
export const essayTheme = EditorView.theme({
  '&': { fontSize: '19px', color: 'var(--color-ink)', backgroundColor: 'transparent' },
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
 * Markdown symbols dimmed rather than hidden, so `#`, `*` and `>` stay where
 * you can see and delete them. Headings are larger.
 */
export const essayHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.processingInstruction, color: 'var(--color-ink-muted)' },
    { tag: tags.heading1, fontSize: '1.45em', fontWeight: '600', lineHeight: '1.3' },
    { tag: tags.heading2, fontSize: '1.25em', fontWeight: '600', lineHeight: '1.35' },
    { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontSize: '1.1em', fontWeight: '600' },
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
 * The line you are typing stays in the middle of the screen. Only typing and
 * moving the cursor from the keyboard re-centre it; a click leaves the page
 * where it is, since the line you clicked is already where you are looking.
 * `wide` is asked on every transaction, so a phone, where the keyboard takes
 * half the screen, keeps the browser's own scrolling.
 */
export function typewriterScroll(wide: () => boolean): Extension {
  return EditorState.transactionExtender.of((tr) => {
    if (!wide()) return null;
    const typed =
      tr.docChanged &&
      (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    const moved =
      !tr.docChanged && tr.selection !== undefined && tr.isUserEvent('select') && !tr.isUserEvent('select.pointer');
    if (!typed && !moved) return null;
    return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) };
  });
}
