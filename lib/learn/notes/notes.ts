/**
 * Notes on Learn cards (plan #1058), in `learn.card_notes`.
 *
 * A note written on a card is kept against the card and against the idea the
 * card teaches, so it shows on that card when it comes back, on any other
 * card for the same idea, and on the idea's page at /learn/c/[id]. A note
 * written on the idea's page has no card. What notes are later used for is a
 * follow-on; for now they are written, kept and shown.
 */

/** The longest note kept, matching `card_notes_body_ck`. */
export const MAX_NOTE = 4000;

export type CardNote = {
  id: string;
  body: string;
  createdAt: string;
  /** The card it was written on. Null when written on the idea's page, or once the card is gone. */
  cardId: string | null;
  /** The idea it is about. */
  conceptId: string | null;
};

/** What adding a note returns: the note as kept, or why it was not. */
export type NoteWrite = { note?: CardNote; error?: string };

/** A row of `learn.card_notes` as read. */
export type CardNoteRow = {
  id: string;
  body: string;
  created_at: string;
  card_id: string | null;
  concept_id: string | null;
};

export const NOTE_SELECT = 'id, body, created_at, card_id, concept_id';

export function toCardNote(row: CardNoteRow): CardNote {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    cardId: row.card_id,
    conceptId: row.concept_id,
  };
}

/**
 * What typed in the box becomes, or why it cannot be kept. Surrounding blank
 * lines go; the lines inside stay as written.
 */
export function noteBody(raw: unknown): { body: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Write something first.' };
  const body = raw.trim();
  if (body === '') return { error: 'Write something first.' };
  if (body.length > MAX_NOTE) {
    return { error: `That note is ${body.length} characters; the most kept is ${MAX_NOTE}.` };
  }
  return { body };
}

/**
 * The notes one card shows, oldest first: the ones written on it, and the
 * ones on its idea from anywhere else.
 */
export function notesForCard(
  notes: readonly CardNote[],
  card: { id: string; conceptId: string | null },
): CardNote[] {
  return notes
    .filter(
      (note) =>
        note.cardId === card.id || (card.conceptId !== null && note.conceptId === card.conceptId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
