import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { tabNamed, tabSearch, type TabAddress } from '@/lib/tabs';

/**
 * The role page's tabs, as the values its `?tab=` address takes.
 *
 * The ids are older than some of the labels: `answers` is the Application
 * tab (note b4cecf70) and `notes` the Comments tab (note 89ad8bef). They stay
 * as they are so that links already written land on the right tab.
 */
export const ROLE_TABS = ['timeline', 'posting', 'answers', 'interviews', 'notes', 'mail'] as const;

export type RoleTab = (typeof ROLE_TABS)[number];

const IDS = ROLE_TABS.map((id) => ({ id }));

/**
 * How the role page keeps its tab in the address (the tabbed sections
 * pattern, lib/tabs.ts). Every tab is written, since the tab it opens on
 * changes with the stage; and the interview to scroll to belongs to the
 * Interviews tab and means nothing once you have left it.
 */
export const ROLE_TAB_ADDRESS = {
  alwaysWrite: true,
  belongsTo: { interview: 'interviews' },
} as const satisfies TabAddress;

/** The tab a `?tab=` value names, or none when it names no tab here. */
export function roleTabFrom(value: string | null | undefined): RoleTab | undefined {
  return tabNamed(value, IDS, ROLE_TAB_ADDRESS) as RoleTab | undefined;
}

/**
 * The tab a stage opens on, for the stages that open on something other than
 * the timeline (plan #1594). A lead is read for its posting and requirement
 * map, an application being written for its questions, and one in
 * interviews for its rounds. Sent and waiting, and closed, open on the
 * timeline, which is what has happened to it.
 */
const OPENS_ON: Partial<Record<ApplicationStatus, RoleTab>> = {
  lead: 'posting',
  drafting: 'answers',
  in_process: 'interviews',
  final_round: 'interviews',
  offer: 'interviews',
};

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
  return tabSearch(current, tab, IDS, ROLE_TAB_ADDRESS);
}
