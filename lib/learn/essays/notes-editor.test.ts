import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { essayNotes, noteRanges, setNoteRanges } from './notes-editor';
import { locateAnchor, makeAnchor } from './anchor';

/**
 * A margin note's range moving with edits in the editor, and then being
 * found again from the anchor a save would store (plan #1869's done-when:
 * a note survives edits above it and a reload).
 */
describe('noteRanges', () => {
  const doc = 'First paragraph.\n\nGold was money, yet nobody eats gold.';
  const quote = 'nobody eats gold';
  const from = doc.indexOf(quote);

  function start() {
    return EditorState.create({
      doc,
      extensions: [essayNotes([{ id: 'n1', from, to: from + quote.length, open: true }], () => undefined)],
    });
  }

  it('moves the range with an edit above it, and the stored anchor finds it after a reload', () => {
    const state = start().update({ changes: { from: 0, insert: 'A new opening line.\n\n' } }).state;
    const [range] = state.field(noteRanges).ranges;
    const text = state.doc.toString();
    expect(text.slice(range.from, range.to)).toBe(quote);
    const stored = makeAnchor(text, range.from, range.to);
    expect(locateAnchor(text, stored)).toEqual({ from: range.from, to: range.to, how: 'offset' });
  });

  it('keeps a word typed inside the range, and closes up when the text is deleted', () => {
    let state = start().update({ changes: { from: from + 'nobody'.length, insert: ' ever' } }).state;
    let [range] = state.field(noteRanges).ranges;
    expect(state.doc.sliceString(range.from, range.to)).toBe('nobody ever eats gold');
    state = state.update({ changes: { from: range.from, to: range.to } }).state;
    [range] = state.field(noteRanges).ranges;
    expect(range.to).toBe(range.from);
  });

  it('takes a new set of ranges outright', () => {
    const state = start().update({ effects: setNoteRanges.of([]) }).state;
    expect(state.field(noteRanges).ranges).toEqual([]);
  });
});
