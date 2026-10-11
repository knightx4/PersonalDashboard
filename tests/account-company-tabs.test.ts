import { describe, expect, it } from 'vitest';
import { ACCOUNT_TAB_ADDRESS, ACCOUNT_TABS } from '@/app/account/tabs';
import { companyTabFrom } from '@/app/jobs/(app)/companies/[slug]/tabs';
import { PUSH_SETTINGS_HREF } from '@/lib/watch/start';
import { tabForAnchor, tabFrom } from '@/lib/tabs';

// Account and a company's page, one section at a time behind tabs (plan #1628).
describe('account tabs', () => {
  it('opens on You when the address names no tab', () => {
    expect(tabFrom(undefined, ACCOUNT_TABS, ACCOUNT_TAB_ADDRESS)).toBe('you');
    expect(tabFrom('nonsense', ACCOUNT_TABS, ACCOUNT_TAB_ADDRESS)).toBe('you');
  });

  it('sends the link Dash gives when push is off to the Notifications tab', () => {
    const url = new URL(PUSH_SETTINGS_HREF, 'https://dash.example');
    expect(url.pathname).toBe('/account');
    expect(tabFrom(url.searchParams.get('tab'), ACCOUNT_TABS, ACCOUNT_TAB_ADDRESS)).toBe(
      'notifications',
    );
  });

  it('moves the old #notifications anchor onto its tab', () => {
    expect(tabForAnchor('#notifications', '', ACCOUNT_TABS, ACCOUNT_TAB_ADDRESS)).toBe(
      'notifications',
    );
  });
});

describe('company tabs', () => {
  it('opens on Roles, and on a named tab when the address has one', () => {
    expect(companyTabFrom(null)).toBe('roles');
    expect(companyTabFrom('people')).toBe('people');
    expect(companyTabFrom('nonsense')).toBe('roles');
  });
});
