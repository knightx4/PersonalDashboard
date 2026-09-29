import { createHash } from 'node:crypto';
import { JEV_CONFIDENCE_FLOOR } from '@/lib/jev/decide';

/**
 * The map trial re-run on Jev and Haiku (plan #1168): which notes it reads and
 * how the answers are counted. Pure, so both are tested without a database;
 * the job that asks the models is inngest/vault/jev-trial.ts.
 *
 * The notes are the 75 of docs/trials/2026-09-19-map-75-notes.md, drawn again
 * the way that trial drew them: every live note but three, ordered by
 * `md5(id || 'trial75')`. The trial stored no verdict per note. What it did
 * record is which notes it found positions in, and which ones it said should
 * be read and were not. Those are TRIAL_READS, the reference both models are
 * scored against. The rest of the sample has no reference, and where Jev and
 * Haiku differ on it the write-up reads the note.
 */

/** The trial's name in obsidian.jev_trial_answers. A second run takes a new one. */
export const JEV_MAP_TRIAL = 'map-75-2026-09';

const SEED = 'trial75';
export const MAP_TRIAL_SIZE = 75;

/** Left out of the draw on privacy, as the trial did. */
export const MAP_TRIAL_LEFT_OUT = ['Me/Journal.md', 'Me/Dreams.md', 'Me/Passwords.md'] as const;

/**
 * Notes the trial says should be read, by path. `evidence` where it also
 * named the note as evidence of what somebody was taught. From the trial's
 * write-up: the notes its clusters were built from, the four short notes
 * finding 2 says the old floor lost, and the two evidence notes finding 1
 * says carried positions. The "note about Dallas" is left out: two notes in
 * the sample could be it.
 */
export const TRIAL_READS: Readonly<Record<string, { evidence?: true }>> = {
  'Bulk/Bulk - Ideas/Game Design.md': {},
  'Bulk/Bulk - Ideas/God is that which cannot be known.md': {},
  'Bulk/Bulk - Ideas/Niche.md': {},
  'Bulk/Bulk - Ideas/On Ways of Thought.md': {},
  'Bulk/Bulk - Ideas/Parking lots.md': {},
  'Bulk/Bulk - Ideas/Ship of Theseus.md': {},
  'Bulk/Bulk - Ideas/Striving itself is Moral Act.md': {},
  'Bulk/Bulk - Wiki/Ideas/individuation.md': {},
  'Bulk/Inverse Modeling.md': {},
  'Bulk/Laura Fox.md': {},
  'Bulk/Resources/Books/Marriage of Heaven and Hell.md': {},
  'Bulk/Resources/Books/Utopia for Realists.md': {},
  'Bulk/Resources/Video-Podcasts/Shakespeare renaissance podcast.md': {},
  'Career/Job Applications/Galaxy Interview Prep.md': {},
  'Career/Job Applications/campfire application backup.md': {},
  'Career/Job Applications/garage application.md': {},
  'Pending/Bovadium Fragments.md': {},
  'Pending/LSME - Session 13 Prep & Assignment.md': {},
  'Pending/Order Without Design.md': {},
  'Pending/Small Cohort Social.md': {},
  'Pending/South Sea Bubble.md': {},
  'Pending/The Wealth of Nations.md': {},
  'Pending/Urban Technology.md': {},
  'Pending/WFH - Alexander Hamilton Case.md': { evidence: true },
  'Pending/inversion and asymmetry between failure and success.md': {},
  'Tasks/SEWB Application Assignment.md': {},
  'Yale/Course Summaries/MGT 430 - The Executive.md': { evidence: true },
};

function sampleKey(id: string): string {
  return createHash('md5').update(`${id}${SEED}`).digest('hex');
}

/** The trial's 75 notes from the live vault, in the trial's order. */
export function pickMapTrialSample<N extends { id: string; path: string }>(notes: readonly N[]): N[] {
  const leftOut = new Set<string>(MAP_TRIAL_LEFT_OUT);
  return notes
    .filter((note) => !leftOut.has(note.path))
    .map((note) => ({ note, key: sampleKey(note.id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, MAP_TRIAL_SIZE)
    .map(({ note }) => note);
}

/** The reference for a note: 'read' when the trial says it should be read, else null. */
export function referenceFor(path: string): { reference: 'read' | null; evidence: boolean | null } {
  const entry = TRIAL_READS[path];
  if (!entry) return { reference: null, evidence: null };
  return { reference: 'read', evidence: entry.evidence ? true : null };
}

/**
 * What the trial does when a model gives no answer. `stop` ends the run: a
 * missing or refused key, or an Anthropic account out of credit, fails every
 * note the same way. `store` keeps the failure as the note's answer. `retry`
 * writes nothing, so the next run asks again.
 */
export function onJevFailure(failure: { reason: string; detail: string }): 'stop' | 'store' | 'retry' {
  if (failure.reason === 'no-key') return 'stop';
  if (failure.reason === 'refused') return /^40[13]\b/.test(failure.detail) ? 'stop' : 'store';
  if (failure.reason === 'malformed') return 'store';
  return 'retry';
}

const HAIKU_STOPS = /credit balance is too low|reached your .*limit|authentication_error|invalid x-api-key/i;

export function onHaikuFailure(detail: string): 'stop' | 'retry' {
  return HAIKU_STOPS.test(detail) ? 'stop' : 'retry';
}

export type MapTrialAnswer = {
  note_id: string;
  path: string;
  not_sent: string | null;
  excluded: boolean;
  reference: string | null;
  reference_evidence: boolean | null;
  jev_class: string | null;
  jev_confidence: number | string | null;
  jev_evidence_probability: number | string | null;
  jev_failure: string | null;
  haiku_class: string | null;
  haiku_evidence: boolean | null;
  haiku_reason: string | null;
  haiku_failure: string | null;
};

export type Scored = {
  notes: number;
  /** Notes each reader would send to be read (knowledge or mixed). */
  jevReads: number;
  haikuReads: number;
  /** Jev where it is sure, Haiku otherwise: what the sweep would do. */
  rolloutReads: number;
};

export type MapTrialDisagreement = {
  path: string;
  jev: string;
  confidence: number;
  haiku: string;
  haikuReason: string | null;
  reference: string | null;
};

export type MapTrialSummary = {
  notes: number;
  notSent: Record<string, number>;
  jevFailed: Record<string, number>;
  haikuFailed: Record<string, number>;
  /** Notes both models answered. */
  compared: number;
  classAgree: number;
  /** Agreeing on read against not read, which is all the class decides. */
  routeAgree: number;
  /** Jev under the floor: these go to Haiku in the rollout and carry its reason. */
  unsure: number;
  sure: { notes: number; classAgree: number; routeAgree: number };
  byHaikuClass: { class: string; notes: number; jevAgree: number; unsure: number }[];
  evidenceAgree: number;
  /** The trial's reference: notes it says should be read. */
  reference: Scored & { evidenceNotes: number; jevEvidence: number; haikuEvidence: number };
  /** Every compared note, whatever the reference. */
  all: Scored;
  disagreements: MapTrialDisagreement[];
};

function num(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const reads = (noteClass: string) => noteClass !== 'operational';

function count(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

export function summariseMapTrial(
  rows: readonly MapTrialAnswer[],
  floor = JEV_CONFIDENCE_FLOOR,
): MapTrialSummary {
  const summary: MapTrialSummary = {
    notes: rows.length,
    notSent: {},
    jevFailed: {},
    haikuFailed: {},
    compared: 0,
    classAgree: 0,
    routeAgree: 0,
    unsure: 0,
    sure: { notes: 0, classAgree: 0, routeAgree: 0 },
    byHaikuClass: [],
    evidenceAgree: 0,
    reference: {
      notes: 0,
      jevReads: 0,
      haikuReads: 0,
      rolloutReads: 0,
      evidenceNotes: 0,
      jevEvidence: 0,
      haikuEvidence: 0,
    },
    all: { notes: 0, jevReads: 0, haikuReads: 0, rolloutReads: 0 },
    disagreements: [],
  };
  const byClass = new Map<string, { class: string; notes: number; jevAgree: number; unsure: number }>();

  for (const row of rows) {
    if (row.not_sent) {
      count(summary.notSent, row.not_sent);
      continue;
    }
    if (row.jev_failure) count(summary.jevFailed, row.jev_failure.split(':')[0]);
    if (row.haiku_failure) count(summary.haikuFailed, row.haiku_failure.slice(0, 60));
    if (!row.jev_class || !row.haiku_class) continue;

    const confidence = num(row.jev_confidence) ?? 0;
    const sure = confidence >= floor;
    const classAgree = row.jev_class === row.haiku_class;
    const routeAgree = reads(row.jev_class) === reads(row.haiku_class);
    const rollout = sure ? row.jev_class : row.haiku_class;
    const jevEvidence = (num(row.jev_evidence_probability) ?? 0) >= 0.5;

    summary.compared += 1;
    if (classAgree) summary.classAgree += 1;
    if (routeAgree) summary.routeAgree += 1;
    if (!sure) summary.unsure += 1;
    if (sure) {
      summary.sure.notes += 1;
      if (classAgree) summary.sure.classAgree += 1;
      if (routeAgree) summary.sure.routeAgree += 1;
    }
    if (row.jev_evidence_probability !== null && jevEvidence === row.haiku_evidence) {
      summary.evidenceAgree += 1;
    }

    const line = byClass.get(row.haiku_class) ?? { class: row.haiku_class, notes: 0, jevAgree: 0, unsure: 0 };
    line.notes += 1;
    if (classAgree) line.jevAgree += 1;
    if (!sure) line.unsure += 1;
    byClass.set(row.haiku_class, line);

    const scores: Scored[] = [summary.all];
    if (row.reference === 'read') scores.push(summary.reference);
    for (const scored of scores) {
      scored.notes += 1;
      if (reads(row.jev_class)) scored.jevReads += 1;
      if (reads(row.haiku_class)) scored.haikuReads += 1;
      if (reads(rollout)) scored.rolloutReads += 1;
    }
    if (row.reference_evidence) {
      summary.reference.evidenceNotes += 1;
      if (jevEvidence) summary.reference.jevEvidence += 1;
      if (row.haiku_evidence) summary.reference.haikuEvidence += 1;
    }

    if (!classAgree) {
      summary.disagreements.push({
        path: row.path,
        jev: row.jev_class,
        confidence,
        haiku: row.haiku_class,
        haikuReason: row.haiku_reason,
        reference: row.reference,
      });
    }
  }

  summary.byHaikuClass = [...byClass.values()].sort((a, b) => b.notes - a.notes);
  summary.disagreements.sort((a, b) => b.confidence - a.confidence);
  return summary;
}
