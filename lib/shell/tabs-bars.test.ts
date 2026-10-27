import { describe, expect, it } from 'vitest';
import type { NavSection } from '@/components/shell/app-shell';
import { tabsFor, withBadges, type TabWorkspace } from './tabs';

/**
 * The Dev, Jobs, Learn and Shopping bars as their layouts wrote them before
 * they were built from lib/shell/tabs.ts (plan #2208.2), copied from those
 * layouts with a badge of 7 where each carried one. Each layout now calls
 * withBadges(tabsFor(workspace, owner), { [href]: count }) the same way.
 */
const BEFORE: Record<
  string,
  { workspace: TabWorkspace; owner: boolean; badge: string; bar: NavSection[] }
> = {
  dev: {
    workspace: 'dev',
    owner: true,
    badge: '/dev/inbox',
    bar: [
      { href: '/dev/raised', label: 'Now', icon: 'devHome' },
      { href: '/dev/inbox', label: 'Inbox', icon: 'inbox', badge: 7 },
      { href: '/dev/plan', label: 'Plan', icon: 'plan' },
      { href: '/dev/projects', label: 'Projects', icon: 'project' },
      { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
      { href: '/dev/ideas', label: 'Ideas', icon: 'ideas' },
      { href: '/dev/inspiration', label: 'Inspiration', icon: 'inspiration' },
      { href: '/dev/specs', label: 'Specs', icon: 'specs' },
      { href: '/dev/modules', label: 'Modules', icon: 'modules' },
      { href: '/dev/ui', label: 'UI', icon: 'ui' },
      { href: '/dev/surfaces', label: 'Surfaces', icon: 'surfaces' },
      { href: '/dev/usage', label: 'Usage', icon: 'usage' },
      { href: '/dev/changelog', label: 'Changelog', icon: 'changelog' },
      { href: '/dev/posts', label: 'Posts', icon: 'posts' },
    ],
  },
  jobs: {
    workspace: 'jobs',
    owner: false,
    badge: '/jobs/inbox',
    bar: [
      { href: '/jobs', label: 'Now', icon: 'jobsHome', exact: true },
      {
        href: '/jobs/inbox',
        label: 'Inbox',
        icon: 'inbox',
        alsoMatches: ['/jobs/review'],
        badge: 7,
      },
      { href: '/jobs/pipeline', label: 'Pipeline', icon: 'pipeline' },
      { href: '/jobs/follow-ups', label: 'Follow-ups', icon: 'followUps' },
      { href: '/jobs/activity', label: 'Activity', icon: 'activity' },
      { href: '/jobs/find', label: 'Find', icon: 'find' },
      { href: '/jobs/companies', label: 'Companies', icon: 'companies' },
      { href: '/jobs/contacts', label: 'Contacts', icon: 'contacts' },
      { href: '/jobs/material', label: 'Material', icon: 'answers' },
      { href: '/jobs/analytics', label: 'Analytics', icon: 'analytics' },
    ],
  },
  shopping: {
    workspace: 'shopping',
    owner: false,
    badge: '/shopping/inbox',
    bar: [
      { href: '/shopping/dashboard', label: 'Now', icon: 'dashboard' },
      {
        href: '/shopping/inbox',
        label: 'Inbox',
        icon: 'inbox',
        alsoMatches: ['/shopping/review'],
        badge: 7,
      },
      { href: '/shopping/orders', label: 'Orders', icon: 'orders' },
      { href: '/shopping/inventory', label: 'Inventory', icon: 'inventory' },
      { href: '/shopping/sell', label: 'Sell', icon: 'sell' },
      { href: '/shopping/returns', label: 'Returns', icon: 'returns' },
      { href: '/shopping/recurring', label: 'Recurring', icon: 'recurring' },
      { href: '/shopping/saved', label: 'Saved', icon: 'saved' },
      { href: '/shopping/share', label: 'Share', icon: 'share' },
    ],
  },
};

const LEARN_SHARED: NavSection[] = [
  { href: '/learn/now', label: 'Now', icon: 'readNow', exact: true },
  { href: '/learn/inbox', label: 'Inbox', icon: 'inbox', exact: true, badge: 7 },
  {
    href: '/learn/know',
    label: 'Subjects',
    icon: 'know',
    exact: true,
    alsoMatches: ['/learn/s/', '/learn/c/', '/learn/quiz', '/learn/topics'],
  },
  { href: '/learn/space', label: 'Idea Space', icon: 'ideaSpace', exact: true },
  {
    href: '/learn/essays',
    label: 'Essays',
    icon: 'essays',
    exact: true,
    alsoMatches: ['/learn/e/'],
  },
  {
    href: '/learn/lists',
    label: 'Reading lists',
    icon: 'tracks',
    exact: true,
    alsoMatches: ['/learn/t/', '/learn/r/'],
  },
];
const LEARN_VIDEOS: NavSection = {
  href: '/learn/videos',
  label: 'Videos',
  icon: 'videos',
  exact: true,
  alsoMatches: ['/learn/videos/', '/learn/clips', '/learn/youtube'],
};

describe('the Dev, Jobs, Learn and Shopping bars built from the list (plan #2208.2)', () => {
  for (const [name, { workspace, owner, badge, bar }] of Object.entries(BEFORE)) {
    it(`draws ${name}'s bar as it was`, () => {
      expect(withBadges(tabsFor(workspace, owner), { [badge]: 7 })).toEqual(bar);
    });
  }

  it("draws Learn's bar as it was, with Videos for the owner alone", () => {
    expect(withBadges(tabsFor('learn', true), { '/learn/inbox': 7 })).toEqual([
      ...LEARN_SHARED,
      LEARN_VIDEOS,
    ]);
    expect(withBadges(tabsFor('learn', false), { '/learn/inbox': 7 })).toEqual(LEARN_SHARED);
  });

  it('keeps a badge of zero, which the layouts passed through as before', () => {
    const inbox = withBadges(tabsFor('jobs', true), { '/jobs/inbox': 0 }).find(
      (tab) => tab.href === '/jobs/inbox',
    );
    expect(inbox?.badge).toBe(0);
  });
});
