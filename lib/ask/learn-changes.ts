/**
 * The Learn changes Dash makes straight away (plan #1894.8), as the cards
 * under an answer and Ask's list of changes read them.
 *
 * The other kinds each keep the fields their card is drawn from, and
 * lib/ask/change-view.ts says each one in its own words. These six share one
 * shape instead: the tool that made the change wrote the sentence and the
 * link when it made it (lib/dash/learn-writes.ts), so a card here only reads
 * them back. No server imports, so the client cards can use it.
 */

/** The Learn write tools, by name, which is the kind each change is kept under. */
export const LEARN_CHANGE_KINDS = [
  'change_reading',
  'add_learn_track',
  'add_track_reading',
  'reword_concept',
  'add_concept_note',
  'change_video',
] as const;

export type LearnChangeKind = (typeof LEARN_CHANGE_KINDS)[number];

/**
 * What a Learn change keeps in `input`: its sentence in the card's three
 * parts, where its row opens and what that link says, and the pages to
 * revalidate after an undo.
 */
export type LearnChangeInput = {
  /** "Marked", "Started the reading list". Always past tense: these are never proposed. */
  verb: string;
  /** The row's own name, which the card links. */
  what: string;
  /** The rest of the sentence, starting with its own space or comma. */
  rest: string;
  href: string;
  /** The link's words: "Open the reading". */
  where: string;
  paths: string[];
};

export function isLearnChangeKind(kind: string): kind is LearnChangeKind {
  return (LEARN_CHANGE_KINDS as readonly string[]).includes(kind);
}

/** Whether a kept change is one of these, so a reader can take the shared shape. */
export function isLearnChange<C extends { kind: string; input: unknown }>(
  change: C,
): change is Extract<C, { kind: LearnChangeKind }> {
  return isLearnChangeKind(change.kind);
}

/** The card's words for a Learn change, read back from what the tool kept. */
export function learnChangeWords(input: LearnChangeInput): { verb: string; what: string; rest: string } {
  return { verb: input.verb, what: input.what, rest: input.rest };
}
