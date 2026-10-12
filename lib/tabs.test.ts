import { describe, expect, it } from 'vitest';
import { tabForAnchor, tabFrom, tabNamed, tabSearch, type Tab, type TabAddress } from './tabs';

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'steps', label: 'Steps', count: 4 },
];

describe('tabFrom', () => {
  it('opens the tab the address names', () => {
    expect(tabFrom('steps', TABS)).toBe('steps');
  });

  it('opens the first tab with no value, an unknown one or a repeated one', () => {
    expect(tabFrom(undefined, TABS)).toBe('overview');
    expect(tabFrom(null, TABS)).toBe('overview');
    expect(tabFrom('', TABS)).toBe('overview');
    expect(tabFrom('nope', TABS)).toBe('overview');
    expect(tabFrom(['steps', 'activity'], TABS)).toBe('overview');
  });
});

describe('tabSearch', () => {
  it('sets the tab and keeps the other parameters', () => {
    expect(tabSearch('s=pattern-tabbed', 'steps', TABS)).toBe('?s=pattern-tabbed&tab=steps');
    expect(tabSearch('?tab=steps&s=x', 'activity', TABS)).toBe('?tab=activity&s=x');
  });

  it('drops the parameter for the first tab', () => {
    expect(tabSearch('tab=steps', 'overview', TABS)).toBe('');
    expect(tabSearch('s=x&tab=steps', 'overview', TABS)).toBe('?s=x');
  });

  it('takes a parameter name of its own', () => {
    expect(tabSearch('s=x', 'steps', TABS, 'section')).toBe('?s=x&section=steps');
  });
});

describe('a page address (the tabbed sections pattern)', () => {
  it('opens on the tab the page says, and drops the parameter for that one', () => {
    const address: TabAddress = { opensOn: 'steps' };
    expect(tabFrom(null, TABS, address)).toBe('steps');
    expect(tabFrom('nope', TABS, address)).toBe('steps');
    expect(tabSearch('tab=activity', 'steps', TABS, address)).toBe('');
    expect(tabSearch('', 'overview', TABS, address)).toBe('?tab=overview');
  });

  it('writes every tab when the page asks', () => {
    expect(tabSearch('', 'overview', TABS, { alwaysWrite: true })).toBe('?tab=overview');
  });

  it('reads a former id as the tab it became', () => {
    const address: TabAddress = { former: { notifications: 'activity' } };
    expect(tabNamed('notifications', TABS, address)).toBe('activity');
    expect(tabFrom('notifications', TABS, address)).toBe('activity');
    expect(tabNamed('nope', TABS, address)).toBeUndefined();
  });

  it('drops a parameter that belongs to another tab', () => {
    const address: TabAddress = { belongsTo: { step: 'steps' } };
    expect(tabSearch('tab=steps&step=4&s=x', 'activity', TABS, address)).toBe('?tab=activity&s=x');
    expect(tabSearch('step=4', 'steps', TABS, address)).toBe('?step=4&tab=steps');
  });

  it('lands an old #anchor on the tab that holds it, unless the link names a tab', () => {
    const address: TabAddress = { anchors: { history: 'activity' } };
    expect(tabForAnchor('#history', '', TABS, address)).toBe('activity');
    expect(tabForAnchor('#history', 'from=mail', TABS, address)).toBe('activity');
    expect(tabForAnchor('#history', 'tab=steps', TABS, address)).toBeUndefined();
    expect(tabForAnchor('#elsewhere', '', TABS, address)).toBeUndefined();
    expect(tabForAnchor('', '', TABS, address)).toBeUndefined();
  });
});
