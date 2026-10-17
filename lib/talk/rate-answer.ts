/**
 * A thumbs up or down on one of Dash's answers in Ask Dash (plan #2285.2),
 * kept on Dash's own turn in core.conversation_turns (0254).
 *
 * The press sends the state wanted, not a flip: 'up', 'down', or null to take
 * it back. The rating, its note and its time are written together, and taking
 * one back clears all three in the same write, since the table refuses a note
 * or a time without a rating.
 *
 * The reads and the write are handed in, so this is tested without a
 * database; lib/talk/ask-request.ts binds them to the signed-in person.
 */

export type AnswerRating = 'up' | 'down';

/** The longest note kept with a rating (conversation_turns_rating_note_ck). */
export const RATING_NOTE_MAX = 1000;

/** What a press hands back: the rating as now kept, or why it was not. */
export type RateAnswerOutcome =
  | { ok: true; rating: AnswerRating | null; note: string | null }
  | { ok: false; error: string };

/** The three columns, as one write. */
export type RatingPatch = {
  rating: AnswerRating | null;
  rating_note: string | null;
  rated_at: string | null;
};

export type RateAnswerDeps = {
  /**
   * The turn's role, read as the signed-in person and only from their own
   * Ask Dash chat `conversationId`; null when it is not there or not theirs.
   */
  readRole: (conversationId: string, turnId: string) => Promise<'user' | 'assistant' | null>;
  /** Writes the patch to that turn as the same person; how many rows it changed. */
  write: (conversationId: string, turnId: string, patch: RatingPatch) => Promise<number>;
  now?: () => Date;
};

const GONE = 'That answer is not there any more.';
const NOT_DASH = 'Only Dash’s answers take a thumbs up or down.';

/** A rating as it arrives from the page: 'up', 'down' or null, anything else refused. */
export function parseRating(value: unknown): AnswerRating | null | undefined {
  if (value === null) return null;
  if (value === 'up' || value === 'down') return value;
  return undefined;
}

/** The note as kept: trimmed, empty as none, and cut to the table's limit. */
export function ratingNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed ? trimmed.slice(0, RATING_NOTE_MAX) : null;
}

/** The write for a rating: all three set, or all three cleared. */
export function ratingPatch(rating: AnswerRating | null, note: string | null, at: Date): RatingPatch {
  if (rating === null) return { rating: null, rating_note: null, rated_at: null };
  return { rating, rating_note: note, rated_at: at.toISOString() };
}

/**
 * Rate answer `turnId` in chat `conversationId`. A new rating replaces the
 * old one with its note, so thumbs down then up keeps up and no note. Never
 * throws for a refusal; a failed read or write throws.
 */
export async function rateAnswer(
  deps: RateAnswerDeps,
  conversationId: string,
  turnId: string,
  rating: AnswerRating | null,
  note: string | null,
): Promise<RateAnswerOutcome> {
  const role = await deps.readRole(conversationId, turnId);
  if (role === null) return { ok: false, error: GONE };
  if (role !== 'assistant') return { ok: false, error: NOT_DASH };
  const patch = ratingPatch(rating, rating === null ? null : note, (deps.now ?? (() => new Date()))());
  const changed = await deps.write(conversationId, turnId, patch);
  if (changed === 0) return { ok: false, error: GONE };
  return { ok: true, rating: patch.rating, note: patch.rating_note };
}
