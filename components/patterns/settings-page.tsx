import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { Card, CardSection } from '@/components/ui/card';
import { sectionSubject } from '@/lib/core/section-path';
import { tabFrom, type Tab, type TabAddress } from '@/lib/tabs';
import { TabbedSections } from './tabbed-sections';

/**
 * The settings page pattern (plan #1937.10): every workspace's settings page,
 * at the foot of its column, reads the same way.
 *
 * A header naming the page, then the sections. Three or fewer stack as a
 * column of CardSections, read top to bottom. More than three go behind a
 * row of tabs (TabbedSections), one section at a time, with the open one in
 * the address as `?tab=<id>` so a reload or a pasted link returns to it; the
 * page passes `searchParams.tab` as `tab`.
 *
 * Fields save themselves (the save model on /dev/ui, "Forms"): settings are
 * settings-shaped, so there is no Save button. Build them from
 * components/patterns/settings-fields.tsx, whose fields save on blur, or on
 * the press for a switch or a choice, and say so in a quiet toast. Buttons
 * that do something now, such as starting a run, sit in a section beside the
 * fields and keep their own presses.
 *
 * Only what the workspace's own behaviour depends on belongs here. Name,
 * timezone and currency are under Account and are not repeated.
 */
export type SettingsSection = {
  /** The tab's id when the page is tabbed, and the section's anchor otherwise. */
  id: string;
  title: string;
  /** One line under the heading: what the section decides. */
  hint?: React.ReactNode;
  /**
   * The section's fields. On a tabbed page only the open tab's is drawn, so
   * pass a function to keep a closed tab from rendering at all.
   */
  content: React.ReactNode | (() => React.ReactNode);
};

/** More sections than this go behind tabs. */
export const SETTINGS_TABS_AFTER = 3;

export function SettingsPage({
  title,
  href,
  description,
  sections,
  tab,
  address,
}: {
  /** The page's name, such as "Learn settings". */
  title: string;
  /** The page's own address, for the header's place in the workspace. */
  href: string;
  /**
   * A line under the title. Usually left out: the critic reads a sentence on
   * the bare background as bare text, and a pointer to Account reads better
   * inside the section it concerns.
   */
  description?: React.ReactNode;
  sections: readonly SettingsSection[];
  /** `searchParams.tab`, which opens a tab on a page with more than three sections. */
  tab?: string | readonly string[];
  /**
   * How the tab is kept in the address, for a page that had `#anchor` links
   * before it had tabs: `anchors` sends each old anchor to the tab holding it.
   */
  address?: TabAddress;
}) {
  const tabbed = sections.length > SETTINGS_TABS_AFTER;
  const tabs: Tab[] = sections.map((section) => ({ id: section.id, label: section.title }));
  const open = tabbed ? tabFrom(tab, tabs, address) : null;

  return (
    <PageColumn>
      <PageHeader subject={sectionSubject(href, title)} title={title} description={description} />
      {tabbed ? (
        <TabbedSections tabs={tabs} label={title} address={address}>
          {sections
            .filter((section) => section.id === open)
            .map((section) => (
              <Section key={section.id} section={section} tabbed />
            ))}
        </TabbedSections>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <Section key={section.id} section={section} />
          ))}
        </div>
      )}
    </PageColumn>
  );
}

/**
 * One section's card. Behind a tab the card has no heading of its own: the
 * open tab right above it already names it (law 9).
 */
function Section({ section, tabbed }: { section: SettingsSection; tabbed?: boolean }) {
  const content = typeof section.content === 'function' ? section.content() : section.content;
  if (tabbed) {
    return (
      <Card id={section.id} padding="dense" data-slot="section">
        {section.hint && <p className="mb-3 text-small text-ink-muted">{section.hint}</p>}
        {content}
      </Card>
    );
  }
  return (
    <CardSection id={section.id} title={section.title} hint={section.hint}>
      {content}
    </CardSection>
  );
}
