import 'server-only';

import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { mapPool } from '@/lib/async/map-pool';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { ensureAccessToken, loadAccount } from '@/lib/core/inbox/sync-account';
import { gmailOAuthEnv, isGmailOAuthConfigured } from '@/lib/email/gmail-env';
import { gmailProvider } from '@/lib/email/providers/gmail';
import { askJev, jevApiKey } from '@/lib/jev/client';
import { classifyMessage } from '@/lib/jobs/email/classify';
import { JOB_EMAIL_QUESTION, jobEmailState } from '@/lib/jobs/email/jev-question';
import { loadCompanies, loadExcludedDomains } from '@/lib/jobs/inbox/link-candidates';
import {
  handLabelFor,
  JEV_JOB_EMAIL_TRIAL,
  MAX_FAILURES_IN_A_ROW,
  onJevFailure,
  pickTrialSample,
  summariseTrial,
  type TrialAnswer,
  type TrialSummary,
} from '@/lib/jobs/jev-trial/trial';

/**
 * The Jev pilot on job email (plan #1165), run where the keys are.
 *
 * TYPESAFE_API_KEY and the Gmail grant exist only on the deployment, and the
 * ledger never stored a body, so the trial cannot be run from a checkout. Each
 * call reads the sample (lib/jobs/jev-trial/trial.ts), skips what an earlier
 * call already answered, fetches each remaining body from Gmail, asks Jev the
 * rollout's own question (lib/jobs/email/jev-question.ts), and writes one row
 * to job_search.jev_trial_answers. Tier A is run on the same body so the
 * write-up can tell mail Haiku labelled from mail the rules did.
 *
 * Resumable and bounded: `limit` messages or `budgetMs`, whichever ends first,
 * then it returns how many are left. When none are, it returns the summary the
 * write-up is read from. Spend goes to classify-job-email, the operation the
 * rollout will record Jev under.
 */

const CONCURRENCY = 4;
const DEFAULT_LIMIT = 250;
const DEFAULT_BUDGET_MS = 240_000;
const PAGE = 1000;

type InboxRow = {
  id: string;
  email_account_id: string;
  provider_message_id: string;
  from_address: string | null;
  reply_to_address: string | null;
  subject: string | null;
  classification: string;
  parse_confidence: number | string | null;
  error: string | null;
};

export type JevTrialResult = {
  trial: string;
  sample: number;
  answeredBefore: number;
  wrote: number;
  gmailFailed: number;
  retryLater: number;
  remaining: number;
  stopped: string | null;
  summary: TrialSummary | null;
};

export async function runJevTrial(
  opts: { userId?: string; limit?: number; budgetMs?: number; trial?: string } = {},
): Promise<JevTrialResult[]> {
  if (!jevApiKey()) throw new Error('TYPESAFE_API_KEY is not set on this deployment.');
  if (!isGmailOAuthConfigured()) throw new Error('Gmail is not configured on this deployment.');

  const core = createCoreServiceSupabase();
  let accounts = core.from('email_accounts').select('id, user_id').eq('status', 'active');
  if (opts.userId) accounts = accounts.eq('user_id', opts.userId);
  const { data, error } = await accounts;
  if (error) throw new Error(error.message);

  const userIds = [...new Set((data ?? []).map((row) => row.user_id as string))];
  const results: JevTrialResult[] = [];
  for (const userId of userIds) results.push(await runForUser(userId, opts));
  return results;
}

async function runForUser(
  userId: string,
  opts: { limit?: number; budgetMs?: number; trial?: string },
): Promise<JevTrialResult> {
  const supabase = createServiceSupabase();
  const core = createCoreServiceSupabase();
  const trial = opts.trial ?? JEV_JOB_EMAIL_TRIAL;
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  const ledger: InboxRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inbox_messages')
      .select(
        'id, email_account_id, provider_message_id, from_address, reply_to_address, subject, classification, parse_confidence, error',
      )
      .eq('user_id', userId)
      .not('classification', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    ledger.push(...((data ?? []) as InboxRow[]));
    if (!data || data.length < PAGE) break;
  }

  const sample = pickTrialSample(ledger, { trial });
  const answered = await answeredIds(supabase, userId, trial);
  const pending = sample.filter((row) => !answered.has(row.id)).slice(0, opts.limit ?? DEFAULT_LIMIT);

  const result: JevTrialResult = {
    trial,
    sample: sample.length,
    answeredBefore: answered.size,
    wrote: 0,
    gmailFailed: 0,
    retryLater: 0,
    remaining: 0,
    stopped: null,
    summary: null,
  };

  if (pending.length > 0) {
    const { TOKEN_ENCRYPTION_KEY } = gmailOAuthEnv();
    const tokens = new Map<string, string>();
    for (const accountId of new Set(pending.map((row) => row.email_account_id))) {
      const account = await loadAccount(core, userId, accountId);
      tokens.set(accountId, await ensureAccessToken(core, account, TOKEN_ENCRYPTION_KEY));
    }
    const [companies, excludedDomains] = await Promise.all([
      loadCompanies(supabase, userId),
      loadExcludedDomains(supabase, userId),
    ]);

    const spend: SpendReport[] = [];
    let failuresInARow = 0;

    await mapPool(pending, CONCURRENCY, async (row) => {
      if (result.stopped || Date.now() - started > budgetMs) return;

      let message;
      try {
        message = await gmailProvider.getMessage(tokens.get(row.email_account_id)!, row.provider_message_id, {
          format: 'full',
        });
      } catch (err) {
        const text = err instanceof Error ? err.message : '';
        // A message deleted from Gmail since it was labelled cannot be read
        // again; its row says so, so later runs do not keep asking.
        if (/\b404\b/.test(text)) {
          if (await writeAnswer(supabase, userId, trial, row, null, { failure: 'gmail: message gone' })) {
            result.wrote += 1;
          }
        } else {
          result.gmailFailed += 1;
        }
        return;
      }

      const fromAddress = message.fromAddress ?? row.from_address;
      const replyToAddress = message.replyToAddress ?? row.reply_to_address;
      const subject = message.subject ?? row.subject;
      const tierA = classifyMessage({
        fromAddress,
        replyToAddress,
        subject,
        bodyPreview: message.text.slice(0, 2000),
        companies: companies.map((c) => ({ id: c.id, slug: c.slug, name: c.name, domains: c.domains })),
        excludedDomains,
      });

      const asked = await askJev({
        state: jobEmailState({ fromAddress, replyToAddress, subject, body: message.text }),
        question: JOB_EMAIL_QUESTION,
        onSpend: (report) => spend.push(report),
      });

      if (asked.ok) {
        failuresInARow = 0;
        const wrote = await writeAnswer(supabase, userId, trial, row, tierA, {
          jev_label: asked.answer.choice,
          jev_confidence: asked.answer.confidence,
          jev_probabilities: asked.answer.probabilities,
          jev_model: asked.model,
        });
        if (wrote) result.wrote += 1;
        return;
      }

      failuresInARow += 1;
      const move = onJevFailure(asked);
      if (move === 'stop' || failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        result.stopped ??= `${asked.reason}: ${asked.detail}`;
        return;
      }
      if (move === 'store') {
        const wrote = await writeAnswer(supabase, userId, trial, row, tierA, {
          failure: `${asked.reason}: ${asked.detail}`.slice(0, 300),
        });
        if (wrote) result.wrote += 1;
      } else {
        result.retryLater += 1;
      }
    });

    await recordSpendReports(core, userId, { module: 'jobs', operation: 'classify-job-email' }, spend);
  }

  const done = await answeredIds(supabase, userId, trial);
  result.remaining = sample.filter((row) => !done.has(row.id)).length;
  if (result.remaining === 0) result.summary = summariseTrial(await trialRows(supabase, userId, trial));
  return result;
}

type JobClient = ReturnType<typeof createServiceSupabase>;

async function answeredIds(supabase: JobClient, userId: string, trial: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('jev_trial_answers')
      .select('message_id')
      .eq('user_id', userId)
      .eq('trial', trial)
      .order('message_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) ids.add(row.message_id as string);
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

async function trialRows(supabase: JobClient, userId: string, trial: string): Promise<TrialAnswer[]> {
  const rows: TrialAnswer[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('jev_trial_answers')
      .select(
        'message_id, stored_label, stored_confidence, hand_label, tier_a_label, tier_a_tier, jev_label, jev_confidence, failure',
      )
      .eq('user_id', userId)
      .eq('trial', trial)
      .order('message_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as TrialAnswer[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function writeAnswer(
  supabase: JobClient,
  userId: string,
  trial: string,
  row: InboxRow,
  tierA: { classification: string; tier: string } | null,
  answer:
    | { jev_label: string; jev_confidence: number; jev_probabilities: Record<string, number>; jev_model: string }
    | { failure: string },
): Promise<boolean> {
  const { error } = await supabase.from('jev_trial_answers').upsert(
    {
      user_id: userId,
      trial,
      message_id: row.id,
      stored_label: row.classification,
      stored_confidence: row.parse_confidence,
      hand_label: handLabelFor(row),
      tier_a_label: tierA?.classification ?? null,
      tier_a_tier: tierA?.tier ?? null,
      ...answer,
    },
    { onConflict: 'trial,message_id' },
  );
  if (error) console.error('jev trial write failed', row.id, error.message);
  return !error;
}
