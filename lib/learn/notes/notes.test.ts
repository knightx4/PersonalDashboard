import { describe, expect, it } from 'vitest';
import { MAX_NOTE, noteBody, notesForCard, toCardNote, type CardNote } from './notes';

function note(id: string, over: Partial<CardNote>): CardNote {
  return { id, body: id, createdAt: '2026-09-26T10:00:00Z', cardId: null, conceptId: null, ...over };
}

describe('noteBody', () => {
  it('keeps what was typed, without the blank lines around it', () => {
    expect(noteBody('\n  First line\nsecond line  \n')).toEqual({ body: 'First line\nsecond line' });
  });

  it('refuses an empty note', () => {
    expect(noteBody('   \n ')).toEqual({ error: 'Write something first.' });
    expect(noteBody(undefined)).toEqual({ error: 'Write something first.' });
  });

  it('refuses a note over the length the table keeps', () => {
    expect(noteBody('a'.repeat(MAX_NOTE))).toEqual({ body: 'a'.repeat(MAX_NOTE) });
    expect(noteBody('a'.repeat(MAX_NOTE + 1))).toHaveProperty('error');
  });
});

describe('notesForCard', () => {
  const card = { id: 'card-1', conceptId: 'idea-1' };

  it('shows the notes on the card and on its idea from elsewhere, oldest first', () => {
    const notes = [
      note('from-page', { conceptId: 'idea-1', createdAt: '2026-09-26T12:00:00Z' }),
      note('on-card', { cardId: 'card-1', conceptId: 'idea-1', createdAt: '2026-09-26T09:00:00Z' }),
      note('other-card', { cardId: 'card-2', conceptId: 'idea-1', createdAt: '2026-09-26T11:00:00Z' }),
      note('other-idea', { cardId: 'card-3', conceptId: 'idea-2' }),
    ];
    expect(notesForCard(notes, card).map((n) => n.id)).toEqual([
      'on-card',
      'other-card',
      'from-page',
    ]);
  });

  it('shows only its own notes on a card with no idea', () => {
    const notes = [note('on-card', { cardId: 'card-1' }), note('loose', {})];
    expect(notesForCard(notes, { id: 'card-1', conceptId: null }).map((n) => n.id)).toEqual([
      'on-card',
    ]);
  });
});

describe('toCardNote', () => {
  it('reads a row', () => {
    expect(
      toCardNote({
        id: 'n',
        body: 'b',
        created_at: '2026-09-26T10:00:00Z',
        card_id: null,
        concept_id: 'c',
      }),
    ).toEqual({ id: 'n', body: 'b', createdAt: '2026-09-26T10:00:00Z', cardId: null, conceptId: 'c' });
  });
});
