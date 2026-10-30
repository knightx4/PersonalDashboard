import { BIG_FIVE_FACTORS } from './ipip';
import type { PersonalityResult } from './model';
import { describeResult, noteLabel, NOTE_CHARS, PINNED_CHARS, readQueries, type CandidateNote } from './read';

/**
 * Dash's analysis across all of a person's personality tests: the pure half.
 * profile-run.ts reads the rows, makes the call and keeps the result.
 *
 * Each test is read against the person's notes on its own already
 * (read.ts). This one puts them side by side: where they agree, where they
 * disagree and what the person's notes and record say about which is nearer,
 * and the patterns the tests predict, each with a number from the record.
 */

export type ProfileAgreement = { text: string; tests: string[] };
export type ProfileTension = {
  text: string;
  tests: string[];
  /** What the notes and record say about which test is nearer. */
  verdict: string;
  /** The note it rests on, as it was when the analysis was written. */
  note: { id: string; title: string; path: string } | null;
};
export type ProfileWatch = { text: string; evidence: string };

export type PersonalityProfile = {
  id: string;
  resultsKey: string;
  summary: string;
  agreements: ProfileAgreement[];
  tensions: ProfileTension[];
  watch: ProfileWatch[];
  model: string;
  createdAt: string;
};

export const PROFILE_COLUMNS = 'id, results_key, summary, agreements, tensions, watch, model, created_at';

export type ProfileRow = {
  id: string;
  results_key: string;
  summary: string;
  agreements: unknown;
  tensions: unknown;
  watch: unknown;
  model: string;
  created_at: string;
};

/** Results needed before an analysis across them says anything. */
export const PROFILE_MIN_RESULTS = 2;

/** 32-bit FNV-1a, as eight hex digits. */
function fnv(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A fingerprint of what the results say: each one's test, type, scores,
 * themes, note and date, in id order. Dash's per-test reads are left out, so
 * a fresh read of one test does not make the analysis look out of date; an
 * added, changed or deleted result does.
 */
export function profileKey(results: readonly PersonalityResult[]): string {
  const parts = [...results]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) =>
      JSON.stringify(
        r.kind === 'big_five'
          ? [r.id, r.kind, r.takenAt, r.note, BIG_FIVE_FACTORS.map((f) => r.scores[f])]
          : [r.id, r.kind, r.testName, r.typedValue, r.takenAt, r.note, r.typeScores, r.themes],
      ),
    );
  const text = parts.join('\n');
  return `${results.length}-${fnv(text, 0x811c9dc5)}${fnv(text, 0x01000193)}`;
}

/**
 * What the tab offers. `none` with too few results to compare; `first` when
 * there are enough and no analysis yet; `changed` when a result was added,
 * changed or deleted since the newest one; `current` when it still fits.
 */
export type ProfileState = 'none' | 'first' | 'changed' | 'current';

export function profileState(
  results: readonly PersonalityResult[],
  profile: Pick<PersonalityProfile, 'resultsKey'> | null,
): ProfileState {
  if (!profile) return results.length >= PROFILE_MIN_RESULTS ? 'first' : 'none';
  return profile.resultsKey === profileKey(results) ? 'current' : 'changed';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function noteFrom(value: unknown): ProfileTension['note'] {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.path !== 'string') return null;
  return { id: v.id, path: v.path, title: text(v.title) ?? v.path };
}

/** A stored analysis, dropping any item in a shape this code never wrote. */
export function profileFromRow(row: ProfileRow): PersonalityProfile {
  const list = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object')
      : [];
  return {
    id: row.id,
    resultsKey: row.results_key,
    summary: row.summary,
    agreements: list(row.agreements).flatMap((v) => {
      const t = text(v.text);
      return t ? [{ text: t, tests: strings(v.tests) }] : [];
    }),
    tensions: list(row.tensions).flatMap((v) => {
      const t = text(v.text);
      const verdict = text(v.verdict);
      return t && verdict ? [{ text: t, tests: strings(v.tests), verdict, note: noteFrom(v.note) }] : [];
    }),
    watch: list(row.watch).flatMap((v) => {
      const t = text(v.text);
      const evidence = text(v.evidence);
      return t && evidence ? [{ text: t, evidence }] : [];
    }),
    model: row.model,
    createdAt: row.created_at,
  };
}

/** What the record shows, as the run read it: counts only, each already worked out. */
export type ProfileRecord = {
  /** The newest row of you.insight_signals, or null when there is none. */
  signals: Record<string, unknown> | null;
  /** The day those signals are for. */
  signalsDay: string | null;
  /** Learn readings by status: queued, reading, read. */
  readings: Record<string, number> | null;
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function at(value: unknown, ...path: string[]): unknown {
  let v = value;
  for (const key of path) {
    if (!v || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
}

/**
 * The record as lines for the prompt. Only numbers that were worked out are
 * given; a missing one is left out rather than guessed.
 */
export function recordLines(record: ProfileRecord): string[] {
  const lines: string[] = [];
  const s = record.signals;
  const add = (label: string, ...values: [string, unknown][]) => {
    const known = values.filter(([, v]) => num(v) !== null).map(([name, v]) => `${name} ${v}`);
    if (known.length > 0) lines.push(`- ${label}: ${known.join(', ')}`);
  };
  if (s) {
    add(
      'Job applications',
      ['sent in all', at(s, 'applications', 'submitted')],
      ['sent in the last 7 days', at(s, 'applications', 'submitted_7d')],
      ['got past the first screen', at(s, 'applications', 'past_screen')],
    );
    add('Saved job leads left untouched over 14 days', ['count', at(s, 'saved_leads_stale')]);
    add(
      'Goal steps closed',
      ['by them', at(s, 'goal_steps_closed', 'you')],
      ['by Dash', at(s, 'goal_steps_closed', 'dash')],
    );
    add(
      'Their own steps that ask someone for something and were dropped',
      ['in all', at(s, 'dropped_asks', 'total')],
      ['in the last 30 days', at(s, 'dropped_asks', 'last_30d')],
    );
    add(
      'Deadlines passed and not met',
      ['goal items', at(s, 'deadlines_passed', 'goal_items')],
      ['job reminders', at(s, 'deadlines_passed', 'job_reminders')],
    );
    add(
      'Pages opened in the last 7 days',
      ['building the app', at(s, 'views_7d', 'build')],
      ['the rest', at(s, 'views_7d', 'other')],
      ['between midnight and 5am', at(s, 'views_7d', 'late_night')],
    );
    add('Feedback notes filed on the app', ['in all', at(s, 'feedback_filed', 'total')], ['in the last 7 days', at(s, 'feedback_filed', 'last_7d')]);
    add('Thoughts written about the job search', ['in all', at(s, 'job_thoughts', 'total')], ['in the last 30 days', at(s, 'job_thoughts', 'last_30d')]);
  }
  if (record.readings) {
    add(
      'Learn readings',
      ['saved and not started', record.readings.queued ?? 0],
      ['in progress', record.readings.reading ?? 0],
      ['finished', record.readings.read ?? 0],
    );
  }
  if (lines.length > 0 && record.signalsDay) lines.unshift(`As of ${record.signalsDay}:`);
  return lines;
}

/**
 * The texts embedded to find the notes: every trait sentence of a Big Five
 * and the first text of each other test, so each test brings its nearest
 * notes, then the sentence about how they see themselves.
 */
export function profileQueries(results: readonly PersonalityResult[]): string[] {
  const texts = new Set<string>();
  let self: string | null = null;
  for (const r of results) {
    const q = readQueries(r);
    self = q[q.length - 1];
    const own = q.slice(0, -1);
    for (const t of r.kind === 'big_five' ? own : own.slice(0, 1)) texts.add(t);
  }
  if (self) texts.add(self);
  return [...texts];
}

export const PROFILE_TOOL = 'report_profile';

export const PROFILE_SYSTEM = `You are reading all of somebody's personality test results together,
against their own notes and a few numbers from their record in a personal
dashboard. Each test has already been read against their notes on its own;
your job is the view across them.

WHAT TO WRITE.
- summary: three to five sentences, to them ("you"), on what the tests
  together say about how they think, work and deal with people, and the one
  thing the tests disagree on that matters most.
- agreements: two to five things several tests say alike. Name the tests and
  what in each says it (a score, a type, a theme). An agreement of one test
  with itself is not one.
- tensions: every place two tests point different ways, up to five. Say what
  each test says, then in verdict what their notes and record say about
  which is nearer, quoting or closely paraphrasing the line or giving the
  number. Name the note by its label (N1, N2…) in the note field when the
  verdict rests on one, never in the text. When nothing in the notes or
  record settles it, say so plainly in verdict.
- watch: two to four patterns the tests predict (the blind spots their
  reports name, or a trait taken to its end) that their record lets you
  check. Put the number from the record in evidence, as given, and say in
  text whether it bears the pattern out. Use only numbers you were given;
  never estimate one.

WEIGHING THE TESTS. The Big Five is the best-studied of these and its scores
are measured; give it the most weight. Myers-Briggs, Enneagram, DISC,
ColorCode and similar type tests are weaker evidence: read them as what the
person recognised in themselves when they took them. An older result is
weaker than a newer one, and a change between them is worth saying.

VOICE. Plain and specific. No flattery, no hedging filler, no em dashes, and
no "not X, but Y" contrasts. Never invent a note, a quote or a number.`;

/** The user message: every result, the record, then the notes by label. */
export function profilePrompt(
  results: readonly PersonalityResult[],
  record: ProfileRecord,
  notes: readonly { note: CandidateNote; pinned: boolean }[],
): string {
  const lines: string[] = ['Their results, newest first:'];
  const ordered = [...results].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  for (const r of ordered) lines.push('', describeResult(r, [r]));
  const facts = recordLines(record);
  lines.push('', 'Their record:', ...(facts.length > 0 ? facts : ['- nothing worked out yet']));
  lines.push('', 'Their notes:');
  if (notes.length === 0) lines.push('- none found');
  notes.forEach(({ note, pinned }, i) => {
    const body = note.body.replace(/\s+/g, ' ').trim();
    const max = pinned ? PINNED_CHARS : NOTE_CHARS;
    lines.push('', `${noteLabel(i)}: "${note.title}"`, body.length > max ? `${body.slice(0, max - 1).trimEnd()}…` : body);
  });
  lines.push('', `Call ${PROFILE_TOOL} with the analysis.`);
  return lines.join('\n');
}

const TESTS = { type: 'array', items: { type: 'string' }, description: 'The tests it draws on, by name.' };

export const PROFILE_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' },
    agreements: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, tests: TESTS },
        required: ['text', 'tests'],
      },
    },
    tensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          tests: TESTS,
          verdict: { type: 'string' },
          note: { type: 'string', description: 'The label of the note the verdict rests on, such as N3, or empty.' },
        },
        required: ['text', 'tests', 'verdict'],
      },
    },
    watch: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, evidence: { type: 'string' } },
        required: ['text', 'evidence'],
      },
    },
  },
  required: ['summary', 'agreements', 'tensions', 'watch'],
};

/** Items kept of each list. */
export const PROFILE_ITEMS = 5;
/** Characters kept of one item's text, and of the summary. */
export const PROFILE_TEXT_CHARS = 600;
export const PROFILE_SUMMARY_CHARS = 1_500;

function cut(value: unknown, max: number): string | null {
  const t = text(value);
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The analysis from the tool's input, each tension tied to the note it names.
 * A tension naming a note it was not given keeps its verdict with no note.
 * Null when the input has no summary at all.
 */
export function profileFrom(
  input: unknown,
  notes: readonly { note: CandidateNote }[],
): Omit<PersonalityProfile, 'id' | 'resultsKey' | 'model' | 'createdAt'> | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  const summary = cut(v.summary, PROFILE_SUMMARY_CHARS);
  if (!summary) return null;
  const items = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
      .slice(0, PROFILE_ITEMS);
  const byLabel = new Map(notes.map((n, i) => [noteLabel(i), n.note]));
  return {
    summary,
    agreements: items(v.agreements).flatMap((x) => {
      const t = cut(x.text, PROFILE_TEXT_CHARS);
      return t ? [{ text: t, tests: strings(x.tests) }] : [];
    }),
    tensions: items(v.tensions).flatMap((x) => {
      const t = cut(x.text, PROFILE_TEXT_CHARS);
      const verdict = cut(x.verdict, PROFILE_TEXT_CHARS);
      if (!t || !verdict) return [];
      const n = typeof x.note === 'string' ? byLabel.get(x.note.trim()) : undefined;
      return [{ text: t, tests: strings(x.tests), verdict, note: n ? { id: n.id, title: n.title, path: n.path } : null }];
    }),
    watch: items(v.watch).flatMap((x) => {
      const t = cut(x.text, PROFILE_TEXT_CHARS);
      const evidence = cut(x.evidence, PROFILE_TEXT_CHARS);
      return t && evidence ? [{ text: t, evidence }] : [];
    }),
  };
}
