import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import { TabbedDetail } from '@/components/patterns/tabbed-detail';
import { CardSection, cardVariants } from '@/components/ui/card';
import { LinkedText } from '@/components/ui/linked-text';
import { ModuleMark } from '@/components/ui/module-mark';
import { cn } from '@/lib/cn';
import {
  OVERVIEW_LIMIT,
  counted,
  moduleCrumbs,
  moduleHref,
  uiLine,
  type ModuleSummary,
  type ModuleTab,
} from '@/lib/dev/module-page';
import { FEEDBACK_KIND_LABEL, type FeedbackRow } from '@/lib/feedback/load';
import type { IdeaRow } from '@/lib/ideas/load';
import { formatMicroDollars } from '@/lib/money';
import { featureHref } from '@/lib/plan/feature-page';
import { PLAN_STATUS_LABEL, type PlanItem } from '@/lib/plan/load';
import { visionAnchor } from '@/lib/specs/vision';
import type { Tab } from '@/lib/tabs';
import { openedText } from '@/lib/usage/report';

/**
 * The module index and one module's page in Dev. Server components, so the
 * page and the gallery draw them from the same summary.
 */

// ---- The index -------------------------------------------------------------

function indexLine(summary: ModuleSummary): string {
  return [
    counted(summary.features.length, 'open feature'),
    counted(summary.bugs.length, 'bug'),
    counted(summary.ideas.length, 'idea'),
    uiLine(summary.ui),
  ].join(' · ');
}

export function ModulesIndexView({ summaries }: { summaries: readonly ModuleSummary[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        crumbs={moduleCrumbs()}
        title="Modules"
        description="Each workspace on its own page: its plan, its bugs and ideas, its spec, its UI review and how much it is used."
      />
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {summaries.map((summary) => (
          <li key={summary.module.id}>
            <Link
              href={moduleHref(summary.module.id)}
              className="press flex items-center gap-3 px-4 py-3 transition-colors duration-quick hover:bg-sunken"
            >
              <ModuleMark module={summary.module.id} />
              <span className="min-w-0">
                <span className="block text-body font-semibold text-ink">{summary.module.label}</span>
                <span className="block text-small text-ink-muted">{indexLine(summary)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- One module ------------------------------------------------------------

/** The tabs, each with the count of what is waiting under it. */
export function moduleTabs(summary: ModuleSummary): Tab[] {
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'plan', label: 'Plan', count: summary.features.length },
    { id: 'bugs', label: 'Bugs', count: summary.bugs.length },
    { id: 'ideas', label: 'Ideas', count: summary.ideas.length },
    { id: 'spec', label: 'Spec' },
    { id: 'ui', label: 'UI', count: summary.ui?.openFindings.length ?? 0 },
    { id: 'usage', label: 'Usage' },
    { id: 'changelog', label: 'Changelog' },
  ];
}

function tabHref(summary: ModuleSummary, tab: ModuleTab): string {
  return `${moduleHref(summary.module.id)}?tab=${tab}`;
}

const rowLink = 'press-area text-body text-ink underline-offset-2 hover:underline';
const moreLink = 'press-area text-small text-accent hover:underline';
const list = cn(cardVariants(), 'divide-y divide-border overflow-hidden');

/**
 * A list of rows: a card of its own on a tab, and flat inside the Overview's
 * sections, which are cards already.
 */
function Rows({ children, flat = false }: { children: React.ReactNode; flat?: boolean }) {
  return <ul className={flat ? 'divide-y divide-border' : list}>{children}</ul>;
}

function Row({
  children,
  meta,
  flat = false,
}: {
  children: React.ReactNode;
  meta: React.ReactNode;
  flat?: boolean;
}) {
  return (
    <li className={cn('flex flex-col gap-0.5 py-3', flat ? 'first:pt-1 last:pb-0' : 'px-4')}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      <span className="text-small text-ink-muted">{meta}</span>
    </li>
  );
}

/** A list with nothing in it, said in a sentence rather than left blank. */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-body text-ink-muted">{children}</p>;
}

function FeatureRows({ items, flat }: { items: readonly PlanItem[]; flat?: boolean }) {
  return (
    <Rows flat={flat}>
      {items.map((item) => (
        <Row flat={flat} key={item.id} meta={`#${item.number} · ${PLAN_STATUS_LABEL[item.status]}`}>
          <Link href={featureHref(item.number)} className={rowLink}>
            {item.title}
          </Link>
        </Row>
      ))}
    </Rows>
  );
}

/** The first line of a note, which is what it is about. */
function firstLine(body: string): string {
  return body.split('\n').find((line) => line.trim())?.trim() ?? body;
}

function BugRows({ rows, flat }: { rows: readonly FeedbackRow[]; flat?: boolean }) {
  return (
    <Rows flat={flat}>
      {rows.map((row) => (
        <Row
          flat={flat}
          key={row.id}
          meta={[FEEDBACK_KIND_LABEL[row.kind], row.pagePath, row.createdAt.slice(0, 10)]
            .filter(Boolean)
            .join(' · ')}
        >
          <Link href={`/dev/bugs#note-${row.id}`} className={rowLink}>
            {firstLine(row.body)}
          </Link>
        </Row>
      ))}
    </Rows>
  );
}

function IdeaRows({ ideas, flat }: { ideas: readonly IdeaRow[]; flat?: boolean }) {
  return (
    <Rows flat={flat}>
      {ideas.map((idea) => (
        <Row
          flat={flat}
          key={idea.id}
          meta={`${idea.source === 'me' ? 'Yours' : 'Suggested by Dash'} · ${idea.createdAt.slice(0, 10)}`}
        >
          <Link href={`/dev/ideas#idea-${idea.id}`} className={rowLink}>
            {firstLine(idea.body)}
          </Link>
        </Row>
      ))}
    </Rows>
  );
}

function ShippedRows({ items, flat }: { items: readonly PlanItem[]; flat?: boolean }) {
  return (
    <Rows flat={flat}>
      {items.map((item) => (
        <Row
          flat={flat}
          key={item.id}
          meta={`#${item.number}${item.completedAt ? ` · ${item.completedAt.slice(0, 10)}` : ''}`}
        >
          <Link href={featureHref(item.number)} className={rowLink}>
            {item.title}
          </Link>
        </Row>
      ))}
    </Rows>
  );
}

/** A list cut to the Overview's length, with a link to the tab holding all of it. */
function Preview({
  summary,
  title,
  tab,
  total,
  empty,
  children,
}: {
  summary: ModuleSummary;
  title: string;
  tab: ModuleTab;
  total: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <CardSection
      title={title}
      meta={total > 0 ? total : undefined}
      action={
        total > OVERVIEW_LIMIT ? (
          <Link href={tabHref(summary, tab)} className={moreLink}>
            All {total}
          </Link>
        ) : undefined
      }
    >
      {total > 0 ? children : <Nothing>{empty}</Nothing>}
    </CardSection>
  );
}

function Overview({ summary }: { summary: ModuleSummary }) {
  const cut = <T,>(rows: readonly T[]) => rows.slice(0, OVERVIEW_LIMIT);
  return (
    <div className="space-y-4">
      {summary.vision && (
        <CardSection title="Vision">
          <p className="whitespace-pre-wrap text-body text-ink">
            <LinkedText text={summary.vision} />
          </p>
        </CardSection>
      )}
      <Preview
        summary={summary}
        title="Plan"
        tab="plan"
        total={summary.features.length}
        empty="No open features."
      >
        <FeatureRows items={cut(summary.features)} flat />
      </Preview>
      <Preview
        summary={summary}
        title="Bugs and requests"
        tab="bugs"
        total={summary.bugs.length}
        empty="Nothing outstanding was filed from this workspace."
      >
        <BugRows rows={cut(summary.bugs)} flat />
      </Preview>
      <Preview
        summary={summary}
        title="Ideas"
        tab="ideas"
        total={summary.ideas.length}
        empty="No live ideas for this workspace."
      >
        <IdeaRows ideas={cut(summary.ideas)} flat />
      </Preview>
      <Preview
        summary={summary}
        title="Shipped lately"
        tab="changelog"
        total={summary.shipped.length}
        empty="Nothing has shipped here yet."
      >
        <ShippedRows items={cut(summary.shipped)} flat />
      </Preview>
    </div>
  );
}

function SpecTab({ summary }: { summary: ModuleSummary }) {
  const id = summary.module.id;
  return (
    <div className="space-y-4">
      <CardSection
        title="Vision"
        action={
          <Link href={`/dev/specs#${visionAnchor(id)}`} className={moreLink}>
            Edit in Specs
          </Link>
        }
      >
        {summary.vision ? (
          <p className="whitespace-pre-wrap text-body text-ink">
            <LinkedText text={summary.vision} />
          </p>
        ) : (
          <Nothing>No vision written for this workspace yet.</Nothing>
        )}
      </CardSection>
      {summary.specs.length > 0 ? (
        <Rows>
          {summary.specs.map((spec) => (
            <Row key={spec.slug} meta={spec.blurb}>
              <Link href={`/dev/specs/${spec.slug}`} className={rowLink}>
                {spec.title}
              </Link>
            </Row>
          ))}
        </Rows>
      ) : (
        <Nothing>No spec describes this workspace yet.</Nothing>
      )}
    </div>
  );
}

function UiTab({ summary }: { summary: ModuleSummary }) {
  const review = summary.ui?.lastReview ?? null;
  const findings = summary.ui?.openFindings ?? [];
  return (
    <div className="space-y-4">
      <CardSection
        title="Last review"
        meta={uiLine(summary.ui)}
        action={
          <Link href={`/dev/ui/review?module=${summary.module.id}`} className={moreLink}>
            Open in Review
          </Link>
        }
      >
        {review?.note ? (
          <p className="whitespace-pre-wrap text-body text-ink">
            <LinkedText text={review.note} />
          </p>
        ) : (
          <Nothing>{review ? 'The pass left no note.' : 'Nobody has reviewed this workspace yet.'}</Nothing>
        )}
      </CardSection>
      {findings.length > 0 && (
        <Rows>
          {findings.map((finding) => (
            <Row
              key={finding.id}
              meta={[
                `${finding.file}${finding.line !== null ? `:${finding.line}` : ''}`,
                finding.law && `law ${finding.law}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              <span className="text-body text-ink">{finding.body}</span>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}

function UsageTab({ summary, now }: { summary: ModuleSummary; now: Date }) {
  const usage = summary.usage;
  const pages = [...(usage?.pages ?? []), ...summary.notOpened];
  return (
    <div className="space-y-4">
      {pages.length > 0 ? (
        <Rows>
          {pages.map((page) => (
            <li key={page.route} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-mono text-ui text-ink">{page.route}</span>
                <span className="block truncate text-small text-ink-muted">
                  last opened {openedText(page.lastOpened, now)}
                </span>
              </span>
              {page.opens30 > 0 && (
                <span className="shrink-0 text-ui text-ink tabular-nums">
                  {page.opens7} <span className="text-ink-muted">/ 7 days</span> · {page.opens30}{' '}
                  <span className="text-ink-muted">/ 30 days</span>
                </span>
              )}
            </li>
          ))}
        </Rows>
      ) : (
        <Nothing>No page in this workspace has been recorded yet.</Nothing>
      )}
      <Link href="/dev/usage" className={moreLink}>
        Every workspace in Usage
      </Link>
    </div>
  );
}

function OpenTab({ summary, tab, now }: { summary: ModuleSummary; tab: ModuleTab; now: Date }) {
  switch (tab) {
    case 'plan':
      return summary.features.length > 0 ? (
        <FeatureRows items={summary.features} />
      ) : (
        <Nothing>No open features.</Nothing>
      );
    case 'bugs':
      return summary.bugs.length > 0 ? (
        <BugRows rows={summary.bugs} />
      ) : (
        <Nothing>Nothing outstanding was filed from this workspace.</Nothing>
      );
    case 'ideas':
      return summary.ideas.length > 0 ? (
        <IdeaRows ideas={summary.ideas} />
      ) : (
        <Nothing>No live ideas for this workspace.</Nothing>
      );
    case 'spec':
      return <SpecTab summary={summary} />;
    case 'ui':
      return <UiTab summary={summary} />;
    case 'usage':
      return <UsageTab summary={summary} now={now} />;
    case 'changelog':
      return summary.shipped.length > 0 ? (
        <ShippedRows items={summary.shipped} />
      ) : (
        <Nothing>Nothing has shipped here yet.</Nothing>
      );
    case 'overview':
    default:
      return <Overview summary={summary} />;
  }
}

function spendValue(summary: ModuleSummary): string {
  const spend = summary.usage?.spend;
  return spend ? formatMicroDollars(spend.spend30) : 'None';
}

export function ModuleView({
  summary,
  tab,
  now,
}: {
  summary: ModuleSummary;
  tab: ModuleTab;
  now: Date;
}) {
  const properties = (
    <PropertyList>
      <Property label="Open steps" value={summary.openSteps} />
      <Property label="Bugs" value={summary.bugs.length} />
      <Property label="Ideas" value={summary.ideas.length} />
      <Property label="UI review" value={uiLine(summary.ui)} />
      <Property label="Opens, 30 days" value={summary.usage?.opens30 ?? 0} />
      <Property label="Spend, 30 days" value={spendValue(summary)} />
    </PropertyList>
  );

  return (
    <TabbedDetail
      crumbs={moduleCrumbs(summary.module)}
      title={summary.module.label}
      description={summary.module.description}
      properties={properties}
      tabs={moduleTabs(summary)}
      label="Module"
    >
      <OpenTab summary={summary} tab={tab} now={now} />
    </TabbedDetail>
  );
}
