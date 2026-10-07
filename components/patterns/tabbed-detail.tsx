import { PageHeader } from '@/components/shell/page-header';
import type { Crumb } from '@/components/shell/breadcrumb';
import { DetailLayout } from '@/components/shell/detail-layout';
import { Tabs } from '@/components/ui/tabs';
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
