import { splitBriefing } from '@/lib/learn/graph/from-brief';
import { QUIZ_QUESTIONS } from '@/lib/learn/quiz/payload';

/**
 * Deciding which piece of the material each question comes from.
 *
 * Pure, and separate from the calls, because this is the part that decides
 * whether a quiz is over everything you picked or over the first page of the
 * first note. Two rules:
 *
 *   **Every piece of material gets at least one question.** You picked three
 *   notes because you wanted to be asked about three notes, and a share-of-the
 *   -text split would give the short one nothing.
 *
 *   **A long note is asked about across its length.** It is split on its own
 *   headings first, the way a briefing is, and the sections that get a
 *   question are spread evenly through it rather than taken from the front.
 */

/** One call's worth: a piece of material, and how many questions to ask of it. */
export type QuizChunk = {
  sourceId: string;
  /** What to call this piece in the prompt and in a dropped-question line. */
  title: string;
  text: string;
  want: number;
};

/** A piece of material, as the planner reads it. */
export type PlannableSource = { id: string; title: string; text: string };

/**
 * Split `total` between the sources, never giving one of them none.
 *
 * Largest remainder on share of the text, after every source has taken its
 * one. A source longer than the rest earns more questions; a source of two
 * lines still earns its one.
 */
function share(lengths: readonly number[], total: number): number[] {
  const quota = lengths.map(() => 1);
  let left = total - lengths.length;
  if (left <= 0) return quota;

  const sum = lengths.reduce((a, b) => a + b, 0);
  const exact = lengths.map((length) => (sum > 0 ? (left * length) / sum : left / lengths.length));

  exact.forEach((value, index) => {
    const whole = Math.floor(value);
    quota[index] += whole;
    left -= whole;
  });

  // Whatever rounding left over goes to the biggest fractional parts, so the
  // total is the total rather than one or two short of it.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; left > 0; i = (i + 1) % order.length) {
    quota[order[i]!.index]! += 1;
    left -= 1;
  }

  return quota;
}

/** `want` questions taken from `sections`, spread evenly through them. */
function spread(sections: readonly { title: string; text: string }[], want: number): number[] {
  const wants = sections.map(() => 0);

  if (sections.length >= want) {
    // One question each, from evenly spaced sections. A note split into twelve
    // sections and owed three is asked about its start, its middle and its end.
    for (let i = 0; i < want; i += 1) {
      wants[Math.min(sections.length - 1, Math.floor((i * sections.length) / want))]! += 1;
    }
    return wants;
  }

  for (let i = 0; i < want; i += 1) wants[i % sections.length]! += 1;
  return wants;
}

/**
 * The calls to make, in the order the material was picked.
 *
 * `target` is what the quiz aims at, raised when there is more material than
 * that: eleven sources cannot share ten questions and still have one each, and
 * the first rule wins.
 */
export function planQuizQuestions(
  sources: readonly PlannableSource[],
  target: number = QUIZ_QUESTIONS,
): QuizChunk[] {
  const usable = sources
    .map((source) => ({ ...source, text: source.text.trim() }))
    .filter((source) => source.text.length > 0);

  if (usable.length === 0) return [];

  const quota = share(
    usable.map((source) => source.text.length),
    Math.max(target, usable.length),
  );

  const chunks: QuizChunk[] = [];

  usable.forEach((source, index) => {
    const sections = splitBriefing(source.text).filter((section) => section.text.trim().length > 0);
    const pieces = sections.length > 0 ? sections : [{ title: source.title, text: source.text }];
    const wants = spread(pieces, quota[index]!);

    pieces.forEach((piece, at) => {
      if (wants[at] === 0) return;
      chunks.push({
        sourceId: source.id,
        title:
          pieces.length > 1 && piece.title !== source.title
            ? `${source.title} — ${piece.title}`
            : source.title,
        text: piece.text,
        want: wants[at]!,
      });
    });
  });

  return chunks;
}
