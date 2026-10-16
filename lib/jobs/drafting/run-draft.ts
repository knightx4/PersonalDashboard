import { createClient } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import type { AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import { runApplicationDraft } from './draft-application';
import { fromStoredDraft } from './draft-application-payload';
import { draftAndSaveCoverLetter } from './draft-cover-letter';
import type { CoverLetterDraftView } from './draft-cover-letter-payload';
import { VAULT_SOURCES } from './gather';
import type { ApplicationDrafts, StoredAsk } from './store';

/**
 * The drafting presses, as plain functions (plan #2228.3).
 *
 * The Draft buttons' server actions (app/jobs/(app)/roles/actions.ts and
 * roles/[id]/actions.ts) and Dash's paid tools (lib/dash/paid-tools-jobs.ts)
 * both call these, so a draft Dash makes on approval is the draft the button
 * makes, and records the same spend. They run as the signed-in person, through
 * the cookie clients, which is how the approval calls them too.
 */

export type DraftApplicationInput = {
  applicationId: string;
  /** Absent or empty: every question with no answer. */
  answerIds?: string[];
  /** Replies to Dash's asks, by ask id; an empty reply clears one. */
  replies?: Record<string, string>;
};

export type DraftApplicationResult = {
  /** The stored draft after this run, earlier drafts and asks included; null on error. */
  drafts: ApplicationDrafts | null;
  /** Answer ids drafted by this run. */
  drafted: string[];
  /** Answer ids whose draft is still over its limit after the retry. */
  flagged: string[];
  /** Answer ids asked for that came back with no draft. */
  missing: string[];
  error: string | null;
};

/** How long the model calls may run inside the page's maxDuration of 300 seconds. */
const DRAFT_DEADLINE_MS = 270_000;

/** Drafts the answers on an application in one call and records what it spent. */
export async function draftApplicationAs(
  userId: string,
  apiKey: string,
  input: DraftApplicationInput,
): Promise<DraftApplicationResult> {
  const started = Date.now();
  const jobs = await createClient();
  const core = await createCoreClient();
  const settings = await loadAccountSettings(userId, core);

  const spend: SpendReport[] = [];
  const result = await runApplicationDraft(
    {
      jobs,
      core,
      vaultSources: moduleEnabled(settings, 'vault') ? VAULT_SOURCES : [],
      apiKey,
      onSpend: (report) => spend.push(report),
      deadline: started + DRAFT_DEADLINE_MS,
    },
    { userId, applicationId: input.applicationId, answerIds: input.answerIds, replies: input.replies },
  );
  await recordSessionSpend(userId, { module: 'jobs', operation: 'draft-application' }, spend);

  if (!result.ok) return { drafts: null, drafted: [], flagged: [], missing: [], error: result.error };
  return { drafts: result.drafts, drafted: result.drafted, flagged: result.flagged, missing: result.missing, error: null };
}

export type DraftAnswerResult = {
  draft: AnswerDraft | null;
  /** The application the answer is on, so the caller can point at it. */
  applicationId?: string;
  /** Dash's questions on the application after this run, so the tab can show a new one (plan #2130.4). */
  asks?: StoredAsk[];
  error: string | null;
};

/** Drafts one answer, which is the whole-application drafter asked for one question. */
export async function draftAnswerFor(userId: string, apiKey: string, answerId: string): Promise<DraftAnswerResult> {
  const supabase = await createClient();
  const { data: row, error: rowError } = await supabase
    .from('application_answers')
    .select('id, application_id')
    .eq('id', answerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (rowError) return { draft: null, error: rowError.message };
  if (!row) return { draft: null, error: 'That question is not yours.' };

  const applicationId = row.application_id as string;
  const result = await draftApplicationAs(userId, apiKey, { applicationId, answerIds: [answerId] });
  if (result.error || !result.drafts) return { draft: null, error: result.error ?? 'No draft came back.' };
  const stored = result.drafts.drafts[answerId];
  if (!stored || !result.drafted.includes(answerId)) return { draft: null, error: 'No draft came back.' };
  return { draft: fromStoredDraft(stored), applicationId, asks: result.drafts.asks, error: null };
}

/** Drafts the cover letter for an application and records what it spent. */
export async function draftCoverLetterFor(
  userId: string,
  apiKey: string,
  input: { applicationId: string; replies?: Record<string, string> },
): Promise<{ draft: CoverLetterDraftView | null; error: string | null }> {
  const [jobs, core] = await Promise.all([createClient(), createCoreClient()]);

  const spend: SpendReport[] = [];
  const result = await draftAndSaveCoverLetter(
    { jobs, core, apiKey, onSpend: (report) => spend.push(report) },
    { userId, applicationId: input.applicationId, replies: input.replies },
  );
  await recordSessionSpend(userId, { module: 'jobs', operation: 'draft-cover-letter' }, spend);

  if (!result.ok) return { draft: null, error: result.error };
  return { draft: result.draft, error: null };
}
