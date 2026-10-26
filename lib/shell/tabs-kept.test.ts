import { describe, expect, it } from 'vitest';
import type { NavSection } from '@/components/shell/app-shell';
import { HOME_SECTIONS } from '@/lib/home/sections';
import { tabsFor, withBadges, type TabWorkspace } from './tabs';

/**
 * Goals, News, Todo, Vault, You and Home kept the bars they had when their
 * layouts moved onto the shared list (plan #2208.3). Each array below is the
 * one its layout held before, copied as it stood, so a change to the list that
 * moves, renames or drops one of these tabs fails here. When a bar is meant to
 * change, change it here too.
 */
const BEFORE: Partial<Record<TabWorkspace, NavSection[]>> = {
  goals: [
    { href: '/goals', label: 'Now', icon: 'goalsHome', exact: true },
    { href: '/goals/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/goals/all', label: 'All goals', icon: 'goalsAll' },
  ],
  news: [
    { href: '/news', label: 'Now', icon: 'quickRead', exact: true },
    { href: '/news/inbox', label: 'Inbox', icon: 'inbox', exact: true },
    { href: '/news/review', label: 'Daily review', icon: 'dailyReview', exact: true },
    {
      href: '/news/all',
      label: 'Newsletters',
      icon: 'newsletters',
      exact: true,
      alsoMatches: ['/news/i/'],
    },
    { href: '/news/saved', label: 'Saved', icon: 'saved', exact: true },
  ],
  todo: [
    { href: '/todo', label: 'Now', icon: 'agenda', exact: true },
    { href: '/todo/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/todo/waiting', label: 'Waiting', icon: 'waiting' },
    { href: '/todo/calendar', label: 'Calendar', icon: 'calendar' },
    { href: '/todo/all', label: 'All', icon: 'tasks' },
  ],
  vault: [
    { href: '/vault', label: 'Now', icon: 'notes', exact: true, alsoMatches: ['/vault/n/'] },
    { href: '/vault/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/vault/triage', label: 'Triage', icon: 'triage' },
    { href: '/vault/map', label: 'Map', icon: 'vaultMap' },
    { href: '/vault/maya', label: 'Maya', icon: 'maya' },
  ],
  you: [
    { href: '/you/personality', label: 'Personality', icon: 'personality' },
    { href: '/you/details', label: 'Details', icon: 'details' },
    { href: '/you/places', label: 'Places', icon: 'places' },
    { href: '/you/work', label: 'Work & school', icon: 'workSchool', exact: true },
    { href: '/you/insights', label: 'Insights', icon: 'insights', exact: true },
    { href: '/you/board', label: 'Board', icon: 'board' },
  ],
  home: [
    { href: '/home', label: 'Now', icon: 'home', exact: true, alsoMatches: ['/home/week'] },
    { href: '/home/inbox', label: 'Inbox', icon: 'inbox' },
  ],
};

describe('the bars Goals, News, Todo, Vault, You and Home kept (plan #2208.3)', () => {
  for (const [workspace, before] of Object.entries(BEFORE) as [TabWorkspace, NavSection[]][]) {
    it(`gives ${workspace} the same tabs in the same order, owner or not`, () => {
      expect(tabsFor(workspace, true)).toEqual(before);
      expect(tabsFor(workspace, false)).toEqual(before);
    });
  }

  it("builds Home's rooms from the list", () => {
    expect(HOME_SECTIONS).toEqual(BEFORE.home);
  });

  it("puts the Goals Inbox count on the Inbox tab alone, and none when the read failed", () => {
    const counted = withBadges(tabsFor('goals', true), { '/goals/inbox': 4 });
    expect(counted.map((tab) => tab.badge)).toEqual([undefined, 4, undefined]);
    const failed = withBadges(tabsFor('goals', true), { '/goals/inbox': undefined });
    expect(failed).toEqual(BEFORE.goals);
  });
});
