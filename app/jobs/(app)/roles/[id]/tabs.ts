import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * The role page's tabs, as the values its `?tab=` address takes.
 *
 * The ids are older than some of the labels: `answers` is the Application
 * tab (note b4cecf70) and `notes` the Comments tab (note 89ad8bef). They stay
 * as they are so that links already written land on the right tab.
 */
export const ROLE_TABS = ['timeline', 'posting', 'answers', 'interviews', 'notes', 'mail'] as const;

export type RoleTab = (typeof ROLE_TABS)[number];

/** The tab a `?tab=` value names, or none when it names no tab here. */
export function roleTabFrom(value: string | null | undefined): RoleTab | undefined {
  return ROLE_TABS.find((tab) => tab === value);
}

/**
 * The tab a stage opens on, for the stages that open on something other than
 * the timeline. Empty for now: every role page opens on its timeline until
 * the stage-led page (plan #1594) fills it in.
 */
const OPENS_ON: Partial<Record<ApplicationStatus, RoleTab>> = {};

/** The tab a role page opens on when its address names none. */
export function defaultRoleTab(status: ApplicationStatus): RoleTab {
  return OPENS_ON[status] ?? 'timeline';
}

/**
 * The address of one tab, from the page's current query string.
 *
 * Every other parameter is kept, except the interview to scroll to: that one
 * belongs to the Interviews tab and means nothing once you have left it.
 */
export function roleTabSearch(current: string, tab: RoleTab): string {
  const params = new URLSearchParams(current);
  params.set('tab', tab);
  if (tab !== 'interviews') params.delete('interview');
  return `?${params.toString()}`;
}
