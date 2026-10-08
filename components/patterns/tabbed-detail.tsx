import { PageHeader } from '@/components/shell/page-header';
import type { Crumb } from '@/components/shell/breadcrumb';
import { DetailLayout } from '@/components/shell/detail-layout';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import type { Tab } from '@/lib/tabs';

/**
 * The tabbed detail pattern (docs/UI-QUALITY-SPEC.md, Part 4): one thing's
 * page with breadcrumbs, a title, a row of tabs and a column of its
 * properties, laid out after Linear's project page (decision #1661). The
 * feature page on /dev/plan and the goal page are built from it.
 *
 * It is `DetailLayout` with the tabs put above the body, so the order on a
 * phone is the crumbs and title, the properties as a grid of facts, then the
 * tabs and the open tab. From laptop width the properties move into a column
 * on the right and stay in place while the tab scrolls.
 *
 * No body text sits straight on the page background (plan #1686, taste
 * `no-bare-text`). `DetailLayout` draws the properties on a card, as a column
 * from laptop width and as the grid of facts on a phone. A tab's paragraphs, done-when and lists go on cards too:
 * `DetailCard` holds them, each under a `DetailPart` heading. Headings,
 * breadcrumbs, tab labels and a one-line count may stay on the background.
 *
 * The page decides which tab is open, with `tabFrom(searchParams.tab, tabs)`
 * from lib/tabs.ts, and passes only that tab's content as `children`. The
 * tabs read the same parameter from the address, so the two agree.
 */
export function TabbedDetail({
  crumbs,
  title,
  description,
  actions,
  properties,
  tabs,
  label,
  children,
  className,
}: {
  /** The path down to this page, the last part this page. */
  crumbs: readonly Crumb[];
  title: React.ReactNode;
  /** One line under the title: what kind of thing this is, or its state. */
  description?: React.ReactNode;
  /** The action that belongs to the whole page, whatever tab is open. */
  actions?: React.ReactNode;
  /** The facts, as `PropertyList` holding `Property`s. */
  properties: React.ReactNode;
  tabs: readonly Tab[];
  /** Names the row of tabs for a screen reader, such as "Feature". */
  label: string;
  /** The open tab's content, and only that tab's. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DetailLayout
      className={className}
      header={
        <PageHeader crumbs={crumbs} title={title} description={description} actions={actions} />
      }
      properties={properties}
    >
      <Tabs tabs={tabs} label={label} className="mb-5" />
      {children}
    </DetailLayout>
  );
}

/**
 * The card a tab's text sits on: a paragraph, the done-when, what it waits on.
 * Several parts of one thing go on one card, each under a `DetailPart`, rather
 * than a card each, so the Overview reads as one account of the thing.
 */
export function DetailCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card padding="standard" className={cn('space-y-4', className)}>
      {children}
    </Card>
  );
}

/** One labelled part of a `DetailCard`. Without a label it is the lead paragraph. */
export function DetailPart({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      {label && (
        <h2 className="text-small font-semibold uppercase tracking-wide text-ink-muted">{label}</h2>
      )}
      {children}
    </section>
  );
}
