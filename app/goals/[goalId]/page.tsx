import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
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
import { loadNumberFrom, loadReadings } from '@/lib/goals/readings-store';
import { goalRunRows, type RunListing } from '@/lib/goals/runs';
import { loadGoalRuns } from '@/lib/goals/runs-store';
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
import { todayIn } from '@/lib/todo/tasks/model';
import { Card } from '@/components/ui/card';
import { FileLinks } from '@/components/files/file-links';
import type { LinkedFile } from '@/lib/files/files';
import { createCoreClient } from '@/lib/core/auth/server';
import { writtenWhen, type Brief } from '@/lib/goals/briefs';
import { loadBrief } from '@/lib/goals/briefs-store';
import { loadFilesOf } from '@/lib/goals/files-store';
import { flagsWaiting } from '@/lib/goals/flags';
import { formatDay } from '@/lib/goals/dates';
import { goalStatus } from '@/lib/goals/goal-status';
import { isCurrent, type GoalReview } from '@/lib/goals/reviews';
import { loadLatestReviews } from '@/lib/goals/reviews-store';
import { goalFindings, goalStages, rhythmSteps } from '@/lib/goals/goal-page';
import { SectionFold } from '@/components/ui/disclosure';
import { goalMatchText } from '@/lib/goals/related-notes';
import { createVaultClient } from '@/lib/vault/auth/server';
import { relatedNotes, toLink } from '@/lib/vault/notes/related';
import { RelatedNotes } from '@/components/vault/related-notes';
import { GoalStatusCard } from './goal-status';
import { GoalFindings, GoalRhythms } from './goal-found';
import { GoalAddRow } from './goal-add-row';
import { GoalAreaMenu } from './goal-area-menu';
import type { Place } from '../move-goal';
import { GoalContext } from './goal-context';
import { GoalFlags } from './goal-flags';
import { GoalHeadingField } from './goal-heading';
import { GoalThread } from './goal-comments';
import { GoalHelp } from './goal-help';
import { GoalLinksSection } from './goal-links';
import { GoalNumber } from './goal-number';
import { GoalFog, GoalShaping } from './goal-shaping';
import { StepTree } from './step-tree';
import { goalViewOf } from '@/lib/goals/plan-rows';
import { DashWork } from './dash-work';
import { dashWork } from '@/lib/goals/dash-work';

export const metadata = { title: 'Goal' };
export const dynamic = 'force-dynamic';

/**
 * One goal (docs/GOALS-SPEC.md, "The daily view"; plans #925 and #1078), read
 * top to bottom: its done-when, Dash's status with a track of the stages, the
 * current stage open and the others folded, its rhythms, what Dash found, and
 * everything that feeds the goal (context, links, help, files, runs,
 * comments) under one Details fold.
 *
 * Up to two of your vault notes on the goal's subject stream in under what
 * Dash found (plan #1114), outside the Details fold, matched on the title and
 * the done-when (lib/goals/related-notes.ts). The lookup is started and not
 * awaited.
 */
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

/** Whether the status is today's. Outside the component because it reads the clock. */
function reviewCurrent(review: GoalReview): boolean {
  return isCurrent(review, Date.now());
}

/** "1 file", "3 comments". */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
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

export default async function GoalMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ goalId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { goalId } = await params;
  // Which of the step views is showing (plan #1157): in the address, so it
  // survives a reload. Open when none is named.
  const view = goalViewOf((await searchParams).view);
  if (!/^[0-9a-f-]{36}$/i.test(goalId)) notFound();

  const user = await requireUser();
  const account = await loadAccountSettings(user.id);
  const today = todayIn(account.timezone);
  const client = await createGoalsClient();
  const learnOn = moduleEnabled(account, 'learn');
  const jobsOn = moduleEnabled(account, 'jobs');
  const learn = learnOn ? await createLearnClient() : null;
  const jobs = jobsOn ? await createJobsClient() : null;
  const [map, readings, numberFrom, sources, links, aims, shaping, history, owner, flags, context] = await Promise.all([
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
  const [stepRuns, filesOf, brief, review, places] = await Promise.all([
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
  const shapingView = shapeable
    ? shapingLines(map.goal.status, map.steps, shaping.approvedAt, history, account.timezone)
    : null;
  // Dash's panel stands above the stages while it has something to approve, a
  // run is going, or every step is finished and the goal needs its next ones;
  // otherwise it is a run line and a button, under Details.
  const shapingUp = Boolean(
    shapingView &&
      (shapingView.approval.approve ||
        shapingView.running ||
        (map.goal.status === 'open' && nothingOpen(map.steps))),
  );
  const shapingPanel = shapingView && (
    <GoalShaping goalId={map.goal.id} {...shapingView} canRun={owner} />
  );
  const shownItems = shownContext(context);
  const thread = map.threads[map.goal.id] ?? [];
  const detailsHint = [
    shownItems.length > 0 && `${shownItems.length} from your other modules`,
    files.length > 0 && plural(files.length, 'file'),
    thread.length > 0 && plural(thread.length, 'comment'),
    !shapingUp && history.runs.length > 0 && plural(history.runs.length, 'run'),
  ]
    .filter(Boolean)
    .join(' · ');

  // As wide as the dev plan (app/dev/plan/page.tsx), which draws the same
  // six-column grid: at max-w-3xl the fixed columns left a step's name about
  // nine rem, and its description wrapped after a few words (note 68fd31b5).
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/goals"
        className="mb-3 inline-flex items-center gap-1.5 text-ui text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden /> {map.areaName}
      </Link>
      <PageHeader
        title={
          errand && map.goal.dueOn ? (
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <GoalHeadingField goalId={map.goal.id} field="title" value={map.goal.title} />
              <span className="tabular font-sans text-ui font-normal tracking-normal whitespace-nowrap text-ink-muted">
                Due {formatDay(map.goal.dueOn)}
              </span>
            </span>
          ) : (
            <GoalHeadingField goalId={map.goal.id} field="title" value={map.goal.title} />
          )
        }
        actions={
          <GoalAreaMenu
            goal={{
              id: map.goal.id,
              title: map.goal.title,
              areaId: map.goal.areaId,
              errand: map.goal.errand ?? false,
              dueOn: map.goal.dueOn ?? null,
            }}
            places={places}
          />
        }
        description={
          <span className="block space-y-0.5">
            <span className="block text-small font-semibold text-ink-muted">Done when</span>
            <GoalHeadingField goalId={map.goal.id} field="acceptance" value={map.goal.acceptance} />
          </span>
        }
      />
      {map.goal.fog && (
        <GoalFog
          goalId={map.goal.id}
          fog={map.goal.fog}
          aside={Boolean(map.goal.fogDismissedAt)}
        />
      )}
      <div className="space-y-6">
        <GoalStatusCard
          status={status}
          brief={brief}
          briefWhen={brief ? noteWhen(brief, account.timezone) : null}
          review={review}
          current={review ? reviewCurrent(review) : false}
          stages={stages}
        />
        <DashWork items={dashWorkOn(map, stepRuns)} />
        {flags.length > 0 && <GoalFlags flags={flags} />}
        {shapingUp && shapingPanel}
        {!numberEmpty && <GoalNumber {...number} />}
        <StepTree
          map={map}
          view={view}
          todoOn={moduleEnabled(account, 'todo')}
          runs={stepRunLines(stepRuns)}
          files={filesOf}
        />
        <GoalRhythms steps={rhythmSteps(map.steps)} records={map.rhythms} />
        <GoalFindings findings={goalFindings(map.steps)} />
        <RelatedNotes notes={related} className="px-1" />
        {/* Everything that feeds the goal rather than being its work: one
            fold, closed on arrival (plan #1078). */}
        <SectionFold title="Details" hint={detailsHint || undefined} defaultOpen={false}>
          <div className="space-y-6">
            {!shapingUp && shapingPanel}
            <GoalContext items={shownItems} />
            {!errand && !helpEmpty && <GoalHelp {...help} />}
            {!linksEmpty && <GoalLinksSection {...linked} />}
            {files.length > 0 && (
              <section aria-labelledby="files-heading" className="space-y-2">
                <h2 id="files-heading" className="px-1 text-ui font-semibold text-ink">
                  Files
                </h2>
                <FileLinks files={files} />
              </section>
            )}
            <GoalAddRow
              number={numberEmpty ? number : null}
              help={!errand && helpEmpty ? help : null}
              links={linksEmpty && canLink ? linked : null}
            />
            {/* The goal's own thread (plan #957). Each step has its own, under its details. */}
            <Card padding="dense">
              <GoalThread
                itemId={map.goal.id}
                thread={thread}
                label="Comment on this goal"
                placeholder="A note on the goal. Tag @dash to ask about it, or to give it figures to file."
              />
            </Card>
          </div>
        </SectionFold>
      </div>
    </div>
  );
}
