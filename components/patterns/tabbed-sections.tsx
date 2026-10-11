import { Tabs } from '@/components/ui/tabs';
import type { Tab, TabAddress } from '@/lib/tabs';

/**
 * The tabbed sections pattern (docs/UI-QUALITY-SPEC.md, Part 4): a page whose
 * sections are peers, looked at one at a time, shows one behind a row of tabs
 * instead of stacking them all (plan #1626, drawn from the role page's tabs).
 * Account and a company's page are built on it (plan #1628), and the role
 * page is.
 *
 * It goes under the page's own header, in the page's one column. The tab is
 * in the address (`?tab=<id>`, lib/tabs.ts), so a reload, the back button and
 * a pasted link all return to it. The page decides which tab is open with
 * `tabFrom(searchParams.tab, tabs, address)`, the same answer the row draws,
 * and passes only that tab's content as `children`, so it loads only that
 * tab's data. Each tab may carry a count, so something waiting is not hidden
 * behind a tab nobody has opened.
 *
 * `address` is for a page whose tab is kept more richly than the plain
 * `?tab=`: an opening tab that depends on what is shown, ids a tab used to
 * go by, parameters that belong to one tab, and `#anchors` from before the
 * page had tabs (see `TabAddress`).
 *
 * Folds may sit inside a tab, since anything long can be folded away. A page
 * read top to bottom stays stacked, and two or three modes of one view (a
 * board and a list) are `Segmented` (components/ui/segmented.tsx), not tabs.
 * One thing with a column of properties beside its tabs is tabbed detail.
 */
export function TabbedSections({
  tabs,
  label,
  address,
  shallow,
  children,
  className,
}: {
  tabs: readonly Tab[];
  /** Names the row of tabs for a screen reader, such as "Account". */
  label: string;
  address?: TabAddress;
  /** For a page drawn in the browser that holds every tab's data (components/ui/tabs.tsx). */
  shallow?: boolean;
  /** The open tab's content, and only that tab's. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Tabs tabs={tabs} label={label} address={address} shallow={shallow} className="mb-5" />
      {children}
    </div>
  );
}
