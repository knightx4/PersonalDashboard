/**
 * A research brief as the app reads it (plan #2023; migrations 0116 and 0117).
 *
 * `learn.briefs` keeps two jsonb arrays whose shape the database does not
 * check beyond "is an array": the sub-questions the run framed and the
 * sections it wrote. This file names those shapes and reads a row into them,
 * dropping any entry that does not fit, so a page never has to guess.
 *
 * Nothing here touches the database or the network.
 */

export type BriefDepth = 'quick' | 'standard' | 'deep';
export type BriefStatus = 'researching' | 'ready' | 'failed';
/** Which of the run's three calls is going, while the brief is researching. */
export type BriefStage = 'framing' | 'searching' | 'writing';
/** Who published a source, as the run labelled it (learn.readings.found_kind). */
export type FoundKind = 'regulator' | 'professional_body' | 'firm' | 'press' | 'vendor';

export const BRIEF_DEPTHS: readonly BriefDepth[] = ['quick', 'standard', 'deep'];
export const BRIEF_STAGES: readonly BriefStage[] = ['framing', 'searching', 'writing'];
export const FOUND_KINDS: readonly FoundKind[] = ['regulator', 'professional_body', 'firm', 'press', 'vendor'];

/** What the page says while a stage runs. */
export const STAGE_LABELS: Record<BriefStage, string> = {
  framing: 'Breaking the question down',
  searching: 'Searching and reading sources',
  writing: 'Writing the answers',
};

export const FOUND_KIND_LABELS: Record<FoundKind, string> = {
  regulator: 'Regulator',
  professional_body: 'Professional body',
  firm: 'Firm',
  press: 'Press',
  vendor: 'Vendor',
};

/** One of the three to five questions the run splits the question into. */
export type SubQuestion = { id: string; text: string };

/** Words quoted from a reading, exactly as the API returned them. */
export type BriefCitation = { reading_id: string; quote: string };

/** The answer to one sub-question: Dash's position and the quotes it rests on. */
export type BriefSection = {
  sub_question_id: string;
  position: string;
  citations: BriefCitation[];
};

export type Brief = {
  id: string;
  trackId: string | null;
  question: string;
  angle: string;
  depth: BriefDepth;
  subQuestions: SubQuestion[];
  status: BriefStatus;
  stage: BriefStage | null;
  error: string | null;
  sections: BriefSection[];
  shortAnswer: string;
  shortAnswerBy: 'dash' | 'you';
  watchOn: boolean;
  watchedAt: string | null;
  quietChecks: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BriefRow = {
  id: string;
  track_id: string | null;
  question: string;
  angle: string | null;
  depth: string;
  sub_questions: unknown;
  status: string;
  stage?: string | null;
  error: string | null;
  sections: unknown;
  short_answer: string | null;
  short_answer_by: string;
  watch_on: boolean;
  watched_at: string | null;
  quiet_checks: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export const BRIEF_COLUMNS =
  'id, track_id, question, angle, depth, sub_questions, status, stage, error, sections, short_answer, ' +
  'short_answer_by, watch_on, watched_at, quiet_checks, archived_at, created_at, updated_at';

type Obj = Record<string, unknown>;

function objects(raw: unknown): Obj[] {
  return Array.isArray(raw) ? raw.filter((x): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)) : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readSubQuestions(raw: unknown): SubQuestion[] {
  const seen = new Set<string>();
  return objects(raw).flatMap((q) => {
    const id = str(q.id);
    const text = str(q.text);
    if (!id || !text || seen.has(id)) return [];
    seen.add(id);
    return [{ id, text }];
  });
}

export function readSections(raw: unknown): BriefSection[] {
  return objects(raw).flatMap((s) => {
    const subQuestionId = str(s.sub_question_id);
    const position = str(s.position);
    if (!subQuestionId || !position) return [];
    const citations = objects(s.citations).flatMap((c) => {
      const readingId = str(c.reading_id);
      const quote = str(c.quote);
      return readingId && quote ? [{ reading_id: readingId, quote }] : [];
    });
    return [{ sub_question_id: subQuestionId, position, citations }];
  });
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function briefFromRow(row: BriefRow): Brief {
  return {
    id: row.id,
    trackId: row.track_id,
    question: row.question,
    angle: row.angle ?? '',
    depth: oneOf(row.depth, BRIEF_DEPTHS, 'standard'),
    subQuestions: readSubQuestions(row.sub_questions),
    status: oneOf<BriefStatus>(row.status, ['researching', 'ready', 'failed'], 'researching'),
    stage: BRIEF_STAGES.includes(row.stage as BriefStage) ? (row.stage as BriefStage) : null,
    error: row.error,
    sections: readSections(row.sections),
    shortAnswer: row.short_answer ?? '',
    shortAnswerBy: row.short_answer_by === 'you' ? 'you' : 'dash',
    watchOn: row.watch_on,
    watchedAt: row.watched_at,
    quietChecks: row.quiet_checks,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A found_kind written loosely ("Professional body", "standard-setter") read into the column's values. */
export function readFoundKind(raw: string): FoundKind | null {
  const word = raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!word) return null;
  if (/\b(regulator|regulatory|standard setter|standards? body|government|agency|supervisor)\b/.test(word)) return 'regulator';
  if (/\b(professional|institute|association|body)\b/.test(word)) return 'professional_body';
  if (/\b(vendor|product|commercial)\b/.test(word)) return 'vendor';
  if (/\b(firm|consultanc|consulting|law firm|audit firm|big four)\w*/.test(word)) return 'firm';
  if (/\b(press|news|journal|media|magazine|blog|academic|paper)\b/.test(word)) return 'press';
  return null;
}
