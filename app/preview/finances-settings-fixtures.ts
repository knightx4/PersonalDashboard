import type { LinkedInstitution } from '@/app/finances/settings/linked-accounts';

/**
 * Finances settings fixtures (plan #2593.3): Chase with checking, savings and
 * both cards, and a brokerage with the longest account names Fidelity gives.
 */
export const FINANCES_LINKS: LinkedInstitution[] = [
  {
    id: '00000000-0000-4000-8000-0000000000c1',
    institutionId: 'ins_56',
    institutionName: 'Chase',
    needsUpdate: false,
    lastError: null,
    linkedAt: '2026-10-21T15:04:00Z',
    lastSyncedAt: '2026-10-28T06:10:00Z',
    accounts: [
      { name: 'Total Checking', mask: '4417' },
      { name: 'Chase Savings', mask: '9020' },
      { name: 'Sapphire Preferred', mask: '3381' },
      { name: 'Freedom Unlimited', mask: '7752' },
    ],
  },
  {
    id: '00000000-0000-4000-8000-0000000000f1',
    institutionId: 'ins_12',
    institutionName: 'Fidelity Investments',
    needsUpdate: false,
    lastError: null,
    linkedAt: '2026-10-22T18:30:00Z',
    lastSyncedAt: null,
    accounts: [
      { name: 'Individual - TOD Brokerage Account', mask: '1186' },
      { name: 'Roth IRA', mask: '5502' },
    ],
  },
];

/** The same, with Chase asking for its sign-in again. */
export const FINANCES_LINKS_NEEDS_SIGN_IN: LinkedInstitution[] = [
  {
    ...FINANCES_LINKS[0]!,
    needsUpdate: true,
    lastError: 'the login details of this item have changed',
  },
  FINANCES_LINKS[1]!,
];
