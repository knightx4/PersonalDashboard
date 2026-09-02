/**
 * Assembling the material a proposal reads from.
 *
 * Split out of the server action so the interesting half — which rows are
 * worth sending, how they are labelled, and where the text gets cut — is
 * testable without a database or a network call.
 */
import type { EvidenceSourceKind } from './propose-payload';

/**
 * A generous ceiling. A long resume is around 8K characters and a year of
 * debriefs is not much more; the cap exists so one pathological row cannot
 * turn a proposal into a 200K-token call.
 */
export const MAX_SOURCE_CHARS = 40_000;

export interface AnswerSource {
  question: string;
  answer: string;
}

export interface DebriefSource {
  /** "Acme, Senior Analyst" — whatever names the pursuit. */
  label: string | null;
  debrief: string | null;
  wentWell: string | null;
  wentPoorly: string | null;
}

function trim(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Cut on a paragraph boundary where there is one, so a story is not halved. */
function cap(text: string): string {
  if (text.length <= MAX_SOURCE_CHARS) return text;
  const cut = text.slice(0, MAX_SOURCE_CHARS);
  const boundary = cut.lastIndexOf('\n\n');
  return (boundary > MAX_SOURCE_CHARS / 2 ? cut.slice(0, boundary) : cut).trimEnd();
}

/** A pasted resume, as stored on the version. Empty when there is no text. */
export function assembleResumeSource(textContent: string | null): string {
  return cap(trim(textContent));
}

/**
 * The approved behavioural answers, as question-and-answer pairs. The question
 * is included because it is what makes the answer readable as a story rather
 * than as a paragraph with no subject.
 */
export function assembleAnswersSource(rows: readonly AnswerSource[]): string {
  const blocks = rows
    .map((row) => ({ question: trim(row.question), answer: trim(row.answer) }))
    .filter((row) => row.answer.length > 0)
    .map((row) => `Question: ${row.question || '(not recorded)'}\nAnswer: ${row.answer}`);
  return cap(blocks.join('\n\n'));
}

/**
 * The interview debriefs. `went_well` and `went_poorly` are separate columns
 * because one blob gets written as a paragraph and never reread — they are
 * reassembled here under labels rather than concatenated blind.
 */
export function assembleDebriefsSource(rows: readonly DebriefSource[]): string {
  const blocks: string[] = [];
  for (const row of rows) {
    const parts: string[] = [];
    const debrief = trim(row.debrief);
    const well = trim(row.wentWell);
    const poorly = trim(row.wentPoorly);
    if (debrief) parts.push(debrief);
    if (well) parts.push(`What went well: ${well}`);
    if (poorly) parts.push(`What went poorly: ${poorly}`);
    if (parts.length === 0) continue;
    const label = trim(row.label);
    blocks.push(`${label ? `Interview — ${label}` : 'Interview'}\n${parts.join('\n')}`);
  }
  return cap(blocks.join('\n\n'));
}

/** Why a source has nothing to propose from, in the words the settings page uses. */
export const EMPTY_SOURCE_REASON: Record<EvidenceSourceKind, string> = {
  resume: 'That resume version has no pasted text to read.',
  answers: 'No approved behavioural answers yet — approve a few and they become evidence.',
  debriefs: 'No interview debriefs written up yet.',
};
