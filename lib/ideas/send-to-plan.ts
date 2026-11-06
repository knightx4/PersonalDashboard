import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SpendReport } from '@/lib/core/spend/pricing';
import type { Triage } from '@/lib/feedback/triage';
import { scoreIdeaRow } from '@/lib/ideas/score-run';
import { shapeIdeaRun } from '@/lib/ideas/shape';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, 'public'>;

/**
 * Where every note that needs planning goes: scored, then straight on to be
 * shaped into a proposed feature on the plan, as Shape on the ideas page would
 * do, without waiting there for a press (note 677a1cdd). One path for the
 * header's notes button (lib/feedback/file-note.ts) and for the note button in
 * a project's own app (lib/project-notes/file.ts), so any app given a note
 * button behaves the same way.
 *
 * Scoring is skipped when Jev is off (`score: false`); shaping is not, since
 * the plan is the point. Never throws: a note is already saved, and a failed
 * hand-off leaves it on the ideas page with its Shape button.
 */
export async function sendIdeaToPlan(
  supabase: Client,
  input: {
    userId: string;
    ideaId: string;
    triage?: Triage | null;
    score: boolean;
    /** Records what scoring spent (the caller knows whether it has a session). */
    record: (spend: SpendReport[]) => Promise<unknown>;
  },
): Promise<{ shaped: boolean; error?: string }> {
  try {
    if (input.score) {
      const spend: SpendReport[] = [];
      await scoreIdeaRow(supabase, { userId: input.userId, id: input.ideaId, triage: input.triage ?? null, spend });
      await input.record(spend).catch(() => {});
    }
  } catch (problem) {
    console.warn('[ideas] scoring before shaping failed', problem);
  }
  try {
    const shaped = await shapeIdeaRun(supabase, input.userId, input.ideaId);
    if (!shaped.ok) console.warn('[ideas] sending an idea to be shaped failed', shaped.error);
    return shaped.ok ? { shaped: true } : { shaped: false, error: shaped.error };
  } catch (problem) {
    console.warn('[ideas] sending an idea to be shaped failed', problem);
    return { shaped: false, error: problem instanceof Error ? problem.message : String(problem) };
  }
}
