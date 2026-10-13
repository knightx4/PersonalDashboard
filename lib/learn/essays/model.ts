/**
 * Essays in Learn (docs/LEARN-ESSAYS-SPEC.md; plan #1865, under #1863).
 *
 * The shapes the Essays list and the editor read from `learn.essays`, and the
 * small rules both share: what an essay is called and how its words are
 * counted. Nothing here touches the database, so it can be tested and drawn
 * in the gallery from fixtures.
 */

import { readDraftMarks, type AuthorMark } from './authorship';

/**
 * The brief, in the person's own words (spec, "Starting an essay"): the five
 * answers the interview asks for (plan #1867), and what they pinned to it.
 */
export type EssayBrief = {
  question: string;
  claim: string;
  reader: string;
  /** What made them think it. */
  origin: string;
  /** What would change their mind. */
  change: string;
  pinned: EssayPin[];
};

/** The kinds of thing an essay can be started from, and pinned to its brief. */
export const PIN_KINDS = ['goal', 'reading', 'theme', 'log'] as const;
export type PinKind = (typeof PIN_KINDS)[number];

/** Something pinned to the brief: what "Write about this" started the essay from. */
export type EssayPin = { kind: PinKind; id: string; title: string };

/** The five answers, in the order the interview asks for them. */
export const BRIEF_FIELDS = ['question', 'claim', 'reader', 'origin', 'change'] as const;
export type BriefField = (typeof BRIEF_FIELDS)[number];

/**
 * Where the interview that fills the brief has got to (plan #1867), kept in
 * the brief's jsonb under `interview`. `asking` holds the field the next
 * answer fills and the question Dash put for it; an essay with no interview
 * (started before it existed) reads as null.
 */
export type EssayInterview =
  | { status: 'asking'; field: BriefField; ask: string }
  | { status: 'done' }
  | { status: 'skipped' };

/** One essay as the editor needs it. */
export type Essay = {
  id: string;
  path: string;
  /** The vault note, null until the first save to the vault (plan #1866). */
  noteId: string | null;
  /** The note's blob SHA when the editor opened it; the next vault save starts from it. */
  blobSha: string | null;
  draftBody: string;
  /** The runs of the draft that are Dash's or quoted (plan #1868); the rest is the person's. */
  marks: AuthorMark[];
  /** True while the draft is ahead of the vault note. */
  unsaved: boolean;
  brief: EssayBrief;
  /** The interview, or null once there is none to show. */
  interview: EssayInterview | null;
  /** The length aimed at, 200 to 2,000 words, or null for none. */
  wordTarget: number | null;
  publishedAt: string | null;
  /** When it was first published, kept through Unpublish (plan #1863.11). */
  firstPublishedAt?: string | null;
  /** The essay's web address on the site, set at the first vault save. */
  slug?: string | null;
  /** When Finish last ran (plan #1873); null for a draft. */
  finishedAt: string | null;
  /** True once the essay is in the Jobs evidence bank. */
  inEvidenceBank: boolean;
  updatedAt: string;
};

/** One row of the Essays list. */
export type EssaySummary = {
  id: string;
  title: string;
  question: string;
  words: number;
  wordTarget: number | null;
  publishedAt: string | null;
  updatedAt: string;
};

/** The columns both reads select. */
export const ESSAY_COLUMNS =
  'id, path, note_id, blob_sha, draft_body, draft_authorship, unsaved, brief, word_target, published_at, first_published_at, slug, finished_at, evidence_item_id, updated_at';

export type EssayRow = {
  id: string;
  path: string;
  note_id?: string | null;
  blob_sha?: string | null;
  draft_body: string | null;
  draft_authorship?: unknown;
  unsaved: boolean | null;
  brief: unknown;
  word_target: number | null;
  published_at: string | null;
  first_published_at?: string | null;
  slug?: string | null;
  finished_at?: string | null;
  evidence_item_id?: string | null;
  updated_at: string;
};

export const WORD_TARGET_MIN = 200;
export const WORD_TARGET_MAX = 2000;

/** Where a new essay's note will go until the vault save names it from its title. */
export const NEW_ESSAY_PATH = 'Essays/Untitled essay.md';

const UNTITLED = 'Untitled essay';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readPins(value: unknown): EssayPin[] {
  if (!Array.isArray(value)) return [];
  const pins: EssayPin[] = [];
  for (const item of value) {
    const pin = object(item);
    const kind = pin.kind;
    if (typeof kind !== 'string' || !(PIN_KINDS as readonly string[]).includes(kind)) continue;
    if (!text(pin.id) || !text(pin.title)) continue;
    pins.push({ kind: kind as PinKind, id: text(pin.id), title: text(pin.title) });
  }
  return pins;
}

/** The brief from its jsonb, with anything missing or of the wrong type read as empty. */
export function readBrief(value: unknown): EssayBrief {
  const brief = object(value);
  return {
    question: text(brief.question),
    claim: text(brief.claim),
    reader: text(brief.reader),
    origin: text(brief.origin),
    change: text(brief.change),
    pinned: readPins(brief.pinned),
  };
}

/** The interview from the brief's jsonb; null when there is none or it is not one this code wrote. */
export function readInterview(value: unknown): EssayInterview | null {
  const interview = object(object(value).interview);
  if (interview.status === 'done' || interview.status === 'skipped') return { status: interview.status };
  if (interview.status !== 'asking') return null;
  const field = interview.field;
  if (typeof field !== 'string' || !(BRIEF_FIELDS as readonly string[]).includes(field)) return null;
  if (!text(interview.ask).trim()) return null;
  return { status: 'asking', field: field as BriefField, ask: text(interview.ask) };
}

export function toEssay(row: EssayRow): Essay {
  return {
    id: row.id,
    path: row.path,
    noteId: row.note_id ?? null,
    blobSha: row.blob_sha ?? null,
    draftBody: row.draft_body ?? '',
    marks: readDraftMarks(row.draft_authorship, (row.draft_body ?? '').length),
    unsaved: row.unsaved ?? false,
    brief: readBrief(row.brief),
    interview: readInterview(row.brief),
    wordTarget: row.word_target,
    publishedAt: row.published_at,
    firstPublishedAt: row.first_published_at ?? null,
    slug: row.slug ?? null,
    finishedAt: row.finished_at ?? null,
    inEvidenceBank: Boolean(row.evidence_item_id),
    updatedAt: row.updated_at,
  };
}

export function toSummary(row: EssayRow): EssaySummary {
  const body = row.draft_body ?? '';
  return {
    id: row.id,
    title: essayTitle(body, row.path),
    question: readBrief(row.brief).question,
    words: countWords(body),
    wordTarget: row.word_target,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

/** Frontmatter at the very start of the text, which is not part of the essay's words. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/**
 * What the essay is called: its first top-level heading, or failing that the
 * note's file name, or "Untitled essay". The draft is the newest thing the
 * person typed, so a heading there wins over a file name the vault has not
 * caught up with.
 */
export function essayTitle(body: string, path: string): string {
  const heading = body.replace(FRONTMATTER, '').match(/^#[ \t]+(.+?)[ \t#]*$/m);
  if (heading && heading[1]!.trim()) return heading[1]!.trim();
  const file = path.split('/').pop()?.replace(/\.md$/i, '').trim() ?? '';
  return file || UNTITLED;
}

/**
 * The words in a draft: runs of text holding at least one letter or digit,
 * so markdown symbols on their own (`#`, `-`, `>`, `---`, `**`) are not
 * counted, and frontmatter is left out.
 */
export function countWords(body: string): number {
  const words = body.replace(FRONTMATTER, '').split(/\s+/);
  let count = 0;
  for (const word of words) if (/[\p{L}\p{N}]/u.test(word)) count += 1;
  return count;
}

/**
 * The word count as it is shown under the draft: "412 words", or
 * "412 of 800 words" with a target.
 */
export function wordCountLabel(words: number, target: number | null): string {
  const n = words.toLocaleString('en-GB');
  if (target === null) return `${n} ${words === 1 ? 'word' : 'words'}`;
  return `${n} of ${target.toLocaleString('en-GB')} words`;
}

/** A target typed into the field, or an error saying what is allowed. */
export function parseWordTarget(input: string): { target: number | null } | { error: string } {
  const trimmed = input.trim().replace(/,/g, '');
  if (!trimmed) return { target: null };
  if (!/^\d+$/.test(trimmed)) return { error: 'Write the target as a number of words.' };
  const target = Number(trimmed);
  if (target < WORD_TARGET_MIN || target > WORD_TARGET_MAX) {
    return { error: `A target is between ${WORD_TARGET_MIN} and ${WORD_TARGET_MAX.toLocaleString('en-GB')} words.` };
  }
  return { target };
}
