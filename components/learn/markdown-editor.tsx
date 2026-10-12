'use client';

import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  essayHighlight,
  essayTheme,
  focusParagraph,
  typewriterScroll,
} from '@/lib/learn/essays/editor';

/** From laptop width the essay page is the calm one; below it a plain editor. */
const WIDE = '(min-width: 1024px)';

/**
 * The essay editor (plan #1865): CodeMirror 6 over the markdown text itself,
 * so what is saved is exactly what was typed (docs/LEARN-ESSAYS-SPEC.md, "The
 * writing surface").
 *
 * The document is uncontrolled: CodeMirror owns it, and `onChange` hands each
 * new text up for the word count and the save. `initialDoc` is read once, on
 * mount. The callbacks are read through a ref, so a parent re-rendering on
 * every keystroke never rebuilds the editor.
 */
export function MarkdownEditor({
  initialDoc,
  label,
  placeholder,
  focusMode = false,
  autoFocus = false,
  onChange,
  onTyping,
  onSaveNow,
}: {
  initialDoc: string;
  /** What a screen reader calls the editor. */
  label: string;
  placeholder?: string;
  /** Dims every paragraph but the one the cursor is in. */
  focusMode?: boolean;
  autoFocus?: boolean;
  onChange?: (doc: string) => void;
  /** Called on each keystroke that changes the text, to hide the tools. */
  onTyping?: () => void;
  /** Cmd-S or Ctrl-S. */
  onSaveNow?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const focus = useRef(new Compartment());
  const callbacks = useRef({ onChange, onTyping, onSaveNow });
  // Written after render, never during it, so the editor always calls the
  // newest callbacks without being rebuilt for them.
  useEffect(() => {
    callbacks.current = { onChange, onTyping, onSaveNow };
  });
  const firstDoc = useRef(initialDoc);
  const firstFocus = useRef(focusMode);
  const firstAutoFocus = useRef(autoFocus);
  const firstLabel = useRef(label);
  const firstPlaceholder = useRef(placeholder);

  useEffect(() => {
    if (!host.current) return;
    const wide = () => typeof window !== 'undefined' && window.matchMedia(WIDE).matches;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: firstDoc.current,
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
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown({ base: markdownLanguage }),
          essayHighlight,
          essayTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': firstLabel.current,
            spellcheck: 'true',
            autocorrect: 'on',
            autocapitalize: 'sentences',
          }),
          firstPlaceholder.current ? placeholderText(firstPlaceholder.current) : [],
          typewriterScroll(wide),
          focus.current.of(firstFocus.current ? focusParagraph : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            callbacks.current.onChange?.(update.state.doc.toString());
            if (update.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
              callbacks.current.onTyping?.();
            }
          }),
        ],
      }),
    });
    view.current = created;
    if (firstAutoFocus.current) created.focus();
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: focus.current.reconfigure(focusMode ? focusParagraph : []) });
  }, [focusMode]);

  return <div ref={host} className="min-h-[40vh]" />;
}
