import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tabFrom } from '@/lib/tabs';
import { createClient, requireUser } from '@/lib/auth/server';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { noLinks, weekInstants, type GoalLinks } from '@/lib/goals/links';
import { loadAimChoices, loadGoalLinks } from '@/lib/goals/links-store';
import { loadCollectionsForGoal } from '@/lib/goals/collections-store';
import { shownContext, type ContextItem } from '@/lib/goals/context';
import { loadContext } from '@/lib/goals/context-store';
import { loadGoalFlags } from '@/lib/goals/flags-store';
import { lastProgressOn, summariseProgress, type ProgressEntry } from '@/lib/goals/progress';
import { loadProgressEntries } from '@/lib/goals/progress-store';
import { loadNumberFrom, loadReadings } from '@/lib/goals/readings-store';
import { goalRunRows, type RunListing } from '@/lib/goals/runs';
import { loadGoalRuns } from '@/lib/goals/runs-store';
import { loadDashArrivals } from '@/lib/goals/dash-arrivals-store';
import {
  approvalLine,
  countOpenQuestions,
  countProposed,
  nothingOpen,
  runInFlight,
  runProgress,
  stepRunViews,
  type GoalRun,
} from '@/lib/goals/shaping';
import type { StepNode } from '@/lib/goals/steps';
import type { GoalStatus } from '@/lib/goals/tree';
import { loadShaping, loadStepRuns } from '@/lib/goals/shaping-store';
import { loadGoalMap, type GoalMap } from '@/lib/goals/steps-store';
import { loadAreas } from '@/lib/goals/store';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadAimForGoal, loadLevel3Counts } from '@/lib/learn/aims-store';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadPlans } from '@/lib/learn/lessons/plan-store';
import { progressLine } from '@/lib/learn/lessons/plan-view';
import { todayIn } from '@/lib/todo/tasks/model';
import { FileLinks } from '@/components/files/file-links';
import type { LinkedFile } from '@/lib/files/files';
import { createCoreClient } from '@/lib/core/auth/server';
import { writtenWhen, type Brief } from '@/lib/goals/briefs';
import { loadBrief } from '@/lib/goals/briefs-store';
import { loadFilesOf } from '@/lib/goals/files-store';
import { flagsWaiting } from '@/lib/goals/flags';
import { goalStatus, statusLine } from '@/lib/goals/goal-status';
import { goalProgress } from '@/lib/goals/status';
import { isCurrent, type GoalReview } from '@/lib/goals/reviews';
import { loadLatestReviews } from '@/lib/goals/reviews-store';
import { closedSteps, GOAL_TABS, goalStages } from '@/lib/goals/goal-page';
import { goalMatchText } from '@/lib/goals/related-notes';
import { createVaultClient } from '@/lib/vault/auth/server';
import { relatedNotes, toLink } from '@/lib/vault/notes/related';
import { RelatedNotes } from '@/components/vault/related-notes';
import { GoalStatusCard } from './goal-status';
import { GoalActivity } from './goal-activity';
import { GoalDetail } from './goal-detail';
import { GoalAddRow } from './goal-add-row';
import { GoalStepsFold } from './goal-close';
import type { Place } from '../move-goal';
import { GoalContext } from './goal-context';
import { WaitingOnYou } from './goal-flags';
import { GoalHelp } from './goal-help';
import { GoalLearn } from './goal-learn';
import { GoalLinksSection } from './goal-links';
import { GoalNumber } from './goal-number';
import { GoalFog, GoalShaping } from './goal-shaping';
import { StepTree } from './step-tree';
import { DashWork } from './dash-work';
import { dashWork } from '@/lib/goals/dash-work';

export const metadata = { title: 'Goal' };
export const dynamic = 'force-dynamic';

/**
 * What the Claude panel says. Outside the component because it reads the
 * clock, and reading the clock during render is unstable.
 */
function shapingLines(
  goalStatus: GoalStatus,
  steps: StepNode[],
  approvedAt: string | null,
  history: { runs: RunListing[]; more: boolean },
  timeZone: string,
) {
  const now = Date.now();
  const lastRun = history.runs[0] ?? null;
  const running = runInFlight(lastRun, now);
  return {
    approval: approvalLine({
      goalStatus,
      approvedAt,
      proposed: countProposed(steps),
      questions: countOpenQuestions(steps),
      nothingOpen: nothingOpen(steps),
    }),
    runs: goalRunRows(history.runs, now, timeZone),
    moreRuns: history.more,
    running: running && lastRun ? runProgress(lastRun, now) : null,
  };
}

/** Every step on the page, its own and those linked in, at any depth. */
/** The finished steps on the page, the only ones that can arrive. */
function doneStepIdsOn(map: GoalMap): string[] {
  const done = new Set<string>();
  const walk = (nodes: StepNode[]) => {
    for (const node of nodes) {
      if (node.status === 'done') done.add(node.id);
      walk(node.children);
    }
  };
  walk(map.steps);
  walk(map.linked.map((entry) => entry.step));
  return [...done];
}

function stepIdsOn(map: GoalMap): string[] {
  const ids: string[] = [];
  const walk = (nodes: StepNode[]) => {
    for (const node of nodes) {
      ids.push(node.id);
      walk(node.children);
    }
  };
  walk(map.steps);
  walk(map.linked.map((entry) => entry.step));
  return ids;
}

/** Each sent step's run line (plan #1044). Outside the component because it reads the clock. */
function stepRunLines(runs: Record<string, GoalRun>) {
  return stepRunViews(runs, Date.now());
}

/** Dash's work at the top of the page (note 03ce0cce). Outside the component because it reads the clock. */
function dashWorkOn(map: GoalMap, runs: Record<string, GoalRun>) {
  const titles = new Map<string, string>();
  const walk = (nodes: StepNode[]) => {
    for (const node of nodes) {
      titles.set(node.id, node.title);
      walk(node.children);
    }
  };
  walk(map.steps);
  walk(map.linked.map((entry) => entry.step));
  return dashWork(runs, titles, Date.now());
}

/** Each question waiting on you, by id, for its answer box in Waiting on you. */
function questionsOn(map: GoalMap, ids: ReadonlySet<string>): Record<string, StepNode> {
  const out: Record<string, StepNode> = {};
  const walk = (nodes: StepNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'decision' && ids.has(node.id)) out[node.id] = { ...node, children: [] };
      walk(node.children);
    }
  };
  walk(map.steps);
  return out;
}

/** Whether the status is today's. Outside the component because it reads the clock. */
function reviewCurrent(review: GoalReview): boolean {
  return isCurrent(review, Date.now());
}

/** When Claude's note was written. Outside the component because it reads the clock. */
function noteWhen(brief: Brief, timeZone: string): string {
  return writtenWhen(brief, timeZone, Date.now());
}

/** Every file on the goal and its steps, once each, the goal's own first. */
function goalFiles(goalId: string, filesOf: Record<string, LinkedFile[]>): LinkedFile[] {
  const seen = new Set<string>();
  const out: LinkedFile[] = [];
  const add = (files: LinkedFile[] | undefined) => {
    for (const file of files ?? []) {
      if (seen.has(file.fileId)) continue;
      seen.add(file.fileId);
      out.push(file);
    }
  };
  add(filesOf[goalId]);
  for (const [itemId, files] of Object.entries(filesOf)) if (itemId !== goalId) add(files);
  return out;
}

/**
 * What Learn holds for a goal in the Learn area (plan #1491): its aim, its
 * plan and, for the Level 3 goal, the counts. Null for any other goal, and
 * when Learn is off or the aim cannot be read, which leaves the section out
 * rather than the page. A plan or counts that cannot be read are left out of
 * the section the same way.
 */
async function loadGoalLearn(learn: LearnSupabaseClient | null, userId: string, goalId: string) {
  if (!learn) return null;
  const aim = await loadAimForGoal(learn, goalId).catch(() => null);
  if (!aim) return null;
  const level3 = aim.listSource === 'level3';
  const [plans, level3Counts] = await Promise.all([
    loadPlans(learn, userId).catch(() => []),
    level3 ? loadLevel3Counts(learn).catch(() => null) : null,
  ]);
  const plan = plans.find((p) => p.aimId === aim.id);
  return {
    aim: { id: aim.id, name: aim.name, depth: aim.depth, level3 },
    plan: plan
      ? { href: `/learn/s/${plan.subjectId}`, line: progressLine(plan.progress, plan.finished) }
      : null,
    level3Counts,
  };
}

/** A closed goal's runs, which have no shaping panel to list them. Outside the component because it reads the clock. */
function runRowsOf(history: { runs: RunListing[] }, timeZone: string) {
  return goalRunRows(history.runs, Date.now(), timeZone);
}

/**
 * One goal (docs/GOALS-SPEC.md, "The goal page"; plans #925, #1078 and
 * #1671), in the tabbed detail pattern the feature page on /dev/plan uses:
 * the path, the title and done-when, then three tabs with the goal's
 * properties in a column beside them.
 *
 *  - Overview: the status card with Dash's verdict and next move, the
 *    number, Waiting on you, and what feeds the goal (context from the other
 *    modules, weekly help, links, Learn, files, related notes, add lines);
 *  - Steps: the step tree, with Now, Other stages and the rhythms;
 *  - Activity: the steps closed, the runs and the goal's comments.
 *
 * The properties are the area, status, Dash's verdict, the dates and the
 * progress split between you and Dash. Up to two of your vault notes on the
 * goal's subject stream in on Overview (plan #1114), matched on the title
 * and the done-when (lib/goals/related-notes.ts); the lookup is started and
 * not awaited.
 */
export default async function GoalMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ goalId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { goalId } = await params;
  const tab = tabFrom((await searchParams).tab, GOAL_TABS);
  if (!/^[0-9a-f-]{36}$/i.test(goalId)) notFound();

  const user = await requireUser();
  const account = await loadAccountSettings(user.id);
  const today = todayIn(account.timezone);
  const client = await createGoalsClient();
  const learnOn = moduleEnabled(account, 'learn');
  const jobsOn = moduleEnabled(account, 'jobs');
  const learn = learnOn ? await createLearnClient() : null;
  const jobs = jobsOn ? await createJobsClient() : null;
  const [
    map,
    readings,
    numberFrom,
    sources,
    links,
    aims,
    shaping,
    history,
    owner,
    flags,
    context,
    learnGoal,
  ] = await Promise.all([
    loadGoalMap(client, goalId, { userId: user.id, today }),
    loadReadings(client, goalId),
    // Where the number is worked out from, and what it could be (plan #1024).
    loadNumberFrom(client, goalId),
    loadCollectionsForGoal(client, goalId),
    // Read live from Learn and the job search (plan #931). A failed read is a
    // line where the links would be, not a broken goal page.
    loadGoalLinks(
      { goals: client, learn, jobs },
      goalId,
      weekInstants(today, account.timezone),
    ).catch((): GoalLinks | null => null),
    learn ? loadAimChoices(learn).catch(() => null) : null,
    loadShaping(client, goalId),
    loadGoalRuns(client, goalId),
    isOwner({ user }),
    // What a run flagged on the goal (plan #1015), from public.raised_items.
    createClient().then((supabase) => loadGoalFlags(supabase, { userId: user.id, goalId })),
    // What Claude found in the other modules for this goal. A failed read
    // leaves the section out rather than the page.
    loadContext(client, goalId).catch((): ContextItem[] => []),
    loadGoalLearn(learn, user.id, goalId),
  ]);
  if (!map) notFound();
  // The latest run on each step sent, prepared or asked about from its row
  // (plan #1044), so a reload shows it going. A failed read leaves the lines
  // out rather than the page.
  const [core, vault] = await Promise.all([createCoreClient(), createVaultClient()]);
  const related = relatedNotes(
    vault,
    user.id,
    goalMatchText({ title: map.goal.title, acceptance: map.goal.acceptance }),
    { core },
  ).then((found) => found.map(toLink));
  const [stepRuns, filesOf, brief, review, places, progressEntries, arrivals] = await Promise.all([
    loadStepRuns(client, stepIdsOn(map)).catch((): Record<string, GoalRun> => ({})),
    // The files the goal and its steps link to. A failed read leaves them
    // out rather than the page, as do the note and the verdict below.
    loadFilesOf(client, core, [map.goal.id, ...stepIdsOn(map)]).catch(
      (): Record<string, LinkedFile[]> => ({}),
    ),
    loadBrief(client, map.goal.id).catch((): Brief | null => null),
    loadLatestReviews(client)
      .then((reviews) => reviews.get(map.goal.id) ?? null)
      .catch((): GoalReview | null => null),
    // The areas the goal can be moved to (plan #1160). A failed read leaves
    // the menu out rather than the page.
    loadAreas(client)
      .then((areas) => areas.map((area) => ({ id: area.id, name: area.name })))
      .catch((): Place[] => []),
    // The partial progress logged on the goal and its steps (plan #1276). A
    // failed read leaves the steps as they were rather than the page.
    loadProgressEntries(client, [map.goal.id, ...stepIdsOn(map)]).catch(
      (): ProgressEntry[] => [],
    ),
    // The finished steps Dash closed lately, which arrive with its mark
    // (plan #1561). A failed read leaves the moment out.
    loadDashArrivals(client, doneStepIdsOn(map)).catch((): string[] => []),
  ]);
  const status = goalStatus(
    map.goal,
    map.areaName,
    map.steps,
    today,
    flagsWaiting(flags, new Map([[map.goal.id, map.goal.title]])),
  );
  const files = goalFiles(map.goal.id, filesOf);
  const shapeable = map.goal.status === 'open' || map.goal.status === 'proposed';
  const linkedAims = new Set(links?.aims.map((aim) => aim.aimId));
  const aimChoices = aims?.filter((aim) => !linkedAims.has(aim.id)) ?? null;

  // Each section drawn above the steps only once it holds something; the empty
  // ones share one row of add lines instead (plan #1038).
  const number = {
    goalId: map.goal.id,
    unit: map.goal.unit,
    target: map.goal.target,
    dueOn: map.goal.dueOn ?? null,
    readings,
    today,
    numberFrom,
    sources,
  };
  const help = {
    goalId: map.goal.id,
    helpKinds: map.goal.helpKinds ?? [],
    proposedHelpKinds: map.goal.proposedHelpKinds ?? [],
  };
  const linked = { goalId: map.goal.id, links, aimChoices, jobsOn };
  const numberEmpty = !number.unit && readings.length === 0;
  const helpEmpty = help.helpKinds.length === 0 && help.proposedHelpKinds.length === 0;
  // An errand is a short job with a date (plan #1262): no stage track and no
  // weekly help, and its due date beside the title.
  const errand = map.goal.errand === true;
  const linksEmpty = links !== null && noLinks(links);
  const canLink = (aimChoices?.length ?? 0) > 0 || jobsOn;

  const stages = errand ? null : goalStages(map.steps);
  // The line the steps fold into once the goal is closed (plan #1341); its
  // hexagon is drawn by GoalDetail from the same progress.
  const closed = map.goal.status === 'done';
  const progress = goalProgress(map.steps);
  const stepsMeta = progress.live > 0 ? `${progress.done} of ${progress.live} done` : undefined;
  const shapingView = shapeable
    ? shapingLines(map.goal.status, map.steps, shaping.approvedAt, history, account.timezone)
    : null;
  // Dash's panel stands under the status while it has something to approve,
  // a run is going, or every step is finished and the goal needs its next
  // ones; otherwise it is Ask Dash alone, in the status card.
  const shapingUp = Boolean(
    shapingView &&
      (shapingView.approval.approve ||
        shapingView.running ||
        (map.goal.status === 'open' && nothingOpen(map.steps))),
  );
  const shapingPanel = shapingView && (
    <GoalShaping goalId={map.goal.id} {...shapingView} canRun={owner} quiet />
  );
  const shownItems = shownContext(context);
  const thread = map.threads[map.goal.id] ?? [];
  const work = dashWorkOn(map, stepRuns);
  const stepProgress = summariseProgress(progressEntries);
  const line = statusLine(status, {
    running: work.filter((item) => item.state === 'running').length,
    // An errand's date is already in the properties as Due.
    dueOn: errand ? null : (map.goal.dueOn ?? null),
    lastProgressOn: lastProgressOn(stepProgress),
  });
  const questions = questionsOn(
    map,
    new Set(status.yourMove.filter((row) => row.kind === 'question').map((row) => row.id)),
  );
  // Every goal's runs, not only an open one's: Activity lists them for a
  // closed goal too.
  const runs = shapingView?.runs ?? runRowsOf(history, account.timezone);

  const overview = (
    <div className="space-y-6">
      {map.goal.fog && (
        <GoalFog goalId={map.goal.id} fog={map.goal.fog} aside={Boolean(map.goal.fogDismissedAt)} />
      )}
      <div className="space-y-4">
        <GoalStatusCard
          line={line}
          review={review}
          current={review ? reviewCurrent(review) : false}
          brief={brief}
          briefWhen={brief ? noteWhen(brief, account.timezone) : null}
          work={<DashWork items={work} />}
          ask={!shapingUp && shapingPanel}
        />
        {shapingUp && shapingPanel}
        {!numberEmpty && <GoalNumber {...number} />}
        <WaitingOnYou rows={status.yourMove} flags={flags} questions={questions} />
      </div>
      <GoalContext items={shownItems} />
      {!errand && !helpEmpty && <GoalHelp {...help} />}
      {!linksEmpty && <GoalLinksSection {...linked} />}
      {learnGoal && <GoalLearn {...learnGoal} />}
      {files.length > 0 && (
        <section aria-labelledby="files-heading" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
            <h2 id="files-heading" className="text-ui font-semibold text-ink">
              Files
            </h2>
            <Link
              href="/goals/files"
              className="press-area text-small text-accent underline-offset-2 hover:underline"
            >
              Files for every goal
            </Link>
          </div>
          <FileLinks files={files} />
        </section>
      )}
      <RelatedNotes notes={related} className="px-1" />
      <GoalAddRow
        number={numberEmpty ? number : null}
        help={!errand && helpEmpty ? help : null}
        links={linksEmpty && canLink ? linked : null}
      />
    </div>
  );

  return (
    <GoalDetail
      goal={map.goal}
      areaName={map.areaName}
      places={places}
      review={review}
      progress={progress}
      timeZone={account.timezone}
    >
      {tab === 'steps' ? (
        <GoalStepsFold closed={closed} meta={stepsMeta}>
          <StepTree
            map={map}
            stages={stages}
            todoOn={moduleEnabled(account, 'todo')}
            runs={stepRunLines(stepRuns)}
            files={filesOf}
            progress={stepProgress}
            arrivals={arrivals}
            canRun={owner}
          />
        </GoalStepsFold>
      ) : tab === 'activity' ? (
        <GoalActivity
          goalId={map.goal.id}
          closed={closedSteps(map.steps)}
          runs={runs}
          moreRuns={shapingView?.moreRuns ?? history.more}
          thread={thread}
          timeZone={account.timezone}
        />
      ) : (
        overview
      )}
    </GoalDetail>
  );
}
