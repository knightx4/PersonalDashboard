import type { Tab, TabAddress } from '@/lib/tabs';

/**
 * The two tabs of Jobs' Now (plan #1496.7.2): the overview it opens on, and
 * the activity feed with the button that checks the inbox now, which had a
 * page and a tab of its own at /jobs/activity until then.
 */
export const NOW_TABS: readonly Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
];

export type NowTab = 'overview' | 'activity';

/** `/jobs#activity` lands on the Activity tab as well as `?tab=activity`. */
export const NOW_TAB_ADDRESS: TabAddress = { anchors: { activity: 'activity' } };

/**
 * Where the whole feed is. The old address redirects here, and Since you last
 * looked, the status line's brief and the updates list all link to it.
 */
export const ACTIVITY_HREF = '/jobs?tab=activity';
