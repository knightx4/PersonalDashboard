import { describe, expect, it } from 'vitest';
import { bringNoteIntoNotes } from './bring-note';
import { NOTES_MAX } from './notebook';

const note = { title: 'Spacing', path: 'Inbox/Spacing.md', body: '---\ntags: [a]\n---\nRecall beats rereading.\n' };

describe('bringNoteIntoNotes', () => {
  it('adds the note under a dated heading and leaves the notes before it alone', () => {
    const r = bringNoteIntoNotes('My thoughts.\n', note, '2026-10-18');
    expect(r).toEqual({
      ok: true,
      changed: true,
      text: 'My thoughts.\n\n## 2026-10-18 · Spacing\n\nRecall beats rereading.\n',
    });
  });
  it('falls back to the path for an untitled note', () => {
    const r = bringNoteIntoNotes('', { ...note, title: '' }, '2026-10-18');
    expect(r.ok && r.text).toContain('## 2026-10-18 · Inbox/Spacing.md');
  });
  it('reports no change when the note is already the last block', () => {
    const once = bringNoteIntoNotes('Mine.', note, '2026-10-18');
    if (!once.ok) throw new Error('unreachable');
    expect(bringNoteIntoNotes(once.text, note, '2026-10-19')).toEqual({ ok: true, changed: false, text: once.text });
  });
  it('refuses a result longer than the notes page holds', () => {
    const r = bringNoteIntoNotes('x'.repeat(NOTES_MAX), note, '2026-10-18');
    expect(r.ok).toBe(false);
  });
});
