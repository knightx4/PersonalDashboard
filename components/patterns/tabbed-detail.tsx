import { Breadcrumb, type Crumb } from '@/components/shell/breadcrumb';
import { PropertiesFold } from '@/components/patterns/properties-fold';
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
 * on the right and stay in place while the tab scrolls. With `glance`, the
 * phone shows only those facts in one row and folds the rest (plan #1688).
 *
 * Every tab is as wide as the row of tabs above it. A tab that capped its own
 * width read as narrower than the one beside it, so none does (plan #1688).
 *
 * The header is the title, its one line under it, then the actions on the
 * title's line at the right, at every width.
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
  glance,
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
  /**
   * The facts read first, as bare `Property`s: status, health and progress
   * on a feature. On a phone they are one row and `properties` folds under
   * "All details" beneath them, so the tabs stay on the first screen; from
   * laptop width they head the column. Without it every fact shows, as a grid
   * on a phone.
   */
  glance?: React.ReactNode;
  /** The facts, as `PropertyList` holding `Property`s; the rest of them when `glance` is given. */
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
        <header className="mb-5">
          <Breadcrumb crumbs={crumbs} className="mb-2" />
          {/* The title and its one line take what is left of the row, and
              the actions keep their width on the same line (plan #1688):
              with the row free to wrap, a title wider than the space beside
              the actions pushed them onto a line of their own. */}
          <div className="flex items-start gap-3">
            <h1 className="min-w-0 flex-1 font-display text-title tracking-tight text-ink [overflow-wrap:anywhere]">
              {title}
            </h1>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
          {/* The one line runs the header's full width, under the actions as
              well as the title, so it stays one line on a phone. */}
          {description && (
            <p className="mt-0.5 text-body text-ink-muted [overflow-wrap:anywhere]">
              {description}
            </p>
          )}
        </header>
      }
      properties={glance ? <PropertiesFold glance={glance}>{properties}</PropertiesFold> : properties}
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
