import { describe, expect, it } from 'vitest';
import { joinNotes } from './join-notes';
import { previewParts } from './merge-preview';

describe('previewParts', () => {
  it('splits a merge into the last lines already there and the block added', () => {
    const before = 'One.\n\nTwo.\n\nThree.\n\nFour.\n\n';
    const after = joinNotes(before, 'From the vault.', 'Rates', '2026-10-18');
    expect(previewParts(before, after)).toEqual({
      context: 'Three.\n\nFour.',
      added: '## 2026-10-18 · Rates\n\nFrom the vault.',
    });
  });

  it('has no context when the text was empty', () => {
    const after = joinNotes('', 'From the vault.', 'Rates', '2026-10-18');
    expect(previewParts('', after)).toEqual({ context: '', added: '## 2026-10-18 · Rates\n\nFrom the vault.' });
  });

  it('shows all of after when it does not continue before', () => {
    expect(previewParts('Old text', 'New text\n')).toEqual({ context: '', added: 'New text' });
  });
});
