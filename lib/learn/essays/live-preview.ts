import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

/**
 * Obsidian's live preview in the essay editor (note 210d50b9): the markdown
 * symbols are hidden on every line but the ones the cursor or selection is
 * on, where they come back to be seen and deleted. Nothing in the text
 * changes; the symbols are only not drawn.
 *
 * Hidden: the `#` of a heading and the space after it, `*` and `_` around
 * emphasis, `~~`, the backticks of inline code, and a link's brackets with
 * its address, so `[text](url)` reads as `text`. Quote and list marks stay,
 * dimmed, since they also say where a line starts.
 */

const HIDDEN = new Set(['HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark']);

/** The ranges to hide in `from`..`to`, in order, skipping the lines in `shown`. */
export function hiddenRanges(
  state: EditorState,
  shown: ReadonlySet<number>,
  from = 0,
  to = state.doc.length,
): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const doc = state.doc;
  const visible = (pos: number) => shown.has(doc.lineAt(pos).number);
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      // A fenced code block keeps its fences: hiding them would run the code into the prose.
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
      if (node.name === 'Link') {
        if (visible(node.from) || visible(node.to)) return false;
        const marks: { from: number; to: number }[] = [];
        for (let child = node.node.firstChild; child; child = child.nextSibling)
          if (child.name === 'LinkMark') marks.push({ from: child.from, to: child.to });
        // [ text ] ( url ) has four marks; a reference or bare [text] keeps its brackets.
        if (marks.length === 4) {
          out.push(marks[0], { from: marks[1].from, to: node.to });
        }
        return false;
      }
      if (!HIDDEN.has(node.name) || visible(node.from)) return;
      let end = node.to;
      if (node.name === 'HeaderMark' && doc.sliceString(end, end + 1) === ' ') end += 1;
      // A closing heading mark, `## Title ##`, has nothing after it on the line.
      if (end > node.from) out.push({ from: node.from, to: end });
    },
  });
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The line numbers the selection touches, or none while the editor is not focused. */
export function activeLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) lines.add(n);
  }
  return lines;
}

const hide = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const shown = activeLines(view.state, view.hasFocus);
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (const range of hiddenRanges(view.state, shown, from, to)) {
      // A node across two visible ranges comes back twice, and a plugin may not hide a line break.
      if (range.from < last || doc.lineAt(range.from).number !== doc.lineAt(range.to).number) continue;
      builder.add(range.from, range.to, hide);
      last = range.to;
    }
  }
  return builder.finish();
}

export const livePreview: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = build(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
