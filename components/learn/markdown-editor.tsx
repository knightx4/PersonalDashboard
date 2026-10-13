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
import { definitionInsert } from '@/lib/learn/essays/research';
import {
  authorMarks,
  authorship,
  insertedBy,
  setMarks,
  showSuggestion,
  suggestionField,
  type Suggestion,
} from '@/lib/learn/essays/authorship-editor';
import {
  essayNotes,
  noteRanges,
  setActiveNote,
  setNoteRanges,
  type NoteRange,
} from '@/lib/learn/essays/notes-editor';

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
  /** The text as it is now. */
  doc(): string;
  /** Replace the margin notes' places in the text (plan #1869). */
  setNotes(ranges: NoteRange[]): void;
  /** Where each note's text is now, after the edits since. */
  notes(): NoteRange[];
  /** Highlight one note's text, or none. */
  showNote(id: string | null): void;
  /**
   * Put text in at the cursor, after any selection, with a space before it
   * when it would otherwise run into a word (plan #1863.8). With `quote`
   * the text is marked as quoted from that source; without, it is the
   * person's, like a link they chose.
   */
  insert(text: string, quote?: { name: string }): void;
  /**
   * Put a footnote reference at the cursor, against the text before it, and
   * its definition after the essay when it has none yet (plan #1863.9). Both
   * are marked as quoted from the source, so neither counts as your words.
   */
  footnote(ref: string, definition: string | null, source: { name: string }): void;
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
  initialNotes = [],
  onOpenNote,
  handle,
  label,
  placeholder,
  focusMode = false,
  autoFocus = false,
  onChange,
  onTyping,
  onSaveNow,
  onSelect,
  onCaret,
}: {
  initialDoc: string;
  /** The runs of `initialDoc` that are Dash's or quoted. */
  initialMarks?: AuthorMark[];
  /** A suggestion already showing, for the gallery. */
  initialSuggestion?: Suggestion | null;
  /** Where the margin notes sit in `initialDoc` (plan #1869). */
  initialNotes?: NoteRange[];
  /** A note's marker in the margin was pressed. */
  onOpenNote?: (id: string) => void;
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
  /** Where the cursor is, whenever it moves or the text changes (plan #1863.8). */
  onCaret?: (pos: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const focus = useRef(new Compartment());
  const callbacks = useRef({ onChange, onTyping, onSaveNow, onSelect, onOpenNote, onCaret });
  // Written after render, never during it, so the editor always calls the
  // newest callbacks without being rebuilt for them.
  useEffect(() => {
    callbacks.current = { onChange, onTyping, onSaveNow, onSelect, onOpenNote, onCaret };
  });
  const firstDoc = useRef(initialDoc);
  const firstMarks = useRef(initialMarks);
  const firstSuggestion = useRef(initialSuggestion);
  const firstNotes = useRef(initialNotes);
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
          essayNotes(firstNotes.current, (id) => callbacks.current.onOpenNote?.(id)),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const selected = !update.state.selection.main.empty;
              if (selected !== !update.startState.selection.main.empty) callbacks.current.onSelect?.(selected);
              callbacks.current.onCaret?.(update.state.selection.main.head);
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
      doc() {
        return view.current?.state.doc.toString() ?? '';
      },
      setNotes(ranges) {
        view.current?.dispatch({ effects: setNoteRanges.of(ranges) });
      },
      notes() {
        return view.current?.state.field(noteRanges).ranges ?? [];
      },
      showNote(id) {
        view.current?.dispatch({ effects: setActiveNote.of(id) });
      },
      insert(text, quote) {
        const editor = view.current;
        if (!editor || !text) return;
        const at = editor.state.selection.main.to;
        const before = at > 0 ? editor.state.sliceDoc(at - 1, at) : '';
        const after = editor.state.sliceDoc(at, at + 1);
        const lead = before && !/\s/.test(before) ? ' ' : '';
        const trail = after && !/[\s.,;:!?)]/.test(after) ? ' ' : '';
        const insert = `${lead}${text}${trail}`;
        editor.dispatch({
          changes: { from: at, insert },
          selection: { anchor: at + insert.length },
          // No `input` event: an insert from the rail is not typing, so the tools stay.
          annotations: quote ? insertedBy.of({ author: 'quote', name: quote.name }) : undefined,
          scrollIntoView: true,
        });
        editor.focus();
      },
      footnote(ref, definition, source) {
        const editor = view.current;
        if (!editor || !ref) return;
        const at = editor.state.selection.main.to;
        const end = editor.state.doc.length;
        const tail = definition ? definitionInsert(editor.state.doc.toString(), definition) : '';
        const changes = [{ from: at, insert: ref }, ...(tail ? [{ from: end, insert: tail }] : [])];
        editor.dispatch({
          changes,
          selection: { anchor: at + ref.length },
          annotations: insertedBy.of({ author: 'quote', name: source.name }),
          scrollIntoView: true,
        });
        editor.focus();
      },
    }),
    [],
  );

  return <div ref={host} className="min-h-[40vh]" />;
}
