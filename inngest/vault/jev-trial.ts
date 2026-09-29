import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createVaultServiceSupabase } from '@/inngest/vault/supabase-admin';
import { mapPool } from '@/lib/async/map-pool';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend } from '@/lib/core/spend/record';
import { askJev, jevApiKey } from '@/lib/jev/client';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { haikuForMap } from '@/lib/vault/map/classify';
import { MAP_CLASS_QUESTION, MAP_EVIDENCE_QUESTION, mapClassState } from '@/lib/vault/map/jev-question';
import {
  JEV_MAP_TRIAL,
  onHaikuFailure,
  onJevFailure,
  pickMapTrialSample,
  referenceFor,
  summariseMapTrial,
  type MapTrialAnswer,
  type MapTrialSummary,
} from '@/lib/vault/map/jev-trial';
import { tooShortForMap, whyNotRead } from '@/lib/vault/map/rules';

/**
 * The map trial on Jev and Haiku (plan #1168), run where the keys are.
 *
 * TYPESAFE_API_KEY and ANTHROPIC_API_KEY exist only on the deployment. Each
 * call draws the trial's 75 notes (lib/vault/map/jev-trial.ts), skips what an
 * earlier call answered, asks Jev the rollout's two questions and Haiku its
 * own classify prompt about each remaining note, and writes one row to
 * obsidian.jev_trial_answers. A journal, a note carrying a key or one under 80
 * characters gets a row saying so and is sent to neither.
 *
 * Resumable and bounded: `limit` notes or `budgetMs`, whichever ends first,
 * then it returns how many are left. When none are, it returns the summary the
 * write-up is read from. Spend goes to learn · map-sweep, the operation the
 * sweep records the classifier under.
 */

const CONCURRENCY = 4;
const DEFAULT_LIMIT = 75;
const DEFAULT_BUDGET_MS = 240_000;
const PAGE = 1000;

type VaultClient = ReturnType<typeof createVaultServiceSupabase>;

type NoteRow = { id: string; path: string; title: string; body: string; blob_sha: string };

export type MapTrialResult = {
  trial: string;
  sample: number;
  answeredBefore: number;
  wrote: number;
  retryLater: number;
  remaining: number;
  stopped: string | null;
  summary: MapTrialSummary | null;
};

export async function runMapJevTrial(opts: {
  userId: string;
  limit?: number;
  budgetMs?: number;
  /** A new name runs a new trial; the default is the first one's. */
  trial?: string;
}): Promise<MapTrialResult | null> {
  if (!jevApiKey()) throw new Error('TYPESAFE_API_KEY is not set on this deployment.');
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set on this deployment.');

  const core = createCoreServiceSupabase();
  // Only an account that agreed to send its notes to TypeSafe (#1163).
  if (!(await jevEnabledFor(core, opts.userId))) return null;

  const supabase = createVaultServiceSupabase();
  const userId = opts.userId;
  const trial = opts.trial ?? JEV_MAP_TRIAL;
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;

  const live: { id: string; path: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('notes')
      .select('id, path')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    live.push(...((data ?? []) as { id: string; path: string }[]));
    if (!data || data.length < PAGE) break;
  }

  const sample = pickMapTrialSample(live);
  const pathOf = new Map(sample.map((note) => [note.id, note.path]));
  const answered = await answeredIds(supabase, userId, trial);
  const pendingIds = sample
    .filter((note) => !answered.has(note.id))
    .slice(0, opts.limit ?? DEFAULT_LIMIT)
    .map((note) => note.id);

  const result: MapTrialResult = {
    trial,
    sample: sample.length,
    answeredBefore: answered.size,
    wrote: 0,
    retryLater: 0,
    remaining: 0,
    stopped: null,
    summary: null,
  };

  if (pendingIds.length > 0) {
    const { data, error } = await supabase
      .from('notes')
      .select('id, path, title, body, blob_sha')
      .eq('user_id', userId)
      .in('id', pendingIds);
    if (error) throw new Error(error.message);
    const notes = (data ?? []) as NoteRow[];

    const haiku = haikuForMap(new Anthropic({ apiKey: anthropicKey }));
    const spend: SpendReport[] = [];
    const onSpend = (report: SpendReport) => spend.push(report);

    await mapPool(notes, CONCURRENCY, async (note) => {
      if (result.stopped || Date.now() - started > budgetMs) return;

      const base = {
        user_id: userId,
        trial,
        note_id: note.id,
        blob_sha: note.blob_sha,
        ...referenceRow(note.path),
      };

      const notRead = whyNotRead(note);
      const notSent =
        notRead && notRead.reason !== 'excluded'
          ? notRead.reason
          : tooShortForMap(note.body)
            ? 'too_short'
            : null;
      if (notSent) {
        if (await write(supabase, { ...base, not_sent: notSent })) result.wrote += 1;
        return;
      }

      const state = mapClassState(note);
      const [asked, evidence] = await Promise.all([
        askJev({ state, question: MAP_CLASS_QUESTION, onSpend }),
        askJev({ state, question: MAP_EVIDENCE_QUESTION, onSpend }),
      ]);

      let jev: Record<string, unknown>;
      if (asked.ok) {
        jev = {
          jev_class: asked.answer.choice,
          jev_confidence: asked.answer.confidence,
          jev_probabilities: asked.answer.probabilities,
          jev_evidence_probability: evidence.ok ? evidence.answer.probability : null,
          jev_model: asked.model,
        };
      } else {
        const move = onJevFailure(asked);
        if (move === 'stop') {
          result.stopped ??= `jev ${asked.reason}: ${asked.detail}`;
          return;
        }
        if (move === 'retry') {
          result.retryLater += 1;
          return;
        }
        jev = { jev_failure: `${asked.reason}: ${asked.detail}`.slice(0, 300) };
      }

      let haikuRow: Record<string, unknown>;
      try {
        const answer = await haiku({ title: note.title, body: note.body, onSpend });
        haikuRow = answer
          ? { haiku_class: answer.class, haiku_evidence: answer.is_evidence, haiku_reason: answer.reason }
          : { haiku_failure: 'unreadable: no classify_note call came back' };
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'failed';
        if (onHaikuFailure(detail) === 'stop') result.stopped ??= `haiku: ${detail.slice(0, 200)}`;
        else result.retryLater += 1;
        return;
      }

      if (await write(supabase, { ...base, ...jev, ...haikuRow })) result.wrote += 1;
    });

    for (const report of spend) {
      await recordSpend(core, userId, {
        module: 'learn',
        operation: 'map-sweep',
        model: report.model,
        usage: report.usage,
      });
    }
  }

  const done = await answeredIds(supabase, userId, trial);
  result.remaining = sample.filter((note) => !done.has(note.id)).length;
  if (result.remaining === 0) {
    const rows = await trialRows(supabase, userId, trial);
    result.summary = summariseMapTrial(
      rows.map((row) => ({ ...row, path: pathOf.get(row.note_id) ?? row.note_id })),
    );
  }
  return result;
}

function referenceRow(path: string) {
  const { reference, evidence } = referenceFor(path);
  return {
    excluded: whyNotRead({ path, body: '' })?.reason === 'excluded',
    reference,
    reference_evidence: evidence,
  };
}

async function answeredIds(supabase: VaultClient, userId: string, trial: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('jev_trial_answers')
    .select('note_id')
    .eq('user_id', userId)
    .eq('trial', trial);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => (row as { note_id: string }).note_id));
}

async function trialRows(
  supabase: VaultClient,
  userId: string,
  trial: string,
): Promise<Omit<MapTrialAnswer, 'path'>[]> {
  const { data, error } = await supabase
    .from('jev_trial_answers')
    .select(
      'note_id, not_sent, excluded, reference, reference_evidence, jev_class, jev_confidence, jev_evidence_probability, jev_failure, haiku_class, haiku_evidence, haiku_reason, haiku_failure',
    )
    .eq('user_id', userId)
    .eq('trial', trial);
  if (error) throw new Error(error.message);
  return (data ?? []) as Omit<MapTrialAnswer, 'path'>[];
}

async function write(supabase: VaultClient, row: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase
    .from('jev_trial_answers')
    .upsert(row, { onConflict: 'trial,note_id' });
  if (error) console.error('map jev trial write failed', row.note_id, error.message);
  return !error;
}
