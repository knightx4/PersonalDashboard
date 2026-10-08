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
import { loadMainCheck } from '@/lib/shell/main-check';
import { loadRecentScreenChanges } from '@/lib/plan/screen-change-load';
import { planRefHref } from '@/lib/comments/refs';
import { ShippedScreens, type ShippedScreen } from '@/components/dev/screen-change';
import { Group } from '@/components/ui/disclosure';
import { NOTES_WORK_KINDS } from '@/lib/feedback/load';
import { CHECK_BACK_COLUMNS, checkBackFrom } from '@/lib/plan/check-backs';
import { CheckBacksPanel } from './check-backs-panel';
import { ConversationsView } from './conversations-view';
import { DigestPanel } from './digest-panel';
import { AskBox } from './ask-box';
import { NowStrip } from './now-strip';
import { InboxRedirect } from './inbox-redirect';
import { StatusPanel } from './status-panel';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadStartedGoalRuns } from '@/lib/goals/runs-store';
import { goalsStatus } from '@/lib/goals/runner-status';
import { loadGoalsNight } from '@/inngest/goals/overnight';

export const metadata = { title: 'Dash' };

/** How far back the pictures under the strip reach. */
const SHIPPED_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Enough pictures to fill a laptop's row; the rest are on the changelog. */
const SHIPPED_SHOWN = 8;

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
 * The page you open in the morning, read top to bottom: what is going right
 * now, what changed, what Dash is due to come back to, then the conversations.
 *
 * The strip of chips answers "is anything running, is main green, is anything
 * waiting on me" before anything is scrolled, each chip a link to the page
 * that holds the detail. The runner's controls are folded under it. What is
 * waiting on you is the Inbox tab, and Home carries only its count.
 *
 * The pictures are the after shots of the screens changed in the last two
 * days, because a changed screen is read faster from a picture than from its
 * changelog line. The summary of the last 24 hours is written once a day by
 * the cron rather than built here, so opening the page never costs a model
 * call.
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
  const now = readClock();
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
    mainCheck,
    recentScreens,
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
    // Counted for the Inbox chip, the same as the tab's badge.
    countProposedSpecChanges(supabase, user.id),
    // The row the status line reads, for the Main chip.
    loadMainCheck(),
    // The screens changed in the last two days, for the pictures. Two days
    // rather than one, so a morning after a quiet day still has something.
    loadRecentScreenChanges(supabase, user.id, new Date(now - SHIPPED_WINDOW_MS).toISOString()),
  ]);
  const comingBack = (checkBacks.data ?? []).map((row) => checkBackFrom(row as Record<string, unknown>));

  // The tree once, for the two things below that read it: how much is
  // waiting on you, and how many features the runner could pick up.
  const sections = buildPlanTree(plan);
  // Counted the way the tab's badge is (app/dev/layout.tsx), so the chip and
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

  // Newest step first, each with the title it shipped under.
  const stepTitles = new Map(plan.items.map((item) => [item.number, item.title]));
  const shipped: ShippedScreen[] = Object.entries(recentScreens)
    .map(([step, changes]) => ({ step: Number(step), changes }))
    .sort((a, b) => b.step - a.step)
    .flatMap(({ step, changes }) =>
      changes.map((change) => ({
        step,
        title: stepTitles.get(step) ?? '',
        href: planRefHref(step),
        change,
      })),
    )
    .slice(0, SHIPPED_SHOWN);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* No description: the page is the day, and says so by what is on it. */}
      <PageHeader title="Home" />
      <InboxRedirect />
      <div className="space-y-3">
        <NowStrip
          run={overnight}
          ready={card.ready}
          openNotes={openNotes.count ?? 0}
          mainCheck={mainCheck}
          inbox={onYou}
        />
        <AskBox />
      </div>
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
      {shipped.some((screen) => screen.change.after) && (
        <Group title="Shipped lately">
          <ShippedScreens screens={shipped} />
        </Group>
      )}
      <DigestPanel digest={digest} />
      <CheckBacksPanel rows={comingBack} now={now} />
      <ConversationsView conversations={conversations} titles={titles} now={now} />
    </div>
  );
}
