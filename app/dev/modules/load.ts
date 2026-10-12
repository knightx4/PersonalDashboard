import { createClient, requireUser } from '@/lib/auth/server';
import { loadFeedbackQueue } from '@/lib/feedback/load';
import { loadIdeas } from '@/lib/ideas/load';
import type { ModuleInputs } from '@/lib/dev/module-page';
import { loadPlanForRequest } from '@/lib/plan/request-plan';
import { loadModuleVisions } from '@/lib/specs/vision';
import { loadUiReviews } from '@/lib/ui-review/load';
import { readPageOpens } from '@/lib/usage/opens';
import { readWorkspaceSpend, usageReport } from '@/lib/usage/report';

/**
 * Everything the module pages read, over the request's own connection so RLS
 * keeps it to the signed-in person. The Dev layout has already refused anybody
 * but the owner.
 */
export async function loadModuleInputs(): Promise<ModuleInputs> {
  const user = await requireUser();
  const supabase = await createClient();
  const [plan, queue, ideas, visions, ui, opened, spend] = await Promise.all([
    loadPlanForRequest(user.id),
    loadFeedbackQueue(supabase, user.id),
    loadIdeas(supabase, user.id),
    loadModuleVisions(supabase, user.id),
    loadUiReviews(supabase, user.id),
    readPageOpens(supabase),
    readWorkspaceSpend(supabase),
  ]);
  const usage = usageReport(opened, spend);
  return {
    plan: plan.items,
    bugs: queue.outstanding,
    ideas: [...ideas.mine, ...ideas.suggested],
    visions,
    ui,
    usage: usage.groups,
    notOpened: usage.notOpened,
  };
}
