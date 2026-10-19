/**
 * Everything an application's drafts draw on, collected once (plan #2130.2).
 *
 * The single-question drafter (lib/jobs/evidence/draft.ts) is sent a few bank
 * items matched to one question. Drafting a whole application, or a cover
 * letter, wants all of the person's material at once: the role and what they
 * found out about the company (their own research, their answers on its
 * Perspective tab and the newest research Dash prepared on it), the whole
 * bank, the résumé, what they have
 * approved or sent before, what they have been thinking, their notes on the
 * company, how they write, and every question with its limit. gather() reads
 * all of it on the client it is handed, so RLS decides whose rows come back,
 * and cuts each part to a budget (./budget.ts) so the whole fits in one call.
 *
 * Each read is flat, one table at a time, rather than one embedded select:
 * the same columns draftAnswerFromEvidence reads, in a shape a fixture can
 * stand in for.
 *
 * The person's own comments under each question, and under the cover letter,
 * come from the threads on those rows (note be3c6616) through `threads`. With
 * no reader, or a failed read, drafting goes ahead without them.
 *
 * Vault passages come from the same core.search_memory Ask Dash's recall
 * uses, asked about the role and company. With no core client, or no
 * embedding key on the deployment, they are skipped and the reason recorded;
 * drafting goes ahead without them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { PERSPECTIVE_COLUMNS, perspectiveOf, perspectiveText, type PerspectiveKey } from '@/lib/jobs/companies/perspective';
import { researchFromRow, researchText } from '@/lib/jobs/companies/research';
import { DEFAULT_BANNED_CONSTRUCTIONS } from '@/lib/jobs/evidence/draft-payload';
import type { RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import {
  groupByRow,
  searchMemory,
  splitPassage,
  type MemoryRpcClient,
  type QuestionEmbedder,
} from '@/lib/memory/search';
import { threadRef } from '@/lib/thread/subjects';
import { BUDGETS, cutOptional, cutText, fitToBudget } from './budget';
import { answerLimit } from './limits';
import {
  renderEvidenceItem,
  renderPastAnswer,
  renderRequirement,
  renderThought,
  renderVaultPassage,
} from './render';
import type {
  AnswerStatus,
  GatherResult,
  GatheredEvidence,
  GatheredQuestion,
  GatheredRequirement,
  GatheredResume,
  GatheredThought,
  PastAnswer,
  VaultPassage,
  VaultSkip,
} from './types';

export type * from './types';

// The jobs client is typed to its own schema; tables are reached by name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobsClient = Pick<SupabaseClient<any, any, any>, 'from'>;

/** A thread's turns as gather() needs them: who wrote each and what. */
export type ThreadTurn = { author: 'me' | 'claude'; body: string };

/** Reads the threads on the given refs, oldest turn first (loadThreads in lib/thread/store.ts). */
export type ThreadReader = (refs: readonly string[]) => Promise<ReadonlyMap<string, readonly ThreadTurn[]>>;

export type GatherDeps = {
  /** The person's job_search client (createClient in lib/jobs/auth/server). */
  jobs: JobsClient;
  /** The person's core client, for vault passages. Absent: they are skipped. */
  core?: MemoryRpcClient | null;
  /** Turns the vault question into a vector; Voyage when absent. */
  embed?: QuestionEmbedder;
  /** What embedding the vault question cost. */
  onSpend?: SpendSink;
  /** Which memory sources count as the vault. [] skips the search. */
  vaultSources?: readonly string[];
  /** The comment threads under the answers and the letter. Absent: no comments. */
  threads?: ThreadReader | null;
};

export type GatherInput = { userId: string; applicationId: string };

/**
 * The Perspective answers a draft draws on. The unknowns and the next move are
 * questions to ask and a to-do, not material for an answer.
 */
export const PERSPECTIVE_FOR_DRAFTS: readonly PerspectiveKey[] = ['business', 'whyNow', 'problem', 'whyMe'];

/** The vault, by default: the Obsidian notes. */
export const VAULT_SOURCES = ['obsidian.notes'] as const;

/** At most this many answers from elsewhere, before the budget. */
export const PAST_ANSWER_CAP = 20;
/** At most this many thoughts, newest first. */
export const THOUGHT_CAP = 15;
/** Passages asked of search_memory for the vault. */
const VAULT_LIMIT = 20;
const NOTE_MAX = 1_000;
const QUESTION_MAX = 1_000;
/** The labels renderQuestion puts around one question. */
const QUESTION_OVERHEAD = 120;

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Newest first by an ISO timestamp; missing ones last. */
function byNewest(a: string | null, b: string | null): number {
  return (b ?? '').localeCompare(a ?? '');
}

/**
 * The résumé the drafts read: the version on the application when it has
 * text, otherwise the newest version that has any.
 */
export function chooseResume(
  versions: readonly { id: string; label: string | null; text_content: string | null; created_at: string | null }[],
  applicationVersionId: string | null,
): GatheredResume | null {
  const onApplication = applicationVersionId
    ? versions.find((v) => v.id === applicationVersionId && str(v.text_content))
    : undefined;
  if (onApplication) {
    return {
      versionId: onApplication.id,
      label: onApplication.label,
      text: cutText(onApplication.text_content!, BUDGETS.resume),
      from: 'application',
    };
  }
  const newest = [...versions]
    .filter((v) => str(v.text_content))
    .sort((a, b) => byNewest(a.created_at, b.created_at))[0];
  if (!newest) return null;
  return {
    versionId: newest.id,
    label: newest.label,
    text: cutText(newest.text_content!, BUDGETS.resume),
    from: 'newest',
  };
}

/** What the role asks for: the match where it has been run, else the extracted list. */
export function roleRequirements(
  matches: readonly RequirementMatch[] | null,
  requirements: readonly Requirement[] | null,
): GatheredRequirement[] {
  const all: GatheredRequirement[] =
    matches && matches.length > 0
      ? matches.map((m) => ({
          text: m.requirement,
          kind: m.kind,
          verdict: m.verdict,
          evidenceItemId: m.evidenceItemId,
          why: m.why || null,
        }))
      : (requirements ?? []).map((r) => ({
          text: r.text,
          kind: r.kind,
          verdict: null,
          evidenceItemId: null,
          why: null,
        }));
  // Must-haves first, then responsibilities, then nice-to-haves.
  const rank = { must_have: 0, responsibility: 1, nice_to_have: 2 } as const;
  const ordered = [...all].sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3));
  return fitToBudget(ordered, (r) => renderRequirement(r).length + 1, BUDGETS.requirements).kept;
}

/**
 * Answers from elsewhere, newest first: approved and submitted answers on
 * other applications, and default answers to questions not on this one. The
 * same text twice is kept once.
 */
export function pastAnswersFrom(entries: readonly PastAnswer[]): { items: PastAnswer[]; omitted: number } {
  const seen = new Set<string>();
  const unique: PastAnswer[] = [];
  for (const entry of [...entries].sort((a, b) => byNewest(a.at, b.at))) {
    const key = entry.answer.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      ...entry,
      question: cutText(entry.question, QUESTION_MAX),
      answer: cutText(entry.answer, BUDGETS.pastAnswer),
    });
  }
  const capped = unique.slice(0, PAST_ANSWER_CAP);
  const fitted = fitToBudget(capped, (p) => renderPastAnswer(p).length + 2, BUDGETS.pastAnswers);
  return { items: fitted.kept, omitted: unique.length - fitted.kept.length };
}

/** The bank, strongest first, then least used, each story cut, the list cut to budget. */
export function evidenceFrom(rows: readonly Row[]): { items: GatheredEvidence[]; omitted: number } {
  const items = [...rows]
    .sort(
      (a, b) =>
        Number(b.strength ?? 0) - Number(a.strength ?? 0) ||
        Number(a.used_count ?? 0) - Number(b.used_count ?? 0) ||
        byNewest(str(a.updated_at), str(b.updated_at)),
    )
    .map(
      (row): GatheredEvidence => ({
        id: row.id as string,
        title: (row.title as string) ?? '',
        body: cutText((row.body as string) ?? '', BUDGETS.evidenceItem),
        context: cutOptional(row.context as string | null, 300),
        metrics: cutOptional(row.metrics as string | null, 300),
        skills: strings(row.skills),
        strength: typeof row.strength === 'number' ? row.strength : null,
      }),
    );
  const fitted = fitToBudget(items, (item) => renderEvidenceItem(item).length + 9, BUDGETS.evidence);
  return { items: fitted.kept, omitted: fitted.omitted };
}

/**
 * The application's questions, every one of them, in the order they were
 * added. None is dropped to fit: their texts are cut shorter the more there
 * are, and the current and default answers share what is left.
 */
export function questionsFrom(
  answers: readonly Row[],
  questions: ReadonlyMap<string, Row>,
): GatheredQuestion[] {
  const ordered = [...answers].sort((a, b) =>
    String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  );
  const n = Math.max(1, ordered.length);
  const textMax = Math.max(200, Math.min(QUESTION_MAX, Math.floor((BUDGETS.questions * 0.5) / n)));
  const texts = ordered.map((row) => (questions.get(row.question_id as string)?.text as string) ?? '');
  const textsUsed = texts.reduce((sum, text) => sum + Math.min(text.length, textMax) + QUESTION_OVERHEAD, 0);
  const share = Math.max(
    150,
    Math.min(BUDGETS.currentAnswer, Math.floor((BUDGETS.questions - textsUsed) / (2 * n))),
  );

  return ordered.map((row, i) => {
    const question = questions.get(row.question_id as string);
    return {
      answerId: row.id as string,
      questionId: row.question_id as string,
      text: cutText(texts[i], textMax),
      kind: str(question?.kind),
      answer: cutOptional(row.answer as string | null, share),
      status: (str(row.status) as AnswerStatus | null) ?? null,
      // Read from the whole text, before it is cut.
      limit: answerLimit(row.word_limit as number | null, texts[i]),
      defaultAnswer: cutOptional(question?.canonical_answer as string | null, share),
      comments: [],
    };
  });
}

/**
 * The person's own comments on each thread, oldest first, cut to the comment
 * budget across the application: the letter's first, then each question's in
 * order. Dash's replies are left out, so a draft does not lean on its own
 * earlier words. A failed read gives no comments rather than no draft.
 */
async function readComments(
  deps: GatherDeps,
  applicationId: string,
  answerIds: readonly string[],
): Promise<{ letter: string[]; byAnswer: Map<string, string[]> }> {
  const none = { letter: [], byAnswer: new Map<string, string[]>() };
  if (!deps.threads) return none;
  const letterRef = threadRef('application', applicationId);
  let threads: ReadonlyMap<string, readonly ThreadTurn[]>;
  try {
    threads = await deps.threads([letterRef, ...answerIds.map((id) => threadRef('answer', id))]);
  } catch (error) {
    console.error('drafting: reading the comment threads failed', error);
    return none;
  }
  let room = BUDGETS.comments;
  const take = (ref: string): string[] => {
    const kept: string[] = [];
    for (const turn of threads.get(ref) ?? []) {
      if (turn.author !== 'me' || !turn.body.trim()) continue;
      const body = cutText(turn.body, BUDGETS.comment);
      if (body.length + 3 > room) break;
      room -= body.length + 3;
      kept.push(body);
    }
    return kept;
  };
  const letter = take(letterRef);
  const byAnswer = new Map(answerIds.map((id) => [id, take(threadRef('answer', id))]));
  return { letter, byAnswer };
}

async function vaultPassages(
  deps: GatherDeps,
  userId: string,
  question: string,
): Promise<{ passages: VaultPassage[]; skipped: VaultSkip | null }> {
  if (!deps.core) return { passages: [], skipped: 'no-client' };
  const sources = deps.vaultSources ?? VAULT_SOURCES;
  if (sources.length === 0) return { passages: [], skipped: 'no-sources' };

  let searched;
  try {
    searched = await searchMemory(deps.core, {
      userId,
      question,
      sources,
      limit: VAULT_LIMIT,
      embed: deps.embed,
      onSpend: deps.onSpend,
    });
  } catch (error) {
    console.error('drafting gather: vault search', error);
    return { passages: [], skipped: 'failed' };
  }
  if (!searched.ok) {
    if (searched.reason !== 'no-key') console.error('drafting gather: vault search', searched.reason, searched.detail);
    return { passages: [], skipped: searched.reason === 'no-key' ? 'no-key' : 'failed' };
  }

  // One passage per note, the closest, so one long note does not fill the part.
  const passages = groupByRow(searched.passages).map((hit): VaultPassage => {
    const best = hit.passages[0];
    const { title, text } = splitPassage(best.body);
    return {
      sourceTable: hit.sourceTable,
      sourceRef: hit.sourceRef,
      title,
      text: cutText(text || best.body, BUDGETS.vaultPassage),
      similarity: hit.similarity,
    };
  });
  return {
    passages: fitToBudget(passages, (p) => renderVaultPassage(p).length + 2, BUDGETS.vault).kept,
    skipped: null,
  };
}

/** Everything one application's drafts draw on, cut to budget. */
export async function gather(deps: GatherDeps, input: GatherInput): Promise<GatherResult> {
  const { jobs } = deps;
  const { userId, applicationId } = input;

  const { data: application, error: applicationError } = await jobs
    .from('applications')
    .select('id, role_id, resume_version_id')
    .eq('id', applicationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (applicationError) return { ok: false, error: applicationError.message };
  if (!application) return { ok: false, error: 'That application is not yours.' };

  const { data: role, error: roleError } = await jobs
    .from('roles')
    .select('id, title, company_id, jd_text, requirements, requirement_matches')
    .eq('id', application.role_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (roleError) return { ok: false, error: roleError.message };
  if (!role) return { ok: false, error: 'The role on that application could not be read.' };

  const companyId = (role.company_id as string | null) ?? null;
  const noteScope = [
    companyId && `company_id.eq.${companyId}`,
    `role_id.eq.${role.id}`,
    `application_id.eq.${applicationId}`,
  ]
    .filter(Boolean)
    .join(',');

  const [company, writeUps, answers, bank, resumes, past, defaults, thoughts, notes, profile] = await Promise.all([
    companyId
      ? jobs
          .from('companies')
          .select(`id, name, industry, research, ${PERSPECTIVE_COLUMNS}`)
          .eq('id', companyId)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // The newest finished research run on the company, if one has finished.
    companyId
      ? jobs
          .from('company_research')
          .select('summary, sections, finished_at')
          .eq('company_id', companyId)
          .eq('user_id', userId)
          .eq('status', 'ready')
          .order('finished_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
    jobs
      .from('application_answers')
      .select('id, question_id, answer, status, word_limit, created_at')
      .eq('application_id', applicationId)
      .eq('user_id', userId),
    jobs
      .from('evidence_items')
      .select('id, title, body, context, metrics, skills, strength, used_count, updated_at')
      .eq('user_id', userId),
    jobs.from('resume_versions').select('id, label, text_content, created_at').eq('user_id', userId),
    jobs
      .from('application_answers')
      .select('id, application_id, question_id, answer, status, updated_at')
      .eq('user_id', userId)
      .in('status', ['approved', 'submitted'])
      .neq('application_id', applicationId)
      .not('answer', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(PAST_ANSWER_CAP * 3),
    jobs
      .from('questions')
      .select('id, text, kind, canonical_answer, canonical_answer_updated_at')
      .eq('user_id', userId)
      .not('canonical_answer', 'is', null)
      .order('canonical_answer_updated_at', { ascending: false })
      .limit(PAST_ANSWER_CAP * 3),
    jobs
      .from('thoughts')
      .select('id, body, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(THOUGHT_CAP),
    jobs
      .from('notes')
      .select('id, body, pinned, updated_at, company_id, role_id, application_id')
      .eq('user_id', userId)
      .or(noteScope),
    jobs.from('profiles').select('writing_style_notes, banned_constructions').eq('id', userId).maybeSingle(),
  ]);

  for (const read of [company, writeUps, answers, bank, resumes, past, defaults, thoughts, notes, profile]) {
    if (read.error) return { ok: false, error: read.error.message };
  }

  const answerRows = (answers.data ?? []) as Row[];
  const pastRows = ((past.data ?? []) as Row[]).filter((row) => str(row.answer));
  const defaultRows = ((defaults.data ?? []) as Row[]).filter((row) => str(row.canonical_answer));

  // The text of every question in play: this application's and the ones answered elsewhere.
  const known = new Map<string, Row>(defaultRows.map((row) => [row.id as string, row]));
  const wanted = [
    ...new Set([...answerRows, ...pastRows].map((row) => row.question_id as string).filter(Boolean)),
  ].filter((id) => !known.has(id));
  if (wanted.length > 0) {
    const { data, error } = await jobs
      .from('questions')
      .select('id, text, kind, canonical_answer, canonical_answer_updated_at')
      .eq('user_id', userId)
      .in('id', wanted);
    if (error) return { ok: false, error: error.message };
    for (const row of (data ?? []) as Row[]) known.set(row.id as string, row);
  }

  const onThisApplication = new Set(answerRows.map((row) => row.question_id as string));
  const pastAnswers = pastAnswersFrom([
    ...pastRows.flatMap((row): PastAnswer[] => {
      const question = str(known.get(row.question_id as string)?.text);
      if (!question) return [];
      return [
        {
          question,
          answer: row.answer as string,
          status: row.status as 'approved' | 'submitted',
          at: str(row.updated_at),
        },
      ];
    }),
    // A default answer to a question on this application rides on that question instead.
    ...defaultRows
      .filter((row) => !onThisApplication.has(row.id as string))
      .map(
        (row): PastAnswer => ({
          question: row.text as string,
          answer: row.canonical_answer as string,
          status: 'default',
          at: str(row.canonical_answer_updated_at),
        }),
      ),
  ]);

  const thoughtItems = ((thoughts.data ?? []) as Row[])
    .filter((row) => str(row.body))
    .map(
      (row): GatheredThought => ({
        id: row.id as string,
        body: cutText(row.body as string, BUDGETS.thought),
        at: str(row.created_at),
      }),
    );
  const fittedThoughts = fitToBudget(thoughtItems, (t) => renderThought(t).length + 1, BUDGETS.thoughts);

  const noteBodies = ((notes.data ?? []) as Row[])
    .filter((row) => str(row.body))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || byNewest(str(a.updated_at), str(b.updated_at)))
    .map((row) => cutText(row.body as string, NOTE_MAX));
  const fittedNotes = fitToBudget(noteBodies, (note) => note.length + 3, BUDGETS.notes).kept;

  const companyRow = company.data as Row | null;
  const writeUp = ((writeUps.data ?? []) as Row[])[0];
  const companyName = str(companyRow?.name);
  const title = (role.title as string) ?? '';

  const vault = await vaultPassages(
    deps,
    userId,
    [title, companyName && `at ${companyName}`, str(companyRow?.industry)].filter(Boolean).join(' '),
  );

  const banned = strings(profile.data?.banned_constructions);
  const questions = questionsFrom(answerRows, known);
  const comments = await readComments(
    deps,
    applicationId,
    questions.map((question) => question.answerId),
  );

  return {
    ok: true,
    material: {
      applicationId,
      role: {
        roleId: role.id as string,
        title,
        companyId,
        company: companyName,
        industry: str(companyRow?.industry),
        posting: cutOptional(role.jd_text as string | null, BUDGETS.posting),
        requirements: roleRequirements(
          (role.requirement_matches as RequirementMatch[] | null) ?? null,
          (role.requirements as Requirement[] | null) ?? null,
        ),
        research: cutOptional(companyRow?.research as string | null, BUDGETS.companyResearch),
        perspective: companyRow
          ? cutOptional(perspectiveText(perspectiveOf(companyRow), PERSPECTIVE_FOR_DRAFTS), BUDGETS.perspective)
          : null,
        researchWriteUp: writeUp ? cutOptional(researchText(researchFromRow(writeUp)), BUDGETS.researchWriteUp) : null,
        notes: fittedNotes,
      },
      evidence: evidenceFrom((bank.data ?? []) as Row[]),
      resume: chooseResume(
        (resumes.data ?? []) as { id: string; label: string | null; text_content: string | null; created_at: string | null }[],
        (application.resume_version_id as string | null) ?? null,
      ),
      pastAnswers,
      thoughts: { items: fittedThoughts.kept, omitted: fittedThoughts.omitted },
      style: {
        notes: cutOptional(profile.data?.writing_style_notes as string | null, BUDGETS.style),
        banned: banned.length > 0 ? banned : [...DEFAULT_BANNED_CONSTRUCTIONS],
      },
      questions: questions.map((question) => ({
        ...question,
        comments: comments.byAnswer.get(question.answerId) ?? [],
      })),
      letterComments: comments.letter,
      vault,
    },
  };
}
