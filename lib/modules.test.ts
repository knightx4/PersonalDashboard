import { describe, expect, it } from 'vitest';
import {
  MODULE_IDS,
  moduleForPath,
  moduleIdsFor,
  modulesFor,
  switchableModules,
} from '@/lib/modules';

describe('moduleForPath', () => {
  it('reads the workspace off the path', () => {
    expect(moduleForPath('/jobs/today')).toBe('jobs');
    expect(moduleForPath('/dev')).toBe('dev');
  });

  it('is null for a path outside every workspace, and for no path at all', () => {
    expect(moduleForPath('/account/settings')).toBeNull();
    expect(moduleForPath(null)).toBeNull();
  });

  it('does not mistake a longer segment for a prefix', () => {
    expect(moduleForPath('/todoist')).toBeNull();
  });
});

/**
 * Dev belongs to one account, and the app has three.
 *
 * The rule is a filter over this list rather than a check on each page, so
 * every list of workspaces -- the switcher, the phone's sheet, ⌘K, the home
 * tiles, the account page's checkboxes and the action behind them -- drops it
 * for everybody else by asking the same question. These are that question.
 */
describe('modulesFor', () => {
  it('gives the owner every workspace', () => {
    expect(modulesFor(true).map((module) => module.id)).toEqual(MODULE_IDS);
  });

  it('drops the owner-only ones for anybody else, and keeps the rest', () => {
    const ids = moduleIdsFor(false);
    expect(ids).not.toContain('dev');
    expect(ids).toContain('shopping');
    expect(ids.length).toBe(MODULE_IDS.length - 1);
  });
});

describe('switchableModules', () => {
  it('keeps the account to what it switched on', () => {
    expect(switchableModules(['shopping', 'todo'], true)).toEqual(['shopping', 'todo']);
  });

  it('offers every allowed workspace when the settings are not known yet', () => {
    expect(switchableModules(undefined, true)).toEqual(MODULE_IDS);
    expect(switchableModules(undefined, false)).not.toContain('dev');
  });

  it('will not switch to dev on a stale setting from another account', () => {
    // enabled_modules is a text[] written before the rule existed, so somebody
    // else's row can still name dev. The list is intersected rather than
    // trusted.
    expect(switchableModules(['shopping', 'dev'], false)).toEqual(['shopping']);
    expect(switchableModules(['shopping', 'dev'], true)).toEqual(['shopping', 'dev']);
  });
});
