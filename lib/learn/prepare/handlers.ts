import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { finishStep, type StepHandler } from './run';
import type { PreparationStepKey } from './steps';

/**
 * The steps whose code is on main, by key (plan #2276).
 *
 * A key missing here is skipped by the runner with the plan step that builds
 * it, so the run still reaches its end. Each later step adds its handler here:
 * classify, pull_documents and match_weeks with #2276.3, compile_territory
 * with #2276.4, draft_topics and write_units with #2276.5.
 */
export type PreparationDeps = {
  learn: LearnSupabaseClient;
  userId: string;
  anthropicApiKey: string | undefined;
};

export function liveHandlers(deps: PreparationDeps): Partial<Record<PreparationStepKey, StepHandler>> {
  void deps;
  return {
    finish: finishStep,
  };
}
