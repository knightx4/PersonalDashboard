/**
 * What gather() collects for one application's drafts (plan #2130.2), as
 * plain data a prompt builder can render or a test can compare.
 */
import type { RequirementKind } from '@/lib/jobs/jd/requirements';
import type { MatchVerdict } from '@/lib/jobs/evidence/match-payload';
import type { AnswerLimit } from './limits';

export type AnswerStatus = 'draft' | 'approved' | 'submitted';

export type GatheredRequirement = {
  text: string;
  kind: RequirementKind;
  /** From the requirement match when it has been run; null otherwise. */
  verdict: MatchVerdict | null;
  evidenceItemId: string | null;
  why: string | null;
};

export type GatheredRole = {
  roleId: string;
  title: string;
  companyId: string | null;
  company: string | null;
  industry: string | null;
  /** roles.jd_text, cut to its budget. */
  posting: string | null;
  requirements: GatheredRequirement[];
  /** companies.research, cut to its budget. */
  research: string | null;
  /** Their answers on the company's Perspective tab, as "label: answer" paragraphs, cut to budget. */
  perspective: string | null;
  /** The newest finished job_search.company_research write-up: summary and sections, cut to budget. */
  researchWriteUp: string | null;
  /** job_search.notes on the company, the role or this application, pinned first. */
  notes: string[];
};

export type GatheredEvidence = {
  id: string;
  title: string;
  body: string;
  context: string | null;
  metrics: string | null;
  skills: string[];
  strength: number | null;
};

export type GatheredResume = {
  versionId: string;
  label: string | null;
  text: string;
  /** The version on the application, or the newest with text when it has none. */
  from: 'application' | 'newest';
};

export type PastAnswer = {
  question: string;
  answer: string;
  /** approved / submitted on another application, or the question's default answer. */
  status: 'approved' | 'submitted' | 'default';
  /** When it was last changed, for newest-first. */
  at: string | null;
};

export type GatheredThought = { id: string; body: string; at: string | null };

export type GatheredQuestion = {
  /** application_answers.id: the row a draft is written to. */
  answerId: string;
  questionId: string;
  text: string;
  kind: string | null;
  /** The answer on this application now, cut to its budget; null when unanswered. */
  answer: string | null;
  status: AnswerStatus | null;
  limit: AnswerLimit | null;
  /** questions.canonical_answer: the answer reused for this question everywhere. */
  defaultAnswer: string | null;
};

export type VaultPassage = {
  sourceTable: string;
  sourceRef: string;
  title: string | null;
  text: string;
  similarity: number;
};

/** Why there are no vault passages, when there are none for a reason. */
export type VaultSkip = 'no-client' | 'no-key' | 'no-sources' | 'failed';

export type Listed<T> = { items: T[]; omitted: number };

export type GatheredMaterial = {
  applicationId: string;
  role: GatheredRole;
  /** The whole bank, strongest first, cut to budget. */
  evidence: Listed<GatheredEvidence>;
  resume: GatheredResume | null;
  /** Answers from other applications and default answers, newest first. */
  pastAnswers: Listed<PastAnswer>;
  /** job_search.thoughts, newest first. */
  thoughts: Listed<GatheredThought>;
  style: { notes: string | null; banned: string[] };
  /** Every question on this application, in the order they were added. */
  questions: GatheredQuestion[];
  vault: { passages: VaultPassage[]; skipped: VaultSkip | null };
};

export type GatherResult = { ok: true; material: GatheredMaterial } | { ok: false; error: string };
