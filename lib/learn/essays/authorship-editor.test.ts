import { EditorState, type Transaction, type TransactionSpec } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { describe, expect, it } from 'vitest';
import { authorMarks, authorship, insertedBy, showSuggestion, suggestionField } from './authorship-editor';
import type { AuthorMark } from './authorship';

/**
 * The editor's authorship field run on a bare EditorState with the real
 * history, so undo and redo are the commands the keymap sends.
 */
function editor(doc: string, marks: AuthorMark[] = []) {
  let state = EditorState.create({ doc, extensions: [history(), authorship(marks)] });
  const dispatch = (tr: Transaction) => {
    state = tr.state;
  };
  return {
    get state() {
      return state;
    },
    apply(spec: TransactionSpec) {
      dispatch(state.update(spec));
    },
    undo: () => undo({ state, dispatch }),
    redo: () => redo({ state, dispatch }),
    marks: () => state.field(authorMarks),
  };
}

const dash = { author: 'dash' as const, name: 'claude-sonnet-5-5' };

describe('authorMarks', () => {
  it('marks only text a transaction says is Dash’s; typing and pasting are the person’s', () => {
    const e = editor('Hello world.');
    e.apply({ changes: { from: 12, insert: ' Pasted.' }, userEvent: 'input.paste' });
    expect(e.marks()).toEqual([]);
    e.apply({ changes: { from: 0, to: 5, insert: 'Greetings' }, annotations: insertedBy.of(dash) });
    expect(e.marks()).toEqual([{ ...dash, from: 0, to: 9 }]);
  });

  it('gives back Dash’s mark when the deletion of Dash’s text is undone, and on redo of an accept', () => {
    const e = editor('Mine. Theirs. Mine.', [{ ...dash, from: 6, to: 13 }]);
    e.apply({ changes: { from: 6, to: 13 }, userEvent: 'delete' });
    expect(e.marks()).toEqual([]);
    e.undo();
    expect(e.state.doc.toString()).toBe('Mine. Theirs. Mine.');
    expect(e.marks()).toEqual([{ ...dash, from: 6, to: 13 }]);

    const f = editor('Mine. Old. Mine.');
    f.apply({ changes: { from: 6, to: 10, insert: 'New one.' }, annotations: insertedBy.of(dash), userEvent: 'rephrase' });
    expect(f.marks()).toEqual([{ ...dash, from: 6, to: 14 }]);
    f.undo();
    expect(f.state.doc.toString()).toBe('Mine. Old. Mine.');
    expect(f.marks()).toEqual([]);
    f.redo();
    expect(f.state.doc.toString()).toBe('Mine. New one. Mine.');
    expect(f.marks()).toEqual([{ ...dash, from: 6, to: 14 }]);
  });

  it('makes the words you type over Dash’s yours', () => {
    const e = editor('Mine. Theirs. Mine.', [{ ...dash, from: 6, to: 13 }]);
    e.apply({ changes: { from: 6, to: 12, insert: 'Ours' }, userEvent: 'input.type' });
    expect(e.marks()).toEqual([{ ...dash, from: 10, to: 11 }]);
  });
});

describe('suggestionField', () => {
  it('is withdrawn by an edit that touches the selected text, and moves with one elsewhere', () => {
    const e = editor('One. Two. Three.');
    e.apply({ effects: showSuggestion.of({ from: 5, to: 9, text: 'Second.', name: 'm' }) });
    e.apply({ changes: { from: 0, insert: 'Zero. ' } });
    expect(e.state.field(suggestionField)).toMatchObject({ from: 11, to: 15 });
    e.apply({ changes: { from: 12, insert: 'x' } });
    expect(e.state.field(suggestionField)).toBeNull();
  });
});
