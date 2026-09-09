/**
 * Shape and validation for a generated prep note, plus the post-checks that
 * run on it. Free of server-only imports, so the rules — which is to say the
 * interesting part — are testable without a network call, the same split as
 * lib/jobs/evidence/draft-payload.ts.
 *
 * The note is structured fields rather than one markdown blob so the renderer
 * decides the formatting and an absent section can simply not be there. That
 * shape is also what makes the grounding checkable, and there are four of
 * them, all of the same kind: the model supplies the reading, the context
 * supplies the facts.
 *
 * - A story must cite an evidence item that was actually offered. An invented
 *   id is dropped, exactly as in the draft.
 * - An interviewer must be someone on file for this round. A round with nobody
 *   named produces no interviewer section rather than a paragraph about a
 *   person the model imagined into the room.
 * - A strength or a gap must point at a line of the requirement map, and which
 *   of the two it is comes from that line's own verdict rather than from the
 *   model — "taken from requirement_matches rather than re-derived" means the
 *   note cannot disagree with the map it is quoting.
 * - What earlier rounds asked is copied from the rows verbatim. The model gets
 *   to say what those rounds seemed to care about; it does not get to retype
 *   the questions, because a paraphrased question is a question nobody asked.
 *
 * And the banned constructions, by regex over the whole note, for the reason
 * the draft gives: an instruction not to use a phrase leaks, and a regex does
 * not drift.
 */
import { z } from 'zod';

import { findBannedConstructions } from '../evidence/draft-payload';
import type { MatchVerdict } from '../evidence/match-payload';
import type { RequirementKind } from '../jd/requirements';
import { PREP_MISSING_LABEL, type PrepContext } from './prep-context';

/**
 * Earlier questions carried into the note.
 *
 * The context already caps them, at a budget sized for what a call can read.
 * This is the smaller cap for what a person can read at eight in the morning.
 */
export const MAX_NOTE_PRIOR_QUESTIONS = 12;

/** One person in the room, and what is on file about them. */
export interface PrepInterviewerNote {
  contactId: string;
  /** From the contact row, not the model. */
  name: string;
  note: string;
}

/** One line of the requirement map, with the note's reading of it. */
export interface PrepPoint {
  /** Copied from the match, so the note quotes the map exactly. */
  requirement: string;
  kind: RequirementKind;
  verdict: MatchVerdict;
  note: string;
}

/** A story to have ready, and when to reach for it. */
export interface PrepStory {
  evidenceItemId: string;
  /** From the bank item, not the model. */
  title: string;
  note: string;
}

export interface PrepNote {
  /** What this round is and who is in it. */
  roundSummary: string;
  /** Empty when nobody is named on the round. */
  interviewers: PrepInterviewerNote[];
  /** Where the map says you are strong. */
  strengths: PrepPoint[];
  /** Where it says you are thin — partial counts as thin. */
  gaps: PrepPoint[];
  stories: PrepStory[];
  /** Verbatim from earlier rounds at this company. */
  priorQuestions: string[];
  /** The model's reading of those rounds. Null when there are none. */
  priorRoundsNote: string | null;
  questionsToAsk: string[];
  /** What it did not have, in sentences ready to render. */
  missing: string[];
  /** Banned constructions found in the note, as written. */
  bannedFound: string[];
}

export type PrepResult = { ok: true; note: PrepNote } | { ok: false; error: string };

const prepSchema = z.object({
  round_summary: z.string().trim().min(1),
  interviewers: z
    .array(z.object({ contact_id: z.string(), note: z.string().trim().min(1) }))
    .nullish(),
  points: z
    .array(
      z.object({
        requirement_index: z.number().int().min(0),
        note: z.string().trim().min(1),
      }),
    )
    .nullish(),
  stories: z
    .array(z.object({ evidence_item_id: z.string(), note: z.string().trim().min(1) }))
    .nullish(),
  prior_rounds_note: z.string().trim().min(1).nullish(),
  questions_to_ask: z.array(z.string().trim().min(1)).nullish(),
  missing: z.array(z.string().trim().min(1)).nullish(),
});

/** Case-insensitively, so the same sentence twice is one sentence. */
function pushOnce(into: string[], seen: Set<string>, value: string): void {
  const key = value.trim().toLowerCase();
  if (!key || seen.has(key)) return;
  seen.add(key);
  into.push(value.trim());
}

/**
 * The questions earlier rounds at this company actually asked.
 *
 * Newest first, because the context orders the rounds that way and recency is
 * what makes an earlier question worth reading.
 */
function collectPriorQuestions(context: PrepContext): string[] {
  const questions: string[] = [];
  const seen = new Set<string>();
  for (const round of context.priorRounds) {
    for (const question of round.questionsAsked) {
      if (questions.length >= MAX_NOTE_PRIOR_QUESTIONS) return questions;
      pushOnce(questions, seen, question);
    }
  }
  return questions;
}

/**
 * What the note could not draw on: the context's own list first, in the words
 * the app uses for it, then anything the model noticed on top.
 *
 * The context's half is not negotiable — it is derived from the rows rather
 * than reported, so a note cannot quietly leave out that it had no job
 * description. The model's half is for the things a list of codes cannot
 * cover: a round with no time set, an interviewer with a name and nothing
 * else.
 */
function collectMissing(context: PrepContext, reported: readonly string[]): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const code of context.missing) pushOnce(missing, seen, PREP_MISSING_LABEL[code]);
  for (const line of reported) pushOnce(missing, seen, line);
  return missing;
}

/** Validate a prep note against the context it was written from. */
export function parsePrepPayload(
  raw: unknown,
  context: PrepContext,
  banned: readonly string[],
): PrepResult {
  const parsed = prepSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'The prep note came back in an unexpected shape.' };
  }

  const namesByContact = new Map(
    context.interviewers.map((person) => [person.contactId, person.name]),
  );
  const interviewers: PrepInterviewerNote[] = [];
  const seenContacts = new Set<string>();
  for (const row of parsed.data.interviewers ?? []) {
    const name = namesByContact.get(row.contact_id);
    if (name === undefined || seenContacts.has(row.contact_id)) continue;
    seenContacts.add(row.contact_id);
    interviewers.push({ contactId: row.contact_id, name, note: row.note });
  }

  // A verdict of partial is thin rather than strong: the point of the section
  // is what to shore up before the morning, and "the right domain, less scale"
  // is exactly what gets asked about.
  const strengths: PrepPoint[] = [];
  const gaps: PrepPoint[] = [];
  const seenPoints = new Set<number>();
  for (const row of parsed.data.points ?? []) {
    const match = context.role.matches[row.requirement_index];
    if (!match || seenPoints.has(row.requirement_index)) continue;
    seenPoints.add(row.requirement_index);
    const point: PrepPoint = {
      requirement: match.requirement,
      kind: match.kind,
      verdict: match.verdict,
      note: row.note,
    };
    (match.verdict === 'strong' ? strengths : gaps).push(point);
  }

  const titlesByItem = new Map(context.bank.map((item) => [item.id, item.title]));
  const stories: PrepStory[] = [];
  const seenStories = new Set<string>();
  for (const row of parsed.data.stories ?? []) {
    const title = titlesByItem.get(row.evidence_item_id);
    if (title === undefined || seenStories.has(row.evidence_item_id)) continue;
    seenStories.add(row.evidence_item_id);
    stories.push({ evidenceItemId: row.evidence_item_id, title, note: row.note });
  }

  const questionsToAsk: string[] = [];
  const seenQuestions = new Set<string>();
  for (const question of parsed.data.questions_to_ask ?? []) {
    pushOnce(questionsToAsk, seenQuestions, question);
  }

  const priorQuestions = collectPriorQuestions(context);
  // A reading of rounds that are not there is a reading of nothing.
  const priorRoundsNote =
    context.priorRounds.length > 0 ? (parsed.data.prior_rounds_note ?? null) : null;
  const missing = collectMissing(context, parsed.data.missing ?? []);

  const prose = [
    parsed.data.round_summary,
    ...interviewers.map((person) => person.note),
    ...strengths.map((point) => point.note),
    ...gaps.map((point) => point.note),
    ...stories.map((story) => story.note),
    priorRoundsNote,
    ...questionsToAsk,
    ...missing,
  ]
    .filter((text): text is string => Boolean(text))
    .join('\n\n');

  return {
    ok: true,
    note: {
      roundSummary: parsed.data.round_summary,
      interviewers,
      strengths,
      gaps,
      stories,
      priorQuestions,
      priorRoundsNote,
      questionsToAsk,
      missing,
      bannedFound: findBannedConstructions(prose, banned),
    },
  };
}
