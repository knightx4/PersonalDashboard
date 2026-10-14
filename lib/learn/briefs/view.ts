/**
 * A research brief as its page reads it (plan #2023.4).
 *
 * `learn.briefs` keeps the sub-questions and the sections as jsonb (migration
 * learn 0116). The research run writes them (plan #2023.2); this file reads
 * them back for /learn/b/[id] and Learn's list of open briefs, tolerating any
 * entry that is not the expected shape by leaving it out rather than failing
 * the page.
 *
 * While a brief is researching, the page names the stage it is on
 * (`briefStage`). The run records it in `stage` (framing, searching or
 * writing; learn migration 0117, plan #2023.2); where that is empty, the stage
 * is read from what the run has written so far: no sub-questions yet means it
 * is still framing them, sub-questions with no readings means it is
 * searching, readings with no sections means it is reading, and some sections
 * means it is writing the answers.
 */

export type BriefStatus = 'researching' | 'ready' | 'failed';
export type BriefDepth = 'quick' | 'standard' | 'deep';
export type BriefRunStage = 'framing' | 'searching' | 'writing';
export type FoundKind = 'regulator' | 'professional_body' | 'firm' | 'press' | 'vendor';

export type BriefSubQuestion = { id: string; text: string };
export type BriefCitation = { readingId: string; quote: string };
export type BriefSection = { subQuestionId: string; position: string; citations: BriefCitation[] };

/** A reading the brief found, with what the quote popover says about it. */
export type BriefSource = {
  readingId: string;
  title: string;
  kind: FoundKind | null;
  /** The year the source was published, when known. */
  year: number | null;
  /** When the run found it. */
  foundAt: string | null;
  url: string | null;
};

export type Brief = {
  id: string;
  trackId: string | null;
  trackTitle: string | null;
  question: string;
  angle: string;
  depth: BriefDepth;
  subQuestions: BriefSubQuestion[];
  status: BriefStatus;
  /** What the run says it is doing, when it has said. */
  stage: BriefRunStage | null;
  error: string | null;
  sections: BriefSection[];
  shortAnswer: string;
  shortAnswerBy: 'dash' | 'you';
  watchOn: boolean;
  watchedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The brief with the readings its run found, by reading id. */
export type BriefPage = { brief: Brief; sources: Record<string, BriefSource> };

/** One open brief in Learn's list. */
export type BriefSummary = {
  id: string;
  question: string;
  status: BriefStatus;
  subQuestions: number;
  updatedAt: string;
};

export const FOUND_KIND_LABELS: Record<FoundKind, string> = {
  regulator: 'Regulator',
  professional_body: 'Professional body',
  firm: 'Firm',
  press: 'Press',
  vendor: 'Vendor',
};

const STATUSES: readonly BriefStatus[] = ['researching', 'ready', 'failed'];
const STAGES: readonly BriefRunStage[] = ['framing', 'searching', 'writing'];
const DEPTHS: readonly BriefDepth[] = ['quick', 'standard', 'deep'];
const KINDS = Object.keys(FOUND_KIND_LABELS) as FoundKind[];

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseSubQuestions(value: unknown): BriefSubQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, i) => {
    if (typeof entry === 'string') return str(entry) ? [{ id: String(i + 1), text: entry }] : [];
    const row = record(entry);
    const text = row ? str(row.text) : null;
    if (!row || !text) return [];
    const id = str(row.id) ?? (typeof row.id === 'number' ? String(row.id) : String(i + 1));
    return [{ id, text }];
  });
}

export function parseSections(value: unknown): BriefSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    const subQuestionId =
      str(row.sub_question_id) ?? (typeof row.sub_question_id === 'number' ? String(row.sub_question_id) : null);
    const position = str(row.position);
    if (!subQuestionId || !position) return [];
    const citations = Array.isArray(row.citations)
      ? row.citations.flatMap((c) => {
          const cite = record(c);
          const readingId = cite ? str(cite.reading_id) : null;
          const quote = cite ? str(cite.quote) : null;
          return readingId && quote ? [{ readingId, quote }] : [];
        })
      : [];
    return [{ subQuestionId, position, citations }];
  });
}

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
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  tracks?: { title: string | null } | { title: string | null }[] | null;
};

export function toBrief(row: BriefRow): Brief {
  const track = Array.isArray(row.tracks) ? row.tracks[0] : row.tracks;
  return {
    id: row.id,
    trackId: row.track_id,
    trackTitle: track?.title ?? null,
    question: row.question,
    angle: row.angle ?? '',
    depth: DEPTHS.includes(row.depth as BriefDepth) ? (row.depth as BriefDepth) : 'standard',
    subQuestions: parseSubQuestions(row.sub_questions),
    status: STATUSES.includes(row.status as BriefStatus) ? (row.status as BriefStatus) : 'researching',
    stage: STAGES.includes(row.stage as BriefRunStage) ? (row.stage as BriefRunStage) : null,
    error: row.error,
    sections: parseSections(row.sections),
    shortAnswer: row.short_answer ?? '',
    shortAnswerBy: row.short_answer_by === 'you' ? 'you' : 'dash',
    watchOn: row.watch_on,
    watchedAt: row.watched_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function foundKind(value: unknown): FoundKind | null {
  return KINDS.includes(value as FoundKind) ? (value as FoundKind) : null;
}

/** Where a researching brief has got to, named from what it has written so far. */
export type BriefStage = { label: string; detail: string };

export function briefStage(
  brief: Pick<Brief, 'subQuestions' | 'sections' | 'stage'>,
  sourcesFound: number,
): BriefStage {
  const asked = brief.subQuestions.length;
  if (brief.stage === 'framing' || asked === 0) {
    return { label: 'Framing the questions', detail: 'Working out the three to five questions your topic breaks into.' };
  }
  if (brief.stage === 'searching' || (brief.stage === null && sourcesFound === 0)) {
    return {
      label: 'Searching for sources',
      detail: `Searching the web for each of the ${asked} questions below.`,
    };
  }
  const answered = new Set(brief.sections.map((s) => s.subQuestionId)).size;
  if (answered === 0 && brief.stage === null) {
    return {
      label: 'Reading the sources',
      detail: `${sourcesFound} ${sourcesFound === 1 ? 'source' : 'sources'} found. Reading them for what they say on each question.`,
    };
  }
  return {
    label: 'Writing the answers',
    detail:
      answered === 0
        ? `Reading ${sourcesFound} ${sourcesFound === 1 ? 'source' : 'sources'} and writing an answer to each question.`
        : `${Math.min(answered, asked)} of ${asked} questions answered so far.`,
  };
}

/** The sources a section cites, once each, in the order first quoted. */
export function sectionSources(section: BriefSection, sources: Record<string, BriefSource>): BriefSource[] {
  const seen = new Set<string>();
  const out: BriefSource[] = [];
  for (const cite of section.citations) {
    const source = sources[cite.readingId];
    if (!source || seen.has(source.readingId)) continue;
    seen.add(source.readingId);
    out.push(source);
  }
  return out;
}

/** The quote popover's second line: the kind and the date, as far as known. */
export function sourceLine(source: BriefSource): string {
  const parts: string[] = [];
  if (source.kind) parts.push(FOUND_KIND_LABELS[source.kind]);
  if (source.year) parts.push(String(source.year));
  else if (source.foundAt) parts.push(`found ${dayLabel(source.foundAt)}`);
  return parts.join(' · ') || 'Kind and date not known';
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The line under a brief in Learn's list. */
export function summaryLine(summary: BriefSummary): string {
  if (summary.status === 'failed') return 'The research stopped. Open it to try again.';
  if (summary.status === 'researching') return 'Dash is researching this now.';
  return `${summary.subQuestions} ${summary.subQuestions === 1 ? 'question' : 'questions'} answered with sources`;
}
