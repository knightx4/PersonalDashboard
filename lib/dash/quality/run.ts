import { dashHealth, type DashHealth, type HealthSpend, type HealthTurn } from './health';
import { gradeAnswer, parseExpect, type CaseOutcome } from './grade';

/**
 * One run of the Dash check (supabase/migrations/0277, 0279): ask the cases
 * the trigger calls for (none on the free daily run, all of them monthly, or
 * one by hand), grade each answer, work out the last day of real answers,
 * keep it all in core.dash_eval_runs, and write a Dev note when anything
 * failed. The ports are inngest/core/dash-quality.ts.
 */

export type EvalCase = { id: string; question: string; expect: unknown };

/**
 * health: the free daily run, which asks no case. monthly: every active case.
 * manual: every active case, or one named by `only`.
 */
export type DashQualityTrigger = 'health' | 'monthly' | 'manual';

export type CaseResult = {
  case: string;
  question: string;
  passed: boolean;
  failures: string[];
  body: string;
  stop: string;
  lookups: { name: string; ok: boolean; error?: string }[];
  seconds: number;
  costMicros: number;
};

export type DashQualityPorts = {
  owner(): Promise<string>;
  model(userId: string): Promise<string>;
  /** The active cases, or the one named, active or not. */
  cases(userId: string, only?: string): Promise<EvalCase[]>;
  /** Asks one question as a new chat, read-only, and kept nowhere. */
  ask(userId: string, question: string): Promise<{ outcome: CaseOutcome; costMicros: number }>;
  turns(userId: string, since: string): Promise<HealthTurn[]>;
  spend(userId: string, since: string): Promise<HealthSpend[]>;
  start(row: { userId: string; trigger: DashQualityTrigger; model: string; deploy: string | null }): Promise<string>;
  finish(id: string, row: { cases: number; passed: number; results: CaseResult[]; health: DashHealth; costMicros: number; noteId: string | null; error: string | null }): Promise<void>;
  writeNote(userId: string, body: string): Promise<string>;
};

/** Cases asked at once: enough to finish inside the route's five minutes, few enough not to crowd the database. */
export const CASE_CONCURRENCY = 3;

/** The window of real answers the health covers. */
export const HEALTH_HOURS = 24;

function lookupsOf(outcome: CaseOutcome): CaseResult['lookups'] {
  return outcome.toolCalls.map((call) => {
    const result = call.result as { ok?: unknown; error?: unknown } | undefined;
    const ok = result?.ok !== false;
    return ok ? { name: call.name, ok } : { name: call.name, ok, error: String(result?.error ?? '').slice(0, 200) };
  });
}

async function inTurns<T, R>(items: readonly T[], size: number, each: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await each(items[i]);
      }
    }),
  );
  return out;
}

/** The Dev note for a run that found something, or null when all was well. */
export function qualityNote(results: readonly CaseResult[], health: DashHealth, runId: string): string | null {
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0 && health.alerts.length === 0) return null;
  const lines = [
    results.length > 0
      ? `Dash quality check: ${failed.length} of ${results.length} questions failed, ${health.alerts.length} alerts from the last day`
      : `Dash quality check: ${health.alerts.length} alert${health.alerts.length === 1 ? '' : 's'} from the last day of answers`,
    '',
  ];
  if (failed.length > 0) {
    lines.push('Questions that failed:');
    for (const r of failed) lines.push(`- "${r.question}": ${r.failures.join(' ')}`);
    lines.push('');
  }
  if (health.alerts.length > 0) {
    lines.push(`The last day of real answers (${health.answers}):`);
    for (const alert of health.alerts) lines.push(`- ${alert}`);
    lines.push('');
  }
  lines.push(`Run ${runId} in core.dash_eval_runs has each answer and its lookups. The Dash quality session works this note (.claude/skills/dash-quality/SKILL.md).`);
  return lines.join('\n');
}

export async function runDashQuality(
  ports: DashQualityPorts,
  options: { trigger: DashQualityTrigger; only?: string | null; deploy: string | null; now?: Date },
): Promise<{ runId: string; cases: number; passed: number; alerts: number; noteId: string | null }> {
  const now = options.now ?? new Date();
  const userId = await ports.owner();
  const model = await ports.model(userId);
  const runId = await ports.start({ userId, trigger: options.trigger, model, deploy: options.deploy });

  let results: CaseResult[] = [];
  let error: string | null = null;
  try {
    // The daily run reads real answers only: asking cases costs model spend.
    const cases = options.trigger === 'health' ? [] : await ports.cases(userId, options.only ?? undefined);
    results = await inTurns(cases, CASE_CONCURRENCY, async (c): Promise<CaseResult> => {
      try {
        const { outcome, costMicros } = await ports.ask(userId, c.question);
        const failures = gradeAnswer(parseExpect(c.expect), outcome);
        return {
          case: c.id,
          question: c.question,
          passed: failures.length === 0,
          failures,
          body: outcome.ok ? outcome.body.slice(0, 4000) : '',
          stop: outcome.ok ? outcome.stop : 'failed',
          lookups: lookupsOf(outcome),
          seconds: Math.round(outcome.seconds * 10) / 10,
          costMicros,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { case: c.id, question: c.question, passed: false, failures: [`The run threw: ${message}`], body: '', stop: 'threw', lookups: [], seconds: 0, costMicros: 0 };
      }
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const since = new Date(now.getTime() - HEALTH_HOURS * 3_600_000).toISOString();
  const health = dashHealth(await ports.turns(userId, since), await ports.spend(userId, since));
  if (error) health.alerts.unshift(`The run could not read its cases: ${error}`);
  const body = qualityNote(results, health, runId);
  const noteId = body ? await ports.writeNote(userId, body) : null;
  const passed = results.filter((r) => r.passed).length;
  const costMicros = results.reduce((sum, r) => sum + r.costMicros, 0);
  await ports.finish(runId, { cases: results.length, passed, results, health, costMicros, noteId, error });
  return { runId, cases: results.length, passed, alerts: health.alerts.length, noteId };
}
