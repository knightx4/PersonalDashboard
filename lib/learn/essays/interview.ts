import { BRIEF_FIELDS, type BriefField, type EssayBrief, type EssayPin, type PinKind } from './model';

/**
 * The short interview a new essay opens with (plan #1867;
 * docs/LEARN-ESSAYS-SPEC.md, "Starting an essay").
 *
 * Dash asks one question at a time, at most five, each of a fixed kind. The
 * answer goes into the brief as typed, so the brief is in the person's words;
 * Dash writes only the wording of the next question (interview-model.ts).
 * These are the rules around that call, kept pure so they can be tested and
 * drawn in the gallery: the questions as the spec words them, the first
 * question when the essay was started from something, and the brief each
 * answer, skip or edit leaves behind.
 *
 * The interview's state lives in the brief's jsonb under `interview`, beside
 * the answers, so it needs no column of its own. Every write here starts from
 * the stored jsonb and changes only its own keys, so `pinned` and anything a
 * later step adds survive.
 */

/** Each question as the spec words it, asked when Dash's wording is not to hand. */
export const PLAIN_ASKS: Record<BriefField, string> = {
  question: 'What is the question you want to answer?',
  claim: 'What do you think the answer is, right now, in a sentence?',
  reader: 'Who is it for? If nobody comes to mind, a friend who knows nothing about it.',
  origin: 'What made you think this?',
  change: 'What would change your mind?',
};

/** What each answer is called in the brief. */
export const BRIEF_LABELS: Record<BriefField, string> = {
  question: 'Question',
  claim: 'Your answer',
  reader: 'Reader',
  origin: 'What made you think it',
  change: 'What would change your mind',
};

/** What each kind of pin is called where the brief lists it. */
export const PIN_LABELS: Record<PinKind, string> = {
  goal: 'Goal',
  reading: 'Reading',
  theme: 'Theme',
  log: 'Learning log',
};

/** The longest answer kept, about a paragraph. */
export const ANSWER_MAX = 1_000;

/** The longest question from Dash that is used as it came back. */
const ASK_MAX = 300;

function opener(pin: EssayPin): string {
  switch (pin.kind) {
    case 'goal':
      return `You finished your goal “${pin.title}”.`;
    case 'reading':
      return `You read “${pin.title}”.`;
    case 'theme':
      return `Your notes keep coming back to “${pin.title}”.`;
    case 'log':
      return `You talked through “${pin.title}”.`;
  }
}

/**
 * The first question. Started from something, it names it, so the person
 * sees what the essay is about to be built on; otherwise it is the spec's
 * first question as written. No model call: nothing has been said yet that
 * Dash could follow up.
 */
export function openingAsk(pins: readonly EssayPin[]): string {
  const pin = pins[0];
  if (!pin) return PLAIN_ASKS.question;
  return `${opener(pin)} What is the question about it you want to answer?`;
}

/** The brief a new essay starts with: empty answers, its pins, and the first question. */
export function newEssayBrief(pins: readonly EssayPin[]): Record<string, unknown> {
  return {
    question: '',
    claim: '',
    reader: '',
    origin: '',
    change: '',
    pinned: pins.map((pin) => ({ kind: pin.kind, id: pin.id, title: pin.title })),
    interview: { status: 'asking', field: 'question', ask: openingAsk(pins) },
  };
}

/** The field after this one, or null after the last. */
export function nextField(field: BriefField): BriefField | null {
  const at = BRIEF_FIELDS.indexOf(field);
  return BRIEF_FIELDS[at + 1] ?? null;
}

/** "Question 2 of 5". */
export function askNumber(field: BriefField): string {
  return `Question ${BRIEF_FIELDS.indexOf(field) + 1} of ${BRIEF_FIELDS.length}`;
}

function stored(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

/** An answer as it is kept: trimmed, and cut at the limit. */
export function cleanAnswer(answer: string): string {
  return answer.trim().slice(0, ANSWER_MAX);
}

/**
 * The brief after one answer. A blank answer skips the question and leaves
 * whatever the field held. `next` is the following question with Dash's
 * wording, or null when that was the last and the interview is done.
 */
export function answeredBrief(
  raw: unknown,
  field: BriefField,
  answer: string,
  next: { field: BriefField; ask: string } | null,
): Record<string, unknown> {
  const brief = stored(raw);
  const kept = cleanAnswer(answer);
  if (kept) brief[field] = kept;
  brief.interview = next ? { status: 'asking', field: next.field, ask: next.ask } : { status: 'done' };
  return brief;
}

/** The brief once the person skips the rest of the interview: what they answered stays. */
export function skippedBrief(raw: unknown): Record<string, unknown> {
  return { ...stored(raw), interview: { status: 'skipped' } };
}

/** The brief after one field is edited in place. */
export function editedBrief(raw: unknown, field: BriefField, value: string): Record<string, unknown> {
  return { ...stored(raw), [field]: cleanAnswer(value) };
}

/** Words that open a reply with praise or a reaction, which the interview never says. */
const PRAISE =
  /\b(great|interesting|fascinating|love|wonderful|excellent|nice|good (?:question|point|answer)|thanks?|thank you|compelling|intriguing)\b/i;

/**
 * Dash's question as it came back, or null when it cannot be used as it is:
 * empty, more than one question, praise, or too long. The interview then
 * asks the spec's question instead, so it never stalls on a bad reply.
 */
export function usableAsk(reply: string): string | null {
  const ask = reply
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!ask || ask.length > ASK_MAX) return null;
  if (!ask.endsWith('?')) return null;
  if ((ask.match(/\?/g) ?? []).length > 1) return null;
  if (PRAISE.test(ask)) return null;
  return ask;
}

/** The brief so far, as the next question's prompt carries it. Exported for the test. */
export function describeBrief(brief: EssayBrief, field: BriefField): string {
  const lines: string[] = [];
  if (brief.pinned.length > 0) {
    lines.push('They started this essay from:');
    for (const pin of brief.pinned) lines.push(`- ${PIN_LABELS[pin.kind]}: ${pin.title}`);
    lines.push('');
  }
  const answered = BRIEF_FIELDS.filter((f) => f !== field && brief[f].trim());
  if (answered.length > 0) {
    lines.push('Their answers so far, in their words:');
    for (const f of answered) lines.push(`- ${PLAIN_ASKS[f]}`, `  ${brief[f].trim()}`);
  } else {
    lines.push('They have not answered anything yet.');
  }
  lines.push('', `Next, ask this kind of question: ${PLAIN_ASKS[field]}`);
  return lines.join('\n');
}
