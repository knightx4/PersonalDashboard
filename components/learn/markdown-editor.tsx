'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
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
import type { AuthorMark } from '@/lib/learn/essays/authorship';
import {
  authorMarks,
  authorship,
  setMarks,
  showSuggestion,
  suggestionField,
  type Suggestion,
} from '@/lib/learn/essays/authorship-editor';

/** The selected text, as the Rephrase button asks for it. */
export type EditorSelection = { from: number; to: number; text: string; doc: string };

/** What the page can do to the editor from outside it (plan #1868). */
export type MarkdownEditorHandle = {
  /** The main selection, or null when nothing is selected. */
  selection(): EditorSelection | null;
  /**
   * Show Dash's wording for a range as a change to accept or reject. False
   * when the text there is no longer what was sent, since it changed while
   * Dash was working.
   */
  suggest(suggestion: Suggestion, original: string): boolean;
  /** Replace who-wrote-what outright: clearing the marks. */
  setMarks(marks: AuthorMark[]): void;
};

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
 *
 * Who wrote what rides along (plan #1868): `initialMarks` are read once,
 * like the text, and `onChange` hands up the marks with each text. A
 * suggestion Dash makes for a selection is shown through `handle`.
 */
export function MarkdownEditor({
  initialDoc,
  initialMarks = [],
  initialSuggestion = null,
  handle,
  label,
  placeholder,
  focusMode = false,
  autoFocus = false,
  onChange,
  onTyping,
  onSaveNow,
  onSelect,
}: {
  initialDoc: string;
  /** The runs of `initialDoc` that are Dash's or quoted. */
  initialMarks?: AuthorMark[];
  /** A suggestion already showing, for the gallery. */
  initialSuggestion?: Suggestion | null;
  handle?: Ref<MarkdownEditorHandle>;
  /** What a screen reader calls the editor. */
  label: string;
  placeholder?: string;
  /** Dims every paragraph but the one the cursor is in. */
  focusMode?: boolean;
  autoFocus?: boolean;
  /** The text and who wrote what in it, on every change to either. */
  onChange?: (doc: string, marks: AuthorMark[]) => void;
  /** Whether some text is selected, as it changes. */
  onSelect?: (selected: boolean) => void;
  /** Called on each keystroke that changes the text, to hide the tools. */
  onTyping?: () => void;
  /** Cmd-S or Ctrl-S. */
  onSaveNow?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const focus = useRef(new Compartment());
  const callbacks = useRef({ onChange, onTyping, onSaveNow, onSelect });
  // Written after render, never during it, so the editor always calls the
  // newest callbacks without being rebuilt for them.
  useEffect(() => {
    callbacks.current = { onChange, onTyping, onSaveNow, onSelect };
  });
  const firstDoc = useRef(initialDoc);
  const firstMarks = useRef(initialMarks);
  const firstSuggestion = useRef(initialSuggestion);
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
          authorship(firstMarks.current, firstSuggestion.current),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const selected = !update.state.selection.main.empty;
              if (selected !== !update.startState.selection.main.empty) callbacks.current.onSelect?.(selected);
            }
            const marks = update.state.field(authorMarks);
            if (!update.docChanged && marks === update.startState.field(authorMarks)) return;
            callbacks.current.onChange?.(update.state.doc.toString(), marks);
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

  useImperativeHandle(
    handle,
    () => ({
      selection() {
        const editor = view.current;
        if (!editor) return null;
        const { from, to } = editor.state.selection.main;
        if (from === to) return null;
        const doc = editor.state.doc.toString();
        return { from, to, text: doc.slice(from, to), doc };
      },
      suggest(suggestion, original) {
        const editor = view.current;
        if (!editor) return false;
        if (editor.state.sliceDoc(suggestion.from, suggestion.to) !== original) return false;
        editor.dispatch({ effects: showSuggestion.of(suggestion) });
        return editor.state.field(suggestionField) !== null;
      },
      setMarks(marks) {
        view.current?.dispatch({ effects: setMarks.of(marks) });
      },
    }),
    [],
  );

  return <div ref={host} className="min-h-[40vh]" />;
}
