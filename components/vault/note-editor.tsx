'use client';

import { useEffect, useRef } from 'react';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { essayHighlight } from '@/lib/learn/essays/editor';
import { livePreview } from '@/lib/learn/essays/live-preview';
import { wikiLinkPreview } from '@/lib/vault/markdown/wikilink-preview';

/**
 * The note editor: CodeMirror over the note's markdown with Obsidian's live
 * preview, so the note reads as it renders and the marks come back only on
 * the line being typed. Wikilinks render as links (wikilink-preview.ts).
 *
 * It is set in the rendered note's type (`.vault-prose`: 15px, line height
 * 1.7, about 68 characters), so opening it does not change how the note
 * reads. The document is uncontrolled, as in the essay editor: `initialDoc`
 * is read once, and `onChange` hands each new text up.
 */

const noteTheme = EditorView.theme({
  '&': { color: 'var(--c-ink)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.7', overflow: 'visible' },
  '.cm-content': { padding: '0', caretColor: 'var(--c-ink)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--c-ink)', borderLeftWidth: '2px' },
});

export function NoteEditor({
  initialDoc,
  label,
  autoFocus = false,
  caretAt,
  linkExists,
  onOpenLink,
  onChange,
  onBlur,
  onSaveNow,
  onClose,
}: {
  initialDoc: string;
  /** What a screen reader calls the editor. */
  label: string;
  autoFocus?: boolean;
  /** Where on screen the click that opened the editor landed; the caret goes there. */
  caretAt?: { x: number; y: number } | null;
  linkExists: (target: string) => boolean;
  onOpenLink: (target: string) => void;
  onChange: (doc: string) => void;
  onBlur?: () => void;
  /** Cmd-S or Ctrl-S. */
  onSaveNow?: () => void;
  /** Escape. */
  onClose?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ linkExists, onOpenLink, onChange, onBlur, onSaveNow, onClose });
  useEffect(() => {
    callbacks.current = { linkExists, onOpenLink, onChange, onBlur, onSaveNow, onClose };
  });
  const first = useRef({ initialDoc, label, autoFocus, caretAt });

  useEffect(() => {
    if (!host.current) return;
    const { initialDoc: doc, label: name, autoFocus: focus, caretAt: at } = first.current;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc,
        extensions: [
          history(),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                callbacks.current.onSaveNow?.();
                return true;
              },
            },
            {
              key: 'Escape',
              run: () => {
                if (!callbacks.current.onClose) return false;
                callbacks.current.onClose();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown({ base: markdownLanguage }),
          essayHighlight,
          livePreview,
          wikiLinkPreview({
            exists: (target) => callbacks.current.linkExists(target),
            open: (target) => callbacks.current.onOpenLink(target),
          }),
          noteTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': name,
            spellcheck: 'true',
            autocorrect: 'on',
            autocapitalize: 'sentences',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus) callbacks.current.onBlur?.();
          }),
        ],
      }),
    });
    if (focus) {
      view.focus();
      // The editor is laid out like the rendered note, so the place clicked
      // in one is close to the same words in the other.
      const pos = at ? view.posAtCoords(at, false) : null;
      if (pos !== null) view.dispatch({ selection: EditorSelection.cursor(pos) });
    }
    return () => view.destroy();
  }, []);

  return <div ref={host} className="vault-prose min-h-24" />;
}
