import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadRaised } from '@/lib/raised/load';
import { planRefTitles } from '@/lib/plan/load';
import { loadPlanForRequest } from '@/lib/plan/request-plan';
import { buildPlanTree, flattenSections, type PlanSection } from '@/lib/plan/tree';
import { sortAsksWithJev, waitingGroups, waitingOnYou } from '@/lib/plan/waiting';
import { createCoreClient } from '@/lib/core/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { loadOpenSpecChanges } from '@/lib/specs/changes';
import { specBySlug } from '@/lib/specs/registry';
import { RaisedView } from '@/app/dev/raised/raised-view';

export const metadata = { title: 'Inbox' };

/**
 * The plan's rows waiting on you, with each blocked step's ask sorted into a
 * job or a question by Jev (plan #1176). Falls back to the regex's guess, row
 * by row inside sortAsksWithJev and wholesale here if the account setting or
 * the ledger cannot be reached.
 */
async function readWaitingRows(sections: readonly PlanSection[], userId: string) {
  const rows = waitingOnYou(sections);
  try {
    const core = await createCoreClient();
    const spend: SpendReport[] = [];
    const sorted = await sortAsksWithJev(rows, {
      enabled: await jevEnabledFor(core, userId),
      onSpend: (report) => spend.push(report),
    });
    await recordSpendReports(core, userId, { module: 'core', operation: 'sort-waiting' }, spend);
    return sorted;
  } catch (error) {
    console.error(`The inbox could not sort the asks with Jev: ${(error as Error).message}`);
    return rows;
  }
}

/**
 * Everything waiting on you in Dev, on a page of its own.
 *
 * Two halves in one list. The plan's own rows (a blocked step, an unanswered
 * decision, a proposal nobody approved) are derived from the tree rather than
 * filed by a session, so a step blocked on a credential reaches this page
 * without anybody remembering to raise it as well. The raises are what a
 * session ran into and could not settle alone. Changes Dash proposed to a spec
 * wait under To approve (plan #1506).
 *
 * The tab's badge is counted from the same three sources in app/dev/layout.tsx,
 * so the number on the tab is the number of rows on this page.
 */
export default async function DevInboxPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [queue, plan, specChanges] = await Promise.all([
    loadRaised(supabase, user.id),
    loadPlanForRequest(user.id),
    loadOpenSpecChanges(supabase, user.id),
  ]);

  const sections = buildPlanTree(plan);
  const groups = waitingGroups(
    sections,
    queue,
    await readWaitingRows(sections, user.id),
    specChanges.map((change) => ({ change, specTitle: specBySlug(change.spec)?.title ?? null })),
  );

  // What every "#494" on this page is called, built once rather than looked up
  // where each one is drawn.
  const titles = planRefTitles(plan, flattenSections(sections));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Inbox"
        description="Everything waiting on you: jobs to go and do, questions to answer, and proposals to say yes to. Answer one and the next run reads it."
      />
      <RaisedView queue={queue} groups={groups} titles={titles} />
    </div>
  );
}
