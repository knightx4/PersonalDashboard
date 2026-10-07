'use client';

import { useActionState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { TabbedDetail } from '@/components/patterns/tabbed-detail';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { LinkedText } from '@/components/ui/linked-text';
import { StateLabel, TONE_TEXT } from '@/components/dev/state-label';
import { FogNote } from '@/components/dev/fog-note';
import { Thread } from '@/components/thread/thread';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { Dependencies } from '@/components/plan-tree/dependencies';
import { Questions } from '@/components/plan-tree/questions';
import { PLAN_COMMENTS } from '@/components/plan-tree/types';
import { DashCredit } from '@/components/ui/dash-mark';
import { threadRef } from '@/lib/thread/subjects';
import { cn } from '@/lib/cn';
import { PLAN_PRIORITY_LABEL, isClosed } from '@/lib/plan/load';
import { sessionOrigin } from '@/lib/plan/origin';
import type { PlanScope } from '@/lib/plan/projects';
import { flatten, type PlanLiveness, type PlanNode } from '@/lib/plan/tree';
import type { LastRun } from '@/lib/plan/run-end';
import type { RunRaise } from '@/lib/plan/work';
import type { CommitCheck } from '@/lib/plan/checks';
import type { OverhaulProgress } from '@/lib/plan/overhaul-progress';
import type { CriticStopView } from '@/lib/plan/ui-check-stop';
import type { ScreenChangeView } from '@/lib/plan/screen-change';
import { FEATURE_TABS, featureCrumbs, featureHref } from '@/lib/plan/feature-page';
import { TAB_PARAM, tabFrom } from '@/lib/tabs';
import { dismissPlanFog, deletePlanItem, type PlanActionState } from './actions';
import { PlanRow, PLAN_TREE_ACTIONS, usePlanRow } from './plan-row';
import { type PlanCatalogEntry } from './plan-catalog';
import { ASSIGNEE_LABEL, SIZE_LABEL, STATUS_LABEL, scopeLabel } from './step-forms';
import { when } from './plan-run-status';

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
 * Seams for the steps after this one: the Steps tab is the plain tree until
 * #1665 groups it by status, Activity joins `FEATURE_TABS` with #1667, Dash's
 * update goes at the top of Overview with #1666, and the progress split goes
 * at the foot of the properties with #1668.
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
}) {
  const router = useRouter();
  const tab = tabFrom(useSearchParams().get(TAB_PARAM), FEATURE_TABS);
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
    view: 'open',
    searching: false,
    unfolded: false,
    opened: true,
  });
  const { row, health } = parts;
  const node = parts.node as PlanNode;
  const [fogState, fogAction, fogPending] = useActionState(dismissPlanFog, {} as PlanActionState);

  const crumbs = featureCrumbs(node, module, moduleLabel);
  const steps = node.children.filter((child) => child.kind !== 'decision');
  const tabs = FEATURE_TABS.map((t) => (t.id === 'steps' ? { ...t, count: steps.length } : t));
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
          if (!result.error) router.push(crumbs[2].href);
        },
      };
    }
    return item;
  });

  // The step's dated notes, without the stamps the description already
  // says in words: who added it, and the answer that produced it.
  const history = (node.comment ?? '')
    .split('\n')
    .filter(
      (line) =>
        !sessionOrigin(line) &&
        !(parts.origin && line.includes(`#${parts.origin.number}'s answer:`)),
    )
    .join('\n')
    .trim();

  const statusWord = STATUS_LABEL[node.status];
  const properties = (
    <PropertyList>
      <Property
        label="Status"
        value={
          <ActionMenu
            label={`Status of #${node.number} ${node.title}`}
            items={parts.statusMenu}
            align="start"
            triggerClassName="-ml-1.5 h-7 w-auto px-1.5 text-ui font-normal text-ink"
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
      {parts.move && <Property label="Next" value={parts.move} />}
      <Property
        label="Priority"
        value={
          <ActionMenu
            label={`Priority of #${node.number} ${node.title}`}
            items={parts.priorityMenu}
            align="start"
            triggerClassName="-ml-1.5 h-7 w-auto px-1.5 text-ui font-normal text-ink"
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
      <Property label="Module" value={moduleLabel || scopeLabel(node.module)} />
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
    </PropertyList>
  );

  const notices = (parts.confirmNotice || parts.resultNotice) && (
    <div role="status" className="mb-4 space-y-1.5 text-small">
      {parts.confirmNotice}
      {parts.resultNotice}
    </div>
  );

  return (
    <TabbedDetail
      crumbs={crumbs}
      title={node.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 text-small">
          <span>Feature #{node.number}</span>
          {parts.addedBy && (
            <span title={parts.addedBy.session ? `Session ${parts.addedBy.session}` : undefined}>
              <DashCredit />
              Added by Dash on {parts.addedBy.date}
            </span>
          )}
          {parts.origin && (
            <span>
              From #{parts.origin.number}&apos;s answer: {parts.origin.gist}
            </span>
          )}
        </span>
      }
      actions={
        <>
          {parts.sendButton}
          <ActionMenu label={`Actions for #${node.number}`} items={menu} />
        </>
      }
      properties={properties}
      tabs={tabs}
      label="Feature"
      className="gap-y-2 lg:gap-y-0"
    >
      {notices}
      {tab === 'steps' ? (
        <FeatureSteps
          node={node}
          steps={steps}
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
          }}
        />
      ) : row.editing ? (
        <div className="max-w-2xl">{parts.edit}</div>
      ) : (
        <div className="max-w-2xl space-y-5">
          {node.fog && node.fogDismissedAt === null && (
            <FogNote
              id={node.id}
              fog={node.fog}
              aside={false}
              action={fogAction}
              pending={fogPending}
              error={fogState.error}
            />
          )}
          {node.detail && node.kind !== 'decision' && (
            <p className="whitespace-pre-wrap text-body text-ink">
              <LinkedText text={node.detail} />
            </p>
          )}
          {node.acceptance && (
            <Section label="Done when">
              <p className="whitespace-pre-wrap text-ui text-ink">
                <LinkedText text={node.acceptance} />
              </p>
            </Section>
          )}
          {node.blockAsk && (
            <Section label="Needs">
              <p className="whitespace-pre-wrap text-ui text-ink">
                <LinkedText text={node.blockAsk} />
              </p>
            </Section>
          )}
          {parts.body}
          <Questions node={node} titles={parts.refTitles} actions={PLAN_TREE_ACTIONS} />
          <Dependencies
            node={node}
            catalog={catalog}
            groupOf={(entry) => scopeLabel(entry.module)}
            actions={PLAN_TREE_ACTIONS}
            closed={parts.closed}
          />
          {history && (
            <Section label="History">
              <p className="whitespace-pre-wrap text-ui text-ink-muted">
                <LinkedText text={history} />
              </p>
            </Section>
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

/** A labelled part of the Overview, headed the way the row's panel heads its parts. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-small font-semibold uppercase tracking-wide text-ink-muted">{label}</h2>
      {children}
    </section>
  );
}

/**
 * The Steps tab: the feature's steps as the plan's tree, every level
 * unfolded, so a step's number lands on its row. #1665 groups these by
 * status and keeps this tree one press away.
 */
function FeatureSteps({
  node,
  steps,
  addChildLabel,
  adding,
  addForm,
  onAdd,
  rowProps,
}: {
  node: PlanNode;
  steps: readonly PlanNode[];
  addChildLabel: string;
  adding: boolean;
  addForm: React.ReactNode;
  onAdd: () => void;
  rowProps: Omit<
    React.ComponentProps<typeof PlanRow>,
    'node' | 'trail' | 'view' | 'searching' | 'unfolded'
  >;
}) {
  return (
    <div className="space-y-3">
      {steps.length > 0 ? (
        <ul
          className={cn(
            cardVariants({ padding: 'none' }),
            // A finished row is not dimmed here: the plan dims one to 70%,
            // which took its #number below 3:1 on a phone, and on a feature's
            // own page its Done word already says it is finished.
            'divide-y divide-border overflow-hidden [&>li]:opacity-100',
          )}
        >
          <ColumnHeader />
          {steps.map((step) => (
            <PlanRow
              key={step.id}
              {...rowProps}
              node={step}
              trail={[]}
              asStep
              inlinePriority
              view="open"
              searching={false}
              unfolded
            />
          ))}
        </ul>
      ) : (
        !adding && <p className="text-ui text-ink-muted">No steps under this feature yet.</p>
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
