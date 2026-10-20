import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { activeLines } from '@/lib/learn/essays/live-preview';
import { parseWikiLink } from './obsidian';

/**
 * Obsidian's wikilinks in the note editor's live preview. The markdown parser
 * knows nothing of `[[...]]`, so without this the brackets are drawn as typed
 * and a linked note reads as a wall of them.
 *
 * Away from the cursor, `[[Note]]` reads as `Note` and `[[Note|shown]]` as
 * `shown`, in the link colour; on the line being typed the whole of it comes
 * back, with the brackets dimmed. Nothing in the text changes. A link whose
 * note is not in the vault is drawn in muted ink, as Obsidian draws it fainter.
 *
 * A click on a link away from the cursor opens it, and so does Cmd- or
 * Ctrl-click anywhere; `open` is handed the target as written.
 */

const WIKILINK = /(!)?\[\[([^\]\n]+)\]\]/g;

export type WikiLinkPreviewOptions = {
  /** Whether a target as written names a note in the vault. */
  exists: (target: string) => boolean;
  /** Open the note a link names. */
  open: (target: string) => void;
};

type Piece = { from: number; to: number; deco: Decoration };

const hide = Decoration.replace({});
const dimMark = Decoration.mark({ class: 'cm-wikilink-mark' });

function linkMark(target: string, found: boolean): Decoration {
  return Decoration.mark({
    class: found ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-missing',
    attributes: { 'data-wikilink': target },
  });
}

/** The decorations for one line's links, in order. */
export function wikiLinkPieces(
  text: string,
  offset: number,
  shown: boolean,
  exists: (target: string) => boolean,
): Piece[] {
  const out: Piece[] = [];
  for (const match of text.matchAll(WIKILINK)) {
    const start = offset + (match.index ?? 0);
    const open = start + (match[1] ? 3 : 2);
    const inner = match[2];
    const close = open + inner.length;
    const link = parseWikiLink(inner, Boolean(match[1]));
    const target = link.target || `#${link.anchor ?? ''}`;
    const mark = linkMark(target, !link.target || exists(link.target));

    if (shown) {
      out.push({ from: start, to: open, deco: dimMark });
      out.push({ from: open, to: close, deco: mark });
      out.push({ from: close, to: close + 2, deco: dimMark });
      continue;
    }

    // With an alias only the part after the pipe is shown.
    const pipe = inner.indexOf('|');
    const labelFrom = pipe === -1 ? open : open + pipe + 1;
    out.push({ from: start, to: labelFrom, deco: hide });
    if (close > labelFrom) out.push({ from: labelFrom, to: close, deco: mark });
    out.push({ from: close, to: close + 2, deco: hide });
  }
  return out;
}

function build(view: EditorView, exists: (target: string) => boolean): DecorationSet {
  const shown = activeLines(view.state, view.hasFocus);
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      if (line.from > last) {
        for (const piece of wikiLinkPieces(line.text, line.from, shown.has(line.number), exists))
          builder.add(piece.from, piece.to, piece.deco);
        last = line.from;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export function wikiLinkPreview({ exists, open }: WikiLinkPreviewOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, exists);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged)
          this.decorations = build(update.view, exists);
      }
    },
    { decorations: (value) => value.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const element = (event.target as HTMLElement).closest<HTMLElement>('[data-wikilink]');
      if (!element) return false;
      const pos = view.posAtDOM(element);
      const lineShown = activeLines(view.state, view.hasFocus).has(view.state.doc.lineAt(pos).number);
      if (lineShown && !(event.metaKey || event.ctrlKey)) return false;
      event.preventDefault();
      open(element.dataset.wikilink ?? '');
      return true;
    },
  });

  const theme = EditorView.theme({
    '.cm-wikilink': { color: 'var(--c-accent)', cursor: 'pointer' },
    // The parser reads `[Note]` inside the brackets as a link and colours it too.
    '.cm-wikilink *': { color: 'inherit' },
    '.cm-wikilink-missing': { color: 'var(--c-ink-muted)' },
    '.cm-wikilink-mark': { color: 'var(--c-ink-muted)' },
  });

  return [plugin, clicks, theme];
}
