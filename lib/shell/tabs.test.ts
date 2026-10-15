import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_IDS } from '@/lib/modules';
import { scanPageRoutes } from '@/lib/usage/scan';
import { TAB_WORKSPACES, WORKSPACE_TABS, tabsFor, withBadges } from './tabs';

const PAGES = new Set(scanPageRoutes(join(process.cwd(), 'app')));

describe('the tabs of every workspace (plan #2208.1)', () => {
  it('has tabs for Home and every workspace', () => {
    expect([...TAB_WORKSPACES].sort()).toEqual(['home', ...MODULE_IDS].sort());
    for (const workspace of TAB_WORKSPACES) {
      expect(WORKSPACE_TABS[workspace].length, workspace).toBeGreaterThan(0);
    }
  });

  it('points every tab at a page under app/', () => {
    const missing = TAB_WORKSPACES.flatMap((workspace) =>
      WORKSPACE_TABS[workspace]
        .filter((tab) => !PAGES.has(tab.href))
        .map((tab) => `${workspace}: ${tab.href}`),
    );
    expect(missing).toEqual([]);
  });

  it('lists each address once within a workspace', () => {
    for (const workspace of TAB_WORKSPACES) {
      const hrefs = WORKSPACE_TABS[workspace].map((tab) => tab.href);
      expect(new Set(hrefs).size, workspace).toBe(hrefs.length);
    }
  });

  it("keeps Learn's Videos tab to the owner", () => {
    expect(tabsFor('learn', true).map((tab) => tab.href)).toContain('/learn/videos');
    expect(tabsFor('learn', false).map((tab) => tab.href)).not.toContain('/learn/videos');
  });

  it("keeps Dev's tabs to the owner", () => {
    expect(tabsFor('dev', true).length).toBeGreaterThan(0);
    expect(tabsFor('dev', false)).toEqual([]);
  });

  it('hands back sections without the owner flag', () => {
    for (const tab of tabsFor('learn', true)) expect(tab).not.toHaveProperty('ownerOnly');
  });

  it('puts badges on by href and leaves the rest bare', () => {
    const sections = withBadges(tabsFor('jobs', false), {
      '/jobs/inbox': 3,
      '/jobs/find': undefined,
    });
    expect(sections.find((tab) => tab.href === '/jobs/inbox')?.badge).toBe(3);
    expect(sections.find((tab) => tab.href === '/jobs/find')).not.toHaveProperty('badge');
  });
});
