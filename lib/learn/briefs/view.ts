/**
 * A research brief as its page draws it (plan #2023.4).
 *
 * The brief's own shapes, and reading a row into them, are model.ts's (plan
 * #2023.2), which the research run writes with. This file adds only what the
 * page needs on top: the reading list's title, the sources by reading id for
 * the quote popovers, the summary Learn's list shows, and the words for each.
 *
 * While a brief is researching, the page names the stage it is on
 * (`briefStage`). The run records it in `stage` (framing, searching or
 * writing; learn migration 0117); where that is empty, the stage is read from
 * what the run has written so far: no sub-questions yet means it is still
 * framing them, sub-questions with no readings means it is searching, and
 * anything further means it is writing the answers.
 */

import {
  BRIEF_COLUMNS,
  BRIEF_STAGES,
  FOUND_KINDS,
  FOUND_KIND_LABELS,
  STAGE_LABELS,
  briefFromRow,
  type Brief,
  type BriefRow,
  type BriefSection,
  type BriefStage,
  type BriefStatus,
  type FoundKind,
} from './model';
import { whenDate } from '@/lib/core/when';
import type { BriefFinding } from './findings';

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
  /**
   * What it changes in the answer, for a source a weekly check found (plan
   * #2023.8); null for the first run's sources.
   */
  change?: string | null;
  /** Found by a weekly check and not opened yet: marked new on the page and its card. */
  isNew?: boolean;
};

/** The brief as its page draws it: the row, and the title of the reading list it made. */
export type BriefOnPage = Brief & { trackTitle: string | null };

/** The brief with the readings its run found, by reading id. */
export type BriefPage = {
  brief: BriefOnPage;
  sources: Record<string, BriefSource>;
  /** Findings added after the run (lib/learn/briefs/findings.ts); absent where none were read. */
  findings?: BriefFinding[];
};

/** One open brief in Learn's list. */
export type BriefSummary = {
  id: string;
  question: string;
  status: BriefStatus;
  subQuestions: number;
  updatedAt: string;
};

/** The page's columns: the brief's own and its reading list's title. */
export const BRIEF_PAGE_COLUMNS = `${BRIEF_COLUMNS}, tracks!briefs_track_fk ( title )`;

/** A brief row as the page reads it, with the reading list's title joined in. */
export type BriefPageRow = BriefRow & {
  tracks?: { title: string | null } | { title: string | null }[] | null;
};

export function toBriefOnPage(row: BriefPageRow): BriefOnPage {
  const track = Array.isArray(row.tracks) ? row.tracks[0] : row.tracks;
  return { ...briefFromRow(row), trackTitle: track?.title ?? null };
}

export function foundKind(value: unknown): FoundKind | null {
  return FOUND_KINDS.includes(value as FoundKind) ? (value as FoundKind) : null;
}

/** What the page says about a researching brief: the stage's name and a line on it. */
export type StageLine = { stage: BriefStage; label: string; detail: string };

export function briefStage(
  brief: Pick<Brief, 'subQuestions' | 'sections' | 'stage'>,
  sourcesFound: number,
): StageLine {
  const asked = brief.subQuestions.length;
  const stage: BriefStage =
    brief.stage && BRIEF_STAGES.includes(brief.stage)
      ? brief.stage
      : asked === 0
        ? 'framing'
        : sourcesFound === 0
          ? 'searching'
          : 'writing';
  const label = STAGE_LABELS[stage];
  if (stage === 'framing' || asked === 0) {
    return {
      stage: 'framing',
      label: STAGE_LABELS.framing,
      detail: 'Working out the three to five questions your topic breaks into.',
    };
  }
  if (stage === 'searching') {
    return { stage, label, detail: `Searching the web for each of the ${asked} questions below.` };
  }
  const answered = new Set(brief.sections.map((s) => s.sub_question_id)).size;
  return {
    stage,
    label,
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
    const source = sources[cite.reading_id];
    if (!source || seen.has(source.readingId)) continue;
    seen.add(source.readingId);
    out.push(source);
  }
  return out;
}

/** The sources weekly checks found, newest first, for the brief's "New since you asked". */
export function sourcesFoundSince(sources: Record<string, BriefSource>): BriefSource[] {
  return Object.values(sources)
    .filter((source) => source.change)
    .sort((a, b) => (b.foundAt ?? '').localeCompare(a.foundAt ?? ''));
}

/** Whether a source a check found is still new: it has not been opened from the list. */
export function isNewSource(change: string | null | undefined, status: string | null | undefined): boolean {
  return Boolean(change) && status === 'queued';
}

/**
 * The line under a source a check found: its kind, the day it was found and
 * the year it came out, so newest first can be read down the list.
 */
export function foundLine(source: BriefSource): string {
  const parts: string[] = [];
  if (source.kind) parts.push(FOUND_KIND_LABELS[source.kind]);
  if (source.foundAt) parts.push(`found ${dayLabel(source.foundAt)}`);
  if (source.year) parts.push(`published ${source.year}`);
  return parts.join(' · ') || 'Kind and date not known';
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
  return whenDate(iso, { timeZone: 'UTC' });
}

/** The line under a brief in Learn's list. */
export function summaryLine(summary: BriefSummary): string {
  if (summary.status === 'failed') return 'The research stopped. Open it to try again.';
  if (summary.status === 'researching') return 'Dash is researching this now.';
  return `${summary.subQuestions} ${summary.subQuestions === 1 ? 'question' : 'questions'} answered with sources`;
}
