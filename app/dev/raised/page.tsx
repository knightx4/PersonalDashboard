import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { loadRaised } from '@/lib/raised/load';
import { planRefTitles } from '@/lib/plan/load';
import { loadPlanForRequest } from '@/lib/plan/request-plan';
import { buildPlanTree, flattenSections } from '@/lib/plan/tree';
import { waitingOnYou } from '@/lib/plan/waiting';
import { loadDigest } from '@/lib/digest/load';
import { loadConversations } from '@/lib/comments/recent';
import { loadFeatureFires, loadLastRuns, loadStartedRuns } from '@/lib/plan/runs';
import { loadOvernightRun } from '@/lib/plan/overnight';
import { runnerCard } from '@/lib/plan/runner-card';
import { planRoutine } from '@/lib/feedback/routine';
import { loadNotesLastRun } from '@/lib/feedback/last-worked';
import { loadVisionReviewStatus } from '@/lib/specs/vision-review-run';
import { countProposedSpecChanges } from '@/lib/specs/changes';
import { NOTES_WORK_KINDS } from '@/lib/feedback/load';
import { CHECK_BACK_COLUMNS, checkBackFrom } from '@/lib/plan/check-backs';
import { CheckBacksPanel } from './check-backs-panel';
import { ConversationsView } from './conversations-view';
import { DigestPanel } from './digest-panel';
import { InboxLine } from './inbox-line';
import { InboxRedirect } from './inbox-redirect';
import { StatusPanel } from './status-panel';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadStartedGoalRuns } from '@/lib/goals/runs-store';
import { goalsStatus } from '@/lib/goals/runner-status';
import { loadGoalsNight } from '@/inngest/goals/overnight';

export const metadata = { title: 'Dash' };

/** The time the check-backs are measured against. Outside the component because it reads the clock. */
function readClock(): number {
  return Date.now();
}

/** The goal runs going and the goals night's rows, or null when they could not be read. */
async function readGoals(userId: string) {
  try {
    const client = await createGoalsClient();
    const [started, night] = await Promise.all([
      loadStartedGoalRuns(client),
      loadGoalsNight(client, userId, readClock()),
    ]);
    return { started, night };
  } catch (error) {
    console.error(`Dash could not read the goal runs: ${(error as Error).message}`);
    return null;
  }
}

/**
 * The page you open in the morning: your day, and your conversations.
 *
 * The summary of the last 24 hours is written once a day by the cron rather
 * than built here, so opening the page never costs a model call. What is
 * waiting on you was the middle of this page and is the Inbox tab now; Home
 * keeps one line saying how much, so the count is still the first thing read.
 *
 * Then every conversation you have had, wherever it was started. A thread used
 * to be visible only from the row it was written on, which meant finding an
 * answer by remembering where the question was asked.
 *
 * Above all three, what is running. The two routines' states were on two other
 * pages, so the first question of the morning was the one this page could not
 * answer -- see `StatusPanel`.
 *
 * The route stays /dev/raised though the tab is called Home -- #431, note a0897727 -- because
 * every notification, comment and old summary already links to it.
 */
export default async function DevRaisedPage() {
  const user = await requireUser();
  const supabase = await createClient();
  // The goals half of the same runner, read alongside the rest. A goals read
  // that fails leaves the Plan row as it was rather than taking the page down.
  const goalsRead = readGoals(user.id);
  const [
    queue,
    digest,
    conversations,
    plan,
    overnight,
    fires,
    lastRuns,
    started,
    openNotes,
    notesLastRun,
    checkBacks,
    vision,
    specChanges,
  ] = await Promise.all([
    loadRaised(supabase, user.id),
    loadDigest(supabase, user.id),
    loadConversations(supabase, user.id),
    loadPlanForRequest(user.id),
    // The runner's standing intention, and the presses its night has made:
    // the same rows and the same loaders /dev/plan reads, so the two pages
    // cannot come to different answers about what is running.
    loadOvernightRun(supabase, user.id),
    loadFeatureFires(supabase, user.id),
    loadLastRuns(supabase, user.id),
    loadStartedRuns(supabase, user.id),
    // A count, not the rows: what makes "run it" answerable is how many are
    // waiting, and the queue itself is one link away.
    supabase
      .from('feedback_items')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['open', 'in_progress', 'blocked', 'planned'])
      // Beside the routine button, so only what a notes run would work.
      .in('kind', [...NOTES_WORK_KINDS]),
    loadNotesLastRun(supabase, user.id),
    // What Dash has said it will come back to, soonest first.
    supabase
      .from('check_backs')
      .select(CHECK_BACK_COLUMNS)
      .eq('user_id', user.id)
      .eq('status', 'waiting')
      .order('due_at'),
    loadVisionReviewStatus(supabase, user.id),
    // Counted for the inbox line, the same as the tab's badge.
    countProposedSpecChanges(supabase, user.id),
  ]);
  const comingBack = (checkBacks.data ?? []).map((row) => checkBackFrom(row as Record<string, unknown>));
  const now = readClock();

  // The tree once, for the two things below that read it: how much is
  // waiting on you, and how many features the runner could pick up.
  const sections = buildPlanTree(plan);
  // Counted the way the tab's badge is (app/dev/layout.tsx), so the line and
  // the badge never disagree.
  const onYou = queue.open.length + waitingOnYou(sections).length + specChanges;

  // The runner's card, read by the same function the plan page reads it with.
  const card = runnerCard({
    run: overnight,
    fires,
    items: plan.items,
    sections,
    started,
    lastRuns: Object.values(lastRuns),
  });

  // What the goals half is on and what it could pick up.
  const goalsRows = await goalsRead;
  const goals = goalsRows
    ? goalsStatus({
        ...goalsRows,
        nightStartedAt: overnight?.running ? overnight.startedAt : null,
        now,
      })
    : null;

  // What every "#494" on this page is called. Built once here rather than
  // looked up where each one is drawn: a raise with nine references in it
  // would otherwise be nine lookups inside a render.
  const titles = planRefTitles(plan, flattenSections(sections));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Home"
        description="What is running, what happened in the last day, and every conversation you have had with Dash. Reply to a conversation and it goes back on the row it was started on."
      />
      <InboxRedirect />
      <InboxLine count={onYou} />
      <StatusPanel
        run={overnight}
        canSend={Boolean(planRoutine().token)}
        card={card}
        goals={goals}
        openNotes={openNotes.count ?? 0}
        notesLastRun={notesLastRun}
        vision={vision}
        now={now}
      />
      <CheckBacksPanel rows={comingBack} now={now} />
      <DigestPanel digest={digest} />
      <ConversationsView conversations={conversations} titles={titles} />
    </div>
  );
}
