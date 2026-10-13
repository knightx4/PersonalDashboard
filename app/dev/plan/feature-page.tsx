'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { BurnUpChart } from '@/components/ui/burn-up-chart';
import type { ScopeDay } from '@/lib/goals/scope-days';
import { DetailCard, DetailPart, TabbedDetail } from '@/components/patterns/tabbed-detail';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkedText } from '@/components/ui/linked-text';
import { StateLabel, TONE_TEXT } from '@/components/dev/state-label';
import { Thread } from '@/components/thread/thread';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { ViewChips } from '@/components/plan-tree/view-chips';
import { planRowId } from '@/lib/comments/refs';
import { Dependencies } from '@/components/plan-tree/dependencies';
import { Questions } from '@/components/plan-tree/questions';
import { PLAN_COMMENTS, outlinesOf } from '@/components/plan-tree/types';
import { readableRefs, stepRef } from '@/lib/plan/ref';
import { DashCredit } from '@/components/ui/dash-mark';
import { threadRef } from '@/lib/thread/subjects';
import { cn } from '@/lib/cn';
import { isModuleId } from '@/lib/modules';
import { PLAN_PRIORITY_LABEL, isClosed } from '@/lib/plan/load';
import type { PlanScope } from '@/lib/plan/projects';
import { flatten, type PlanLiveness, type PlanNode } from '@/lib/plan/tree';
import type { LastRun } from '@/lib/plan/run-end';
import type { RunRaise } from '@/lib/plan/work';
import type { CommitCheck } from '@/lib/plan/checks';
import type { OverhaulProgress } from '@/lib/plan/overhaul-progress';
import type { CriticStopView } from '@/lib/plan/ui-check-stop';
import type { ScreenChangeView } from '@/lib/plan/screen-change';
import type { PlanPicture } from '@/lib/plan/pictures';
import {
  FEATURE_TABS,
  STEPS_VIEWS,
  STEPS_VIEW_PARAM,
  asListed,
  featureCrumbs,
  featureHref,
  featureStatus,
  MOVE_LABEL,
  stepGroups,
  stepsViewFrom,
  stepsViewHref,
  type GroupedStep,
  type StepGroup,
  type StepsView,
} from '@/lib/plan/feature-page';
import {
  HELD_PARAM,
  heldFrom,
  heldHref,
  progressSplit,
  stepsHeldBy,
  type HeldBy,
} from '@/lib/plan/split';
import { TAB_PARAM, tabFrom } from '@/lib/tabs';
import { deletePlanItem, type PlanActionState } from './actions';
import { PlanRow, PLAN_TREE_ACTIONS, usePlanRow } from './plan-row';
import { type PlanCatalogEntry } from './plan-catalog';
import { ASSIGNEE_LABEL, SIZE_LABEL, STATUS_LABEL, scopeLabel } from './step-forms';
import { when } from './plan-run-status';
import { FeatureUpdate, UpdateOverdue } from './feature-update';
import { FeatureActivity } from './feature-activity';
import { FeatureCompose } from './feature-compose';
import type { PlanUpdate } from '@/lib/plan/updates';
import type { PlacedCheckBack } from '@/lib/plan/check-backs';
import { useClockNow } from '@/lib/use-clock-now';
import { CheckBacksPanel } from '../raised/check-backs-panel';
import { featureActivity, type ActivityDashAction, type ActivityRun } from '@/lib/plan/activity';

/**
 * A feature's own page, /dev/plan/<number> (plan #1664), in the tabbed
 * detail pattern: Dev › Plan › the module › the feature, then Overview and
 * Steps, with its properties in a column beside them.
 *
 * Everything the feature's row on /dev/plan can do is here too, because the
 * presses come from the same place: `usePlanRow` works out the row's menus,
 * action states and panel parts once, and this page lays them out instead of
 * the row. Status and priority are menus on their properties, Send and the
 * row's menu (Mine, send all beneath, re-shape, add a step, edit, move,
 * delete) sit in the header, and the panel the row opens to is the Overview
 * tab.
 *
 * Activity (#1667) lists what happened to the feature and its rows, every
 * update among them; the latest update also heads Overview (#1666). The
 * progress split goes at the foot of the properties with #1668.
 */
export function FeaturePage({
  feature,
  module,
  moduleLabel,
  catalog,
  canSend,
  lastRuns,
  runRaises,
  liveness,
  commitChecks,
  overhaulProgress,
  criticStops,
  screenChanges,
  pictures,
  updates = [],
  overdueDays = null,
  activity,
  comingBack = [],
  startEditing = false,
  scopeDays = [],
}: {
  feature: PlanNode;
  module: PlanScope | null;
  moduleLabel: string;
  catalog: readonly PlanCatalogEntry[];
  canSend: boolean;
  lastRuns: Readonly<Record<string, LastRun>>;
  runRaises?: readonly RunRaise[];
  liveness?: PlanLiveness;
  commitChecks: Readonly<Record<string, CommitCheck>>;
  overhaulProgress?: Readonly<Record<string, OverhaulProgress>>;
  criticStops?: Readonly<Record<string, CriticStopView>>;
  screenChanges?: Readonly<Record<number, readonly ScreenChangeView[]>>;
  /** The drawn options on each row, by plan item id (migration 0189). */
  pictures?: Readonly<Record<string, readonly PlanPicture[]>>;
  /** Dash's updates on the feature, newest first (plan #1666). */
  updates?: readonly PlanUpdate[];
  /** Days since its last update when it is moving and a week overdue for one (plan #1834). */
  overdueDays?: number | null;
  /** What the Activity tab reads beyond the plan (plan #1667). */
  activity?: {
    blockedAt: Readonly<Record<string, string>>;
    runs: readonly ActivityRun[];
    actions: readonly ActivityDashAction[];
  };
  /**
   * What Dash has said it will come back to on the feature or a row beneath
   * it, each with that row. Listed on the Steps tab, linked to the row.
   */
  comingBack?: readonly PlacedCheckBack[];
  /** Open with the compose surface already showing, for the gallery. The page leaves it off. */
  startEditing?: boolean;
  /** The saved step counts, oldest first; the Overview draws them from three days (plan #1837). */
  scopeDays?: readonly ScopeDay[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const tab = tabFrom(search.get(TAB_PARAM), FEATURE_TABS);
  const stepsView = stepsViewFrom(search.get(STEPS_VIEW_PARAM));
  const held = heldFrom(search.get(HELD_PARAM));
  const parts = usePlanRow({
    node: feature,
    trail: [],
    catalog,
    canSend,
    lastRuns,
    runRaises,
    liveness,
    commitChecks,
    overhaulProgress,
    criticStops,
    screenChanges,
    pictures,
    view: 'open',
    searching: false,
    unfolded: false,
    opened: true,
    moveAfter: true,
  });
  const { row, health } = parts;
  const { setEditing } = row;
  useEffect(() => {
    if (startEditing) setEditing(true);
  }, [startEditing, setEditing]);
  const node = parts.node as PlanNode;
  // Every step's outline, so stored text naming a step `#1084` reads as the
  // `#1073.4` its row heads itself with.
  const outlines = useMemo(() => outlinesOf(parts.refTitles), [parts.refTitles]);
  const readable = (text: string) => readableRefs(text, outlines);
  const ref = stepRef(node);

  const crumbs = featureCrumbs(node, module, moduleLabel);
  const steps = node.children.filter((child) => child.kind !== 'decision');
  const split = progressSplit(node);
  // The count says what it holds: open steps, so it does not read as the total.
  const tabs = FEATURE_TABS.map((t) =>
    t.id === 'steps' && split.open > 0 ? { ...t, label: `Steps · ${split.open} open` } : t,
  );
  // Where the page's own address is, for the presses that need a tab.
  const overview = featureHref(node.number);
  const stepsTab = `${overview}?${TAB_PARAM}=steps`;

  // The row's menu, with the three presses that mean something else on a
  // page: Edit opens the form on Overview, adding a step opens the form on
  // Steps, and a deleted feature has no page to stay on.
  // Every open step beneath the feature, which "Send all beneath" hands over
  // in one press, as the row's opened panel offers it.
  const openBeneath = flatten([node]).filter(
    (step) => step.id !== node.id && !isClosed(step.status) && step.status !== 'proposed',
  ).length;
  const batch: ActionMenuItem[] =
    openBeneath > 0 && !parts.closed && node.track !== 'overhaul'
      ? [
          {
            id: 'batch',
            label: `Send all ${openBeneath} beneath`,
            formAction: (formData: FormData) => parts.batchAction(formData),
            formFields: { id: node.id },
          },
        ]
      : [];
  const rowMenu = parts.sendButton ? parts.menu.filter((item) => item.id !== 'send') : parts.menu;
  const withBatch = rowMenu.flatMap((item) => (item.id === 'assign' ? [item, ...batch] : [item]));
  const menu: ActionMenuItem[] = withBatch.map((item) => {
    if (item.id === 'edit') {
      return {
        ...item,
        onSelect: () => {
          row.setEditing(true);
          if (tab !== 'overview') router.push(overview, { scroll: false });
        },
      };
    }
    if (item.id === 'add-child') {
      return {
        ...item,
        onSelect: () => {
          row.setAddingChild(true);
          if (tab !== 'steps') router.push(stepsTab, { scroll: false });
        },
      };
    }
    if (item.id === 'delete') {
      return {
        ...item,
        formAction: async (formData: FormData) => {
          const result = await deletePlanItem({}, formData);
          // The crumb before the feature's own: the module, or the plan.
          if (!result.error) router.push(crumbs[crumbs.length - 2].href);
        },
      };
    }
    return item;
  });

  const statusWord = STATUS_LABEL[featureStatus(node)];
  // Status, health and progress are read first: one row on a phone, with the
  // rest under "All details", so the tabs are on the first screen (plan #1688).
  const glance = (
    <>
      <Property
        label="Status"
        value={
          <ActionMenu
            label={`Status of ${ref} ${node.title}`}
            items={parts.statusMenu}
            align="start"
            // Pulled up by the room the press target adds, so its word sits on
            // the same line as Health's and Progress's beside it.
            triggerClassName="-my-1 -ml-1.5 h-7 w-auto px-1.5 text-ui font-normal text-ink"
            trigger={<span>{statusWord}</span>}
          />
        }
      />
      {/* The health is the status read against the steps beneath and what
          they wait on. Said only when it adds to the status. */}
      {health.word !== statusWord && (
        <Property
          label="Health"
          hint={health.title}
          value={
            <StateLabel
              glyph={health.glyph}
              word={health.word}
              tone={health.tone}
              className={cn('text-ui', TONE_TEXT[health.tone])}
            />
          }
        />
      )}
      {split.scope > 0 && (
        <Property
          label="Progress"
          hint="Steps and substeps beneath the feature, questions and setup jobs included, not dropped."
          value={`${split.done} of ${split.scope} done`}
        />
      )}
    </>
  );
  // The facts below, counted for the closed fold on a phone: whose move,
  // priority, size, held by, module, the dates, the commit and the split.
  const detailCount = [
    Boolean(parts.move),
    true,
    Boolean(node.size),
    true,
    true,
    Boolean(when(node.startedAt)),
    Boolean(when(node.completedAt)),
    Boolean(node.commitSha),
    split.open > 0,
    split.open > 0,
  ].filter(Boolean).length;
  const properties = (
    <PropertyList>
      {parts.move && <Property label={MOVE_LABEL} value={parts.move} />}
      <Property
        label="Priority"
        value={
          <ActionMenu
            label={`Priority of ${ref} ${node.title}`}
            items={parts.priorityMenu}
            align="start"
            // Pulled up as Status is, so the gap above it matches the others.
            triggerClassName="-my-1 -ml-1.5 h-7 w-auto px-1.5 text-ui font-normal text-ink"
            trigger={<span>{PLAN_PRIORITY_LABEL[node.priority]}</span>}
          />
        }
      />
      {node.size && <Property label="Size" value={SIZE_LABEL[node.size]} />}
      <Property
        label="Held by"
        hint={
          node.assignee === 'me'
            ? 'Yours. The runner will not take it.'
            : 'The runner takes it unless you mark it yours.'
        }
        value={node.assignee ? ASSIGNEE_LABEL[node.assignee] : 'Dash'}
      />
      <Property
        label="Module"
        value={
          // A workspace has a page of its own in Dev (/dev/modules); a
          // project's page is the crumb above the title.
          module && isModuleId(module) ? (
            <Link href={`/dev/modules/${module}`} className={cn('press-area', linkVariants())}>
              {moduleLabel || scopeLabel(node.module)}
            </Link>
          ) : (
            moduleLabel || scopeLabel(node.module)
          )
        }
      />
      {when(node.startedAt) && <Property label="Started" value={when(node.startedAt)} />}
      {when(node.completedAt) && (
        <Property
          label={node.status === 'dropped' ? 'Dropped' : 'Finished'}
          value={when(node.completedAt)}
        />
      )}
      {node.commitSha && (
        <Property label="Commit" value={<span className="font-mono">{node.commitSha}</span>} />
      )}
      {split.open > 0 && (
        <>
          <Property
            label="Yours"
            hint="Open steps marked yours, with every question and setup job. Shows them on the Steps tab."
            value={<SplitLink href={heldHref(overview, 'me')} count={split.me} who="me" />}
          />
          <Property
            label="Dash’s"
            hint="Open steps nobody has marked yours. Shows them on the Steps tab."
            value={<SplitLink href={heldHref(overview, 'dash')} count={split.dash} who="dash" />}
          />
        </>
      )}
    </PropertyList>
  );

  const editingHere = row.editing && tab === 'overview';

  const notices = (parts.confirmNotice || parts.resultNotice) && (
    <div role="status" className="mb-4 space-y-1.5 text-small">
      {parts.confirmNotice}
      {parts.resultNotice}
    </div>
  );

  return (
    <TabbedDetail
      crumbs={crumbs}
      // While the compose surface is open the title and summary are its
      // first two fields, so the header names what is being edited instead
      // of showing them twice.
      title={editingHere ? `Editing ${ref}` : node.title}
      description={
        editingHere ? undefined : (
          <>
            {/* The facts about where it came from. The one line it was written
                with (plan #1670) opens the Overview's card instead, since a
                sentence on the page background is bare text (plan #1686). */}
            {/* The number and who added it each keep to one line and wrap
                between them, so a date never breaks in two (plan #1688). */}
            <span className="inline-flex flex-wrap items-center gap-x-2 text-small">
              <span className="whitespace-nowrap">Feature {ref}</span>
              {parts.addedBy && (
                <span
                  className="whitespace-nowrap"
                  title={parts.addedBy.session ? `Session ${parts.addedBy.session}` : undefined}
                >
                  <DashCredit />
                  Added by Dash on {parts.addedBy.date}
                </span>
              )}
              {parts.origin && (
                <span>
                  From {parts.origin.ref}&apos;s answer: {readable(parts.origin.gist)}
                </span>
              )}
            </span>
          </>
        )
      }
      actions={
        <>
          {parts.sendButton}
          <ActionMenu label={`Actions for ${ref}`} items={menu} />
        </>
      }
      glance={glance}
      detailCount={detailCount}
      properties={properties}
      tabs={tabs}
      label="Feature"
      className="gap-y-2 lg:grid-rows-[auto_1fr] lg:gap-y-0"
    >
      {notices}
      {tab === 'activity' ? (
        <FeatureActivity entries={featureActivity(node, { ...activity, updates, outlines })} />
      ) : tab === 'steps' ? (
        <FeatureSteps
          node={node}
          comingBack={comingBack}
          steps={steps}
          view={stepsView}
          held={held}
          liveness={liveness}
          addChildLabel={parts.addChildLabel}
          adding={row.addingChild}
          addForm={parts.addChild}
          onAdd={() => row.setAddingChild(true)}
          rowProps={{
            catalog,
            canSend,
            lastRuns,
            runRaises,
            liveness,
            commitChecks,
            overhaulProgress,
            criticStops,
            screenChanges,
            pictures,
          }}
        />
      ) : row.editing ? (
        // The compose surface it can be written in from /dev/plan, filled in
        // (plan #1670). The note and the commit stay on the row's own
        // Edit on /dev/plan, which is the whole row at once.
        <FeatureCompose node={node} onDone={() => row.setEditing(false)} />
      ) : (
        // As wide as the tabs, as Steps and Activity are (plan #1688).
        <div className="space-y-5">
          {overdueDays !== null && <UpdateOverdue days={overdueDays} />}
          {updates[0] && <FeatureUpdate update={updates[0]} earlier={updates[1]} />}
          {/* The summary, the feature's own words, what it is done
              when, what it needs and what it waits on, on one card (plan
              #1686): none of it sits bare on the page. */}
          <DetailCard>
            {node.summary && <p className="text-body font-medium text-ink">{node.summary}</p>}
            {node.detail && node.kind !== 'decision' && (
              <DetailPart>
                <p className="whitespace-pre-wrap text-body text-ink">
                  <LinkedText text={readable(node.detail)} />
                </p>
              </DetailPart>
            )}
            {node.acceptance && (
              <DetailPart label="Done when">
                <p className="whitespace-pre-wrap text-ui text-ink">
                  <LinkedText text={readable(node.acceptance)} />
                </p>
              </DetailPart>
            )}
            {node.blockAsk && (
              <DetailPart label="Needs">
                <p className="whitespace-pre-wrap text-ui text-ink">
                  <LinkedText text={readable(node.blockAsk)} />
                </p>
              </DetailPart>
            )}
            <Dependencies
              node={node}
              catalog={catalog}
              groupOf={(entry) => scopeLabel(entry.module)}
              actions={PLAN_TREE_ACTIONS}
              closed={parts.closed}
            />
          </DetailCard>
          <BurnUpChart days={scopeDays} />
          {parts.body}
          {/* Questions draws nothing for a closed feature that never asked
              one, and then neither does its card. */}
          {(!parts.closed || node.children.some((child) => child.kind === 'decision')) && (
            <div className={cardVariants({ padding: 'standard' })}>
              <Questions node={node} titles={parts.refTitles} actions={PLAN_TREE_ACTIONS} />
            </div>
          )}
          {/* On a card of its own: the thread's usual well is the canvas,
              which is the page's own ground here and vanished in dark. */}
          <div className={cardVariants({ padding: 'dense' })}>
            <Thread
              subject={threadRef(PLAN_COMMENTS.target, node.id)}
              turns={node.thread}
              titles={parts.refTitles}
              onCard
              placeholder="A note on this feature. Tag @dash to ask something, or to tell it to reword the feature, file an idea or build it."
            />
          </div>
        </div>
      )}
    </TabbedDetail>
  );
}

/**
 * The Steps tab. By default the feature's steps and substeps in status groups
 * (plan #1665), each listed once, in one card with a heading row per group,
 * after Linear's project page: blocked, in progress, ready and not started
 * open, done and dropped folded. A substep says which step it sits under on
 * a line below its title, since no tree is drawn to say it. "Tree" swaps the
 * groups for the plan's own tree, every level unfolded.
 *
 * Every row keeps its `plan-<number>` anchor, so a link to a step lands on
 * it in either view; a folded group holding the step it names opens itself.
 */
function FeatureSteps({
  node,
  comingBack,
  steps,
  view,
  held,
  liveness,
  addChildLabel,
  adding,
  addForm,
  onAdd,
  rowProps,
}: {
  node: PlanNode;
  comingBack: readonly PlacedCheckBack[];
  steps: readonly PlanNode[];
  view: StepsView;
  held: HeldBy | null;
  liveness?: PlanLiveness;
  addChildLabel: string;
  adding: boolean;
  addForm: React.ReactNode;
  onAdd: () => void;
  rowProps: Omit<
    React.ComponentProps<typeof PlanRow>,
    'node' | 'trail' | 'view' | 'searching' | 'unfolded'
  >;
}) {
  const heldIds = held ? new Set(stepsHeldBy(node, held).map((step) => step.id)) : undefined;
  const groups = stepGroups(node, liveness, heldIds);
  const row = (step: PlanNode, extra: Partial<React.ComponentProps<typeof PlanRow>> = {}) => (
    <PlanRow
      key={step.id}
      {...rowProps}
      node={step}
      trail={[]}
      asStep
      moveAfter
      view="open"
      searching={false}
      unfolded
      {...extra}
    />
  );
  const now = useClockNow();
  return (
    <div className="space-y-3">
      {/* What Dash will come back to on these steps, above them and linked to
          each one's row, so a step waiting on a check is not only on the
          Dash tab. A done step's row is in its folded group, which opens
          when the link names it. */}
      <CheckBacksPanel
        rows={comingBack}
        now={now}
        hrefOf={(step) =>
          step.id === node.id ? featureHref(node.number) : `#${planRowId(step.number)}`
        }
      />
      {steps.length > 0 ? (
        <>
          {held ? (
            <p className="flex flex-wrap items-center gap-x-3 text-ui text-ink-muted">
              <span>
                {held === 'me' ? 'Your' : 'Dash’s'} open steps: {heldIds?.size ?? 0}
              </span>
              <Link
                href={stepsViewHref(node.number, view)}
                scroll={false}
                className={cn('press-area', linkVariants())}
              >
                Show all steps
              </Link>
            </p>
          ) : (
            <ViewChips
              view={view}
              chips={STEPS_VIEWS}
              labels={STEPS_VIEW_LABEL}
              hrefOf={(candidate) => stepsViewHref(node.number, candidate)}
              scroll={false}
            />
          )}
          <ul
            className={cn(
              cardVariants({ padding: 'none' }),
              // A finished row is not dimmed here: the plan dims one to 70%,
              // which took its #number below 3:1 on a phone, and on a feature's
              // own page its Done word already says it is finished.
              'divide-y divide-border overflow-hidden [&>li]:opacity-100',
            )}
          >
            <ColumnHeader status={MOVE_LABEL} priority="Size" />
            {view === 'tree' && !held
              ? steps.map((step) => row(step))
              : groups.map((group) => (
                  <StepGroupRows key={group.id} group={group}>
                    {group.steps.map(({ node: step, parent, after }) =>
                      row(asListed(step), { source: stepSource(parent, after) }),
                    )}
                  </StepGroupRows>
                ))}
          </ul>
        </>
      ) : (
        !adding && <EmptyState size="inline" title="No steps under this feature yet." />
      )}
      {adding ? (
        <div className={cn(cardVariants({ padding: 'dense' }))}>{addForm}</div>
      ) : (
        !isClosed(node.status) && (
          <Button type="button" size="sm" variant="ghost" className="-ml-2.5" onClick={onAdd}>
            <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
            {addChildLabel}
          </Button>
        )
      )}
    </div>
  );
}

/**
 * The line under a grouped step's title: the step it sits under, when it is a
 * substep, and the step it waits on, when it is listed beneath that one. Text
 * only, since the title is a button; the Whose move column's "After #…" is
 * the link to that step.
 */
function stepSource(
  parent: GroupedStep['parent'],
  after: GroupedStep['after'],
): string | undefined {
  const lines = [
    parent && `Under #${parent.outline} ${parent.title}`,
    after && `After #${after.outline} ${after.title}`,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join(' · ') : undefined;
}

/** A count in the properties that opens the Steps tab on just those steps. */
function SplitLink({ href, count, who }: { href: string; count: number; who: HeldBy }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={`${count} open ${count === 1 ? 'step' : 'steps'} ${who === 'me' ? 'yours' : 'Dash’s'}, show them`}
      className={cn('-mx-1.5 inline-flex min-h-7 items-center max-sm:min-h-11 rounded-control px-1.5 hover:bg-sunken', linkVariants())}
    >
      {count} open
    </Link>
  );
}

const STEPS_VIEW_LABEL: Record<StepsView, string> = { status: 'By status', tree: 'Tree' };

/**
 * One status group: a heading row with its count, then its rows. The
 * heading folds the group; done and dropped start folded, and a folded group
 * opens by itself when the address names one of its steps.
 */
function StepGroupRows({ group, children }: { group: StepGroup; children: React.ReactNode }) {
  const [open, setOpen] = useState(!group.folded);
  const anchors = group.steps.map(({ node }) => planRowId(node.number)).join(' ');
  useEffect(() => {
    if (!group.folded) return;
    const named = () => {
      const hash = window.location.hash.slice(1);
      if (!anchors.split(' ').includes(hash)) return;
      setOpen(true);
      // The browser looked for the row before the group was open to hold it.
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    };
    named();
    window.addEventListener('hashchange', named);
    return () => window.removeEventListener('hashchange', named);
  }, [group.folded, anchors]);
  const heading = (
    <>
      <span>{group.label}</span>
      <span className="tabular font-normal text-ink-muted">{group.steps.length}</span>
    </>
  );
  return (
    <>
      {/* Every heading folds, so the six names share one edge, after the
          arrow, in line with the step numbers beneath them. */}
      <li className="bg-sunken px-3 py-1.5 text-small font-semibold text-ink">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="press press-area inline-flex items-center gap-1.5"
        >
          <ChevronRight
            className={cn('size-3.5 text-ink-muted transition-transform', open && 'rotate-90')}
            strokeWidth={1.75}
            aria-hidden
          />
          {heading}
        </button>
      </li>
      {open && children}
    </>
  );
}
